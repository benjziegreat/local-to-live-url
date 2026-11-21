const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { getSettings } = require('../lib/settings');
const { invalidateAlerts } = require('../lib/alerts');
const { logActivity } = require('../lib/log');
const { sectionWhere, assertSection, isAdmin, optInt } = require('../lib/scope');
const { round1, avg } = require('../lib/metrics');
const { parseDay } = require('../lib/time');
const { learnerName } = require('../lib/shape');

const router = express.Router();
router.use(authenticate);

const TYPES = ['QUIZ', 'PERFORMANCE_TASK', 'QUARTERLY_EXAM'];

function assessmentWhere(user, { quarter, sectionId, learningArea }) {
  return {
    ...(quarter && { quarter }),
    ...(learningArea && { competency: { learningArea } }),
    section: { ...sectionWhere(user), ...(sectionId && { id: sectionId }) },
  };
}

/** Percentages of every score in the matching assessments. */
async function scorePercents(where) {
  const scores = await prisma.assessmentScore.findMany({
    where: { assessment: where, learner: { status: 'ACTIVE' } },
    select: { score: true, assessment: { select: { maxScore: true } } },
  });
  return scores.filter((s) => s.assessment.maxScore).map((s) => (s.score / s.assessment.maxScore) * 100);
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const quarter = optInt(req.query.quarter);
    const sectionId = optInt(req.query.sectionId);
    const learningArea = req.query.learningArea ? String(req.query.learningArea) : undefined;
    const where = assessmentWhere(req.user, { quarter, sectionId, learningArea });

    const [assessments, pcts, previous, sections, areas] = await Promise.all([
      prisma.assessment.findMany({
        where,
        include: { competency: true, section: true, createdBy: true, scores: { select: { score: true } } },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
      }),
      scorePercents(where),
      quarter && quarter > 1 ? scorePercents(assessmentWhere(req.user, { quarter: quarter - 1, sectionId, learningArea })) : Promise.resolve(null),
      prisma.section.findMany({ where: sectionWhere(req.user), orderBy: { name: 'asc' } }),
      prisma.competency.findMany({ distinct: ['learningArea'], select: { learningArea: true }, orderBy: { learningArea: 'asc' } }),
    ]);

    const average = pcts.length ? round1(avg(pcts)) : null;
    const prevAverage = previous && previous.length ? round1(avg(previous)) : null;
    const excellent = pcts.filter((p) => p >= 90).length;
    const satisfactory = pcts.filter((p) => p < 90 && p >= settings.masteryTarget).length;
    const needsImprovement = pcts.length - excellent - satisfactory;
    const share = (n) => (pcts.length ? round1((n / pcts.length) * 100) : 0);

    res.json({
      sections: sections.map((s) => ({ id: s.id, name: s.name })),
      learningAreas: areas.map((a) => a.learningArea),
      masteryTarget: settings.masteryTarget,
      summary: {
        average,
        previousAverage: prevAverage,
        delta: average !== null && prevAverage !== null ? round1(average - prevAverage) : null,
        assessments: assessments.length,
        scores: pcts.length,
        passRate: share(excellent + satisfactory),
      },
      distribution: { excellent: share(excellent), satisfactory: share(satisfactory), needsImprovement: share(needsImprovement) },
      assessments: assessments.map((a) => {
        const list = a.scores.map((s) => (s.score / a.maxScore) * 100);
        return {
          id: a.id,
          title: a.title,
          type: a.type,
          date: a.date,
          quarter: a.quarter,
          maxScore: a.maxScore,
          competencyId: a.competencyId,
          competency: `${a.competency.code}`,
          competencyTitle: a.competency.title,
          learningArea: a.competency.learningArea,
          sectionId: a.sectionId,
          section: a.section.name,
          scored: list.length,
          average: list.length ? round1(avg(list)) : null,
          passed: list.filter((p) => p >= settings.masteryTarget).length,
          createdBy: a.createdBy ? `${a.createdBy.firstName} ${a.createdBy.lastName}` : null,
        };
      }),
    });
  }),
);

