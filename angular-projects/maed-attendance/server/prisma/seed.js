// Demo data for the MAEd geo-fenced attendance ecosystem.
// Every account uses the password: password123
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { dateOnly, addDays, isoWeekdayUtc, toMinutes, minutesNow } = require('../src/lib/time');

const prisma = new PrismaClient();
const PASSWORD = 'password123';
const HISTORY_DAYS = 60;

// Deterministic PRNG so every seed produces the same demo story.
let rngState = 20261014;
function rand() {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}
function pick(arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
}

const SCHOOL = { name: 'MAEd Integrated School — Main Campus', centerLat: 14.6091, centerLng: 121.0223, radiusMeters: 250 };

const STUDENTS = [
  // absentDays / excusedDays are whole school days; cutting / late are individual class periods.
  { email: 'student@maed.edu', first: 'Alex', last: 'Rivera', hue: 210, absentDays: 1, excusedDays: 2, cutting: 0, late: 6 },
  { email: 'maria.santos@maed.edu', first: 'Maria', last: 'Santos', hue: 18, absentDays: 6, excusedDays: 0, cutting: 70, late: 12 },
  { email: 'mark.reyes@maed.edu', first: 'Mark', last: 'Reyes', hue: 140, absentDays: 6, excusedDays: 1, cutting: 18, late: 9 },
  { email: 'juan.cruz@maed.edu', first: 'Juan', last: 'Cruz', hue: 260, absentDays: 3, excusedDays: 0, cutting: 10, late: 8 },
  { email: 'ana.lopez@maed.edu', first: 'Ana', last: 'Lopez', hue: 320, absentDays: 2, excusedDays: 1, cutting: 4, late: 5 },
  { email: 'paolo.garcia@maed.edu', first: 'Paolo', last: 'Garcia', hue: 40, absentDays: 2, excusedDays: 0, cutting: 2, late: 14 },
  { email: 'bea.mendoza@maed.edu', first: 'Bea', last: 'Mendoza', hue: 170, absentDays: 0, excusedDays: 1, cutting: 0, late: 3 },
  { email: 'carlo.bautista@maed.edu', first: 'Carlo', last: 'Bautista', hue: 95, absentDays: 1, excusedDays: 0, cutting: 1, late: 4 },
  { email: 'diana.torres@maed.edu', first: 'Diana', last: 'Torres', hue: 285, absentDays: 0, excusedDays: 0, cutting: 0, late: 2 },
  { email: 'enzo.villanueva@maed.edu', first: 'Enzo', last: 'Villanueva', hue: 195, absentDays: 1, excusedDays: 1, cutting: 0, late: 5 },
  { email: 'faith.ramos@maed.edu', first: 'Faith', last: 'Ramos', hue: 350, absentDays: 0, excusedDays: 0, cutting: 0, late: 1 },
  { email: 'gabriel.aquino@maed.edu', first: 'Gabriel', last: 'Aquino', hue: 230, absentDays: 1, excusedDays: 0, cutting: 2, late: 3 },
];

// Daily timetable, Monday–Saturday (dayOfWeek 1..6).
const TIMETABLE = [
  { code: 'MATH10', start: '07:30', end: '08:30', room: 'Room 201' },
  { code: 'SCI10', start: '08:30', end: '09:30', room: 'Room 204' },
  { code: 'ENG10', start: '09:45', end: '10:45', room: 'Room 105' },
  { code: 'FIL10', start: '10:45', end: '11:45', room: 'Room 105' },
  { code: 'AP10', start: '13:00', end: '14:00', room: 'Room 202' },
  { code: 'SCI10', start: '14:30', end: '15:30', room: 'Science Lab' },
];

