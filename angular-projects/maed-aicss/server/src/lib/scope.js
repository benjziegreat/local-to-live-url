// Data scoping: teachers see only the sections assigned to them, admins see the whole school.
const prisma = require('./prisma');
const { HttpError } = require('./http');

const isAdmin = (user) => user.role === 'ADMIN';

/** Prisma `where` for sections visible to `user`. */
function sectionWhere(user) {
  return isAdmin(user) ? {} : { teacherId: user.id };
}

/** Prisma `where` for learners visible to `user` (active only unless `includeArchived`). */
function learnerWhere(user, { includeArchived = false, sectionId } = {}) {
  const where = {};
  if (!includeArchived) where.status = 'ACTIVE';
  if (!isAdmin(user)) where.section = { teacherId: user.id };
  if (sectionId) where.sectionId = sectionId;
  return where;
}

async function assertSection(user, sectionId) {
  if (!sectionId) throw new HttpError(400, 'Choose a section');
  const section = await prisma.section.findFirst({ where: { id: Number(sectionId), ...sectionWhere(user) } });
  if (!section) throw new HttpError(403, 'This section is not assigned to you');
  return section;
}

async function assertLearner(user, learnerId) {
  const learner = await prisma.learner.findFirst({
    where: { id: Number(learnerId), ...learnerWhere(user, { includeArchived: isAdmin(user) }) },
    include: { section: { include: { teacher: true } } },
  });
  if (!learner) throw new HttpError(404, 'Learner not found or not assigned to you');
  return learner;
}

/**
 * Predicate for competencies relevant to the sections in view: core subjects always,
 * electives only when one of those sections takes that elective.
 */
async function competencyFilter(user, sectionId) {
  const [electives, sections] = await Promise.all([
    prisma.subject.findMany({ where: { kind: 'ELECTIVE' }, select: { name: true } }),
    prisma.section.findMany({ where: { ...sectionWhere(user), ...(sectionId && { id: sectionId }) }, include: { elective: true } }),
  ]);
  const electiveNames = new Set(electives.map((e) => e.name));
  const taken = new Set(sections.map((s) => s.elective?.name).filter(Boolean));
  return (c) => !electiveNames.has(c.learningArea) || taken.has(c.learningArea);
}

/** Optional numeric query param. */
function optInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

module.exports = { isAdmin, sectionWhere, learnerWhere, assertSection, assertLearner, competencyFilter, optInt };