/** One assessment with the section roster and any recorded scores. */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const assessment = await prisma.assessment.findFirst({
      where: { id: Number(req.params.id), section: sectionWhere(req.user) },
      include: { competency: true, section: true, scores: true },
    });
    if (!assessment) throw new HttpError(404, 'Assessment not found');
    const learners = await prisma.learner.findMany({
      where: { sectionId: assessment.sectionId, status: 'ACTIVE' },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const scoreBy = new Map(assessment.scores.map((s) => [s.learnerId, s.score]));
    const { scores, ...rest } = assessment;
    res.json({
      ...rest,
      learners: learners.map((l) => ({ id: l.id, learnerNo: l.learnerNo, name: learnerName(l), score: scoreBy.get(l.id) ?? null })),
    });
  }),
);

async function cleanAssessment(user, body) {
  const title = String(body?.title ?? '').trim();
  const maxScore = Number(body?.maxScore);
  if (!title) throw new HttpError(400, 'Title is required');
  if (!TYPES.includes(body?.type)) throw new HttpError(400, 'Choose an assessment type');
  if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > 1000) throw new HttpError(400, 'Highest possible score must be 1 to 1000');
  const section = await assertSection(user, optInt(body?.sectionId));
  const competency = await prisma.competency.findUnique({ where: { id: Number(body?.competencyId) || 0 } });
  if (!competency) throw new HttpError(400, 'Choose a competency');

  const roster = new Set((await prisma.learner.findMany({ where: { sectionId: section.id, status: 'ACTIVE' }, select: { id: true } })).map((l) => l.id));
  const scores = [];
  for (const s of Array.isArray(body?.scores) ? body.scores : []) {
    if (s.score === null || s.score === '' || s.score === undefined) continue;
    const score = Number(s.score);
    if (!roster.has(Number(s.learnerId))) continue;
    if (!Number.isFinite(score) || score < 0 || score > maxScore) throw new HttpError(400, `Scores must be between 0 and ${maxScore}`);
    scores.push({ learnerId: Number(s.learnerId), score });
  }
  return {
    data: { title: title.slice(0, 190), type: body.type, competencyId: competency.id, sectionId: section.id, date: parseDay(body?.date), maxScore, quarter: competency.quarter },
    scores,
    section,
    competency,
  };
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { data, scores, section, competency } = await cleanAssessment(req.user, req.body);
    const created = await prisma.assessment.create({ data: { ...data, createdById: req.user.id, scores: { create: scores } } });
    invalidateAlerts();
    logActivity(req.user.id, 'Recorded assessment', 'Assessment', `${created.title} · ${competency.code} · ${section.name} · ${scores.length} scores`);
    res.status(201).json({ id: created.id });
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.assessment.findFirst({ where: { id, section: sectionWhere(req.user) } });
    if (!existing) throw new HttpError(404, 'Assessment not found');
    const { data, scores, section } = await cleanAssessment(req.user, req.body);
    await prisma.$transaction([
      prisma.assessment.update({ where: { id }, data }),
      prisma.assessmentScore.deleteMany({ where: { assessmentId: id } }),
      prisma.assessmentScore.createMany({ data: scores.map((s) => ({ ...s, assessmentId: id })) }),
    ]);
    invalidateAlerts();
    logActivity(req.user.id, 'Updated assessment', 'Assessment', `${data.title} · ${section.name} · ${scores.length} scores`);
    res.json({ id });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.assessment.findFirst({ where: { id, section: sectionWhere(req.user) } });
    if (!existing) throw new HttpError(404, 'Assessment not found');
    if (!isAdmin(req.user) && existing.createdById !== req.user.id) throw new HttpError(403, 'Only the teacher who recorded it or an admin can delete it');
    await prisma.assessment.delete({ where: { id } });
    invalidateAlerts();
    logActivity(req.user.id, 'Deleted assessment', 'Assessment', existing.title);
    res.json({ ok: true });
  }),
);

module.exports = router;
