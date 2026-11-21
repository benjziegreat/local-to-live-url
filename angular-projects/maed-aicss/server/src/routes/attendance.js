// Attendance (daily time record), recorded per class period of the section's timetable.
//
// GET  /overview                    trends and daily/monthly summaries (day-level, period-based rate)
// GET  /periods?date&sectionId      class periods on that date the user may record
// GET  /roster?scheduleId&date      learners of that period with status, time in and remarks
// POST /bulk                        save one period's attendance
//
// Who may record a period: the subject teacher of that period, the section's adviser, or an admin.
const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { getSettings } = require('../lib/settings');
const { invalidateAlerts } = require('../lib/alerts');
const { logActivity } = require('../lib/log');
const { learnerWhere, sectionWhere, isAdmin, optInt } = require('../lib/scope');
const { dailySeries, totals, monthlySeries } = require('../lib/metrics');
const { dateOnly, parseDay, dayKey, isoWeekdayUtc, schoolYearStart } = require('../lib/time');
const { learnerName } = require('../lib/shape');
const { trendFor } = require('./dashboard');

const router = express.Router();
router.use(authenticate);

const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Where-clause for class periods the user may record. */
function recordableWhere(user) {
  return isAdmin(user) ? {} : { OR: [{ teacherId: user.id }, { section: { teacherId: user.id } }] };
}

function periodRow(c, extra = {}) {
  return {
    id: c.id,
    sectionId: c.sectionId,
    section: c.section.name,
    subject: c.subject.name,
    subjectKind: c.subject.kind,
    room: c.room,
    dayOfWeek: c.dayOfWeek,
    startTime: c.startTime,
    endTime: c.endTime,
    teacherId: c.teacherId,
    teacher: c.teacher ? `${c.teacher.firstName} ${c.teacher.lastName}` : null,
    ...extra,
  };
}

async function loadRecordable(user, scheduleId) {
  const schedule = await prisma.classSchedule.findFirst({
    where: { id: Number(scheduleId) || 0, ...recordableWhere(user) },
    include: { section: true, subject: true, teacher: true },
  });
  if (!schedule) throw new HttpError(403, 'You can only record attendance for your own classes or advisory section');
  return schedule;
}

function checkDate(date, schedule) {
  if (date > dateOnly()) throw new HttpError(400, 'You cannot record attendance for a future date');
  if (isoWeekdayUtc(date) !== schedule.dayOfWeek) {
    throw new HttpError(400, `${schedule.subject.name} meets on ${DAYS[schedule.dayOfWeek]}, but ${dayKey(date)} is a ${DAYS[isoWeekdayUtc(date)]}`);
  }
}

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const range = req.query.range === 'month' ? 'month' : 'week';
    const lw = learnerWhere(req.user, { sectionId: optInt(req.query.sectionId) });

    const [learnerCount, sections, series] = await Promise.all([
      prisma.learner.count({ where: lw }),
      prisma.section.findMany({ where: sectionWhere(req.user), orderBy: { name: 'asc' } }),
      dailySeries(lw, schoolYearStart(settings.academicYear), dateOnly()),
    ]);
    const trend = trendFor(series, range);
    const latest = series[series.length - 1] ?? null;

    res.json({
      sections: sections.map((s) => ({ id: s.id, name: s.name })),
      kpis: {
        learners: learnerCount,
        rate: totals(trend).rate,
        latestDate: latest?.date ?? null,
        absent: latest?.absent ?? 0,
        late: latest?.late ?? 0,
        partial: latest?.partial ?? 0,
        present: latest ? latest.present + latest.late : 0,
      },
      trend,
      summary: totals(trend),
      schoolYear: totals(series),
      monthly: monthlySeries(series),
      records: series.slice(-15).reverse(),
    });
  }),
);

/** Class periods on a date that the user may record, with how many learners are already marked. */
router.get(
  '/periods',
  asyncHandler(async (req, res) => {
    const date = parseDay(req.query.date);
    const dow = isoWeekdayUtc(date);
    const sectionId = optInt(req.query.sectionId);
    const periods = await prisma.classSchedule.findMany({
      where: { dayOfWeek: dow, ...(sectionId && { sectionId }), ...recordableWhere(req.user) },
      include: { section: true, subject: true, teacher: true },
      orderBy: [{ startTime: 'asc' }],
    });
    const ids = periods.map((p) => p.id);
    const sectionIds = [...new Set(periods.map((p) => p.sectionId))];
    const [recorded, sizes] = await Promise.all([
      ids.length ? prisma.attendanceRecord.groupBy({ by: ['scheduleId'], where: { date, scheduleId: { in: ids } }, _count: { _all: true } }) : [],
      sectionIds.length ? prisma.learner.groupBy({ by: ['sectionId'], where: { sectionId: { in: sectionIds }, status: 'ACTIVE' }, _count: { _all: true } }) : [],
    ]);
    const recordedBy = new Map(recorded.map((r) => [r.scheduleId, r._count._all]));
    const sizeBy = new Map(sizes.map((s) => [s.sectionId, s._count._all]));
    res.json({
      date: dayKey(date),
      day: DAYS[dow],
      periods: periods
        .map((p) => periodRow(p, { recorded: recordedBy.get(p.id) ?? 0, learners: sizeBy.get(p.sectionId) ?? 0, mine: p.teacherId === req.user.id }))
        .sort((a, b) => a.section.localeCompare(b.section) || a.startTime.localeCompare(b.startTime)),
    });
  }),
);

