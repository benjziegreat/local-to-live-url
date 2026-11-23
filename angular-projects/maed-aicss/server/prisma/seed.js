// Demo data for AICSS. Deterministic (seeded PRNG) so every reset looks the same.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ---- Deterministic random helpers ------------------------------------------
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20262027);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => min + rand() * (max - min);
function gauss(mean, sd) {
  const u = 1 - rand();
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const day = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);

// ---- Reference data -----------------------------------------------------------
const MALE = ['Juan Miguel', 'Mark Anthony', 'John Paul', 'Christian', 'Joshua', 'Angelo', 'Carlo', 'Daniel', 'Gabriel', 'Jericho', 'Kenneth', 'Lance', 'Miguel', 'Nathaniel', 'Paolo', 'Rafael', 'Renz', 'Sean', 'Tristan', 'Vince', 'Adrian', 'Bryan', 'Cedric', 'Dominic', 'Elijah', 'Francis', 'Harvey', 'Ivan', 'Jasper', 'Kyle'];
const FEMALE = ['Maria Isabel', 'Patricia', 'Angela', 'Bea', 'Camille', 'Danica', 'Erica', 'Francine', 'Gabrielle', 'Hannah', 'Isabella', 'Janelle', 'Kathleen', 'Leah', 'Mikaela', 'Nicole', 'Princess', 'Queenie', 'Rhea', 'Sofia', 'Trisha', 'Vanessa', 'Wendy', 'Ysabel', 'Alyssa', 'Bianca', 'Carla', 'Denise', 'Ella', 'Faith'];
const SURNAMES = ['Cruz', 'Dela Cruz', 'Santos', 'Reyes', 'Bautista', 'Garcia', 'Mendoza', 'Torres', 'Flores', 'Ramos', 'Aquino', 'Castillo', 'Villanueva', 'Navarro', 'Gonzales', 'Lopez', 'Rivera', 'Domingo', 'Mercado', 'Pascual', 'Soriano', 'Valdez', 'Salazar', 'Fernandez', 'Manalo', 'Aguilar', 'Del Rosario', 'Tolentino', 'Ocampo', 'Dizon', 'Gutierrez', 'Morales', 'Pineda', 'Robles', 'Sison', 'Lim', 'Tan', 'Yap', 'Javier', 'Ignacio'];

// Subject catalog. defaultRoom = null means the class meets in the section's own room.
const SUBJECTS = [
  // Core subjects (every section)
  { code: 'GENMATH', name: 'General Mathematics', kind: 'CORE', defaultRoom: null },
  { code: 'GENSCI', name: 'General Science', kind: 'CORE', defaultRoom: 'Science Laboratory' },
  { code: 'EFFCOM', name: 'Effective Communication / Mabisang Komunikasyon', kind: 'CORE', defaultRoom: null },
  { code: 'LCS', name: 'Life and Career Skills', kind: 'CORE', defaultRoom: null },
  { code: 'PNK', name: 'Pag-aaral ng Kasaysayan', kind: 'CORE', defaultRoom: null },
  // Daily program block
  { code: 'ARAL', name: 'ARAL Program', kind: 'PROGRAM', defaultRoom: null },
  // Specialization electives
  { code: 'SMAW', name: 'Shielded Metal Arc Welding (SMAW)', kind: 'ELECTIVE', track: 'TechPro', defaultRoom: 'Welding Shop' },
  { code: 'PROG', name: 'Programming', kind: 'ELECTIVE', track: 'TechPro', defaultRoom: 'ICT Laboratory' },
  { code: 'VGD', name: 'Visual Graphic Design (VGD)', kind: 'ELECTIVE', track: 'TechPro', defaultRoom: 'Multimedia Laboratory' },
  { code: 'AGRI', name: 'Agricultural Crop Production', kind: 'ELECTIVE', track: 'TechPro', defaultRoom: 'Agri Field / Nursery' },
  { code: 'BAKE', name: 'Bakery Operation', kind: 'ELECTIVE', track: 'TechPro', defaultRoom: 'Bakery Laboratory' },
  { code: 'KITCH', name: 'Kitchen Operation', kind: 'ELECTIVE', track: 'TechPro', defaultRoom: 'Kitchen Laboratory' },
  { code: 'FBS', name: 'Food and Beverage Services', kind: 'ELECTIVE', track: 'TechPro', defaultRoom: 'F&B Laboratory' },
  { code: 'EIM', name: 'Electrical Installation and Maintenance (EIM)', kind: 'ELECTIVE', track: 'TechPro', defaultRoom: 'Electrical Shop' },
  { code: 'PHYS', name: 'Physics', kind: 'ELECTIVE', track: 'Academic', defaultRoom: 'Physics Laboratory' },
  { code: 'FINMATH', name: 'Finite Mathematics', kind: 'ELECTIVE', track: 'Academic', defaultRoom: null },
  { code: 'CHEM', name: 'Chemistry', kind: 'ELECTIVE', track: 'Academic', defaultRoom: 'Chemistry Laboratory' },
  { code: 'CREACOMP', name: 'Creative Composition', kind: 'ELECTIVE', track: 'Academic', defaultRoom: null },
  { code: 'ACCT', name: 'Accounting', kind: 'ELECTIVE', track: 'Academic', defaultRoom: null },
];
const CORE = SUBJECTS.filter((s) => s.kind === 'CORE').map((s) => s.code);

