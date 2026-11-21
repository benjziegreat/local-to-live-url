const prisma = require('./prisma');

/** Record an entry in the system activity log. Never fails the request. */
function logActivity(userId, action, entity, details) {
  return prisma.activityLog
    .create({ data: { userId: userId ?? null, action, entity, details: details ?? null } })
    .catch((err) => console.error('Activity log failed:', err.message));
}

module.exports = { logActivity };
