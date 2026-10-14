// Attendance statistics and dropout-risk scoring.

const ATTENDED = new Set(['PRESENT', 'LATE', 'EXCUSED']);

/** records: [{ status, date }] — `date` is used to count absences per school day. */
function summarize(records) {
  const stats = { total: records.length, present: 0, late: 0, absent: 0, excused: 0, cutting: 0 };
  const absentDays = new Set();
  for (const r of records) {
    stats[r.status.toLowerCase()] += 1;
    if (r.status === 'ABSENT') absentDays.add(r.date ? new Date(r.date).toISOString().slice(0, 10) : absentDays.size);
  }
  const attended = records.filter((r) => ATTENDED.has(r.status)).length;
  stats.rate = stats.total ? Math.round((attended / stats.total) * 100) : 100;
  stats.unexcusedAbsences = absentDays.size;
  stats.cuttingRate = stats.total ? Math.round((stats.cutting / stats.total) * 100) : 0;
  return stats;
}

/**
 * SAFE / MODERATE / CRITICAL.
 * Thresholds follow common early-warning practice: chronic absence starts
 * around 10% missed time, and repeated class cutting is a strong dropout signal.
 */
function riskLevel(stats) {
  if (stats.unexcusedAbsences >= 5 || stats.cuttingRate >= 20 || stats.rate < 80) return 'CRITICAL';
  if (stats.unexcusedAbsences >= 2 || stats.cuttingRate >= 10 || stats.rate < 90) return 'MODERATE';
  return 'SAFE';
}

function healthLabel(rate) {
  if (rate >= 90) return 'Good';
  if (rate >= 80) return 'Fair';
  return 'At Risk';
}

module.exports = { summarize, riskLevel, healthLabel, ATTENDED };