// [code, subject code, quarter, learning competency]
const COMPETENCIES = [
  ['GM-Q1-01', 'GENMATH', 1, 'Represents real-life situations using functions, including piecewise functions.'],
  ['GM-Q1-02', 'GENMATH', 1, 'Solves problems involving rational, exponential and logarithmic functions.'],
  ['GM-Q2-01', 'GENMATH', 2, 'Solves problems involving simple and compound interest, annuities and loans.'],
  ['GS-Q1-01', 'GENSCI', 1, 'Explains the properties and changes of matter using the particle model.'],
  ['GS-Q1-02', 'GENSCI', 1, 'Describes energy transformations in everyday systems.'],
  ['GS-Q2-01', 'GENSCI', 2, 'Investigates the interactions between living things and their environment.'],
  ['EC-Q1-01', 'EFFCOM', 1, 'Uses appropriate language and register in different communication situations (Gumagamit ng angkop na wika sa iba’t ibang sitwasyong pangkomunikasyon).'],
  ['EC-Q1-02', 'EFFCOM', 1, 'Delivers clear and well-organized oral presentations.'],
  ['EC-Q2-01', 'EFFCOM', 2, 'Writes coherent texts for academic and workplace purposes.'],
  ['LCS-Q1-01', 'LCS', 1, 'Identifies personal strengths, interests and values in relation to career goals.'],
  ['LCS-Q1-02', 'LCS', 1, 'Demonstrates financial literacy and responsible decision-making.'],
  ['LCS-Q2-01', 'LCS', 2, 'Prepares a personal career and life plan.'],
  ['PK-Q1-01', 'PNK', 1, 'Nasusuri ang mga primaryang sanggunian sa pag-aaral ng kasaysayan.'],
  ['PK-Q1-02', 'PNK', 1, 'Naipaliliwanag ang mahahalagang pangyayari sa kasaysayan ng Pilipinas.'],
  ['PK-Q2-01', 'PNK', 2, 'Naiuugnay ang kasaysayan ng lokal na pamayanan sa kasaysayang pambansa.'],
  ['PHYS-Q1-01', 'PHYS', 1, 'Applies kinematics to describe motion in one and two dimensions.'],
  ['PHYS-Q2-01', 'PHYS', 2, 'Applies Newton’s laws of motion to solve problems.'],
  ['CC-Q1-01', 'CREACOMP', 1, 'Uses imagery, figures of speech and other literary devices in writing poetry.'],
  ['CC-Q2-01', 'CREACOMP', 2, 'Writes a short story applying the elements of fiction.'],
  ['PROG-Q1-01', 'PROG', 1, 'Writes programs using variables, data types and control structures.'],
  ['PROG-Q2-01', 'PROG', 2, 'Develops a simple application using functions and arrays.'],
  ['CHEM-Q1-01', 'CHEM', 1, 'Explains atomic structure and the periodic properties of elements.'],
  ['CHEM-Q2-01', 'CHEM', 2, 'Balances chemical equations and performs stoichiometric calculations.'],
  ['ACCT-Q1-01', 'ACCT', 1, 'Records business transactions using the accounting equation.'],
  ['ACCT-Q2-01', 'ACCT', 2, 'Prepares basic financial statements.'],
  ['BAKE-Q1-01', 'BAKE', 1, 'Prepares and bakes bread and pastry products following standard recipes.'],
  ['BAKE-Q2-01', 'BAKE', 2, 'Applies food safety and sanitation practices in the bakeshop.'],
];
// How hard each subject is (added to a learner's ability).
const DIFFICULTY = { GENMATH: -5, GENSCI: -3, EFFCOM: 2, LCS: 5, PNK: 0, PHYS: -6, CREACOMP: 3, PROG: -2, CHEM: -5, ACCT: -2, BAKE: 4 };