async function main() {
  console.log('Clearing existing data…');
  await prisma.$transaction([
    prisma.message.deleteMany(),
    prisma.intervention.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.excuseNote.deleteMany(),
    prisma.attendanceRecord.deleteMany(),
    prisma.gateLog.deleteMany(),
    prisma.classSchedule.deleteMany(),
    prisma.subject.deleteMany(),
    prisma.parentLink.deleteMany(),
    prisma.student.deleteMany(),
    prisma.section.deleteMany(),
    prisma.geofence.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mkUser = (email, firstName, lastName, role, avatarHue = 210) =>
    prisma.user.create({ data: { email, firstName, lastName, role, avatarHue, passwordHash } });

  await prisma.geofence.create({ data: SCHOOL });

  const adviser = await mkUser('adviser@maed.edu', 'Amy', 'Max', 'ADVISER', 200);
  const science = await mkUser('teacher@maed.edu', 'Ramon', 'Dela Paz', 'TEACHER', 150);
  const lang = await mkUser('grace.lim@maed.edu', 'Grace', 'Lim', 'TEACHER', 300);
  const parent = await mkUser('parent@maed.edu', 'Elena', 'Santos', 'PARENT', 25);
  const parent2 = await mkUser('parent.rivera@maed.edu', 'Jose', 'Rivera', 'PARENT', 205);

  const section = await prisma.section.create({ data: { name: 'Grade 10 - Rizal', gradeLevel: 10, adviserId: adviser.id } });

  const subjects = {};
  for (const [code, name, teacherId] of [
    ['MATH10', 'Math 10', science.id],
    ['SCI10', 'Science 10', science.id],
    ['ENG10', 'English 10', lang.id],
    ['FIL10', 'Filipino 10', lang.id],
    ['AP10', 'Araling Panlipunan 10', lang.id],
  ]) {
    subjects[code] = await prisma.subject.create({ data: { code, name, teacherId } });
  }

  const schedulesByDay = {};
  for (let day = 1; day <= 6; day++) {
    schedulesByDay[day] = [];
    for (const slot of TIMETABLE) {
      schedulesByDay[day].push(
        await prisma.classSchedule.create({
          data: {
            subjectId: subjects[slot.code].id,
            sectionId: section.id,
            dayOfWeek: day,
            startTime: slot.start,
            endTime: slot.end,
            room: slot.room,
          },
        }),
      );
    }
  }

  const students = [];
  for (const [i, s] of STUDENTS.entries()) {
    const user = await mkUser(s.email, s.first, s.last, 'STUDENT', s.hue);
    const student = await prisma.student.create({
      data: { userId: user.id, studentNo: `2026-10${String(i + 1).padStart(3, '0')}`, sectionId: section.id },
    });
    students.push({ ...s, user, student });
  }
  const byFirst = Object.fromEntries(students.map((s) => [s.first, s]));

  await prisma.parentLink.createMany({
    data: [
      { parentId: parent.id, studentId: byFirst.Maria.student.id, relationship: 'Mother' },
      { parentId: parent2.id, studentId: byFirst.Alex.student.id, relationship: 'Father' },
    ],
  });

  // ---- Attendance history --------------------------------------------------
  console.log('Generating attendance history…');
  const now = new Date();
  const today = dateOnly(now);
  const pastDays = [];
  for (let d = addDays(today, -HISTORY_DAYS); d < today; d = addDays(d, 1)) {
    if (isoWeekdayUtc(d) !== 7) pastDays.push(d);
  }

  const records = [];
  const gateLogs = [];
  const excuseNotes = [];
  for (const s of students) {
    const absent = new Set(pick(pastDays, s.absentDays + s.excusedDays).map((d) => d.getTime()));
    const excused = new Set([...absent].slice(0, s.excusedDays));
    const periods = pastDays.flatMap((d) => (absent.has(d.getTime()) ? [] : schedulesByDay[isoWeekdayUtc(d)].map((sc) => ({ d, sc }))));
    const cutting = new Set(pick(periods, s.cutting));
    const late = new Set(pick(periods.filter((p) => !cutting.has(p)), s.late));

    for (const d of pastDays) {
      const isAbsent = absent.has(d.getTime());
      const isExcused = excused.has(d.getTime());
      if (isExcused) {
        excuseNotes.push({
          studentId: s.student.id,
          submittedById: s.user.id,
          date: d,
          reason: 'Medical consultation — clinic slip attached.',
          attachmentName: 'clinic-slip.jpg',
          status: 'APPROVED',
          reviewedById: adviser.id,
          createdAt: addDays(d, 1),
        });
      }
      if (!isAbsent) {
        const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        const entryMin = 7 * 60 + 5 + Math.floor(rand() * 20);
        const exitMin = 15 * 60 + 35 + Math.floor(rand() * 25);
        gateLogs.push(
          { studentId: s.student.id, event: 'ENTRY', timestamp: new Date(local.getTime() + entryMin * 60000), gate: 'Main Gate' },
          { studentId: s.student.id, event: 'EXIT', timestamp: new Date(local.getTime() + exitMin * 60000), gate: 'Main Gate' },
        );
      }
    }

    for (const d of pastDays) {
      for (const sc of schedulesByDay[isoWeekdayUtc(d)]) {
        let status = 'PRESENT';
        if (absent.has(d.getTime())) status = excused.has(d.getTime()) ? 'EXCUSED' : 'ABSENT';
        else if ([...cutting].some((p) => p.d === d && p.sc === sc)) status = 'CUTTING';
        else if ([...late].some((p) => p.d === d && p.sc === sc)) status = 'LATE';
        records.push({
          studentId: s.student.id,
          scheduleId: sc.id,
          date: d,
          status,
          markedById: sc.subjectId === subjects.SCI10.id || sc.subjectId === subjects.MATH10.id ? science.id : lang.id,
          locationAtCheck: status === 'ABSENT' || status === 'EXCUSED' ? 'OFF_CAMPUS' : status === 'CUTTING' ? 'ON_CAMPUS' : 'IN_ROOM',
        });
      }
    }
  }

  // Today: mark the classes that have already ended for students who are on campus.
  const todayDay = isoWeekdayUtc(today);
  const onCampusToday = ['Maria', 'Juan', 'Ana', 'Paolo', 'Bea', 'Carlo', 'Diana', 'Enzo', 'Faith', 'Gabriel'];
  if (todayDay !== 7) {
    const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (const first of onCampusToday) {
      const s = byFirst[first];
      gateLogs.push({
        studentId: s.student.id,
        event: 'ENTRY',
        timestamp: new Date(localMidnight.getTime() + (7 * 60 + 10 + Math.floor(rand() * 10)) * 60000),
        gate: 'Main Gate',
      });
      for (const sc of schedulesByDay[todayDay]) {
        if (toMinutes(sc.endTime) > minutesNow(now)) continue;
        records.push({
          studentId: s.student.id,
          scheduleId: sc.id,
          date: today,
          status: first === 'Maria' && sc.startTime === '13:00' ? 'CUTTING' : 'PRESENT',
          markedById: science.id,
          locationAtCheck: 'IN_ROOM',
        });
      }
    }
    // Mark Reyes is absent today with no excuse yet.
    for (const sc of schedulesByDay[todayDay]) {
      if (toMinutes(sc.endTime) > minutesNow(now)) continue;
      records.push({ studentId: byFirst.Mark.student.id, scheduleId: sc.id, date: today, status: 'ABSENT', markedById: science.id, locationAtCheck: 'OFF_CAMPUS' });
    }
  }

  await prisma.attendanceRecord.createMany({ data: records });
  await prisma.gateLog.createMany({ data: gateLogs });
  await prisma.excuseNote.createMany({ data: excuseNotes });

  // ---- Live location state ------------------------------------------------
  const inRoom = (first, room) =>
    prisma.student.update({
      where: { id: byFirst[first].student.id },
      data: { location: 'IN_ROOM', currentRoom: room, lastLat: SCHOOL.centerLat + 0.0003, lastLng: SCHOOL.centerLng - 0.0002, lastSeenAt: now },
    });
  // Seat everyone in the class running right now (if any) so the teacher roster starts realistic.
  const runningNow = (schedulesByDay[todayDay] || []).find(
    (sc) => minutesNow(now) >= toMinutes(sc.startTime) - 15 && minutesNow(now) <= toMinutes(sc.endTime),
  );
  const seatRoom = runningNow?.room ?? 'Room 204';
  for (const first of ['Juan', 'Ana', 'Paolo', 'Bea', 'Carlo', 'Diana', 'Enzo', 'Faith', 'Gabriel']) await inRoom(first, seatRoom);
  await prisma.student.update({
    where: { id: byFirst.Maria.student.id },
    data: { location: 'ON_CAMPUS', currentRoom: null, lastLat: SCHOOL.centerLat - 0.0006, lastLng: SCHOOL.centerLng + 0.0004, lastSeenAt: now },
  });
  // Alex and Mark stay OFF_CAMPUS so the student demo can perform a live check-in.

  // ---- Alerts, interventions, messages, pending excuse --------------------
  const maria = byFirst.Maria.student.id;
  const mark = byFirst.Mark.student.id;
  const juan = byFirst.Juan.student.id;

  await prisma.alert.createMany({
    data: [
      { studentId: maria, raisedById: science.id, subjectId: subjects.MATH10.id, type: 'UNEXCUSED_ABSENCE', message: 'Unexcused absence detected in Math 10.', createdAt: addDays(now, -2) },
      { studentId: maria, raisedById: lang.id, subjectId: subjects.AP10.id, type: 'CUTTING', message: 'On campus but not in Room 202 during Araling Panlipunan 10.', createdAt: addDays(now, -1) },
      { studentId: mark, raisedById: science.id, subjectId: subjects.SCI10.id, type: 'EARLY_WARNING', message: 'Mark has missed 3 Science sessions this month. Please follow up with the family.', createdAt: addDays(now, -3) },
    ],
  });

  await prisma.intervention.createMany({
    data: [
      { studentId: maria, adviserId: adviser.id, date: addDays(now, -20), actionTaken: 'Parent conference', notes: 'Discussed repeated cutting in afternoon classes.', outcome: 'YELLOW' },
      { studentId: maria, adviserId: adviser.id, date: addDays(now, -6), actionTaken: 'Referred to guidance counselor', notes: 'Cutting continued after conference.', outcome: 'RED' },
      { studentId: mark, adviserId: adviser.id, date: addDays(now, -10), actionTaken: 'Home visit', notes: 'Family reports transport issues.', outcome: 'YELLOW' },
      { studentId: juan, adviserId: adviser.id, date: addDays(now, -15), actionTaken: 'One-on-one counseling', notes: 'Agreed on punctuality plan.', outcome: 'GREEN' },
    ],
  });

  await prisma.message.createMany({
    data: [
      { senderId: adviser.id, recipientId: parent.id, studentId: maria, body: 'Good day, Mrs. Santos. Maria was flagged for leaving Room 202 during Araling Panlipunan yesterday. Could we schedule a short call this week?', createdAt: addDays(now, -1) },
      { senderId: parent.id, recipientId: adviser.id, studentId: maria, body: 'Good day, Ma\'am Amy. Thank you for letting me know. I am free Thursday afternoon.', createdAt: addDays(now, -1), readAt: now },
      { senderId: adviser.id, recipientId: parent.id, studentId: maria, body: 'Thursday 3:30 PM works. I will also ask the guidance office to join. See you!', createdAt: new Date(now.getTime() - 3 * 3600000) },
    ],
  });

  await prisma.excuseNote.create({
    data: {
      studentId: juan,
      submittedById: byFirst.Juan.user.id,
      date: pastDays[pastDays.length - 1],
      reason: 'Fever in the morning; went to the barangay health center.',
      attachmentName: 'health-center-note.pdf',
    },
  });

  console.log(`Seeded ${students.length} students, ${records.length} attendance records, ${gateLogs.length} gate logs.`);
  console.log(`\nDemo accounts (password: ${PASSWORD})`);
  console.log('  Student : student@maed.edu');
  console.log('  Teacher : teacher@maed.edu');
  console.log('  Adviser : adviser@maed.edu');
  console.log('  Parent  : parent@maed.edu');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
