// Competency coverage and completion, shared by the Competencies module and the reports.
//
// Completion per competency, over the sections in view that take its subject:
//   COMPLETED    a post-test is recorded in every such section
//   IN_PROGRESS  lessons logged, a pre-test given, or assessments recorded
//   NOT_STARTED  nothing yet
const prisma = require('./prisma');
const { sectionWhere } = require('./scope');
const { loadPrePost, testRows } = require('./prepost');
const { dayKey } = require('./time');

/** Lessons, pre/post-tests and offering sections for the given competencies within the view. */
async function coverage(user, { subjectId, sectionId, competencyIds, settings }) {
  const sections = { ...sectionWhere(user, subjectId), ...(sectionId && { id: sectionId }) };
  const [offered, sessions, prePost] = await Promise.all([
    // Which sections in view take which subjects
    prisma.classSchedule.findMany({
      where: { section: sections, ...(subjectId && { subjectId }) },
      distinct: ['sectionId', 'subjectId'],
      select: { sectionId: true, subjectId: true },
    }),
    prisma.classSession.groupBy({
      by: ['competencyId'],
      where: { competencyId: { in: competencyIds }, schedule: { section: sections } },
      _count: { _all: true },
      _max: { date: true },
    }),
    loadPrePost({ academicYear: settings.academicYear, competencyId: { in: competencyIds }, section: sections }, settings),
  ]);
  const sectionsBySubject = new Map();
  for (const o of offered) sectionsBySubject.set(o.subjectId, (sectionsBySubject.get(o.subjectId) ?? 0) + 1);
  const lessons = new Map(sessions.map((s) => [s.competencyId, { count: s._count._all, last: s._max.date ? dayKey(s._max.date) : null }]));
  const tests = testRows(prePost.tests, prePost.records, settings);
  const testsBy = new Map();
  for (const t of tests) testsBy.set(t.competencyId, [...(testsBy.get(t.competencyId) ?? []), t]);
  const recordsBy = new Map();
  for (const r of prePost.records) recordsBy.set(r.competencyId, [...(recordsBy.get(r.competencyId) ?? []), r]);
  return { sectionsBySubject, lessons, testsBy, recordsBy };
}

/** Completion status of one competency given its coverage and number of regular assessments. */
function completion(c, cov, assessments) {
  const sections = cov.sectionsBySubject.get(c.subjectId) ?? 0;
  const tests = cov.testsBy.get(c.id) ?? [];
  const completedSections = tests.filter((t) => t.postTaken > 0).length;
  const lessons = cov.lessons.get(c.id)?.count ?? 0;
  let status = 'NOT_STARTED';
  if (sections && completedSections >= sections) status = 'COMPLETED';
  else if (lessons || tests.length || assessments) status = 'IN_PROGRESS';
  return { status, sections, completedSections, lessons, lastLesson: cov.lessons.get(c.id)?.last ?? null, tests };
}

const COMPLETION_LABEL = { COMPLETED: 'Completed', IN_PROGRESS: 'In progress', NOT_STARTED: 'Not started' };

module.exports = { coverage, completion, COMPLETION_LABEL };