// Each section has its own adviser (who also handles its ARAL Program period) and one elective.
const SECTIONS = [
  { name: 'Grade 11 – STEM A', gradeLevel: 11, strand: 'STEM', adviser: 'teacher@aicss.edu', room: 'Room 201', elective: 'PHYS', size: 32, boost: 2 },
  { name: 'Grade 11 – HUMSS A', gradeLevel: 11, strand: 'HUMSS', adviser: 'juan.delacruz@aicss.edu', room: 'Room 202', elective: 'CREACOMP', size: 30, boost: 0 },
  { name: 'Grade 11 – TVL ICT A', gradeLevel: 11, strand: 'TVL-ICT', adviser: 'paolo.garcia@aicss.edu', room: 'Room 203', elective: 'PROG', size: 28, boost: 0 },
  { name: 'Grade 12 – STEM A', gradeLevel: 12, strand: 'STEM', adviser: 'liza.tan@aicss.edu', room: 'Room 301', elective: 'CHEM', size: 30, boost: 1 },
  { name: 'Grade 12 – ABM A', gradeLevel: 12, strand: 'ABM', adviser: 'rosa.mendoza@aicss.edu', room: 'Room 302', elective: 'ACCT', size: 28, boost: -1 },
  { name: 'Grade 12 – TVL HE A', gradeLevel: 12, strand: 'TVL-HE', adviser: 'teresa.aquino@aicss.edu', room: 'Room 303', elective: 'BAKE', size: 26, boost: -1 },
];

// Bell schedule. Recess 9:30-9:45 and lunch 11:45-12:30 stay free; ARAL runs 12:30-1:30 for everyone.
const TEACHING_SLOTS = [
  ['07:30', '08:30'],
  ['08:30', '09:30'],
  ['09:45', '10:45'],
  ['10:45', '11:45'],
  ['13:30', '14:30'],
  ['14:30', '15:30'],
];
const ARAL_SLOT = ['12:30', '13:30'];

// One teacher per core subject (across all sections) and one per elective.
const SUBJECT_TEACHER = {
  GENMATH: 'juan.delacruz@aicss.edu',
  GENSCI: 'liza.tan@aicss.edu',
  EFFCOM: 'teacher@aicss.edu',
  LCS: 'rosa.mendoza@aicss.edu',
  PNK: 'paolo.garcia@aicss.edu',
  PHYS: 'ramon.villanueva@aicss.edu',
  CREACOMP: 'carmela.bautista@aicss.edu',
  PROG: 'jerome.castillo@aicss.edu',
  CHEM: 'elena.navarro@aicss.edu',
  ACCT: 'victor.ramos@aicss.edu',
  BAKE: 'teresa.aquino@aicss.edu',
};

