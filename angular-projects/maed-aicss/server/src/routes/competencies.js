// Learning competencies, organised by subject, quarter and learning period.
//
// GET    /?subjectId&sectionId&quarter   competencies with mastery, coverage and completion
// GET    /:id?sectionId&subjectId        one competency: learner mastery, assessments, pre/post, lessons
// POST   /  PUT /:id                     add / edit (subjectId required)
// DELETE /:id                            admins only
//
// Completion status rules are in lib/coverage.js.
const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { getSettings } = require('../lib/settings');
const { invalidateAlerts } = require('../lib/alerts');
const { logActivity } = require('../lib/log');
const { learnerWhere, sectionWhere, isAdmin, competencyWhere, optInt, subjectOf } = require('../lib/scope');
const { learnerMetrics, competencyStats, band, round1 } = require('../lib/metrics');
const { learnerName } = require('../lib/shape');
const { loadPrePost, summarize, testRows } = require('../lib/prepost');
const { coverage, completion } = require('../lib/coverage');
const { dayKey } = require('../lib/time');
const { areaProgress } = require('./dashboard');

const router = express.Router();
router.use(authenticate);

const COMPETENCY_ORDER = [{ quarter: 'asc' }, { learningPeriod: 'asc' }, { code: 'asc' }];

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const quarter = optInt(req.query.quarter);
    const sectionId = optInt(req.query.sectionId);
    const subjectId = subjectOf(req);
    const lw = learnerWhere(req.user, { sectionId, subjectId });

    const [learners, competencies, sections] = await Promise.all([
      prisma.learner.findMany({ where: lw, select: { id: true, sectionId: true } }),
      prisma.competency.findMany({
        where: { ...competencyWhere(req.user, { subjectId, sectionId }), ...(quarter && { quarter }), ...(isAdmin(req.user) ? {} : { active: true }) },
        include: { subject: true },
        orderBy: [{ learningArea: 'asc' }, ...COMPETENCY_ORDER],
      }),
      prisma.section.findMany({ where: sectionWhere(req.user, subjectId), orderBy: { name: 'asc' } }),
    ]);
    const ids = competencies.map((c) => c.id);
    const [metrics, assessed, cov] = await Promise.all([
      learnerMetrics(learners, settings, { quarter, subjectId }),
      prisma.assessment.groupBy({
        by: ['competencyId'],
        where: { competencyId: { in: ids }, section: { ...sectionWhere(req.user, subjectId), ...(sectionId && { id: sectionId }) } },
        _count: { _all: true },
      }),
      coverage(req.user, { subjectId, sectionId, competencyIds: ids, settings }),
    ]);
    const stats = competencyStats(metrics, settings);
    const assessmentCount = new Map(assessed.map((a) => [a.competencyId, a._count._all]));

    let mastered = 0;
    let inProgress = 0;
    let needsSupport = 0;
    for (const s of stats.values()) {
      mastered += s.MASTERED;
      inProgress += s.IN_PROGRESS;
      needsSupport += s.NEEDS_SUPPORT;
    }
    const pairs = mastered + inProgress + needsSupport;
    const pct = (n) => (pairs ? round1((n / pairs) * 100) : 0);
    const active = competencies.filter((c) => c.active);

    const rows = competencies.map(({ subject, ...c }) => {
      const s = stats.get(c.id);
      const done = completion(c, cov, assessmentCount.get(c.id) ?? 0);
      const pp = summarize(cov.recordsBy.get(c.id) ?? [], settings);
      return {
        ...c,
        subject: subject?.name ?? c.learningArea,
        subjectCode: subject?.code ?? null,
        assessments: assessmentCount.get(c.id) ?? 0,
        assessed: s?.assessed ?? 0,
        mastered: s?.MASTERED ?? 0,
        inProgress: s?.IN_PROGRESS ?? 0,
        needsSupport: s?.NEEDS_SUPPORT ?? 0,
        masteryRate: s?.masteryRate ?? null,
        average: s?.average ?? null,
        completion: done.status,
        sections: done.sections,
        completedSections: done.completedSections,
        lessons: done.lessons,
        lastLesson: done.lastLesson,
        prePost: { tests: (cov.testsBy.get(c.id) ?? []).length, avgPre: pp.avgPre, avgPost: pp.avgPost, avgGain: pp.avgGain, completed: pp.completed },
      };
    });
    const activeRows = rows.filter((r) => r.active);
    const covered = activeRows.filter((r) => r.lessons || r.assessments || r.prePost.tests).length;

    res.json({
      sections: sections.map((s) => ({ id: s.id, name: s.name })),
      masteryTarget: settings.masteryTarget,
      currentQuarter: settings.currentQuarter,
      kpis: {
        onTrack: pct(mastered),
        monitor: pct(inProgress),
        needsSupport: pct(needsSupport),
        targetCoverage: active.length ? round1((active.filter((c) => assessmentCount.get(c.id)).length / active.length) * 100) : 0,
        coverage: activeRows.length ? round1((covered / activeRows.length) * 100) : 0,
        completed: activeRows.filter((r) => r.completion === 'COMPLETED').length,
        inProgressCount: activeRows.filter((r) => r.completion === 'IN_PROGRESS').length,
        notStarted: activeRows.filter((r) => r.completion === 'NOT_STARTED').length,
        total: activeRows.length,
      },
      areas: areaProgress(stats, active, settings),
      competencies: rows,
    });
  }),
);

