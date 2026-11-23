const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/auth');
const { asyncHandler } = require('../lib/http');
const { getSettings } = require('../lib/settings');
const { syncAlerts } = require('../lib/alerts');
const { learnerWhere, sectionWhere, isAdmin, competencyWhere, optInt, subjectOf } = require('../lib/scope');
const { learnerMetrics, competencyStats, dailySeries, totals, monthlySeries, scorePercents, distribution, round1, STATUS_ORDER } = require('../lib/metrics');
const { dateOnly, dayKey, weekStart, parseDay, schoolYearStart } = require('../lib/time');
const { learnerRow, alertRow, ALERT_INCLUDE } = require('../lib/shape');
const { testWhere } = require('../lib/metrics');
const { loadPrePost, summarize, competencyRows } = require('../lib/prepost');
const { scopeWhere: alertScope } = require('./alerts');

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

/** Per-competency progress rows (same shape as areaProgress) for a single-subject view. */
function competencyProgress(stats, competencies, settings) {
  return competencies.map((c) => {
    const s = stats.get(c.id);
    const masteryRate = s?.masteryRate ?? null;
    return {
      learningArea: c.code,
      title: c.title,
      competencies: 1,
      assessed: s?.assessed ?? 0,
      mastered: s?.MASTERED ?? 0,
      inProgress: s?.IN_PROGRESS ?? 0,
      needsSupport: s?.NEEDS_SUPPORT ?? 0,
      masteryRate,
      status: masteryRate === null ? 'NO_DATA' : masteryRate >= settings.masteryTarget ? 'ON_TRACK' : masteryRate >= settings.masteryTarget - 15 ? 'MONITOR' : 'NEEDS_SUPPORT',
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
    const subjectId = subjectOf(req);
    const lw = learnerWhere(req.user, { sectionId, subjectId });
    const sectionScope = { ...sectionWhere(req.user, subjectId), ...(sectionId && { id: sectionId }) };

    const [learners, competencies, sections] = await Promise.all([
      prisma.learner.findMany({ where: lw, include: { section: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
      prisma.competency.findMany({ where: { ...competencyWhere(req.user, { subjectId, sectionId }), active: true }, orderBy: [{ learningArea: 'asc' }, { quarter: 'asc' }, { code: 'asc' }] }),
      prisma.section.findMany({ where: sectionWhere(req.user, subjectId), orderBy: { name: 'asc' } }),
    ]);
    const [metrics, series, pcts, prePost] = await Promise.all([
      learnerMetrics(learners, settings, { subjectId }),
      dailySeries(lw, schoolYearStart(settings.academicYear), dateOnly(), { subjectId }),
      scorePercents({ section: sectionScope, ...(subjectId && { competency: { subjectId } }) }),
      loadPrePost({ ...testWhere(settings, { subjectId }), section: sectionScope }, settings),
    ]);

    const recent = totals(series.slice(-20));
    const previous = totals(series.slice(-40, -20));
    const rows = learners
      .map((l) => learnerRow(l, metrics.get(l.id)))
      .sort((a, b) => STATUS_ORDER[a.monitoring] - STATUS_ORDER[b.monitoring] || a.name.localeCompare(b.name));

    const alertWhere = { status: { not: 'RESOLVED' }, ...alertScope(req.user, { sectionId, subjectId }) };
    const stats = competencyStats(metrics, settings);
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
      subjectId: subjectId ?? null,
      trend: trendFor(series, range),
      monthly: monthlySeries(series),
      // All subjects: progress per learning area. One subject: progress per competency.
      progressBy: subjectId ? 'competency' : 'area',
      competencyProgress: subjectId ? competencyProgress(stats, competencies, settings) : areaProgress(stats, competencies, settings),
      assessment: { masteryTarget: settings.masteryTarget, ...distribution(pcts, settings) },
      prePost: {
        summary: { tests: prePost.tests.length, ...summarize(prePost.records, settings) },
        byCompetency: competencyRows(prePost.records, settings).slice(0, 8),
      },
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
        sections: await prisma.section.count(),
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