// A section that struggles with one competency (triggers a "needs reteaching" alert).
const STRUGGLES = { 'Grade 11 – HUMSS A': { 'GM-Q2-01': -14 }, 'Grade 12 – ABM A': { 'GS-Q2-01': -13 } };

const SY_START = '2026-06-15';
const HOLIDAYS = new Set(['2026-08-21', '2026-08-31', '2026-11-02']);
const QUARTER_END = { 1: '2026-08-28' };
const QUARTER_START = { 1: SY_START, 2: '2026-08-31' };
const quarterOf = (d) => (iso(d) >= QUARTER_START[2] ? 2 : 1);

/** "Weeks 1–5" style learning period of the k-th of n competencies in a 10-week quarter. */
function learningPeriod(k, n) {
  const size = Math.floor(10 / n);
  const from = k * size + 1;
  const to = k === n - 1 ? 10 : from + size - 1;
  return from === to ? `Week ${from}` : `Weeks ${from}–${to}`;
}

/**
 * Weekly timetable for every section, Monday to Friday.
 * Each section takes its 6 subjects (5 core + its elective) through the 6 teaching periods,
 * rotated by section and by day. Because the rotation offset differs per section, a given
 * core subject (and so its teacher and any shared lab) is never in the same period twice.
 */
function buildTimetable(sections, subjectByCode, users) {
  const rows = [];
  sections.forEach((s, si) => {
    const order = [...CORE, s.elective];
    for (let dow = 1; dow <= 5; dow++) {
      order.forEach((code, k) => {
        const [startTime, endTime] = TEACHING_SLOTS[(k + si + dow) % TEACHING_SLOTS.length];
        const subj = subjectByCode[code];
        rows.push({
          sectionId: s.id,
          subjectId: subj.id,
          teacherId: users[SUBJECT_TEACHER[code]].id,
          dayOfWeek: dow,
          startTime,
          endTime,
          room: subj.defaultRoom ?? s.room,
        });
      });
      rows.push({
        sectionId: s.id,
        subjectId: subjectByCode.ARAL.id,
        teacherId: users[s.adviser].id,
        dayOfWeek: dow,
        startTime: ARAL_SLOT[0],
        endTime: ARAL_SLOT[1],
        room: s.room,
      });
    }
  });
  return rows;
}

/** Throw if any section, room or teacher is booked twice at overlapping times. */
function assertNoConflicts(rows) {
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (a.dayOfWeek !== b.dayOfWeek || !(a.startTime < b.endTime && b.startTime < a.endTime)) continue;
      const what = a.sectionId === b.sectionId ? 'section' : a.room === b.room ? `room ${a.room}` : a.teacherId === b.teacherId ? 'teacher' : null;
      if (what) throw new Error(`Timetable conflict (${what}) on day ${a.dayOfWeek} at ${a.startTime}`);
    }
  }
}

