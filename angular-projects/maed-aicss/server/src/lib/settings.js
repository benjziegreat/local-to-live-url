const prisma = require('./prisma');

const DEFAULTS = {
  id: 1,
  schoolName: 'Senior High School',
  academicYear: '2026-2027',
};

let cache = null;

/** School settings (single row), created with defaults on first use. */
async function getSettings() {
  if (cache) return cache;
  cache = await prisma.schoolSetting.upsert({ where: { id: 1 }, update: {}, create: DEFAULTS });
  return cache;
}

function clearSettingsCache() {
  cache = null;
}

module.exports = { getSettings, clearSettingsCache };
