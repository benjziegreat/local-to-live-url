const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { getSettings } = require('../lib/settings');
const { invalidateAlerts } = require('../lib/alerts');
const { logActivity } = require('../lib/log');
const { learnerWhere, sectionWhere, isAdmin, competencyFilter, optInt } = require('../lib/scope');
const { learnerMetrics, competencyStats, band, round1 } = require('../lib/metrics');
const { learnerName } = require('../lib/shape');
const { areaProgress } = require('./dashboard');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const quarter = optInt(req.query.quarter);
    const sectionId = optInt(req.query.sectionId);
    const lw = learnerWhere(req.user, { sectionId });

    const [learners, allCompetencies, sections, assessed, relevant] = await Promise.all([
      prisma.learner.findMany({ where: lw, select: { id: true, sectionId: true } }),
      prisma.competency.findMany({
        where: { ...(quarter && { quarter }), ...(isAdmin(req.user) ? {} : { active: true }) },
        orderBy: [{ learningArea: 'asc' }, { quarter: 'asc' }, { code: 'asc' }],
      }),
      prisma.section.findMany({ where: sectionWhere(req.user), orderBy: { name: 'asc' } }),
      prisma.assessment.groupBy({
        by: ['competencyId'],
        where: { ...(quarter && { quarter }), section: { ...sectionWhere(req.user), ...(sectionId && { id: sectionId }) } },
        _count: { _all: true },
      }),
      competencyFilter(req.user, sectionId),
    ]);
    // Admins viewing the whole school still see every competency (including unused electives).
    const competencies = isAdmin(req.user) && !sectionId ? allCompetencies : allCompetencies.filter(relevant);
    const metrics = await learnerMetrics(learners, settings, { quarter });
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

    res.json({
      sections: sections.map((s) => ({ id: s.id, name: s.name })),
      masteryTarget: settings.masteryTarget,
      kpis: {
        onTrack: pct(mastered),
        monitor: pct(inProgress),
        needsSupport: pct(needsSupport),
        targetCoverage: active.length ? round1((active.filter((c) => assessmentCount.get(c.id)).length / active.length) * 100) : 0,
      },
      areas: areaProgress(stats, active, settings),
      competencies: competencies.map((c) => {
        const s = stats.get(c.id);
        return {
          ...c,
          assessments: assessmentCount.get(c.id) ?? 0,
          assessed: s?.assessed ?? 0,
          mastered: s?.MASTERED ?? 0,
          inProgress: s?.IN_PROGRESS ?? 0,
          needsSupport: s?.NEEDS_SUPPORT ?? 0,
          masteryRate: s?.masteryRate ?? null,
          average: s?.average ?? null,
        };
      }),
    });
  }),
);

/** One competency: each visible learner's average and mastery band. */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const competency = await prisma.competency.findUnique({ where: { id: Number(req.params.id) } });
    if (!competency) throw new HttpError(404, 'Competency not found');
    const lw = learnerWhere(req.user, { sectionId: optInt(req.query.sectionId) });
    const learners = await prisma.learner.findMany({ where: lw, include: { section: true }, orderBy: [{ lastName: 'asc' }] });
    const metrics = await learnerMetrics(learners, settings);
    const assessments = await prisma.assessment.findMany({
      where: { competencyId: competency.id, section: sectionWhere(req.user) },
      include: { section: true },
      orderBy: { date: 'desc' },
    });

    res.json({
      competency,
      assessments: assessments.map((a) => ({ id: a.id, title: a.title, type: a.type, date: a.date, section: a.section.name, maxScore: a.maxScore })),
      learners: learners
        .map((l) => {
          const score = metrics.get(l.id).competencyAvg.get(competency.id);
          return { id: l.id, learnerNo: l.learnerNo, name: learnerName(l), section: l.section.name, average: score ?? null, band: score === undefined ? null : band(score, settings) };
        })
        .filter((l) => l.average !== null)
        .sort((a, b) => a.average - b.average),
    });
  }),
);

function cleanCompetency(body) {
  const code = String(body?.code ?? '').trim();
  const title = String(body?.title ?? '').trim();
  const learningArea = String(body?.learningArea ?? '').trim();
  const quarter = Number(body?.quarter);
  if (!code || !title || !learningArea) throw new HttpError(400, 'Code, learning area and competency are required');
  if (![1, 2, 3, 4].includes(quarter)) throw new HttpError(400, 'Quarter must be 1 to 4');
  return { code: code.slice(0, 60), title, learningArea: learningArea.slice(0, 120), quarter, active: body?.active !== false };
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = cleanCompetency(req.body);
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
    const data = cleanCompetency(req.body);
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