/** Roster of one class period on one date, with what is already recorded. */
router.get(
  '/roster',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const schedule = await loadRecordable(req.user, req.query.scheduleId);
    const date = parseDay(req.query.date);
    checkDate(date, schedule);

    const [learners, sameDay] = await Promise.all([
      prisma.learner.findMany({
        where: { sectionId: schedule.sectionId, status: 'ACTIVE' },
        include: { attendance: { where: { date, scheduleId: schedule.id }, include: { recordedBy: true } } },
        orderBy: [{ sex: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
      }),
      // Earlier periods today, so the teacher can see who was already absent.
      prisma.attendanceRecord.findMany({
        where: { date, scheduleId: { not: schedule.id }, schedule: { sectionId: schedule.sectionId, startTime: { lt: schedule.startTime } } },
        include: { schedule: { include: { subject: true } } },
      }),
    ]);
    const earlierBy = new Map();
    for (const r of sameDay.sort((a, b) => a.schedule.startTime.localeCompare(b.schedule.startTime))) {
      const list = earlierBy.get(r.learnerId) ?? [];
      list.push({ startTime: r.schedule.startTime, subject: r.schedule.subject.name, status: r.status });
      earlierBy.set(r.learnerId, list);
    }

    res.json({
      period: periodRow(schedule),
      date: dayKey(date),
      graceMinutes: settings.lateGraceMinutes,
      recorded: learners.some((l) => l.attendance.length),
      learners: learners.map((l) => {
        const rec = l.attendance[0];
        return {
          id: l.id,
          learnerNo: l.learnerNo,
          name: learnerName(l),
          sex: l.sex,
          avatarHue: l.avatarHue,
          status: rec?.status ?? null,
          timeIn: rec?.timeIn ?? '',
          remarks: rec?.remarks ?? '',
          recordedBy: rec?.recordedBy ? `${rec.recordedBy.firstName} ${rec.recordedBy.lastName}` : null,
          earlier: earlierBy.get(l.id) ?? [],
        };
      }),
    });
  }),
);

/** Save one class period's attendance. A time in past the grace period turns PRESENT into LATE. */
router.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    if (!settings.enableAttendance) throw new HttpError(403, 'Attendance monitoring is turned off in Settings');
    const schedule = await loadRecordable(req.user, req.body?.scheduleId);
    const date = parseDay(req.body?.date);
    checkDate(date, schedule);

    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const valid = await prisma.learner.findMany({ where: { sectionId: schedule.sectionId, status: 'ACTIVE' }, select: { id: true } });
    const allowed = new Set(valid.map((l) => l.id));
    const lateAfter = toMin(schedule.startTime) + settings.lateGraceMinutes;

    const clean = [];
    for (const e of entries) {
      if (!allowed.has(Number(e.learnerId)) || !STATUSES.includes(e.status)) continue;
      let status = e.status;
      let timeIn = e.timeIn ? String(e.timeIn).slice(0, 5) : null;
      if (timeIn && !TIME.test(timeIn)) throw new HttpError(400, `Invalid time in "${e.timeIn}" (use HH:mm)`);
      if (status === 'ABSENT' || status === 'EXCUSED') timeIn = null;
      if (status === 'PRESENT' && timeIn && toMin(timeIn) > lateAfter) status = 'LATE';
      clean.push({ learnerId: Number(e.learnerId), status, timeIn, remarks: e.remarks ? String(e.remarks).slice(0, 190) : null });
    }
    if (!clean.length) throw new HttpError(400, 'Mark at least one learner');

    await prisma.$transaction(
      clean.map((e) =>
        prisma.attendanceRecord.upsert({
          where: { learnerId_scheduleId_date: { learnerId: e.learnerId, scheduleId: schedule.id, date } },
          update: { status: e.status, timeIn: e.timeIn, remarks: e.remarks, recordedById: req.user.id, recordedAt: new Date() },
          create: { learnerId: e.learnerId, scheduleId: schedule.id, date, status: e.status, timeIn: e.timeIn, remarks: e.remarks, recordedById: req.user.id },
        }),
      ),
    );
    invalidateAlerts();
    const count = (s) => clean.filter((e) => e.status === s).length;
    logActivity(
      req.user.id,
      'Recorded attendance',
      'Attendance',
      `${schedule.section.name} · ${schedule.subject.name} · ${dayKey(date)} ${schedule.startTime}–${schedule.endTime} · ${schedule.room} · ${clean.length} learners, ${count('ABSENT')} absent, ${count('LATE')} late`,
    );
    res.json({ saved: clean.length, late: count('LATE'), absent: count('ABSENT') });
  }),
);

module.exports = router;
