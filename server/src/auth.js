const crypto = require('node:crypto');

const USERNAME = process.env.ADMIN_USERNAME || 'admin';
// scrypt "salt:hash" of the admin password. Override with ADMIN_PASSWORD_HASH (or plain ADMIN_PASSWORD).
const PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH ||
  '64ea30b707bd7c1cadb7a9ec1375a38d:0339cad1f1fe12b3b01eb9acc6ddb7b97f9491f6c923a3af1cbbdf76f9b51586b310591bd0143234ae2d067f45c1fa70d7bacfccedcb63ab6ede347bac015e38';

// A session dies if the dashboard stops talking to the server (tab closed, machine asleep).
// The dashboard itself locks after 1 minute without user input and revokes its session.
const SESSION_IDLE_MS = 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

const sessions = new Map(); // token -> lastSeen (ms)
const failures = new Map(); // ip -> { count, lockedUntil }

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function checkPassword(password) {
  if (process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH) {
    return safeEqual(password, process.env.ADMIN_PASSWORD);
  }
  const [salt, hash] = PASSWORD_HASH.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return safeEqual(candidate, hash);
}

function login(req, res) {
  const ip = req.ip;
  const entry = failures.get(ip);
  if (entry && entry.lockedUntil > Date.now()) {
    const seconds = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${seconds}s.` });
  }

  const { username, password } = req.body || {};
  const ok =
    typeof username === 'string' &&
    typeof password === 'string' &&
    safeEqual(username, USERNAME) &&
    checkPassword(password);

  if (!ok) {
    // Start counting afresh once a previous lockout has expired.
    const count = (entry && !entry.lockedUntil ? entry.count : 0) + 1;
    const lockedUntil = count >= MAX_FAILED_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0;
    failures.set(ip, { count, lockedUntil });
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  failures.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now());
  res.json({ token, username: USERNAME });
}

function tokenFrom(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function logout(req, res) {
  const token = tokenFrom(req);
  if (token) sessions.delete(token);
  res.status(204).end();
}

function requireAuth(req, res, next) {
  const token = tokenFrom(req);
  const lastSeen = token && sessions.get(token);
  if (!lastSeen || Date.now() - lastSeen > SESSION_IDLE_MS) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Not authenticated' });
  }
  sessions.set(token, Date.now());
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [token, lastSeen] of sessions) {
    if (now - lastSeen > SESSION_IDLE_MS) sessions.delete(token);
  }
}, SESSION_IDLE_MS).unref();

module.exports = { login, logout, requireAuth };
