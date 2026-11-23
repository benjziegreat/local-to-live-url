// Assessment records.
//
// Competency-level pre-test / post-test (one test per section × competency × school year):
//   GET    /prepost?subjectId&sectionId&competencyId&quarter&phase   learner records + class summaries
//   GET    /prepost/sheet?sectionId&competencyId                     encoding sheet (roster + scores)
//   PUT    /prepost                                                  save a sheet (pre and/or post scores)
//   DELETE /prepost/:id
// Regular assessments (quizzes, performance tasks, exams):
//   GET /?subjectId&competencyId&sectionId&quarter, GET/PUT/DELETE /:id, POST /
//
// Subject teachers may record for every section where they teach that subject.
const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { getSettings } = require('../lib/settings');
const { invalidateAlerts } = require('../lib/alerts');
const { logActivity } = require('../lib/log');
const { sectionWhere, assertSection, isAdmin, optInt, subjectOf, competencyWhere } = require('../lib/scope');
const { round1, avg, scorePercents, distribution } = require('../lib/metrics');
const { loadPrePost, summarize, testRows, competencyRows } = require('../lib/prepost');
const { parseDay, dayKey } = require('../lib/time');
const { learnerName } = require('../lib/shape');

const router = express.Router();
router.use(authenticate);

const TYPES = ['QUIZ', 'PERFORMANCE_TASK', 'QUARTERLY_EXAM'];
const PHASES = { pending: (r) => r.prePct !== null && r.postPct === null, complete: (r) => r.gain !== null, pre: (r) => r.prePct !== null, post: (r) => r.postPct !== null };

/** Competencies offered in the filters/editors of the current view. */
function competencyOptions(user, subjectId) {
  return prisma.competency.findMany({
    where: { ...competencyWhere(user, { subjectId }), active: true },
    orderBy: [{ learningArea: 'asc' }, { quarter: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, title: true, quarter: true, learningArea: true, subjectId: true, learningPeriod: true },
  });
}

// ---- Pre-test / post-test -------------------------------------------------------

router.get(
  '/prepost',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const subjectId = subjectOf(req);
    const sectionId = optInt(req.query.sectionId);
    const competencyId = optInt(req.query.competencyId);
    const quarter = optInt(req.query.quarter);
    const where = {
      academicYear: settings.academicYear,
      ...(quarter && { quarter }),
      ...(competencyId && { competencyId }),
      ...(subjectId && { competency: { subjectId } }),
      section: { ...sectionWhere(req.user, subjectId), ...(sectionId && { id: sectionId }) },
    };
    const [{ tests, records }, sections, competencies] = await Promise.all([
      loadPrePost(where, settings),
      prisma.section.findMany({ where: sectionWhere(req.user, subjectId), orderBy: { name: 'asc' } }),
      competencyOptions(req.user, subjectId),
    ]);
    const phase = PHASES[req.query.phase];
    const shown = (phase ? records.filter(phase) : records).sort(
      (a, b) => a.quarter - b.quarter || a.competencyCode.localeCompare(b.competencyCode) || a.section.localeCompare(b.section) || a.learner.localeCompare(b.learner),
    );

    res.json({
      academicYear: settings.academicYear,
      masteryTarget: settings.masteryTarget,
      minLearningGain: settings.minLearningGain,
      pretestLowThreshold: settings.pretestLowThreshold,
      sections: sections.map((s) => ({ id: s.id, name: s.name })),
      competencies,
      summary: { tests: tests.length, ...summarize(records, settings) },
      tests: testRows(tests, records, settings),
      byCompetency: competencyRows(records, settings),
      records: shown,
    });
  }),
);

