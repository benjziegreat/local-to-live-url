const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { getSettings } = require('../lib/settings');
const { invalidateAlerts } = require('../lib/alerts');
const { logActivity } = require('../lib/log');
const { learnerWhere, sectionWhere, assertLearner, isAdmin, optInt, subjectOf } = require('../lib/scope');
const { learnerMetrics, monthlySeries, dailySeries, band, round1, avg, missedLessons, STATUS_ORDER } = require('../lib/metrics');
const { dayKey, parseDay, dateOnly } = require('../lib/time');
const { learnerRow, alertRow, ALERT_INCLUDE } = require('../lib/shape');
const { record } = require('../lib/prepost');

const router = express.Router();
router.use(authenticate);

const fullName = (u) => (u ? `${u.firstName} ${u.lastName}` : null);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const subjectId = subjectOf(req);
    const archived = req.query.status === 'ARCHIVED' && isAdmin(req.user);
    const where = learnerWhere(req.user, { sectionId: optInt(req.query.sectionId), includeArchived: archived, subjectId });
    if (archived) where.status = 'ARCHIVED';
    const q = String(req.query.q ?? '').trim();
    if (q) where.OR = [{ learnerNo: { contains: q } }, { lrn: { contains: q } }, { firstName: { contains: q } }, { lastName: { contains: q } }];

    const [learners, sections, teaching] = await Promise.all([
      prisma.learner.findMany({ where, include: { section: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
      prisma.section.findMany({ where: sectionWhere(req.user, subjectId), include: { teacher: true }, orderBy: { name: 'asc' } }),
      // Subject teacher per section, for the selected subject
      subjectId ? prisma.classSchedule.findMany({ where: { subjectId }, distinct: ['sectionId', 'teacherId'], include: { teacher: true } }) : [],
    ]);
    const teacherBy = new Map();
    for (const t of teaching) if (t.teacher) teacherBy.set(t.sectionId, [...new Set([...(teacherBy.get(t.sectionId) ?? []), fullName(t.teacher)])]);
    const metrics = await learnerMetrics(learners, settings, { subjectId });
    let rows = learners.map((l) => ({ ...learnerRow(l, metrics.get(l.id)), subjectTeacher: teacherBy.get(l.sectionId)?.join(', ') ?? null }));
    if (['ON_TRACK', 'MONITOR', 'AT_RISK'].includes(req.query.monitoring)) rows = rows.filter((r) => r.monitoring === req.query.monitoring);
    if (req.query.sort === 'risk') rows.sort((a, b) => STATUS_ORDER[a.monitoring] - STATUS_ORDER[b.monitoring] || a.name.localeCompare(b.name));

    res.json({
      sections: sections.map((s) => ({ id: s.id, name: s.name, gradeLevel: s.gradeLevel, strand: s.strand, teacher: s.teacher ? `${s.teacher.firstName} ${s.teacher.lastName}` : null })),
      learners: rows,
    });
  }),
);

