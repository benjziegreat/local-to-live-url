const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/auth');
const { asyncHandler } = require('../lib/http');
const { getSettings } = require('../lib/settings');
const { syncAlerts } = require('../lib/alerts');
const { learnerWhere, sectionWhere, isAdmin, competencyFilter, optInt } = require('../lib/scope');
const { learnerMetrics, competencyStats, dailySeries, totals, monthlySeries, round1, STATUS_ORDER } = require('../lib/metrics');
const { dateOnly, dayKey, weekStart, parseDay, schoolYearStart } = require('../lib/time');
const { learnerRow, alertRow, ALERT_INCLUDE } = require('../lib/shape');

const router = express.Router();
router.use(authenticate);

/** Trend points for "this week" (latest week with data) or "this month" (last ~22 school days). */
function trendFor(series, range) {
  if (!series.length) return [];
  if (range === 'month') return series.slice(-22);
  const start = dayKey(weekStart(parseDay(series[series.length - 1].date)));
  return series.filter((d) => d.date >= start);
}

/** Group competency stats by learning area. */
function areaProgress(stats, competencies, settings) {
  const byArea = new Map();
  for (const c of competencies) {
    if (!byArea.has(c.learningArea)) byArea.set(c.learningArea, { learningArea: c.learningArea, competencies: 0, assessed: 0, MASTERED: 0, IN_PROGRESS: 0, NEEDS_SUPPORT: 0 });
    byArea.get(c.learningArea).competencies++;
    const s = stats.get(c.id);
    if (!s) continue;
    const a = byArea.get(c.learningArea);
    a.assessed += s.assessed;
    a.MASTERED += s.MASTERED;
    a.IN_PROGRESS += s.IN_PROGRESS;
    a.NEEDS_SUPPORT += s.NEEDS_SUPPORT;
  }
  return [...byArea.values()].map((a) => {
    const masteryRate = a.assessed ? round1((a.MASTERED / a.assessed) * 100) : null;
    const status =
      masteryRate === null ? 'NO_DATA' : masteryRate >= settings.masteryTarget ? 'ON_TRACK' : masteryRate >= settings.masteryTarget - 15 ? 'MONITOR' : 'NEEDS_SUPPORT';
    return {
      learningArea: a.learningArea,
      competencies: a.competencies,
      assessed: a.assessed,
      mastered: a.MASTERED,
      inProgress: a.IN_PROGRESS,
      needsSupport: a.NEEDS_SUPPORT,
      masteryRate,
      status,
    };
  });
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    await syncAlerts();
    const range = req.query.range === 'month' ? 'month' : 'week';
    const sectionId = optInt(req.query.sectionId);
    const lw = learnerWhere(req.user, { sectionId });

    const [learners, allCompetencies, sections, relevant] = await Promise.all([
      prisma.learner.findMany({ where: lw, include: { section: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
      prisma.competency.findMany({ where: { active: true }, orderBy: [{ learningArea: 'asc' }, { code: 'asc' }] }),
      prisma.section.findMany({ where: sectionWhere(req.user), orderBy: { name: 'asc' } }),
      competencyFilter(req.user, sectionId),
    ]);
    const competencies = allCompetencies.filter(relevant);
    const metrics = await learnerMetrics(learners, settings);
    const series = await dailySeries(lw, schoolYearStart(settings.academicYear), dateOnly());

    const recent = totals(series.slice(-20));
    const previous = totals(series.slice(-40, -20));
    const rows = learners
      .map((l) => learnerRow(l, metrics.get(l.id)))
      .sort((a, b) => STATUS_ORDER[a.monitoring] - STATUS_ORDER[b.monitoring] || a.name.localeCompare(b.name));

    const alertWhere = { status: { not: 'RESOLVED' }, ...(isAdmin(req.user) ? {} : { section: { teacherId: req.user.id } }) };
    const [alerts, alertCounts] = await Promise.all([
      prisma.alert.findMany({ where: alertWhere, include: ALERT_INCLUDE, orderBy: [{ level: 'asc' }, { updatedAt: 'desc' }], take: 4 }),
      prisma.alert.groupBy({ by: ['level'], where: alertWhere, _count: { _all: true } }),
    ]);

    const body = {
      settings: { schoolName: settings.schoolName, schoolLevel: settings.schoolLevel, academicYear: settings.academicYear, currentQuarter: settings.currentQuarter },
      sections: sections.map((s) => ({ id: s.id, name: s.name })),
      kpis: {
        enrolled: learners.length,
        averageAttendance: recent.rate,
        attendanceDelta: recent.rate !== null && previous.rate !== null ? round1(recent.rate - previous.rate) : null,
        competenciesMonitored: competencies.length,
        needSupport: rows.filter((r) => r.monitoring !== 'ON_TRACK').length,
        atRisk: rows.filter((r) => r.monitoring === 'AT_RISK').length,
        openAlerts: alertCounts.reduce((n, c) => n + c._count._all, 0),
      },
      trend: trendFor(series, range),
      monthly: monthlySeries(series),
      competencyProgress: areaProgress(competencyStats(metrics, settings), competencies, settings),
      alerts: alerts.map(alertRow),
      learners: rows,
    };

    if (isAdmin(req.user)) {
      const [users, activity] = await Promise.all([
        prisma.user.groupBy({ by: ['role', 'status'], _count: { _all: true } }),
        prisma.activityLog.findMany({ include: { user: true }, orderBy: { createdAt: 'desc' }, take: 6 }),
      ]);
      body.system = {
        users: users.reduce((n, u) => n + u._count._all, 0),
        activeUsers: users.filter((u) => u.status === 'ACTIVE').reduce((n, u) => n + u._count._all, 0),
        teachers: users.filter((u) => u.role === 'TEACHER').reduce((n, u) => n + u._count._all, 0),
        sections: sections.length,
        reportsGenerated: await prisma.activityLog.count({ where: { action: 'Generated report' } }),
        activity: activity.map((a) => ({
          id: a.id,
          action: a.action,
          entity: a.entity,
          details: a.details,
          user: a.user ? `${a.user.firstName} ${a.user.lastName}` : 'System',
          createdAt: a.createdAt,
        })),
      };
    }
    res.json(body);
  }),
);

module.exports = { router, areaProgress, trendFor };