/** Encoding sheet: the section roster with any saved pre/post scores for one competency. */
router.get(
  '/prepost/sheet',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const competency = await prisma.competency.findUnique({ where: { id: optInt(req.query.competencyId) ?? 0 }, include: { subject: true } });
    if (!competency) throw new HttpError(400, 'Choose a competency');
    const section = await assertSection(req.user, optInt(req.query.sectionId), competency.subjectId);
    const [test, learners] = await Promise.all([
      prisma.prePostTest.findUnique({
        where: { sectionId_competencyId_academicYear: { sectionId: section.id, competencyId: competency.id, academicYear: settings.academicYear } },
        include: { scores: true },
      }),
      prisma.learner.findMany({ where: { sectionId: section.id, status: 'ACTIVE' }, orderBy: [{ sex: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }] }),
    ]);
    const scoreBy = new Map((test?.scores ?? []).map((s) => [s.learnerId, s]));
    res.json({
      test: test
        ? { id: test.id, preTotal: test.preTotal, postTotal: test.postTotal, preDate: test.preDate ? dayKey(test.preDate) : null, postDate: test.postDate ? dayKey(test.postDate) : null }
        : null,
      section: { id: section.id, name: section.name },
      competency: { id: competency.id, code: competency.code, title: competency.title, quarter: competency.quarter, subject: competency.subject?.name ?? competency.learningArea },
      learners: learners.map((l) => ({
        id: l.id,
        learnerNo: l.learnerNo,
        name: learnerName(l),
        sex: l.sex,
        preScore: scoreBy.get(l.id)?.preScore ?? null,
        postScore: scoreBy.get(l.id)?.postScore ?? null,
      })),
    });
  }),
);

const blank = (v) => v === null || v === undefined || v === '';

router.put(
  '/prepost',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const b = req.body || {};
    const competency = await prisma.competency.findUnique({ where: { id: Number(b.competencyId) || 0 } });
    if (!competency) throw new HttpError(400, 'Choose a competency');
    const section = await assertSection(req.user, optInt(b.sectionId), competency.subjectId);
    const preTotal = Number(b.preTotal);
    const postTotal = Number(b.postTotal);
    for (const [label, n] of [['Pre-test', preTotal], ['Post-test', postTotal]]) {
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw new HttpError(400, `${label} total items must be 1 to 1000`);
    }

    const roster = new Set((await prisma.learner.findMany({ where: { sectionId: section.id, status: 'ACTIVE' }, select: { id: true } })).map((l) => l.id));
    const scores = [];
    for (const s of Array.isArray(b.scores) ? b.scores : []) {
      if (!roster.has(Number(s.learnerId))) continue;
      const pre = blank(s.preScore) ? null : Number(s.preScore);
      const post = blank(s.postScore) ? null : Number(s.postScore);
      if (pre !== null && (!Number.isFinite(pre) || pre < 0 || pre > preTotal)) throw new HttpError(400, `Pre-test scores must be between 0 and ${preTotal}`);
      if (post !== null && (!Number.isFinite(post) || post < 0 || post > postTotal)) throw new HttpError(400, `Post-test scores must be between 0 and ${postTotal}`);
      if (pre !== null || post !== null) scores.push({ learnerId: Number(s.learnerId), preScore: pre, postScore: post });
    }
    if (!scores.length) throw new HttpError(400, 'Enter at least one pre-test or post-test score');
    const hasPost = scores.some((s) => s.postScore !== null);
    const data = {
      quarter: competency.quarter,
      preTotal,
      postTotal,
      preDate: b.preDate ? parseDay(b.preDate) : null,
      postDate: b.postDate ? parseDay(b.postDate) : hasPost ? parseDay() : null,
    };

    const key = { sectionId_competencyId_academicYear: { sectionId: section.id, competencyId: competency.id, academicYear: settings.academicYear } };
    const test = await prisma.$transaction(async (tx) => {
      const t = await tx.prePostTest.upsert({
        where: key,
        update: data,
        create: { ...data, sectionId: section.id, competencyId: competency.id, academicYear: settings.academicYear, createdById: req.user.id },
      });
      await tx.prePostScore.deleteMany({ where: { testId: t.id } });
      await tx.prePostScore.createMany({ data: scores.map((s) => ({ ...s, testId: t.id })) });
      return t;
    });
    invalidateAlerts();
    const pre = scores.filter((s) => s.preScore !== null).length;
    const post = scores.filter((s) => s.postScore !== null).length;
    logActivity(req.user.id, 'Recorded pre/post-test', 'Assessment', `${competency.code} · ${section.name} · ${pre} pre-test, ${post} post-test score(s)`);
    res.json({ id: test.id, pre, post });
  }),
);

router.delete(
  '/prepost/:id',
  asyncHandler(async (req, res) => {
    const test = await prisma.prePostTest.findUnique({ where: { id: Number(req.params.id) || 0 }, include: { competency: true, section: true } });
    if (!test) throw new HttpError(404, 'Pre/post-test not found');
    await assertSection(req.user, test.sectionId, test.competency.subjectId);
    if (!isAdmin(req.user) && test.createdById !== req.user.id) throw new HttpError(403, 'Only the teacher who recorded it or an admin can delete it');
    await prisma.prePostTest.delete({ where: { id: test.id } });
    invalidateAlerts();
    logActivity(req.user.id, 'Deleted pre/post-test', 'Assessment', `${test.competency.code} · ${test.section.name}`);
    res.json({ ok: true });
  }),
);