/**
 * Full learner profile: attendance history, assessment results, competency mastery,
 * pre/post-tests and alerts, overall and broken down by subject (`subjects`). Records carry
 * their subjectId so the client can switch subjects without another request.
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const learner = await assertLearner(req.user, req.params.id);
    const since = new Date(Date.UTC(2000, 0, 1));
    const [metrics, daily, exceptions, scores, competencies, alerts, schedules, prePostScores, lessons] = await Promise.all([
      learnerMetrics([learner], settings),
      dailySeries({ id: learner.id }, since, dateOnly()),
      // Latest non-present period records (absent, late, excused) with their class period.
      prisma.attendanceRecord.findMany({
        where: { learnerId: learner.id, status: { not: 'PRESENT' } },
        include: { schedule: { include: { subject: true } } },
        orderBy: [{ date: 'desc' }, { schedule: { startTime: 'asc' } }],
        take: 200,
      }),
      prisma.assessmentScore.findMany({
        where: { learnerId: learner.id },
        include: { assessment: { include: { competency: true } } },
        orderBy: { assessment: { date: 'desc' } },
      }),
      prisma.competency.findMany({ orderBy: [{ learningArea: 'asc' }, { quarter: 'asc' }, { code: 'asc' }] }),
      prisma.alert.findMany({ where: { learnerId: learner.id }, include: ALERT_INCLUDE, orderBy: { updatedAt: 'desc' }, take: 60 }),
      prisma.classSchedule.findMany({ where: { sectionId: learner.sectionId }, include: { subject: true, teacher: true } }),
      prisma.prePostScore.findMany({
        where: { learnerId: learner.id, test: { academicYear: settings.academicYear } },
        include: { learner: true, test: { include: { section: true, competency: { include: { subject: true } } } } },
      }),
      missedLessons({ learnerIds: [learner.id] }),
    ]);
    const m = metrics.get(learner.id);
    const compById = new Map(competencies.map((c) => [c.id, c]));
    const prePost = prePostScores
      .map((s) => record(s.test, s, settings))
      .sort((a, b) => a.quarter - b.quarter || a.competencyCode.localeCompare(b.competencyCode));

    // Subjects the learner's section takes, with the teachers who handle them.
    const subjectMap = new Map();
    for (const s of schedules) {
      const e = subjectMap.get(s.subjectId) ?? { id: s.subjectId, code: s.subject.code, name: s.subject.name, kind: s.subject.kind, teachers: new Set(), meetings: 0 };
      if (s.teacher) e.teachers.add(fullName(s.teacher));
      e.meetings++;
      subjectMap.set(s.subjectId, e);
    }
    const KIND = { CORE: 0, ELECTIVE: 1, PROGRAM: 2 };
    const subjectList = [...subjectMap.values()].sort((a, b) => KIND[a.kind] - KIND[b.kind] || a.name.localeCompare(b.name));
    const perSubject = await Promise.all(
      subjectList.map(async (s) => {
        const [sm, sd] = await Promise.all([
          learnerMetrics([learner], settings, { subjectId: s.id }),
          dailySeries({ id: learner.id }, since, dateOnly(), { subjectId: s.id }),
        ]);
        return [s.id, { metrics: sm.get(learner.id), monthly: monthlySeries(sd) }];
      }),
    );
    const subjectStats = new Map(perSubject);
    const openAlerts = (subjectId) => alerts.filter((a) => a.status !== 'RESOLVED' && a.subjectId === subjectId).length;
    const mean = (list) => (list.length ? round1(avg(list)) : null);
    const subjects = subjectList.map((s) => {
      const { metrics: sm, monthly } = subjectStats.get(s.id);
      const comps = [...sm.competencyAvg.values()];
      const pp = prePost.filter((r) => r.subjectId === s.id);
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        kind: s.kind,
        teacher: [...s.teachers].join(', ') || null,
        meetingsPerWeek: s.meetings,
        attendanceRate: sm.attendanceRate,
        present: sm.present,
        late: sm.late,
        absent: sm.absent,
        excused: sm.excused,
        periodsMissed: sm.periodsMissed,
        recentAbsences: sm.recentAbsences,
        assessmentAvg: sm.assessmentAvg,
        assessmentCount: sm.assessmentCount,
        descriptor: sm.descriptor,
        monitoring: sm.status,
        action: sm.action,
        competenciesAssessed: comps.length,
        competenciesMastered: comps.filter((v) => v >= settings.masteryTarget).length,
        prePost: { tests: pp.length, avgPre: mean(pp.map((r) => r.prePct).filter((v) => v !== null)), avgPost: mean(pp.map((r) => r.postPct).filter((v) => v !== null)), avgGain: mean(pp.map((r) => r.gain).filter((v) => v !== null)) },
        openAlerts: openAlerts(s.id),
        monthly,
      };
    });

    res.json({
      learner: {
        ...learnerRow(learner, m),
        birthDate: learner.birthDate,
        guardian: learner.guardian,
        contactNo: learner.contactNo,
        gradeLevel: learner.section.gradeLevel,
        strand: learner.section.strand,
        room: learner.section.room,
        teacher: learner.section.teacher ? `${learner.section.teacher.firstName} ${learner.section.teacher.lastName}` : null,
      },
      attendance: {
        monthly: monthlySeries(daily),
        partialDays: m.partialDays,
        periodsMissed: m.periodsMissed,
        recent: exceptions.map((r) => ({
          date: dayKey(r.date),
          status: r.status,
          subjectId: r.schedule.subjectId,
          subject: r.schedule.subject.name,
          startTime: r.schedule.startTime,
          endTime: r.schedule.endTime,
          room: r.schedule.room,
          timeIn: r.timeIn,
          remarks: r.remarks,
        })),
      },
      assessments: scores.map((s) => ({
        id: s.assessment.id,
        title: s.assessment.title,
        type: s.assessment.type,
        date: s.assessment.date,
        competency: s.assessment.competency.code,
        learningArea: s.assessment.competency.learningArea,
        subjectId: s.assessment.competency.subjectId,
        score: s.score,
        maxScore: s.assessment.maxScore,
        percent: round1((s.score / s.assessment.maxScore) * 100),
      })),
      competencies: competencies
        .filter((c) => m.competencyAvg.has(c.id))
        .map((c) => {
          const average = m.competencyAvg.get(c.id);
          return { id: c.id, code: c.code, title: c.title, learningArea: c.learningArea, subjectId: c.subjectId, quarter: c.quarter, average, band: band(average, settings) };
        }),
      subjects,
      prePost,
      missedLessons: [...(lessons.missed.get(learner.id) ?? [])]
        .map(([competencyId, missed]) => {
          const c = compById.get(competencyId);
          return c ? { competencyId, code: c.code, title: c.title, subjectId: c.subjectId, missed, taught: lessons.taught.get(`${learner.sectionId}|${competencyId}`) ?? 0 } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.missed - a.missed),
      alerts: alerts.map(alertRow),
    });
  }),
);

// ---- Admin: add, edit, archive -------------------------------------------

async function cleanLearner(body) {
  const firstName = String(body?.firstName ?? '').trim();
  const lastName = String(body?.lastName ?? '').trim();
  if (!firstName || !lastName) throw new HttpError(400, 'First and last name are required');
  if (!['M', 'F'].includes(body?.sex)) throw new HttpError(400, 'Choose sex (M or F)');
  const section = await prisma.section.findUnique({ where: { id: Number(body?.sectionId) || 0 } });
  if (!section) throw new HttpError(400, 'Choose a section');
  const lrn = String(body?.lrn ?? '').trim();
  if (lrn && !/^\d{12}$/.test(lrn)) throw new HttpError(400, 'LRN must be 12 digits');
  return {
    firstName: firstName.slice(0, 100),
    lastName: lastName.slice(0, 100),
    sex: body.sex,
    sectionId: section.id,
    lrn: lrn || null,
    birthDate: body?.birthDate ? parseDay(body.birthDate) : null,
    guardian: body?.guardian ? String(body.guardian).trim().slice(0, 150) : null,
    contactNo: body?.contactNo ? String(body.contactNo).trim().slice(0, 40) : null,
  };
}

async function nextLearnerNo() {
  const settings = await getSettings();
  const year = parseInt(settings.academicYear, 10) || new Date().getFullYear();
  const prefix = `SHS-${year}-`;
  const last = await prisma.learner.findFirst({ where: { learnerNo: { startsWith: prefix } }, orderBy: { learnerNo: 'desc' } });
  const n = last ? parseInt(last.learnerNo.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

function uniqueError(err) {
  if (err.code === 'P2002') throw new HttpError(409, 'Another learner already has that LRN');
  throw err;
}

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const data = await cleanLearner(req.body);
    const learner = await prisma.learner
      .create({ data: { ...data, learnerNo: await nextLearnerNo(), avatarHue: Math.floor(Math.random() * 360) } })
      .catch(uniqueError);
    logActivity(req.user.id, 'Added learner', 'Learner', `${learner.learnerNo} · ${learner.lastName}, ${learner.firstName}`);
    res.status(201).json({ id: learner.id, learnerNo: learner.learnerNo });
  }),
);

router.put(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const data = await cleanLearner(req.body);
    const learner = await prisma.learner.update({ where: { id: Number(req.params.id) }, data }).catch(uniqueError);
    invalidateAlerts();
    logActivity(req.user.id, 'Updated learner', 'Learner', `${learner.learnerNo} · ${learner.lastName}, ${learner.firstName}`);
    res.json({ id: learner.id });
  }),
);

router.post(
  '/:id/archive',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const archived = req.body?.archived !== false;
    const learner = await prisma.learner.update({ where: { id: Number(req.params.id) }, data: { status: archived ? 'ARCHIVED' : 'ACTIVE' } });
    invalidateAlerts();
    logActivity(req.user.id, archived ? 'Archived learner' : 'Restored learner', 'Learner', `${learner.learnerNo} · ${learner.lastName}, ${learner.firstName}`);
    res.json({ id: learner.id, status: learner.status });
  }),
);

module.exports = router;
