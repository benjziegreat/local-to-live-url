// Data scoping. Every module (attendance, competencies, assessments, alerts, reports,
// learners, dashboard) filters through these helpers, so the subject filter behaves the
// same everywhere.
//
// Without a subject ("All subjects"):
//   admin    the whole school
//   teacher  their advisory sections (all subjects)
// With a subject (`subjectId`):
//   admin    every section that takes the subject
//   teacher  sections where they teach the subject, plus advisory sections that take it
const prisma = require('./prisma');
const { HttpError } = require('./http');

const isAdmin = (user) => user.role === 'ADMIN';

/** Optional numeric query param. */
function optInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The subject filter of a request (`?subjectId=`), or undefined for all subjects. */
function subjectOf(req) {
  return optInt(req.query?.subjectId ?? req.body?.subjectId);
}

/** Prisma `where` for sections visible to `user`, optionally limited to one subject. */
function sectionWhere(user, subjectId) {
  if (!subjectId) return isAdmin(user) ? {} : { teacherId: user.id };
  if (isAdmin(user)) return { schedules: { some: { subjectId } } };
  return {
    OR: [{ teacherId: user.id, schedules: { some: { subjectId } } }, { schedules: { some: { subjectId, teacherId: user.id } } }],
  };
}

/** Sections a user may open records for at all: advisory sections and sections they teach in. */
function visibleSectionWhere(user) {
  return isAdmin(user) ? {} : { OR: [{ teacherId: user.id }, { schedules: { some: { teacherId: user.id } } }] };
}

/** Prisma `where` for learners visible to `user` (active only unless `includeArchived`). */
function learnerWhere(user, { includeArchived = false, sectionId, subjectId } = {}) {
  const where = {};
  if (!includeArchived) where.status = 'ACTIVE';
  const sw = sectionWhere(user, subjectId);
  if (Object.keys(sw).length) where.section = sw;
  if (sectionId) where.sectionId = sectionId;
  return where;
}

/** Prisma `where` for attendance rows of one subject (all subjects when undefined). */
function attendanceSubject(subjectId) {
  return subjectId ? { schedule: { subjectId } } : {};
}

/** Prisma `where` for competencies relevant to the view. */
function competencyWhere(user, { subjectId, sectionId } = {}) {
  if (subjectId) return { subjectId };
  if (isAdmin(user) && !sectionId) return {};
  const sections = { ...sectionWhere(user), ...(sectionId && { id: sectionId }) };
  return { OR: [{ subjectId: null }, { subject: { schedules: { some: { section: sections } } } }] };
}

async function assertSection(user, sectionId, subjectId) {
  if (!sectionId) throw new HttpError(400, 'Choose a section');
  const section = await prisma.section.findFirst({ where: { id: Number(sectionId), ...sectionWhere(user, subjectId) } });
  if (!section) throw new HttpError(403, subjectId ? 'You do not handle this subject in that section' : 'This section is not assigned to you');
  return section;
}

/** True when `user` may see records of `sectionId` (for `subjectId`, or any subject they teach there). */
async function canSeeSection(user, sectionId, subjectId) {
  if (isAdmin(user)) return true;
  if (!sectionId) return false;
  const where = subjectId ? sectionWhere(user, subjectId) : visibleSectionWhere(user);
  return !!(await prisma.section.findFirst({ where: { id: sectionId, ...where }, select: { id: true } }));
}

async function assertLearner(user, learnerId) {
  const learner = await prisma.learner.findFirst({
    where: { id: Number(learnerId), ...(isAdmin(user) ? {} : { status: 'ACTIVE', section: visibleSectionWhere(user) }) },
    include: { section: { include: { teacher: true } } },
  });
  if (!learner) throw new HttpError(404, 'Learner not found or not assigned to you');
  return learner;
}

/**
 * Subjects offered in the subject filter. Admins get every subject; teachers get the
 * subjects they teach and those of their advisory sections. `allowAll` says whether the
 * "All subjects" overall view is available (admins and advisers).
 */
async function subjectsFor(user) {
  if (isAdmin(user)) {
    const subjects = await prisma.subject.findMany({ where: { active: true }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] });
    return { allowAll: true, subjects: subjects.map((s) => ({ id: s.id, code: s.code, name: s.name, kind: s.kind, teaches: false })) };
  }
  const [rows, advisory] = await Promise.all([
    prisma.classSchedule.findMany({
      where: { OR: [{ teacherId: user.id }, { section: { teacherId: user.id } }] },
      select: { teacherId: true, subject: true },
    }),
    prisma.section.count({ where: { teacherId: user.id } }),
  ]);
  const byId = new Map();
  for (const r of rows) {
    const e = byId.get(r.subject.id) ?? { id: r.subject.id, code: r.subject.code, name: r.subject.name, kind: r.subject.kind, teaches: false };
    if (r.teacherId === user.id) e.teaches = true;
    byId.set(r.subject.id, e);
  }
  const KIND = { CORE: 0, ELECTIVE: 1, PROGRAM: 2 };
  const subjects = [...byId.values()].sort((a, b) => Number(b.teaches) - Number(a.teaches) || KIND[a.kind] - KIND[b.kind] || a.name.localeCompare(b.name));
  return { allowAll: advisory > 0, subjects };
}

/** The subject row for a filter value (404 when unknown). */
async function loadSubject(subjectId) {
  if (!subjectId) return null;
  const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
  if (!subject) throw new HttpError(404, 'Subject not found');
  return subject;
}

module.exports = {
  isAdmin,
  optInt,
  subjectOf,
  sectionWhere,
  visibleSectionWhere,
  learnerWhere,
  attendanceSubject,
  competencyWhere,
  assertSection,
  canSeeSection,
  assertLearner,
  subjectsFor,
  loadSubject,
};
