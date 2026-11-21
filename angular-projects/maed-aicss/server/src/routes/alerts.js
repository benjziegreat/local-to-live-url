const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { syncAlerts } = require('../lib/alerts');
const { logActivity } = require('../lib/log');
const { isAdmin, sectionWhere, optInt } = require('../lib/scope');
const { alertRow, ALERT_INCLUDE } = require('../lib/shape');

const router = express.Router();
router.use(authenticate);

const LEVELS = ['HIGH', 'MEDIUM', 'LOW'];

function scopeWhere(user, sectionId) {
  return { section: { ...sectionWhere(user), ...(sectionId && { id: sectionId }) } };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    await syncAlerts();
    const sectionId = optInt(req.query.sectionId);
    const scope = scopeWhere(req.user, sectionId);
    const status = ['OPEN', 'FOLLOWED_UP', 'RESOLVED'].includes(req.query.status) ? req.query.status : null;
    const level = LEVELS.includes(req.query.level) ? req.query.level : null;

    const where = {
      ...scope,
      ...(status ? { status } : { status: { not: 'RESOLVED' } }),
      ...(level && { level }),
    };
    const [items, counts, sections] = await Promise.all([
      prisma.alert.findMany({ where, include: ALERT_INCLUDE, orderBy: [{ level: 'asc' }, { updatedAt: 'desc' }], take: 500 }),
      prisma.alert.groupBy({ by: ['level', 'status'], where: scope, _count: { _all: true } }),
      prisma.section.findMany({ where: sectionWhere(req.user), orderBy: { name: 'asc' } }),
    ]);

    const open = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    const byStatus = { OPEN: 0, FOLLOWED_UP: 0, RESOLVED: 0 };
    for (const c of counts) {
      byStatus[c.status] += c._count._all;
      if (c.status !== 'RESOLVED') open[c.level] += c._count._all;
    }
    res.json({ sections: sections.map((s) => ({ id: s.id, name: s.name })), counts: open, byStatus, items: items.map(alertRow) });
  }),
);

/** Open alert counts for the navigation badge. */
router.get(
  '/count',
  asyncHandler(async (req, res) => {
    await syncAlerts();
    const counts = await prisma.alert.groupBy({ by: ['level'], where: { ...scopeWhere(req.user), status: 'OPEN' }, _count: { _all: true } });
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

    const alert = await prisma.alert.findFirst({ where: { id, ...(isAdmin(req.user) ? {} : scopeWhere(req.user)) } });
    if (!alert) throw new HttpError(404, 'Alert not found');
    const updated = await prisma.alert.update({
      where: { id },
      data: status === 'OPEN' ? { status, followUpById: null, followUpAt: null, followUpNote: null } : { status, followUpNote: note, followUpById: req.user.id, followUpAt: new Date() },
      include: ALERT_INCLUDE,
    });
    logActivity(req.user.id, status === 'RESOLVED' ? 'Resolved alert' : status === 'OPEN' ? 'Reopened alert' : 'Followed up alert', 'Instructional Alert', `${updated.title}${updated.learner ? ` · ${updated.learner.lastName}, ${updated.learner.firstName}` : ''}`);
    res.json(alertRow(updated));
  }),
);

module.exports = router;
