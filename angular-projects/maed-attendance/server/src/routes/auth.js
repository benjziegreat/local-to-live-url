const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { signToken, authenticate, publicUser } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');

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
    res.json({ token: signToken(user), user: publicUser(user) });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new HttpError(401, 'Account no longer exists');
    res.json(publicUser(user));
  }),
);

module.exports = router;
