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

/** ISO weekday of a dateOnly() value: 1 = Monday ... 7 = Sunday. */
function isoWeekdayUtc(d) {
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

/** Monday of the week containing `d` (a dateOnly value). On weekends, the week just ended. */
function weekStart(d = dateOnly()) {
  return addDays(d, 1 - isoWeekdayUtc(d));
}

/** Parse "YYYY-MM-DD" (or anything Date accepts) into a dateOnly() value. */
function parseDay(value) {
  if (!value) return dateOnly();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return dateOnly(new Date(value));
}

/** Parse "YYYY-MM" into [firstDay, lastDay] dateOnly values; defaults to the current month. */
function parseMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value || '');
  const today = dateOnly();
  const y = match ? +match[1] : today.getUTCFullYear();
  const m = match ? +match[2] - 1 : today.getUTCMonth();
  return [new Date(Date.UTC(y, m, 1)), new Date(Date.UTC(y, m + 1, 0))];
}

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

/** "2026-2027" -> June 1 of the first year, the start of the DepEd school year. */
function schoolYearStart(academicYear) {
  const year = parseInt(String(academicYear), 10) || dateOnly().getUTCFullYear();
  return new Date(Date.UTC(year, 5, 1));
}

module.exports = { dateOnly, addDays, isoWeekdayUtc, weekStart, parseDay, parseMonth, dayKey, schoolYearStart };
