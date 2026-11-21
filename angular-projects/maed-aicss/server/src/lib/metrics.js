// Attendance, assessment and competency calculations shared by the API routes.
//
// Attendance is recorded per class period (see AttendanceRecord). Two views are derived:
//   - Period level: attendance rate = periods attended (present + late) / periods recorded.
//   - Day level, per learner and date (dayStatus):
//       ABSENT   absent from every period that day
//       EXCUSED  every period absent or excused, at least one excused
//       LATE     attended, and late to at least one period
//       PRESENT  attended
//     A "partial" day = attended but absent from at least one period (possible cutting).
const prisma = require('./prisma');
const { dayKey } = require('./time');

const round1 = (n) => Math.round(n * 10) / 10;
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const rateOf = (attended, total) => (total ? round1((attended / total) * 100) : null);

/** Rate from day counts { present, late, absent, excused } (present + late = attended). */
function attendanceRate(c) {
  return rateOf(c.present + c.late, c.present + c.late + c.absent + c.excused);
}

const emptyPeriods = () => ({ PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 });

/** Day-level status from one learner's period counts on one date. */
function dayStatus(p) {
  const total = p.PRESENT + p.LATE + p.ABSENT + p.EXCUSED;
  const status = p.ABSENT === total ? 'ABSENT' : p.ABSENT + p.EXCUSED === total ? 'EXCUSED' : p.LATE > 0 ? 'LATE' : 'PRESENT';
  return { status, partial: (status === 'PRESENT' || status === 'LATE') && p.ABSENT > 0, total, attended: p.PRESENT + p.LATE, missed: p.ABSENT };
}

