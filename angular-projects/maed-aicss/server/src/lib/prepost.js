// Competency-level pre-test / post-test calculations.
//
//   Pre-test %    = pre-test score / pre-test total items × 100
//   Post-test %   = post-test score / post-test total items × 100
//   Learning gain = post-test % − pre-test %   (percentage points)
//
// Change: IMPROVED (gain > 0), MAINTAINED (gain = 0), DECLINED (gain < 0), PENDING (no post-test yet).
// Performance is read from the post-test against the mastery target (or from the pre-test
// while the post-test is pending).
const prisma = require('./prisma');
const { round1, avg } = require('./metrics');
const { dayKey } = require('./time');
const { learnerName } = require('./shape');

const CHANGE_LABEL = { IMPROVED: 'Improved', MAINTAINED: 'Maintained', DECLINED: 'Declined', PENDING: 'Awaiting post-test', NO_PRETEST: 'No pre-test' };

const pctOf = (score, total) => (score === null || score === undefined || !total ? null : round1((score / total) * 100));

function change(prePct, postPct) {
  if (postPct === null) return 'PENDING';
  if (prePct === null) return 'NO_PRETEST';
  const gain = round1(postPct - prePct);
  return gain > 0 ? 'IMPROVED' : gain < 0 ? 'DECLINED' : 'MAINTAINED';
}

function performance(prePct, postPct, settings) {
  if (postPct !== null) {
    if (postPct >= settings.masteryTarget) return 'Mastered';
    if (postPct >= settings.masteryTarget - 10) return 'Nearly mastered';
    return 'Needs remediation';
  }
  if (prePct === null) return 'Not yet tested';
  if (prePct >= 90) return 'Advanced: provide enrichment';
  if (prePct < settings.pretestLowThreshold) return 'Low readiness: remediate prerequisites';
  return 'Developing';
}

/** One learner's record from a test and a score row. */
function record(test, score, settings) {
  const prePct = pctOf(score.preScore, test.preTotal);
  const postPct = pctOf(score.postScore, test.postTotal);
  const gain = prePct !== null && postPct !== null ? round1(postPct - prePct) : null;
  const c = change(prePct, postPct);
  const perf = performance(prePct, postPct, settings);
  return {
    testId: test.id,
    learnerId: score.learnerId,
    learnerNo: score.learner?.learnerNo ?? null,
    learner: score.learner ? learnerName(score.learner) : null,
    sectionId: test.sectionId,
    section: test.section?.name ?? null,
    subjectId: test.competency.subjectId,
    subject: test.competency.subject?.name ?? test.competency.learningArea,
    quarter: test.quarter,
    competencyId: test.competencyId,
    competencyCode: test.competency.code,
    competencyTitle: test.competency.title,
    preScore: score.preScore,
    preTotal: test.preTotal,
    postScore: score.postScore,
    postTotal: test.postTotal,
    prePct,
    postPct,
    gain,
    change: c,
    performance: perf,
    interpretation: c === 'PENDING' ? perf : `${CHANGE_LABEL[c]} · ${perf}`,
    preDate: test.preDate ? dayKey(test.preDate) : null,
    postDate: test.postDate ? dayKey(test.postDate) : null,
  };
}

const TEST_INCLUDE = {
  section: true,
  competency: { include: { subject: true } },
  scores: { where: { learner: { status: 'ACTIVE' } }, include: { learner: true } },
};

/** Tests matching `where` with every learner record flattened. */
async function loadPrePost(where, settings) {
  const tests = await prisma.prePostTest.findMany({
    where,
    include: TEST_INCLUDE,
    orderBy: [{ quarter: 'asc' }, { competency: { code: 'asc' } }, { section: { name: 'asc' } }],
  });
  const records = [];
  for (const t of tests) for (const s of t.scores) records.push(record(t, s, settings));
  return { tests, records };
}

/** Class-level summary of a list of records. */
function summarize(records, settings) {
  const pre = records.map((r) => r.prePct).filter((v) => v !== null);
  const post = records.map((r) => r.postPct).filter((v) => v !== null);
  const both = records.filter((r) => r.gain !== null);
  const count = (c) => records.filter((r) => r.change === c).length;
  const mean = (list) => (list.length ? round1(avg(list)) : null);
  return {
    learners: records.length,
    preTaken: pre.length,
    postTaken: post.length,
    completed: both.length,
    avgPre: mean(pre),
    avgPost: mean(post),
    // Gain over learners with both scores, so a missing post-test does not distort it
    avgGain: mean(both.map((r) => r.gain)),
    avgPreCompleted: mean(both.map((r) => r.prePct)),
    avgPostCompleted: mean(both.map((r) => r.postPct)),
    improved: count('IMPROVED'),
    maintained: count('MAINTAINED'),
    declined: count('DECLINED'),
    pending: count('PENDING'),
    masteredPost: post.filter((p) => p >= settings.masteryTarget).length,
    lowPre: pre.filter((p) => p < settings.pretestLowThreshold).length,
    limitedGain: both.filter((r) => r.gain < settings.minLearningGain && r.postPct < settings.masteryTarget).length,
  };
}

/** One row per test (section × competency) with its class summary. */
function testRows(tests, records, settings) {
  const byTest = new Map();
  for (const r of records) byTest.set(r.testId, [...(byTest.get(r.testId) ?? []), r]);
  return tests.map((t) => ({
    id: t.id,
    sectionId: t.sectionId,
    section: t.section.name,
    subjectId: t.competency.subjectId,
    subject: t.competency.subject?.name ?? t.competency.learningArea,
    competencyId: t.competencyId,
    competencyCode: t.competency.code,
    competencyTitle: t.competency.title,
    quarter: t.quarter,
    preTotal: t.preTotal,
    postTotal: t.postTotal,
    preDate: t.preDate ? dayKey(t.preDate) : null,
    postDate: t.postDate ? dayKey(t.postDate) : null,
    ...summarize(byTest.get(t.id) ?? [], settings),
  }));
}

/** One row per competency across sections (the pre/post comparison chart). */
function competencyRows(records, settings) {
  const by = new Map();
  for (const r of records) {
    const e = by.get(r.competencyId) ?? { competencyId: r.competencyId, code: r.competencyCode, title: r.competencyTitle, subject: r.subject, quarter: r.quarter, list: [] };
    e.list.push(r);
    by.set(r.competencyId, e);
  }
  return [...by.values()].map(({ list, ...e }) => ({ ...e, ...summarize(list, settings) }));
}

module.exports = { pctOf, change, performance, record, loadPrePost, summarize, testRows, competencyRows, CHANGE_LABEL, TEST_INCLUDE };