// ---- Regular assessments ---------------------------------------------------------

function assessmentWhere(user, { quarter, sectionId, learningArea, subjectId, competencyId }) {
  const competency = { ...(learningArea && { learningArea }), ...(subjectId && { subjectId }) };
  return {
    ...(quarter && { quarter }),
    ...(competencyId && { competencyId }),
    ...(Object.keys(competency).length && { competency }),
    section: { ...sectionWhere(user, subjectId), ...(sectionId && { id: sectionId }) },
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const filter = {
      quarter: optInt(req.query.quarter),
      sectionId: optInt(req.query.sectionId),
      subjectId: subjectOf(req),
      competencyId: optInt(req.query.competencyId),
      learningArea: req.query.learningArea ? String(req.query.learningArea) : undefined,
    };
    const where = assessmentWhere(req.user, filter);

    const [assessments, pcts, previous, sections, areas, competencies] = await Promise.all([
      prisma.assessment.findMany({
        where,
        include: { competency: true, section: true, createdBy: true, scores: { select: { score: true } } },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
      }),
      scorePercents(where),
      filter.quarter && filter.quarter > 1 ? scorePercents(assessmentWhere(req.user, { ...filter, quarter: filter.quarter - 1 })) : Promise.resolve(null),
      prisma.section.findMany({ where: sectionWhere(req.user, filter.subjectId), orderBy: { name: 'asc' } }),
      prisma.competency.findMany({ distinct: ['learningArea'], select: { learningArea: true }, orderBy: { learningArea: 'asc' } }),
      competencyOptions(req.user, filter.subjectId),
    ]);

    const d = distribution(pcts, settings);
    const prevAverage = previous && previous.length ? round1(avg(previous)) : null;

    res.json({
      sections: sections.map((s) => ({ id: s.id, name: s.name })),
      learningAreas: areas.map((a) => a.learningArea),
      competencies,
      masteryTarget: settings.masteryTarget,
      summary: {
        average: d.average,
        previousAverage: prevAverage,
        delta: d.average !== null && prevAverage !== null ? round1(d.average - prevAverage) : null,
        assessments: assessments.length,
        scores: d.scores,
        passRate: d.passRate,
      },
      distribution: d.distribution,
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
          subjectId: a.competency.subjectId,
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

/** Load an assessment the user may work with (subject teacher of its competency's subject, adviser or admin). */
async function loadAssessment(user, id, include = {}) {
  const assessment = await prisma.assessment.findUnique({ where: { id: Number(id) || 0 }, include: { competency: true, ...include } });
  if (!assessment) throw new HttpError(404, 'Assessment not found');
  const ok =
    isAdmin(user) ||
    (await prisma.section.findFirst({
      where: { id: assessment.sectionId, OR: [{ teacherId: user.id }, ...(assessment.competency.subjectId ? [sectionWhere(user, assessment.competency.subjectId)] : [])] },
      select: { id: true },
    }));
  if (!ok) throw new HttpError(404, 'Assessment not found');
  return assessment;
}

/** One assessment with the section roster and any recorded scores. */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const assessment = await loadAssessment(req.user, req.params.id, { section: true, scores: true });
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
  const competency = await prisma.competency.findUnique({ where: { id: Number(body?.competencyId) || 0 } });
  if (!competency) throw new HttpError(400, 'Choose a competency');
  const section = await assertSection(user, optInt(body?.sectionId), competency.subjectId ?? undefined).catch(async (err) => {
    // Advisers may still record any subject for their advisory section.
    const own = await prisma.section.findFirst({ where: { id: optInt(body?.sectionId) ?? 0, ...sectionWhere(user) } });
    if (own) return own;
    throw err;
  });

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
    await loadAssessment(req.user, id);
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
    const existing = await loadAssessment(req.user, id);
    if (!isAdmin(req.user) && existing.createdById !== req.user.id) throw new HttpError(403, 'Only the teacher who recorded it or an admin can delete it');
    await prisma.assessment.delete({ where: { id } });
    invalidateAlerts();
    logActivity(req.user.id, 'Deleted assessment', 'Assessment', existing.title);
    res.json({ ok: true });
  }),
);

module.exports = router;