/** Group attendance rows ({learnerId, date, status, _count}) into per learner-day period counts. */
function learnerDays(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.learnerId}|${dayKey(r.date)}`;
    const e = map.get(key) ?? { learnerId: r.learnerId, date: dayKey(r.date), periods: emptyPeriods() };
    e.periods[r.status] += r._count._all;
    map.set(key, e);
  }
  return [...map.values()].map((e) => ({ ...e, ...dayStatus(e.periods) }));
}

const STATUS_ORDER = { AT_RISK: 0, MONITOR: 1, ON_TRACK: 2 };

function classify(m, s) {
  const att = m.attendanceRate ?? 100;
  const score = m.assessmentAvg ?? 100;
  const attIssue = att < s.attendanceTarget || m.recentAbsences >= s.absenceAlertThreshold || m.recentPartial >= s.missedClassThreshold;
  const scoreIssue = score < s.masteryTarget;
  let status = 'ON_TRACK';
  if (att < s.attendanceTarget - 10 || score < s.masteryTarget - 10 || m.recentAbsences >= s.absenceAlertThreshold) {
    status = 'AT_RISK';
  } else if (attIssue || scoreIssue) {
    status = 'MONITOR';
  }

  let action;
  if (status === 'AT_RISK') {
    action =
      attIssue && scoreIssue
        ? 'Provide an intervention plan and contact the parent/guardian.'
        : attIssue
          ? 'Contact the parent/guardian and set an attendance plan.'
          : 'Provide an intervention plan with reteaching.';
  } else if (status === 'MONITOR') {
    action =
      m.recentPartial >= s.missedClassThreshold
        ? 'Check missed class periods with subject teachers.'
        : attIssue
          ? 'Check attendance and assess needs.'
          : 'Assign supplementary activities.';
  } else {
    action = score >= 90 ? 'Encourage consistent performance.' : 'Continue current strategy.';
  }
  return { status, action };
}

function descriptor(score, s) {
  if (score === null || score === undefined) return 'No scores yet';
  if (score >= s.masteryTarget) return 'Passed';
  if (score >= s.masteryTarget - 10) return 'Developing';
  return 'Needs Improvement';
}

/** Mastery band of a single percentage. */
function band(score, s) {
  if (score >= s.masteryTarget) return 'MASTERED';
  if (score >= s.masteryTarget - 10) return 'IN_PROGRESS';
  return 'NEEDS_SUPPORT';
}

/** The first day of the most recent `n` school days that have attendance on record. */
async function recentWindowStart(n = 30) {
  const days = await prisma.attendanceRecord.groupBy({ by: ['date'], orderBy: { date: 'desc' }, take: n });
  return days.length ? dayKey(days[days.length - 1].date) : null;
}

/**
 * Per-learner metrics. `learners` = [{ id, sectionId, ... }].
 * Options: quarter (limits assessments), from/to (limits attendance).
 * Day counts (present/late/absent/excused/partialDays) are in learner-days;
 * attendanceRate is period-based.
 */
async function learnerMetrics(learners, settings, { quarter, from, to } = {}) {
  const ids = learners.map((l) => l.id);
  const result = new Map();
  if (!ids.length) return result;

  const dateFilter = from || to ? { date: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {};
  const [rows, windowStart, scores] = await Promise.all([
    prisma.attendanceRecord.groupBy({
      by: ['learnerId', 'date', 'status'],
      where: { learnerId: { in: ids }, ...dateFilter },
      _count: { _all: true },
    }),
    recentWindowStart(30),
    prisma.assessmentScore.findMany({
      where: { learnerId: { in: ids }, ...(quarter ? { assessment: { quarter } } : {}) },
      select: { learnerId: true, score: true, assessment: { select: { maxScore: true, competencyId: true } } },
    }),
  ]);

  for (const l of learners) {
    result.set(l.id, {
      learnerId: l.id,
      sectionId: l.sectionId,
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
      partialDays: 0,
      periodsTotal: 0,
      periodsAttended: 0,
      periodsMissed: 0,
      recentAbsences: 0,
      recentPartial: 0,
      recentMissedPeriods: 0,
      pcts: [],
      byCompetency: new Map(),
    });
  }
  for (const d of learnerDays(rows)) {
    const m = result.get(d.learnerId);
    if (!m) continue;
    m[d.status.toLowerCase()]++;
    m.periodsTotal += d.total;
    m.periodsAttended += d.attended;
    m.periodsMissed += d.missed;
    if (d.partial) m.partialDays++;
    if (windowStart && d.date >= windowStart) {
      if (d.status === 'ABSENT') m.recentAbsences++;
      if (d.partial) {
        m.recentPartial++;
        m.recentMissedPeriods += d.missed;
      }
    }
  }
  for (const sc of scores) {
    const m = result.get(sc.learnerId);
    if (!m || !sc.assessment.maxScore) continue;
    const pct = (sc.score / sc.assessment.maxScore) * 100;
    m.pcts.push(pct);
    const list = m.byCompetency.get(sc.assessment.competencyId) ?? [];
    list.push(pct);
    m.byCompetency.set(sc.assessment.competencyId, list);
  }

  for (const m of result.values()) {
    m.days = m.present + m.late + m.absent + m.excused;
    m.attendanceRate = rateOf(m.periodsAttended, m.periodsTotal);
    const a = avg(m.pcts);
    m.assessmentAvg = a === null ? null : round1(a);
    m.assessmentCount = m.pcts.length;
    m.competencyAvg = new Map([...m.byCompetency].map(([id, list]) => [id, round1(avg(list))]));
    Object.assign(m, classify(m, settings));
    m.descriptor = descriptor(m.assessmentAvg, settings);
    delete m.pcts;
    delete m.byCompetency;
  }
  return result;
}

/** Mastery stats per competency (optionally per section) from learnerMetrics output. */
function competencyStats(metrics, settings, { bySection = false } = {}) {
  const stats = new Map();
  for (const m of metrics.values()) {
    for (const [competencyId, score] of m.competencyAvg) {
      const key = bySection ? `${m.sectionId}:${competencyId}` : competencyId;
      const s = stats.get(key) ?? { competencyId, sectionId: m.sectionId, assessed: 0, MASTERED: 0, IN_PROGRESS: 0, NEEDS_SUPPORT: 0, total: 0 };
      s.assessed++;
      s.total += score;
      s[band(score, settings)]++;
      stats.set(key, s);
    }
  }
  for (const s of stats.values()) {
    s.masteryRate = s.assessed ? round1((s.MASTERED / s.assessed) * 100) : null;
    s.average = s.assessed ? round1(s.total / s.assessed) : null;
    delete s.total;
  }
  return stats;
}

const emptyDay = (date) => ({ date, present: 0, late: 0, absent: 0, excused: 0, partial: 0, periodsTotal: 0, periodsAttended: 0 });

/**
 * Daily totals for the learners matching `learnerFilter`: learner counts by day status,
 * partial days, and the period-based attendance rate.
 */
async function dailySeries(learnerFilter, from, to) {
  const rows = await prisma.attendanceRecord.groupBy({
    by: ['learnerId', 'date', 'status'],
    where: { date: { gte: from, lte: to }, learner: learnerFilter },
    _count: { _all: true },
  });
  const byDay = new Map();
  for (const d of learnerDays(rows)) {
    const day = byDay.get(d.date) ?? emptyDay(d.date);
    day[d.status.toLowerCase()]++;
    if (d.partial) day.partial++;
    day.periodsTotal += d.total;
    day.periodsAttended += d.attended;
    byDay.set(d.date, day);
  }
  return [...byDay.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => ({ ...d, total: d.present + d.late + d.absent + d.excused, rate: rateOf(d.periodsAttended, d.periodsTotal) }));
}

/** Sum a series into one set of counts. */
function totals(series) {
  const t = { present: 0, late: 0, absent: 0, excused: 0, partial: 0, periodsTotal: 0, periodsAttended: 0 };
  for (const d of series) for (const k of Object.keys(t)) t[k] += d[k] ?? 0;
  return { ...t, total: t.present + t.late + t.absent + t.excused, rate: rateOf(t.periodsAttended, t.periodsTotal) };
}

/** Group a daily series into calendar months: [{ month: 'YYYY-MM', ...totals }]. */
function monthlySeries(series) {
  const months = new Map();
  for (const d of series) {
    const key = d.date.slice(0, 7);
    const list = months.get(key) ?? [];
    list.push(d);
    months.set(key, list);
  }
  return [...months].map(([month, list]) => ({ month, days: list.length, ...totals(list) }));
}

module.exports = {
  round1,
  avg,
  rateOf,
  attendanceRate,
  dayStatus,
  learnerDays,
  classify,
  descriptor,
  band,
  learnerMetrics,
  competencyStats,
  dailySeries,
  totals,
  monthlySeries,
  STATUS_ORDER,
};