/** One competency: each visible learner's average and band, its assessments, pre/post tests and lessons. */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const competency = await prisma.competency.findUnique({ where: { id: Number(req.params.id) }, include: { subject: true } });
    if (!competency) throw new HttpError(404, 'Competency not found');
    const sectionId = optInt(req.query.sectionId);
    // A competency belongs to one subject, so its records are scoped by that subject.
    const subjectId = competency.subjectId ?? subjectOf(req);
    const sections = { ...sectionWhere(req.user, subjectId), ...(sectionId && { id: sectionId }) };
    const lw = learnerWhere(req.user, { sectionId, subjectId });
    const learners = await prisma.learner.findMany({ where: lw, include: { section: true }, orderBy: [{ lastName: 'asc' }] });
    const [metrics, assessments, prePost, sessions] = await Promise.all([
      learnerMetrics(learners, settings, { subjectId }),
      prisma.assessment.findMany({ where: { competencyId: competency.id, section: sections }, include: { section: true }, orderBy: { date: 'desc' } }),
      loadPrePost({ academicYear: settings.academicYear, competencyId: competency.id, section: sections }, settings),
      prisma.classSession.groupBy({ by: ['scheduleId'], where: { competencyId: competency.id, schedule: { section: sections } }, _count: { _all: true }, _max: { date: true } }),
    ]);
    const schedules = sessions.length
      ? await prisma.classSchedule.findMany({ where: { id: { in: sessions.map((s) => s.scheduleId) } }, include: { section: true } })
      : [];
    const sectionOf = new Map(schedules.map((s) => [s.id, s.section.name]));
    const lessonsBySection = new Map();
    for (const s of sessions) {
      const name = sectionOf.get(s.scheduleId);
      const e = lessonsBySection.get(name) ?? { section: name, lessons: 0, last: null };
      e.lessons += s._count._all;
      const last = s._max.date ? dayKey(s._max.date) : null;
      if (last && (!e.last || last > e.last)) e.last = last;
      lessonsBySection.set(name, e);
    }
    const { subject, ...rest } = competency;

    res.json({
      competency: { ...rest, subject: subject?.name ?? competency.learningArea },
      assessments: assessments.map((a) => ({ id: a.id, title: a.title, type: a.type, date: a.date, section: a.section.name, maxScore: a.maxScore })),
      prePost: testRows(prePost.tests, prePost.records, settings),
      lessons: [...lessonsBySection.values()].sort((a, b) => a.section.localeCompare(b.section)),
      learners: learners
        .map((l) => {
          const score = metrics.get(l.id).competencyAvg.get(competency.id);
          const pp = prePost.records.find((r) => r.learnerId === l.id);
          return {
            id: l.id,
            learnerNo: l.learnerNo,
            name: learnerName(l),
            section: l.section.name,
            average: score ?? null,
            band: score === undefined ? null : band(score, settings),
            prePct: pp?.prePct ?? null,
            postPct: pp?.postPct ?? null,
            gain: pp?.gain ?? null,
          };
        })
        .filter((l) => l.average !== null || l.prePct !== null)
        .sort((a, b) => (a.average ?? a.prePct ?? 0) - (b.average ?? b.prePct ?? 0)),
    });
  }),
);

async function cleanCompetency(body) {
  const code = String(body?.code ?? '').trim();
  const title = String(body?.title ?? '').trim();
  const quarter = Number(body?.quarter);
  // Subject is required; older clients may still send only the learning-area name.
  let subject = null;
  if (body?.subjectId) subject = await prisma.subject.findUnique({ where: { id: Number(body.subjectId) || 0 } });
  else if (body?.learningArea) subject = await prisma.subject.findFirst({ where: { name: String(body.learningArea).trim() } });
  if (!code || !title) throw new HttpError(400, 'Code and competency are required');
  if (!subject) throw new HttpError(400, 'Choose the subject this competency belongs to');
  if (![1, 2, 3].includes(quarter)) throw new HttpError(400, 'Choose the 1st, 2nd or 3rd term');
  const learningPeriod = String(body?.learningPeriod ?? '').trim().slice(0, 60) || null;
  return { code: code.slice(0, 60), title, subjectId: subject.id, learningArea: subject.name, quarter, learningPeriod, active: body?.active !== false };
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = await cleanCompetency(req.body);
    if (await prisma.competency.findUnique({ where: { code: data.code } })) throw new HttpError(409, 'A competency with that code already exists');
    const created = await prisma.competency.create({ data });
    logActivity(req.user.id, 'Added competency', 'Competency', `${created.code} · ${created.learningArea}`);
    res.status(201).json(created);
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = await cleanCompetency(req.body);
    const clash = await prisma.competency.findFirst({ where: { code: data.code, id: { not: id } } });
    if (clash) throw new HttpError(409, 'A competency with that code already exists');
    const updated = await prisma.competency.update({ where: { id }, data });
    invalidateAlerts();
    logActivity(req.user.id, 'Updated competency', 'Competency', `${updated.code} · ${updated.learningArea}`);
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const competency = await prisma.competency.delete({ where: { id: Number(req.params.id) } });
    invalidateAlerts();
    logActivity(req.user.id, 'Deleted competency', 'Competency', `${competency.code} · ${competency.learningArea}`);
    res.json({ ok: true });
  }),
);

module.exports = router;
