// One-time data upgrades for databases created before subject-based filtering.
// Safe to run on every start: it only touches rows that are still missing their links.
const prisma = require('./prisma');

/** Link competencies to their subject by name (the old `learningArea` text). */
async function linkCompetencySubjects() {
  const unlinked = await prisma.competency.findMany({ where: { subjectId: null }, select: { id: true, learningArea: true } });
  if (!unlinked.length) return 0;
  const subjects = await prisma.subject.findMany({ select: { id: true, name: true, code: true } });
  const byName = new Map();
  for (const s of subjects) {
    byName.set(s.name.toLowerCase(), s.id);
    byName.set(s.code.toLowerCase(), s.id);
  }
  let linked = 0;
  for (const c of unlinked) {
    const subjectId = byName.get(c.learningArea.trim().toLowerCase());
    if (!subjectId) continue;
    await prisma.competency.update({ where: { id: c.id }, data: { subjectId } });
    linked++;
  }
  return linked;
}

async function runBackfill() {
  try {
    const linked = await linkCompetencySubjects();
    if (linked) console.log(`Linked ${linked} competenc${linked === 1 ? 'y' : 'ies'} to their subjects.`);
  } catch (err) {
    // P2021 = missing table, P2022 = missing column: the database is older than the schema.
    if (err.code === 'P2021' || err.code === 'P2022') {
      console.error(
        '\n*** The database schema is out of date (missing ' + (err.meta?.column ?? err.meta?.table ?? 'tables/columns') + ').\n' +
          '*** Run:  npm run db:push --prefix server   (adds the new tables/columns, keeps your data)\n' +
          '*** then restart the API.\n',
      );
    } else {
      console.warn(`Skipped data backfill: ${err.message.split('\n')[0]}`);
    }
  }
}

module.exports = { runBackfill };
