// School-day helpers. All "days" are the server's local calendar day, stored as
// a UTC-midnight Date so they round-trip cleanly through MySQL DATE columns.

function dateOnly(d = new Date()) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** ISO weekday of a local Date: 1 = Monday ... 7 = Sunday. */
function isoWeekday(d = new Date()) {
  return d.getDay() === 0 ? 7 : d.getDay();
}

/** ISO weekday of a dateOnly() value. */
function isoWeekdayUtc(d) {
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesNow(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

/** Parse "YYYY-MM-DD" (or anything Date accepts) into a dateOnly() value. */
function parseDay(value) {
  if (!value) return dateOnly();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return dateOnly(new Date(value));
}

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

module.exports = { dateOnly, addDays, isoWeekday, isoWeekdayUtc, toMinutes, minutesNow, parseDay, dayKey };
