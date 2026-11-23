// School configuration, monitoring preferences, sections and personal settings.
const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin, publicUser } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { getSettings, clearSettingsCache } = require('../lib/settings');
const { invalidateAlerts } = require('../lib/alerts');
const { logActivity } = require('../lib/log');
const { sectionWhere, subjectOf, subjectsFor } = require('../lib/scope');
const { termLabel } = require('../lib/shape');

const router = express.Router();
router.use(authenticate);

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json(await getSettings());
  }),
);

function intIn(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be between ${min} and ${max}`);
  return n;
}

router.put(
  '/settings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const schoolName = String(b.schoolName ?? '').trim();
    if (!schoolName) throw new HttpError(400, 'School name is required');
    if (!/^\d{4}-\d{4}$/.test(String(b.academicYear ?? ''))) throw new HttpError(400, 'Academic year must look like 2026-2027');
    const data = {
      schoolName: schoolName.slice(0, 190),
      schoolId: String(b.schoolId ?? '').trim().slice(0, 40),
      schoolLevel: String(b.schoolLevel ?? 'Senior High School').slice(0, 60),
      division: String(b.division ?? '').trim().slice(0, 120),
      region: String(b.region ?? '').trim().slice(0, 120),
      academicYear: b.academicYear,
      currentQuarter: intIn(b.currentQuarter, 1, 3, 'Current term'),
      enableAttendance: !!b.enableAttendance,
      enableCompetency: !!b.enableCompetency,
      enableAlerts: !!b.enableAlerts,
      attendanceTarget: intIn(b.attendanceTarget, 50, 100, 'Attendance target'),
      masteryTarget: intIn(b.masteryTarget, 50, 100, 'Mastery target'),
      absenceAlertThreshold: intIn(b.absenceAlertThreshold, 1, 30, 'Absence alert threshold'),
      reteachThreshold: intIn(b.reteachThreshold, 10, 100, 'Reteach threshold'),
      lateGraceMinutes: intIn(b.lateGraceMinutes ?? 15, 0, 60, 'Late grace period'),
      missedClassThreshold: intIn(b.missedClassThreshold ?? 3, 1, 30, 'Missed-class alert threshold'),
      pretestLowThreshold: intIn(b.pretestLowThreshold ?? 40, 0, 100, 'Low pre-test threshold'),
      minLearningGain: intIn(b.minLearningGain ?? 10, 0, 100, 'Minimum learning gain'),
    };
    const saved = await prisma.schoolSetting.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
    clearSettingsCache();
    invalidateAlerts();
    logActivity(req.user.id, 'Updated settings', 'School Configuration', `${saved.schoolName} · ${saved.academicYear} · ${termLabel(saved.currentQuarter)}`);
    res.json(saved);
  }),
);

// ---- Sections ---------------------------------------------------------------

router.get(
  '/sections',
  asyncHandler(async (req, res) => {
    // With ?subjectId: the sections where the user handles that subject (subject filter).
    const sections = await prisma.section.findMany({
      where: sectionWhere(req.user, subjectOf(req)),
      include: { teacher: true, elective: true, _count: { select: { learners: { where: { status: 'ACTIVE' } }, schedules: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(
      sections.map((s) => ({
        id: s.id,
        name: s.name,
        gradeLevel: s.gradeLevel,
        strand: s.strand,
        room: s.room,
        electiveId: s.electiveId,
        elective: s.elective?.name ?? null,
        teacherId: s.teacherId,
        teacher: s.teacher ? `${s.teacher.firstName} ${s.teacher.lastName}` : null,
        learners: s._count.learners,
        classes: s._count.schedules,
      })),
    );
  }),
);

async function cleanSection(body) {
  const name = String(body?.name ?? '').trim();
  const strand = String(body?.strand ?? '').trim();
  const gradeLevel = Number(body?.gradeLevel);
  if (!name || !strand) throw new HttpError(400, 'Section name and strand are required');
  if (![11, 12].includes(gradeLevel)) throw new HttpError(400, 'Grade level must be 11 or 12');
  let teacherId = null;
  if (body?.teacherId) {
    const t = await prisma.user.findFirst({ where: { id: Number(body.teacherId), role: 'TEACHER' } });
    if (!t) throw new HttpError(400, 'Choose a teacher account');
    teacherId = t.id;
  }
  const room = String(body?.room ?? '').trim().slice(0, 60) || null;
  let electiveId = null;
  if (body?.electiveId) {
    const e = await prisma.subject.findFirst({ where: { id: Number(body.electiveId), kind: 'ELECTIVE' } });
    if (!e) throw new HttpError(400, 'Choose an elective subject');
    electiveId = e.id;
  }
  return { name: name.slice(0, 120), strand: strand.slice(0, 60), gradeLevel, teacherId, room, electiveId };
}

const sectionClash = (err) => {
  if (err.code === 'P2002') throw new HttpError(409, 'A section with that name already exists');
  throw err;
};

router.post(
  '/sections',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const s = await prisma.section.create({ data: await cleanSection(req.body) }).catch(sectionClash);
    logActivity(req.user.id, 'Added section', 'Section', s.name);
    res.status(201).json(s);
  }),
);

router.put(
  '/sections/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const s = await prisma.section.update({ where: { id: Number(req.params.id) }, data: await cleanSection(req.body) }).catch(sectionClash);
    logActivity(req.user.id, 'Updated section', 'Section', s.name);
    res.json(s);
  }),
);

router.delete(
  '/sections/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (await prisma.learner.count({ where: { sectionId: id } })) throw new HttpError(409, 'Move or archive this section’s learners first');
    const s = await prisma.section.delete({ where: { id } });
    logActivity(req.user.id, 'Deleted section', 'Section', s.name);
    res.json({ ok: true });
  }),
);

// ---- Class schedules ----------------------------------------------------------
//
// GET /schedules?sectionId=N  a section's weekly timetable (sections visible to the user)
// GET /schedules?mine=1       the signed-in teacher's own teaching schedule, all sections
// GET /schedules?day=N        admin: every class on that weekday (room utilization view)
// POST/PUT/DELETE             administrators only; rejects clashes for the same section,
//                             room or teacher on the same day.

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCHEDULE_INCLUDE = { section: true, teacher: true, subject: true };

function scheduleRow(c) {
  return {
    id: c.id,
    sectionId: c.sectionId,
    section: c.section?.name ?? null,
    subjectId: c.subjectId,
    learningArea: c.subject?.name ?? null,
    subjectKind: c.subject?.kind ?? null,
    teacherId: c.teacherId,
    teacher: c.teacher ? `${c.teacher.firstName} ${c.teacher.lastName}` : null,
    dayOfWeek: c.dayOfWeek,
    day: DAYS[c.dayOfWeek],
    startTime: c.startTime,
    endTime: c.endTime,
    room: c.room,
  };
}

router.get(
  '/schedules',
  asyncHandler(async (req, res) => {
    let where;
    if (req.query.mine) {
      where = { teacherId: req.user.id };
    } else if (req.query.day) {
      if (req.user.role !== 'ADMIN') throw new HttpError(403, 'Only administrators can view the whole-school timetable');
      where = { dayOfWeek: Number(req.query.day) };
    } else {
      const sectionId = Number(req.query.sectionId);
      if (!sectionId) throw new HttpError(400, 'Choose a section');
      // Teachers may view sections they advise or teach in.
      const visible =
        req.user.role === 'ADMIN' ||
        (await prisma.section.findFirst({
          where: { id: sectionId, OR: [{ teacherId: req.user.id }, { schedules: { some: { teacherId: req.user.id } } }] },
        }));
      if (!visible) throw new HttpError(403, 'This section is not assigned to you');
      where = { sectionId };
    }
    const rows = await prisma.classSchedule.findMany({
      where,
      include: SCHEDULE_INCLUDE,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    res.json(rows.map(scheduleRow));
  }),
);

async function cleanSchedule(body, id) {
  const sectionId = Number(body?.sectionId);
  const dayOfWeek = Number(body?.dayOfWeek);
  const startTime = String(body?.startTime ?? '');
  const endTime = String(body?.endTime ?? '');
  const room = String(body?.room ?? '').trim().slice(0, 60);
  if (!(await prisma.section.findUnique({ where: { id: sectionId || 0 } }))) throw new HttpError(400, 'Choose a section');
  const subject = await prisma.subject.findUnique({ where: { id: Number(body?.subjectId) || 0 } });
  if (!subject) throw new HttpError(400, 'Choose a subject');
  const subjectId = subject.id;
  if (!room) throw new HttpError(400, 'Room is required');
  if (!(dayOfWeek >= 1 && dayOfWeek <= 6)) throw new HttpError(400, 'Choose a day (Monday to Saturday)');
  if (!TIME.test(startTime) || !TIME.test(endTime)) throw new HttpError(400, 'Times must be HH:mm');
  if (endTime <= startTime) throw new HttpError(400, 'End time must be after start time');

  let teacherId = null;
  if (body?.teacherId) {
    const t = await prisma.user.findFirst({ where: { id: Number(body.teacherId), role: 'TEACHER' } });
    if (!t) throw new HttpError(400, 'Choose a teacher account');
    teacherId = t.id;
  }

  // Overlap: existing.start < new.end AND existing.end > new.start ("HH:mm" compares as text).
  const clash = await prisma.classSchedule.findFirst({
    where: {
      dayOfWeek,
      startTime: { lt: endTime },
      endTime: { gt: startTime },
      ...(id && { id: { not: id } }),
      OR: [{ sectionId }, { room }, ...(teacherId ? [{ teacherId }] : [])],
    },
    include: SCHEDULE_INCLUDE,
  });
  if (clash) {
    const who = clash.sectionId === sectionId ? clash.section.name : clash.room === room ? `Room "${room}"` : `${clash.teacher.firstName} ${clash.teacher.lastName}`;
    throw new HttpError(
      409,
      `Schedule conflict: ${who} already has ${clash.subject.name} (${clash.section.name}, ${clash.room}) on ${DAYS[dayOfWeek]} ${clash.startTime}–${clash.endTime}`,
    );
  }
  return { sectionId, subjectId, dayOfWeek, startTime, endTime, room, teacherId };
}

const describe = (c) => `${c.section.name} · ${c.subject.name} · ${DAYS[c.dayOfWeek]} ${c.startTime}–${c.endTime} · ${c.room}`;

router.post(
  '/schedules',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const c = await prisma.classSchedule.create({ data: await cleanSchedule(req.body), include: SCHEDULE_INCLUDE });
    logActivity(req.user.id, 'Added class schedule', 'Class Schedule', describe(c));
    res.status(201).json(scheduleRow(c));
  }),
);

router.put(
  '/schedules/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const c = await prisma.classSchedule.update({ where: { id }, data: await cleanSchedule(req.body, id), include: SCHEDULE_INCLUDE });
    logActivity(req.user.id, 'Updated class schedule', 'Class Schedule', describe(c));
    res.json(scheduleRow(c));
  }),
);

router.delete(
  '/schedules/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const c = await prisma.classSchedule.delete({ where: { id: Number(req.params.id) }, include: SCHEDULE_INCLUDE });
    logActivity(req.user.id, 'Deleted class schedule', 'Class Schedule', describe(c));
    res.json({ ok: true });
  }),
);

// ---- Subjects catalog -----------------------------------------------------------

/** Options for the subject filter shown on every module: { allowAll, subjects }. */
router.get(
  '/subjects/mine',
  asyncHandler(async (req, res) => {
    res.json(await subjectsFor(req.user));
  }),
);

router.get(
  '/subjects',
  asyncHandler(async (_req, res) => {
    const subjects = await prisma.subject.findMany({
      include: { _count: { select: { sections: true, schedules: true } } },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    res.json(
      subjects.map(({ _count, ...s }) => ({ ...s, sections: _count.sections, classes: _count.schedules })),
    );
  }),
);

function cleanSubject(body) {
  const code = String(body?.code ?? '').trim().toUpperCase().slice(0, 30);
  const name = String(body?.name ?? '').trim().slice(0, 120);
  if (!code || !name) throw new HttpError(400, 'Code and subject name are required');
  if (!['CORE', 'ELECTIVE', 'PROGRAM'].includes(body?.kind)) throw new HttpError(400, 'Choose a subject type');
  return {
    code,
    name,
    kind: body.kind,
    track: body.kind === 'ELECTIVE' ? String(body?.track ?? '').trim().slice(0, 30) || null : null,
    defaultRoom: String(body?.defaultRoom ?? '').trim().slice(0, 60) || null,
    active: body?.active !== false,
  };
}

const subjectClash = (err) => {
  if (err.code === 'P2002') throw new HttpError(409, 'A subject with that code or name already exists');
  throw err;
};

router.post(
  '/subjects',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const s = await prisma.subject.create({ data: cleanSubject(req.body) }).catch(subjectClash);
    logActivity(req.user.id, 'Added subject', 'Subjects', `${s.code} · ${s.name}`);
    res.status(201).json(s);
  }),
);

router.put(
  '/subjects/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.subject.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, 'Subject not found');
    const data = cleanSubject(req.body);
    const s = await prisma.$transaction(async (tx) => {
      const updated = await tx.subject.update({ where: { id }, data });
      // Competencies keep the subject name as their learning area; keep it in sync after a rename.
      if (before.name !== updated.name) {
        await tx.competency.updateMany({ where: { OR: [{ subjectId: id }, { subjectId: null, learningArea: before.name }] }, data: { learningArea: updated.name, subjectId: id } });
      }
      return updated;
    }).catch(subjectClash);
    logActivity(req.user.id, 'Updated subject', 'Subjects', `${s.code} · ${s.name}`);
    res.json(s);
  }),
);

// ---- Personal settings --------------------------------------------------------

router.put(
  '/profile',
  asyncHandler(async (req, res) => {
    const firstName = String(req.body?.firstName ?? '').trim();
    const lastName = String(req.body?.lastName ?? '').trim();
    if (!firstName || !lastName) throw new HttpError(400, 'First and last name are required');
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { firstName: firstName.slice(0, 100), lastName: lastName.slice(0, 100) } });
    logActivity(req.user.id, 'Updated profile', 'Account');
    res.json(publicUser(user));
  }),
);

router.put(
  '/profile/password',
  asyncHandler(async (req, res) => {
    const { current, next } = req.body || {};
    if (!next || String(next).length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!(await bcrypt.compare(String(current ?? ''), user.passwordHash))) throw new HttpError(400, 'Current password is incorrect');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(String(next), 10) } });
    logActivity(req.user.id, 'Changed password', 'Account');
    res.json({ ok: true });
  }),
);

module.exports = router;
