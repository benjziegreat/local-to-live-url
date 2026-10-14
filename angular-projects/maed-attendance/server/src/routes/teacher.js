const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../lib/auth');
const { asyncHandler, HttpError, rosterName } = require('../lib/http');
const { dateOnly, addDays, isoWeekday, isoWeekdayUtc, parseDay, dayKey } = require('../lib/time');
const { ATTENDED } = require('../lib/risk');
const { currentSchedule } = require('../lib/attendance');

const router = express.Router();
router.use(authenticate, requireRole('TEACHER'));

const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'CUTTING'];
const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function loadOwnSchedule(teacherId, scheduleId) {
  const schedule = await prisma.classSchedule.findFirst({
    where: { id: Number(scheduleId), subject: { teacherId } },
    include: { subject: true, section: true },
  });
  if (!schedule) throw new HttpError(404, 'Class not found in your schedule');
  return schedule;
}

/** All of the teacher's subjects with their weekly time slots. */
router.get(
  '/schedules',
  asyncHandler(async (req, res) => {
    const subjects = await prisma.subject.findMany({
      where: { teacherId: req.user.id },
      include: { schedules: { include: { section: true }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] } },
      orderBy: { name: 'asc' },
    });
    res.json({
      today: isoWeekday(),
      subjects: subjects.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        schedules: s.schedules.map((sc) => ({
          id: sc.id,
          dayOfWeek: sc.dayOfWeek,
          day: WEEKDAY[sc.dayOfWeek],
          startTime: sc.startTime,
          endTime: sc.endTime,
          room: sc.room,
          section: sc.section.name,
        })),
      })),
    });
  }),
);

/** Live roster: every student in the class section with location + today's mark. */
router.get(
  '/roster/:scheduleId',
  asyncHandler(async (req, res) => {
    const schedule = await loadOwnSchedule(req.user.id, req.params.scheduleId);
    const date = parseDay(req.query.date);
    // Live location only means something while this class is actually in session.
    const live =
      dayKey(date) === dayKey(dateOnly()) && schedule.dayOfWeek === isoWeekday() && !!currentSchedule([schedule]);

    const students = await prisma.student.findMany({
      where: { sectionId: schedule.sectionId },
      include: {
        user: true,
        attendance: { where: { scheduleId: schedule.id, date } },
        alerts: { where: { subjectId: schedule.subjectId, createdAt: { gte: addDays(dateOnly(), -1) } } },
      },
      orderBy: { user: { lastName: 'asc' } },
    });

    res.json({
      schedule: {
        id: schedule.id,
        subject: schedule.subject.name,
        subjectId: schedule.subjectId,
        section: schedule.section.name,
        room: schedule.room,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      },
      date: dayKey(date),
      live,
      students: students.map((st) => {
        const inThisRoom = live && st.location === 'IN_ROOM' && st.currentRoom === schedule.room;
        return {
          id: st.id,
          name: rosterName(st.user),
          avatarHue: st.user.avatarHue,
          studentNo: st.studentNo,
          location: st.location,
          currentRoom: st.currentRoom,
          inThisRoom,
          // On campus but not in this class's room = possible cutting
          suspectedCutting: live && st.location !== 'OFF_CAMPUS' && !inThisRoom,
          lastSeenAt: st.lastSeenAt,
          status: st.attendance[0]?.status || null,
          alertRaised: st.alerts.length > 0,
        };
      }),
    });
  }),
);

router.post(
  '/attendance',
  asyncHandler(async (req, res) => {
    const { scheduleId, studentId, status, note } = req.body || {};
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid attendance status');
    const schedule = await loadOwnSchedule(req.user.id, scheduleId);
    const student = await prisma.student.findFirst({ where: { id: Number(studentId), sectionId: schedule.sectionId } });
    if (!student) throw new HttpError(404, 'Student is not in this class');

    const date = parseDay(req.body?.date);
    const record = await prisma.attendanceRecord.upsert({
      where: { studentId_scheduleId_date: { studentId: student.id, scheduleId: schedule.id, date } },
      update: { status, markedById: req.user.id, markedAt: new Date(), note: note || null, locationAtCheck: student.location },
      create: {
        studentId: student.id,
        scheduleId: schedule.id,
        date,
        status,
        markedById: req.user.id,
        note: note || null,
        locationAtCheck: student.location,
      },
    });

    if (status === 'CUTTING') {
      await prisma.alert.create({
        data: {
          studentId: student.id,
          raisedById: req.user.id,
          subjectId: schedule.subjectId,
          type: 'CUTTING',
          message: `Flagged for cutting ${schedule.subject.name} (${schedule.startTime}, ${schedule.room}). Last known location: ${student.location.replace('_', ' ').toLowerCase()}${student.currentRoom ? ` (${student.currentRoom})` : ''}.`,
        },
      });
    }
    res.json(record);
  }),
);

/** Early alert to the student's adviser. */
router.post(
  '/alerts',
  asyncHandler(async (req, res) => {
    const { scheduleId, studentId, message } = req.body || {};
    const schedule = await loadOwnSchedule(req.user.id, scheduleId);
    const student = await prisma.student.findFirst({ where: { id: Number(studentId), sectionId: schedule.sectionId } });
    if (!student) throw new HttpError(404, 'Student is not in this class');

    const alert = await prisma.alert.create({
      data: {
        studentId: student.id,
        raisedById: req.user.id,
        subjectId: schedule.subjectId,
        type: 'EARLY_WARNING',
        message: (message && String(message).trim()) || `Early attendance warning raised from ${schedule.subject.name}.`,
      },
    });
    res.status(201).json(alert);
  }),
);

/** Attendance rate for one subject over the last 7 school days (Sundays skipped). */
router.get(
  '/trends/:subjectId',
  asyncHandler(async (req, res) => {
    const subject = await prisma.subject.findFirst({ where: { id: Number(req.params.subjectId), teacherId: req.user.id } });
    if (!subject) throw new HttpError(404, 'Subject not found');

    const days = [];
    for (let d = dateOnly(); days.length < 7; d = addDays(d, -1)) {
      if (isoWeekdayUtc(d) !== 7) days.unshift(d);
    }

    const records = await prisma.attendanceRecord.findMany({
      where: { schedule: { subjectId: subject.id }, date: { gte: days[0] } },
      select: { date: true, status: true },
    });

    res.json(
      days.map((d) => {
        const key = dayKey(d);
        const dayRecords = records.filter((r) => dayKey(r.date) === key);
        const attended = dayRecords.filter((r) => ATTENDED.has(r.status)).length;
        return {
          date: key,
          label: WEEKDAY[isoWeekdayUtc(d)],
          rate: dayRecords.length ? Math.round((attended / dayRecords.length) * 100) : null,
          total: dayRecords.length,
        };
      }),
    );
  }),
);

module.exports = router;
