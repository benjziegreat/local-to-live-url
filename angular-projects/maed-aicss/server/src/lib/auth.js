const jwt = require('jsonwebtoken');
const prisma = require('./prisma');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '12h';

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, SECRET, { expiresIn: TOKEN_TTL });
}

/**
 * Express middleware: requires a valid Bearer token for an ACTIVE account and sets
 * req.user = { id, role }. The role is read from the database so changes apply immediately.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, role: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Account is no longer active' });
    req.user = { id: user.id, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission for this action' });
    }
    next();
  };
}

const requireAdmin = requireRole('ADMIN');

/** Public shape of a user record (never includes the password hash). */
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    name: `${user.firstName} ${user.lastName}`,
    role: user.role,
    status: user.status,
    avatarHue: user.avatarHue,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}

module.exports = { signToken, authenticate, requireRole, requireAdmin, publicUser };
