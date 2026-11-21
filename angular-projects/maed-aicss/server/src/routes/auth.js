const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { signToken, authenticate, publicUser } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { logActivity } = require('../lib/log');

const router = express.Router();

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw new HttpError(400, 'Email and password are required');

    const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } });
    if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) {
      throw new HttpError(401, 'Incorrect email or password');
    }
    if (user.status !== 'ACTIVE') throw new HttpError(403, 'This account is deactivated. Contact your system administrator.');

    const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    logActivity(user.id, 'Signed in', 'Session');
    res.json({ token: signToken(user), user: publicUser(updated) });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || user.status !== 'ACTIVE') throw new HttpError(401, 'Account is no longer active');
    res.json(publicUser(user));
  }),
);

module.exports = router;
