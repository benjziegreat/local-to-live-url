const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { syncAlerts } = require('../lib/alerts');
const { logActivity } = require('../lib/log');
const { sectionWhere, canSeeSection, isAdmin, optInt, subjectOf } = require('../lib/scope');
const { alertRow, ALERT_INCLUDE } = require('../lib/shape');

const router = express.Router();
router.use(authenticate);

const LEVELS = ['HIGH', 'MEDIUM', 'LOW'];
const INTERVENTIONS = ['RETEACHING', 'REMEDIATION', 'ENRICHMENT', 'CATCH_UP', 'ATTENDANCE'];

/**
 * Alerts in view. With a subject: that subject's alerts plus whole-day attendance alerts
 * (no subject) of learners in the sections that take it, since those affect every subject.
 */
function scopeWhere(user, { sectionId, subjectId } = {}) {
  return {
    section: { ...sectionWhere(user, subjectId), ...(sectionId && { id: sectionId }) },
    ...(subjectId && { OR: [{ subjectId }, { subjectId: null, learnerId: { not: null } }] }),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    await syncAlerts();
    const subjectId = subjectOf(req);
    const scope = scopeWhere(req.user, { sectionId: optInt(req.query.sectionId), subjectId });
    const status = ['OPEN', 'FOLLOWED_UP', 'RESOLVED'].includes(req.query.status) ? req.query.status : null;
    const level = LEVELS.includes(req.query.level) ? req.query.level : null;
    const intervention = INTERVENTIONS.includes(req.query.intervention) ? req.query.intervention : null;
    const competencyId = optInt(req.query.competencyId);

    const where = {
      ...scope,
      ...(status ? { status } : { status: { not: 'RESOLVED' } }),
      ...(level && { level }),
      ...(intervention && { intervention }),
      ...(competencyId && { competencyId }),
    };
    const [items, counts, sections, byIntervention] = await Promise.all([
      prisma.alert.findMany({ where, include: ALERT_INCLUDE, orderBy: [{ level: 'asc' }, { updatedAt: 'desc' }], take: 500 }),
      prisma.alert.groupBy({ by: ['level', 'status'], where: scope, _count: { _all: true } }),
      prisma.section.findMany({ where: sectionWhere(req.user, subjectId), orderBy: { name: 'asc' } }),
      prisma.alert.groupBy({ by: ['intervention'], where: { ...scope, status: { not: 'RESOLVED' } }, _count: { _all: true } }),
    ]);

    const open = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    const byStatus = { OPEN: 0, FOLLOWED_UP: 0, RESOLVED: 0 };
    for (const c of counts) {
      byStatus[c.status] += c._count._all;
      if (c.status !== 'RESOLVED') open[c.level] += c._count._all;
    }
    res.json({
      sections: sections.map((s) => ({ id: s.id, name: s.name })),
      counts: open,
      byStatus,
      byIntervention: Object.fromEntries(byIntervention.filter((i) => i.intervention).map((i) => [i.intervention, i._count._all])),
      items: items.map(alertRow),
    });
  }),
);

/**
 * Open alert counts for the navigation badge: advisory-section alerts plus, for subject
 * teachers, alerts of the subjects they teach in the sections they teach them.
 */
router.get(
  '/count',
  asyncHandler(async (req, res) => {
    await syncAlerts();
    let where = scopeWhere(req.user);
    if (!isAdmin(req.user)) {
      const taught = await prisma.classSchedule.findMany({ where: { teacherId: req.user.id }, distinct: ['sectionId', 'subjectId'], select: { sectionId: true, subjectId: true } });
      where = { OR: [where, ...taught.map((t) => ({ sectionId: t.sectionId, subjectId: t.subjectId }))] };
    }
    const counts = await prisma.alert.groupBy({ by: ['level'], where: { ...where, status: 'OPEN' }, _count: { _all: true } });
    const by = Object.fromEntries(counts.map((c) => [c.level, c._count._all]));
    res.json({ open: counts.reduce((n, c) => n + c._count._all, 0), high: by.HIGH ?? 0 });
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (_req, res) => {
    await syncAlerts(true);
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/follow-up',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status;
    const note = String(req.body?.note ?? '').trim();
    if (!['OPEN', 'FOLLOWED_UP', 'RESOLVED'].includes(status)) throw new HttpError(400, 'Choose a status');
    if (status !== 'OPEN' && note.length < 3) throw new HttpError(400, 'Describe the follow-up you made');

    const alert = await prisma.alert.findUnique({ where: { id } });
    // Advisers, the subject's teachers (for subject alerts) or any teacher of the section (whole-day alerts).
    if (!alert || !(await canSeeSection(req.user, alert.sectionId, alert.subjectId ?? undefined))) throw new HttpError(404, 'Alert not found');
    const updated = await prisma.alert.update({
      where: { id },
      data: status === 'OPEN' ? { status, followUpById: null, followUpAt: null, followUpNote: null } : { status, followUpNote: note, followUpById: req.user.id, followUpAt: new Date() },
      include: ALERT_INCLUDE,
    });
    logActivity(req.user.id, status === 'RESOLVED' ? 'Resolved alert' : status === 'OPEN' ? 'Reopened alert' : 'Followed up alert', 'Instructional Alert', `${updated.title}${updated.learner ? ` · ${updated.learner.lastName}, ${updated.learner.firstName}` : ''}`);
    res.json(alertRow(updated));
  }),
);

module.exports = { router, scopeWhere };
