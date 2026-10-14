const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { insideGeofence } = require('../lib/geo');
const { summarize, healthLabel } = require('../lib/risk');
const { dateOnly, addDays } = require('../lib/time');
const { todaysSchedules, currentSchedule, autoCheckIn } = require('../lib/attendance');

const router = express.Router();
router.use(authenticate, requireRole('STUDENT'));

async function loadStudent(userId) {
  const student = await prisma.student.findUnique({
    where: { userId },
    include: { user: true, section: { include: { adviser: true } } },
  });
  if (!student) throw new HttpError(404, 'Student profile not found');
  return student;
}

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const student = await loadStudent(req.user.id);
    const now = new Date();
    const today = dateOnly(now);

    const [geofence, gateLogs, schedules, todayRecords, history, excuseNotes, allSchedules] = await Promise.all([
      prisma.geofence.findFirst({ orderBy: { id: 'asc' } }),
      prisma.gateLog.findMany({ where: { studentId: student.id }, orderBy: { timestamp: 'desc' }, take: 8 }),
      todaysSchedules(student.sectionId, now),
      prisma.attendanceRecord.findMany({ where: { studentId: student.id, date: today } }),
      prisma.attendanceRecord.findMany({ where: { studentId: student.id, date: { gte: addDays(today, -90) } } }),
      prisma.excuseNote.findMany({ where: { studentId: student.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
      prisma.classSchedule.findMany({ where: { sectionId: student.sectionId }, select: { room: true } }),
    ]);

    const statusBySchedule = new Map(todayRecords.map((r) => [r.scheduleId, r.status]));
    const current = currentSchedule(schedules, now);
    const lastEntryToday = gateLogs.find((g) => g.event === 'ENTRY' && g.timestamp >= startOfLocalDay(now));
    const health = summarize(history);

    res.json({
      student: {
        id: student.id,
        studentNo: student.studentNo,
        firstName: student.user.firstName,
        lastName: student.user.lastName,
        avatarHue: student.user.avatarHue,
        section: student.section.name,
        adviser: student.section.adviser
          ? `${student.section.adviser.firstName} ${student.section.adviser.lastName}`
          : null,
        location: student.location,
        currentRoom: student.currentRoom,
        lastLat: student.lastLat,
        lastLng: student.lastLng,
        lastSeenAt: student.lastSeenAt,
        geofenceActive: student.geofenceActive,
      },
      geofence,
      checkIn: lastEntryToday ? { at: lastEntryToday.timestamp, gate: lastEntryToday.gate } : null,
      gateLogs,
      currentClass: current ? { scheduleId: current.id, subject: current.subject.name, room: current.room } : null,
      rooms: [...new Set(allSchedules.map((s) => s.room))].sort(),
      todaysClasses: schedules.map((s) => ({
        scheduleId: s.id,
        subject: s.subject.name,
        teacher: `${s.subject.teacher.firstName} ${s.subject.teacher.lastName}`,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room,
        status: statusBySchedule.get(s.id) || null,
        inSession: current?.id === s.id,
      })),
      health: { ...health, label: healthLabel(health.rate) },
      excuseNotes,
    });
  }),
);

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Location ping from the student's device. Evaluates the school geofence,
 * records gate ENTRY/EXIT transitions and runs automated class check-in.
 */
router.post(
  '/location',
  asyncHandler(async (req, res) => {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const room = req.body?.room ? String(req.body.room) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'lat and lng are required');

    const student = await loadStudent(req.user.id);
    if (!student.geofenceActive) throw new HttpError(409, 'Geofence tracking is turned off for this account');

    const fence = await prisma.geofence.findFirst({ orderBy: { id: 'asc' } });
    if (!fence) throw new HttpError(500, 'No school geofence has been configured');

    const { inside, distance } = insideGeofence(fence, lat, lng);
    const wasOnCampus = student.location !== 'OFF_CAMPUS';
    const location = inside ? (room ? 'IN_ROOM' : 'ON_CAMPUS') : 'OFF_CAMPUS';
    const event = !wasOnCampus && inside ? 'ENTRY' : wasOnCampus && !inside ? 'EXIT' : null;

    const updated = await prisma.student.update({
      where: { id: student.id },
      data: {
        location,
        currentRoom: inside ? room : null,
        lastLat: lat,
        lastLng: lng,
        lastSeenAt: new Date(),
      },
    });

    if (event) {
      await prisma.gateLog.create({ data: { studentId: student.id, event, lat, lng, verified: true } });
    }

    const record = await autoCheckIn(updated);

    res.json({
      inside,
      distance,
      location,
      room: updated.currentRoom,
      event,
      autoMarked: record ? { subject: record.schedule.subject.name, status: record.status } : null,
    });
  }),
);

module.exports = router;
