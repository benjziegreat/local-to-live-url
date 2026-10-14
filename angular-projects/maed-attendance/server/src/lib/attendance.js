const prisma = require('./prisma');
const { dateOnly, isoWeekday, toMinutes, minutesNow } = require('./time');

// A student may check in this many minutes before class starts...
const EARLY_WINDOW_MIN = 15;
// ...and counts as LATE once this many minutes past the start have elapsed.
const GRACE_MIN = 10;

function todaysSchedules(sectionId, now = new Date()) {
  return prisma.classSchedule.findMany({
    where: { sectionId, dayOfWeek: isoWeekday(now) },
    include: { subject: { include: { teacher: true } } },
    orderBy: { startTime: 'asc' },
  });
}

/** The class whose check-in window contains `now`, if any. */
function currentSchedule(schedules, now = new Date()) {
  const mins = minutesNow(now);
  return schedules.find(
    (s) => mins >= toMinutes(s.startTime) - EARLY_WINDOW_MIN && mins <= toMinutes(s.endTime),
  );
}

/**
 * Automated check-in: when a student is detected inside the room of the class
 * currently in session and has no record yet, mark them PRESENT (or LATE).
 * Returns the created record, or null when nothing was marked.
 */
async function autoCheckIn(student, now = new Date()) {
  if (student.location !== 'IN_ROOM' || !student.currentRoom) return null;

  const schedules = await todaysSchedules(student.sectionId, now);
  const current = currentSchedule(schedules, now);
  if (!current || current.room !== student.currentRoom) return null;

  const date = dateOnly(now);
  const existing = await prisma.attendanceRecord.findUnique({
    where: { studentId_scheduleId_date: { studentId: student.id, scheduleId: current.id, date } },
  });
  if (existing) return null;

  const late = minutesNow(now) > toMinutes(current.startTime) + GRACE_MIN;
  return prisma.attendanceRecord.create({
    data: {
      studentId: student.id,
      scheduleId: current.id,
      date,
      status: late ? 'LATE' : 'PRESENT',
      locationAtCheck: 'IN_ROOM',
      note: 'Automated geofence check-in',
    },
    include: { schedule: { include: { subject: true } } },
  });
}

module.exports = { todaysSchedules, currentSchedule, autoCheckIn };
