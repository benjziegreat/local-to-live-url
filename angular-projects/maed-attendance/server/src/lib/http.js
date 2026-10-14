/** Wrap an async route handler so rejected promises reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fullName(user) {
  return `${user.firstName} ${user.lastName}`;
}

/** "Cruz, Juan" — the roster style used on teacher/adviser screens. */
function rosterName(user) {
  return `${user.lastName}, ${user.firstName}`;
}

module.exports = { asyncHandler, HttpError, fullName, rosterName };
