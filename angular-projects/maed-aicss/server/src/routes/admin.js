// Administrator-only: user management and system activity logs.
const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin, publicUser } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { logActivity } = require('../lib/log');

const router = express.Router();
router.use(authenticate, requireAdmin);

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ include: { sections: true }, orderBy: [{ role: 'asc' }, { lastName: 'asc' }] });
    res.json(users.map((u) => ({ ...publicUser(u), sections: u.sections.map((s) => s.name) })));
  }),
);

function cleanUser(body, { requirePassword }) {
  const email = String(body?.email ?? '').trim().toLowerCase();
  const firstName = String(body?.firstName ?? '').trim();
  const lastName = String(body?.lastName ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
  if (!firstName || !lastName) throw new HttpError(400, 'First and last name are required');
  if (!['TEACHER', 'ADMIN'].includes(body?.role)) throw new HttpError(400, 'Choose a role');
  if (!['ACTIVE', 'INACTIVE'].includes(body?.status ?? 'ACTIVE')) throw new HttpError(400, 'Invalid status');
  const password = body?.password ? String(body.password) : '';
  if ((requirePassword || password) && password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  return { email, firstName: firstName.slice(0, 100), lastName: lastName.slice(0, 100), role: body.role, status: body?.status ?? 'ACTIVE', password };
}

const emailClash = (err) => {
  if (err.code === 'P2002') throw new HttpError(409, 'That email is already in use');
  throw err;
};

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const { password, ...data } = cleanUser(req.body, { requirePassword: true });
    const user = await prisma.user
      .create({ data: { ...data, passwordHash: await bcrypt.hash(password, 10), avatarHue: Math.floor(Math.random() * 360) } })
      .catch(emailClash);
    logActivity(req.user.id, 'Created user', 'User Management', `${user.email} · ${user.role}`);
    res.status(201).json(publicUser(user));
  }),
);

router.put(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { password, ...data } = cleanUser(req.body, { requirePassword: false });
    if (id === req.user.id && (data.status !== 'ACTIVE' || data.role !== 'ADMIN')) {
      throw new HttpError(400, 'You cannot deactivate or demote your own account');
    }
    if (data.role !== 'ADMIN' || data.status !== 'ACTIVE') {
      const otherAdmins = await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', id: { not: id } } });
      if (!otherAdmins) throw new HttpError(400, 'At least one active administrator is required');
    }
    const user = await prisma.user
      .update({ where: { id }, data: { ...data, ...(password && { passwordHash: await bcrypt.hash(password, 10) }) } })
      .catch(emailClash);
    if (user.role !== 'TEACHER') {
      await prisma.section.updateMany({ where: { teacherId: id }, data: { teacherId: null } });
      await prisma.classSchedule.updateMany({ where: { teacherId: id }, data: { teacherId: null } });
    }
    logActivity(req.user.id, data.status === 'INACTIVE' ? 'Deactivated user' : 'Updated user', 'User Management', `${user.email} · ${user.role}${password ? ' · password reset' : ''}`);
    res.json(publicUser(user));
  }),
);

router.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 25));
    const q = String(req.query.q ?? '').trim();
    const where = q
      ? { OR: [{ action: { contains: q } }, { entity: { contains: q } }, { details: { contains: q } }, { user: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }] } }] }
      : {};
    const [total, items] = await Promise.all([
      prisma.activityLog.count({ where }),
      prisma.activityLog.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({
      total,
      page,
      pageSize,
      items: items.map((a) => ({
        id: a.id,
        action: a.action,
        entity: a.entity,
        details: a.details,
        user: a.user ? `${a.user.firstName} ${a.user.lastName}` : 'System',
        role: a.user?.role ?? null,
        createdAt: a.createdAt,
      })),
    });
  }),
);

module.exports = router;