async function main() {
  console.log('Clearing existing data...');
  await prisma.activityLog.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.prePostScore.deleteMany();
  await prisma.prePostTest.deleteMany();
  await prisma.classSession.deleteMany();
  await prisma.classSchedule.deleteMany();
  await prisma.assessmentScore.deleteMany();
  await prisma.assessment.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.learner.deleteMany();
  await prisma.section.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.competency.deleteMany();
  await prisma.user.deleteMany();
  await prisma.schoolSetting.deleteMany();

  await prisma.schoolSetting.create({
    data: {
      id: 1,
      schoolName: 'Immaculate Conception SHS',
      schoolId: '300000',
      schoolLevel: 'Senior High School',
      division: 'Sample Division',
      region: 'Region IV-A',
      academicYear: '2026-2027',
      currentQuarter: 2,
    },
  });

  const passwordHash = await bcrypt.hash('password123', 10);
  const users = {};
  for (const u of [
    { email: 'admin@aicss.edu', firstName: 'Antonio', lastName: 'Reyes', role: 'ADMIN', avatarHue: 265 },
    { email: 'teacher@aicss.edu', firstName: 'Maria', lastName: 'Santos', role: 'TEACHER', avatarHue: 330 },
    { email: 'juan.delacruz@aicss.edu', firstName: 'Juan', lastName: 'Dela Cruz', role: 'TEACHER', avatarHue: 200 },
    { email: 'rosa.mendoza@aicss.edu', firstName: 'Rosa', lastName: 'Mendoza', role: 'TEACHER', avatarHue: 20 },
    { email: 'liza.tan@aicss.edu', firstName: 'Liza', lastName: 'Tan', role: 'TEACHER', avatarHue: 290 },
    { email: 'paolo.garcia@aicss.edu', firstName: 'Paolo', lastName: 'Garcia', role: 'TEACHER', avatarHue: 110 },
    { email: 'ramon.villanueva@aicss.edu', firstName: 'Ramon', lastName: 'Villanueva', role: 'TEACHER', avatarHue: 180 },
    { email: 'carmela.bautista@aicss.edu', firstName: 'Carmela', lastName: 'Bautista', role: 'TEACHER', avatarHue: 350 },
    { email: 'jerome.castillo@aicss.edu', firstName: 'Jerome', lastName: 'Castillo', role: 'TEACHER', avatarHue: 230 },
    { email: 'elena.navarro@aicss.edu', firstName: 'Elena', lastName: 'Navarro', role: 'TEACHER', avatarHue: 60 },
    { email: 'victor.ramos@aicss.edu', firstName: 'Victor', lastName: 'Ramos', role: 'TEACHER', avatarHue: 140 },
    { email: 'teresa.aquino@aicss.edu', firstName: 'Teresa', lastName: 'Aquino', role: 'TEACHER', avatarHue: 30 },
    { email: 'grace.lim@aicss.edu', firstName: 'Grace', lastName: 'Lim', role: 'TEACHER', avatarHue: 150, status: 'INACTIVE' },
  ]) {
    users[u.email] = await prisma.user.create({ data: { ...u, passwordHash } });
  }

  console.log('Creating subjects, competencies, sections and learners...');
  const subjectByCode = {};
  for (const s of SUBJECTS) subjectByCode[s.code] = await prisma.subject.create({ data: s });

  const comps = [];
  for (const [code, subjectCode, quarter, title] of COMPETENCIES) {
    const siblings = COMPETENCIES.filter((x) => x[1] === subjectCode && x[2] === quarter);
    const k = siblings.findIndex((x) => x[0] === code);
    const subject = subjectByCode[subjectCode];
    const c = await prisma.competency.create({
      data: { code, subjectId: subject.id, learningArea: subject.name, quarter, title, learningPeriod: learningPeriod(k, siblings.length) },
    });
    comps.push({ ...c, subjectCode });
  }
  // Competencies taught in each subject and quarter, in teaching order.
  const compsBy = new Map();
  for (const c of comps) {
    const key = `${c.subjectId}|${c.quarter}`;
    compsBy.set(key, [...(compsBy.get(key) ?? []), c]);
  }

  const learners = [];
  const sectionRows = [];
  let seq = 1;
  for (const s of SECTIONS) {
    const section = await prisma.section.create({
      data: { name: s.name, gradeLevel: s.gradeLevel, strand: s.strand, room: s.room, teacherId: users[s.adviser].id, electiveId: subjectByCode[s.elective].id },
    });
    sectionRows.push({ ...s, id: section.id, teacherId: section.teacherId });

    const used = new Set();
    for (let i = 0; i < s.size; i++) {
      const sex = i % 2 === 0 ? 'M' : 'F';
      let firstName;
      let lastName;
      do {
        firstName = pick(sex === 'M' ? MALE : FEMALE);
        lastName = pick(SURNAMES);
      } while (used.has(`${firstName} ${lastName}`));
      used.add(`${firstName} ${lastName}`);

      // Absence propensity: most learners rarely miss class, a few miss often.
      const r = rand();
      const absentP = r < 0.05 ? between(0.18, 0.28) : r < 0.15 ? between(0.08, 0.14) : between(0.01, 0.05);
      const ability = clamp(gauss(84 + s.boost, 6.5) - absentP * 45, 55, 98);
      // Chance of skipping a single class period while in school (a few learners cut class).
      const cutP = rand() < 0.1 ? between(0.02, 0.05) : between(0, 0.005);
      const learner = await prisma.learner.create({
        data: {
          learnerNo: `SHS-2026-${String(seq).padStart(3, '0')}`,
          lrn: `1${String(30000000000 + seq * 7919).slice(-11)}`,
          firstName,
          lastName,
          sex,
          birthDate: day(`${2026 - s.gradeLevel - 5}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`),
          guardian: `${pick(sex === 'M' ? FEMALE : MALE).split(' ')[0]} ${lastName}`,
          contactNo: `09${String(170000000 + Math.floor(rand() * 829999999)).padStart(9, '0')}`,
          sectionId: section.id,
          avatarHue: Math.floor(rand() * 360),
        },
      });
      seq++;
      learners.push({ ...learner, absentP, cutP, ability, teacherId: section.teacherId });
    }
  }

  console.log('Building class schedules...');
  const timetable = buildTimetable(sectionRows, subjectByCode, users);
  assertNoConflicts(timetable);
  await prisma.classSchedule.createMany({ data: timetable });

  console.log('Generating attendance...');
  const today = new Date();
  const lastDay = day(iso(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))));
  const schoolDays = [];
  for (let d = day(SY_START); d <= lastDay; d = new Date(d.getTime() + 86400000)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !HOLIDAYS.has(iso(d))) schoolDays.push(d);
  }
  // Daily time record: one row per learner per class period. Whole-day absences and excuses
  // apply to every period; otherwise each period gets a time in, with occasional late
  // arrivals (mostly first period) and occasional skipped periods.
  const periodsBy = new Map();
  for (const p of await prisma.classSchedule.findMany({ orderBy: { startTime: 'asc' } })) {
    const key = `${p.sectionId}|${p.dayOfWeek}`;
    periodsBy.set(key, [...(periodsBy.get(key) ?? []), p]);
  }
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const GRACE = 15;

  let recordCount = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    await prisma.attendanceRecord.createMany({ data: batch });
    recordCount += batch.length;
    batch = [];
  };
  for (const l of learners) {
    for (const d of schoolDays) {
      const periods = periodsBy.get(`${l.sectionId}|${d.getUTCDay()}`) ?? [];
      // Rainy-season dip in July-August; slight improvement towards November.
      const month = d.getUTCMonth();
      const seasonal = month === 6 || month === 7 ? 1.25 : month === 10 ? 0.85 : 1;
      const x = rand();
      const pA = l.absentP * seasonal;
      const dayStatus = x < pA ? 'ABSENT' : x < pA + 0.012 ? 'EXCUSED' : null;
      const excuse = dayStatus === 'EXCUSED' ? pick(['Medical certificate', 'Family emergency', 'School activity']) : null;
      const lateFirst = rand() < 0.035;
      periods.forEach((p, idx) => {
        const start = toMin(p.startTime);
        let status = dayStatus ?? 'PRESENT';
        let timeIn = null;
        let remarks = excuse;
        if (!dayStatus) {
          if (idx > 0 && rand() < l.cutP) {
            status = 'ABSENT';
            remarks = 'Not in class';
          } else if ((idx === 0 && lateFirst) || rand() < 0.006) {
            status = 'LATE';
            timeIn = toTime(start + GRACE + 1 + Math.floor(rand() * 25));
          } else {
            timeIn = toTime(start + (idx === 0 ? -10 : -3) + Math.floor(rand() * (idx === 0 ? 18 : 8)));
          }
        }
        batch.push({ learnerId: l.id, scheduleId: p.id, date: d, status, timeIn, remarks, recordedById: p.teacherId });
      });
      if (batch.length >= 5000) await flush();
    }
  }
  await flush();

  // Lesson log: the competency covered in every class meeting. Each quarter's school days
  // are split evenly across that subject's competencies for the quarter.
  console.log('Logging lessons (competency per class meeting)...');
  const quarterDays = { 1: schoolDays.filter((d) => quarterOf(d) === 1), 2: schoolDays.filter((d) => quarterOf(d) === 2) };
  const sessionRows = [];
  for (const [key, periods] of periodsBy) {
    const dow = Number(key.split('|')[1]);
    for (const p of periods) {
      for (const d of schoolDays) {
        if (d.getUTCDay() !== dow) continue;
        const q = quarterOf(d);
        const list = compsBy.get(`${p.subjectId}|${q}`);
        if (!list) continue;
        const i = quarterDays[q].findIndex((x) => x.getTime() === d.getTime());
        const c = list[Math.min(list.length - 1, Math.floor((i * list.length) / quarterDays[q].length))];
        sessionRows.push({ scheduleId: p.id, date: d, competencyId: c.id, recordedById: p.teacherId });
      }
    }
  }
  for (let i = 0; i < sessionRows.length; i += 5000) await prisma.classSession.createMany({ data: sessionRows.slice(i, i + 5000) });

  console.log('Generating assessments...');
  let scoreCount = 0;
  for (const section of sectionRows) {
    const roster = learners.filter((l) => l.sectionId === section.id);
    const subjects = [...CORE, section.elective];
    const mine = comps.filter((c) => subjects.includes(c.subjectCode));
    for (const c of mine) {
      // Q1 competencies assessed Jun-Aug, Q2 competencies Sep-Nov, by the subject teacher.
      const idx = mine.filter((x) => x.quarter === c.quarter).indexOf(c);
      const base = c.quarter === 1 ? day('2026-06-29') : day('2026-09-07');
      const quizDate = new Date(base.getTime() + idx * 4 * 86400000);
      const taskDate = new Date(quizDate.getTime() + 21 * 86400000);
      const createdById = users[SUBJECT_TEACHER[c.subjectCode]].id;
      for (const [type, title, maxScore, date] of [
        ['QUIZ', `Quiz: ${c.code}`, 20, quizDate],
        ['PERFORMANCE_TASK', `Performance Task: ${c.code}`, 50, taskDate],
      ]) {
        if (date > lastDay) continue;
        const struggle = STRUGGLES[section.name]?.[c.code] ?? 0;
        const assessment = await prisma.assessment.create({
          data: { title, type, competencyId: c.id, sectionId: section.id, date, maxScore, quarter: c.quarter, createdById },
        });
        const scores = roster.map((l) => {
          const pct = clamp(gauss(l.ability + DIFFICULTY[c.subjectCode] + struggle + (type === 'PERFORMANCE_TASK' ? 2 : 0), 7), 30, 100);
          return { assessmentId: assessment.id, learnerId: l.id, score: Math.round((pct / 100) * maxScore) };
        });
        await prisma.assessmentScore.createMany({ data: scores });
        scoreCount += scores.length;
      }
    }
    // 1st Term examination per subject
    for (const code of subjects) {
      const c = mine.find((x) => x.subjectCode === code && x.quarter === 1);
      const assessment = await prisma.assessment.create({
        data: {
          title: `1st Term Exam: ${subjectByCode[code].name}`,
          type: 'QUARTERLY_EXAM',
          competencyId: c.id,
          sectionId: section.id,
          date: day(QUARTER_END[1]),
          maxScore: 50,
          quarter: 1,
          createdById: users[SUBJECT_TEACHER[code]].id,
        },
      });
      const scores = roster.map((l) => ({
        assessmentId: assessment.id,
        learnerId: l.id,
        score: Math.round((clamp(gauss(l.ability + DIFFICULTY[code] - 2, 7), 30, 100) / 100) * 50),
      }));
      await prisma.assessmentScore.createMany({ data: scores });
      scoreCount += scores.length;
    }
  }

  // Competency-level pre-tests (before instruction) and post-tests (after). 1st Term tests
  // are complete; 2nd Term post-tests are done in half the sections, the rest are pending.
  console.log('Generating competency pre-tests and post-tests...');
  let prePostCount = 0;
  for (const [si, section] of sectionRows.entries()) {
    const roster = learners.filter((l) => l.sectionId === section.id);
    const subjects = [...CORE, section.elective];
    for (const c of comps.filter((x) => subjects.includes(x.subjectCode))) {
      const list = compsBy.get(`${c.subjectId}|${c.quarter}`);
      const k = list.indexOf(c);
      const days = quarterDays[c.quarter];
      if (!days.length) continue;
      const startDay = days[Math.floor((k * days.length) / list.length)];
      const endDay = days[Math.max(0, Math.floor(((k + 1) * days.length) / list.length) - 1)];
      const postGiven = c.quarter === 1 || si % 2 === 0;
      const total = c.subjectCode === 'GENMATH' || c.subjectCode === 'PHYS' ? 25 : 20;
      const test = await prisma.prePostTest.create({
        data: {
          sectionId: section.id,
          competencyId: c.id,
          academicYear: '2026-2027',
          quarter: c.quarter,
          preTotal: total,
          postTotal: total,
          preDate: startDay,
          postDate: postGiven ? endDay : null,
          createdById: users[SUBJECT_TEACHER[c.subjectCode]].id,
        },
      });
      const struggle = STRUGGLES[section.name]?.[c.code] ?? 0;
      const scores = [];
      for (const l of roster) {
        const r = rand();
        // A few learners already know the competency; a few barely move after instruction.
        const prePct = r < 0.03 ? clamp(gauss(92, 4), 80, 100) : clamp(gauss(l.ability - 28 + DIFFICULTY[c.subjectCode], 10), 5, 100);
        let postPct = clamp(gauss(l.ability + DIFFICULTY[c.subjectCode] + struggle - l.absentP * 30, 7), 20, 100);
        if (r > 0.94) postPct = clamp(prePct + gauss(1, 5), 0, 100);
        const missedPost = rand() < l.absentP * 0.8;
        scores.push({
          testId: test.id,
          learnerId: l.id,
          preScore: Math.round((prePct / 100) * total),
          postScore: postGiven && !missedPost ? Math.round((Math.max(prePct > 85 ? prePct : 0, postPct) / 100) * total) : null,
        });
      }
      await prisma.prePostScore.createMany({ data: scores });
      prePostCount += scores.length;
    }
  }

  const admin = users['admin@aicss.edu'];
  const maria = users['teacher@aicss.edu'];
  await prisma.activityLog.createMany({
    data: [
      { userId: admin.id, action: 'Updated settings', entity: 'School Configuration', details: 'Immaculate Conception SHS · 2026-2027 · Q2', createdAt: new Date(Date.now() - 6 * 86400000) },
      { userId: admin.id, action: 'Deactivated user', entity: 'User Management', details: 'grace.lim@aicss.edu · TEACHER', createdAt: new Date(Date.now() - 5 * 86400000) },
      { userId: maria.id, action: 'Generated report', entity: 'Report', details: 'School Form 2 (SF2) · Grade 11 – STEM A · October 2026', createdAt: new Date(Date.now() - 3 * 86400000) },
      { userId: maria.id, action: 'Recorded attendance', entity: 'Attendance', details: `Grade 11 – STEM A · ARAL Program · ${iso(schoolDays[schoolDays.length - 1])} 12:30–13:30 · Room 201`, createdAt: new Date(Date.now() - 86400000) },
    ],
  });

  console.log(
    `Seeded ${SUBJECTS.length} subjects, ${sectionRows.length} sections, ${learners.length} learners, ${timetable.length} class meetings/week (no conflicts), ` +
      `${schoolDays.length} school days (${recordCount} class-period attendance records, ${sessionRows.length} lesson logs), ${comps.length} competencies, ` +
      `${scoreCount} assessment scores, ${prePostCount} pre/post-test records.`,
  );
  console.log('Instructional alerts are generated automatically on first load.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
