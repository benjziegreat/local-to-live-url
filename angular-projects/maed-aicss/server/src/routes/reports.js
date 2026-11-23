// Report generation. Every report returns the same tabular shape so the client can
// preview, print (PDF) and export (Excel) any of them:
//   { type, title, subtitle, columns: [{ key, label, align? }], rows: [{...}], summary: [{ label, value }] }
//
// Every report accepts `subjectId` (the shared subject filter) and `sectionId`.
const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { getSettings } = require('../lib/settings');
const { syncAlerts } = require('../lib/alerts');
const { logActivity } = require('../lib/log');
const { learnerWhere, sectionWhere, assertSection, competencyWhere, optInt, loadSubject } = require('../lib/scope');
const { learnerMetrics, competencyStats, attendanceRate, dayStatus, learnerDays, totals, dailySeries, weeklySeries, missedLessons, rateOf, round1, avg, STATUS_ORDER } = require('../lib/metrics');
const { parseMonth, parseDay, dayKey, addDays, dateOnly, isoWeekdayUtc, schoolYearStart, weekStart } = require('../lib/time');
const { learnerName, learnerRow, INTERVENTION_LABEL, termLabel } = require('../lib/shape');
const { loadPrePost, summarize, testRows } = require('../lib/prepost');
const { coverage, completion, COMPLETION_LABEL } = require('../lib/coverage');
const { scopeWhere: alertScope } = require('./alerts');

const router = express.Router();
router.use(authenticate);

const MONITORING = { ON_TRACK: 'On Track', MONITOR: 'Monitor', AT_RISK: 'At Risk' };
const LEVEL = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const ALERT_STATUS = { OPEN: 'Open', FOLLOWED_UP: 'Followed up', RESOLVED: 'Resolved' };
const TYPE = { QUIZ: 'Quiz', PERFORMANCE_TASK: 'Performance Task', QUARTERLY_EXAM: 'Term Exam' };
const pct = (v) => (v === null || v === undefined ? '-' : `${v}%`);
const signed = (v) => (v === null || v === undefined ? '-' : `${v > 0 ? '+' : ''}${v}`);
const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const longDate = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const cols = (list) => list.map(([key, label, align]) => ({ key, label, ...(align && { align }) }));

/** The request's filters: section, subject (row), quarter. */
async function filters(user, q) {
  const subject = await loadSubject(optInt(q.subjectId));
  return { sectionId: optInt(q.sectionId), subjectId: subject?.id, subject, quarter: optInt(q.quarter) };
}

async function scopeLabel(user, { sectionId, subject }) {
  const where = sectionId ? (await assertSection(user, sectionId, subject?.id)).name : user.role === 'ADMIN' ? 'All sections' : subject ? 'My classes' : 'My sections';
  return subject ? `${where} · ${subject.name}` : `${where} · All subjects`;
}

/** First section in view when a report needs exactly one. */
async function oneSection(user, sectionId, subjectId) {
  if (!sectionId) {
    const first = await prisma.section.findFirst({ where: sectionWhere(user, subjectId), orderBy: { name: 'asc' } });
    if (!first) throw new HttpError(400, subjectId ? 'You have no sections for this subject' : 'No sections assigned');
    sectionId = first.id;
  }
  return assertSection(user, sectionId, subjectId);
}

/** Date range of an attendance report: range = day | week | month | year. */
function periodRange(q, settings) {
  const range = q.month === 'year' ? 'year' : ['day', 'week', 'month', 'year'].includes(q.range) ? q.range : 'month';
  if (range === 'year') return { range, from: schoolYearStart(settings.academicYear), to: dateOnly(), label: `School year ${settings.academicYear}` };
  if (range === 'day') {
    const d = parseDay(q.date);
    return { range, from: d, to: d, label: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) };
  }
  if (range === 'week') {
    const from = weekStart(parseDay(q.date));
    const to = addDays(from, 6);
    return { range, from, to, label: `Week of ${longDate(from)} – ${longDate(addDays(from, 4))}` };
  }
  const [from, to] = parseMonth(q.month);
  return { range, from, to, label: monthLabel(from) };
}

const RANGE_TITLE = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'School Year' };

// ---- Attendance -------------------------------------------------------------------

/** SF2-inspired daily attendance grid for one section and month (one subject's periods when filtered). */
async function sf2(user, q, settings) {
  const f = await filters(user, q);
  const section = await oneSection(user, f.sectionId, f.subjectId);
  const teacher = section.teacherId ? await prisma.user.findUnique({ where: { id: section.teacherId } }) : null;
  const [from, to] = parseMonth(q.month);
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d);

  const learners = await prisma.learner.findMany({
    where: { sectionId: section.id, status: 'ACTIVE' },
    orderBy: [{ sex: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
  });
  // Period records rolled up to one status per learner per day.
  const grouped = await prisma.attendanceRecord.groupBy({
    by: ['learnerId', 'date', 'status'],
    where: { learnerId: { in: learners.map((l) => l.id) }, date: { gte: from, lte: to }, ...(f.subjectId && { schedule: { subjectId: f.subjectId } }) },
    _count: { _all: true },
  });
  const dayStatusBy = new Map(learnerDays(grouped).map((d) => [`${d.learnerId}|${d.date}`, d]));
  const MARK = { PRESENT: '', LATE: 'L', ABSENT: 'x', EXCUSED: 'E' };
  const recordedDays = new Set();
  const dailyPresent = new Map(days.map((d) => [dayKey(d), 0]));

  const rows = learners.map((l, i) => {
    const row = { no: i + 1, name: learnerName(l), sex: l.sex };
    const c = { present: 0, late: 0, absent: 0, excused: 0 };
    let partial = 0;
    for (const d of days) {
      const k = dayKey(d);
      const day = dayStatusBy.get(`${l.id}|${k}`);
      row[k] = day ? (day.partial ? 'C' : MARK[day.status]) : '';
      if (day) {
        recordedDays.add(k);
        c[day.status.toLowerCase()]++;
        if (day.partial) partial++;
        if (day.status === 'PRESENT' || day.status === 'LATE') dailyPresent.set(k, dailyPresent.get(k) + 1);
      }
    }
    row.absent = c.absent;
    row.tardy = c.late;
    row.rate = pct(attendanceRate(c));
    row.remarks = [
      c.absent >= settings.absenceAlertThreshold ? 'Frequent absences' : '',
      partial >= settings.missedClassThreshold ? `Missed periods on ${partial} day(s)` : '',
    ]
      .filter(Boolean)
      .join('; ');
    return row;
  });

  const totalRow = { no: '', name: 'TOTAL PRESENT PER DAY', sex: '' };
  for (const d of days) totalRow[dayKey(d)] = recordedDays.has(dayKey(d)) ? dailyPresent.get(dayKey(d)) : '';
  totalRow.absent = rows.reduce((n, r) => n + r.absent, 0);
  totalRow.tardy = rows.reduce((n, r) => n + r.tardy, 0);
  totalRow.rate = '';
  totalRow.remarks = '';

  const schoolDays = recordedDays.size;
  const presentSum = [...dailyPresent.values()].reduce((a, b) => a + b, 0);
  return {
    title: `School Form 2 (SF2) — Daily Attendance Report of Learners${f.subject ? ` · ${f.subject.name}` : ''}`,
    subtitle: `${settings.schoolName} · ${section.name} · ${monthLabel(from)} · Adviser: ${teacher ? `${teacher.firstName} ${teacher.lastName}` : '-'}`,
    legend: f.subject
      ? `Day status from the ${f.subject.name} class periods only · Blank = present · x = absent · L = late/tardy · E = excused · C = attended part of the subject's periods`
      : 'Day status from the class-period records · Blank = present · x = absent all day · L = late/tardy · E = excused · C = in school but missed some periods',
    columns: [
      { key: 'no', label: 'No.', align: 'right' },
      { key: 'name', label: "Learner's Name" },
      { key: 'sex', label: 'Sex' },
      ...days.map((d) => ({ key: dayKey(d), label: `${d.getUTCDate()}`, sub: 'MTWTF'[d.getUTCDay() - 1], align: 'center' })),
      { key: 'absent', label: 'Absent', align: 'right' },
      { key: 'tardy', label: 'Tardy', align: 'right' },
      { key: 'rate', label: 'Rate', align: 'right' },
      { key: 'remarks', label: 'Remarks' },
    ],
    rows: [...rows, totalRow],
    summary: [
      { label: 'Enrolment', value: `${learners.length} (M ${learners.filter((l) => l.sex === 'M').length} · F ${learners.filter((l) => l.sex === 'F').length})` },
      { label: 'School days recorded', value: schoolDays },
      { label: 'Average daily attendance', value: schoolDays ? round1(presentSum / schoolDays) : '-' },
      { label: 'Percentage of attendance', value: schoolDays && learners.length ? pct(round1((presentSum / (schoolDays * learners.length)) * 100)) : '-' },
    ],
  };
}

/**
 * Daily Time Record (DTR) for one section and date: each learner's status and time in
 * for every class period that day (one subject's periods when filtered).
 */
async function dtr(user, q, settings) {
  const f = await filters(user, q);
  const section = await oneSection(user, f.sectionId, f.subjectId);
  const date = parseDay(q.date);
  const dow = isoWeekdayUtc(date);
  const periods = await prisma.classSchedule.findMany({
    where: { sectionId: section.id, dayOfWeek: dow, ...(f.subjectId && { subjectId: f.subjectId }) },
    include: { subject: true, teacher: true, sessions: { where: { date }, include: { competency: true } } },
    orderBy: { startTime: 'asc' },
  });
  const learners = await prisma.learner.findMany({
    where: { sectionId: section.id, status: 'ACTIVE' },
    include: { attendance: { where: { date } } },
    orderBy: [{ sex: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
  });
  const label = (t) => {
    const [h, m] = t.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
  };
  const SHORT = { ABSENT: 'Absent', EXCUSED: 'Excused' };

  let attended = 0;
  let recorded = 0;
  const perPeriod = new Map(periods.map((p) => [p.id, { present: 0, late: 0, absent: 0, excused: 0 }]));
  const rows = learners.map((l, i) => {
    const byPeriod = new Map(l.attendance.map((a) => [a.scheduleId, a]));
    const row = { no: i + 1, name: learnerName(l), sex: l.sex };
    const p = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 };
    for (const per of periods) {
      const a = byPeriod.get(per.id);
      if (!a) {
        row[`p${per.id}`] = '';
        continue;
      }
      p[a.status]++;
      perPeriod.get(per.id)[a.status.toLowerCase()]++;
      row[`p${per.id}`] = SHORT[a.status] ?? `${a.timeIn ?? '✓'}${a.status === 'LATE' ? ' L' : ''}`;
    }
    const total = p.PRESENT + p.LATE + p.ABSENT + p.EXCUSED;
    if (total) {
      const d = dayStatus(p);
      recorded += total;
      attended += d.attended;
      row.day = d.partial ? `Partial (${d.missed} missed)` : { PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent', EXCUSED: 'Excused' }[d.status];
    } else {
      row.day = 'Not recorded';
    }
    return row;
  });
  const totalRow = { no: '', name: 'PRESENT / LATE / ABSENT', sex: '', day: '' };
  for (const per of periods) {
    const c = perPeriod.get(per.id);
    totalRow[`p${per.id}`] = c.present + c.late + c.absent + c.excused ? `${c.present} / ${c.late} / ${c.absent + c.excused}` : '';
  }

  return {
    title: `Daily Time Record (DTR) — Class Attendance${f.subject ? ` · ${f.subject.name}` : ''}`,
    subtitle: `${settings.schoolName} · ${section.name} · ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`,
    legend: `Cells show time in (L = late, more than ${settings.lateGraceMinutes} min after the period starts). Blank = not yet recorded. Column notes show the competency taught.`,
    columns: [
      { key: 'no', label: 'No.', align: 'right' },
      { key: 'name', label: "Learner's Name" },
      { key: 'sex', label: 'Sex' },
      ...periods.map((per) => ({
        key: `p${per.id}`,
        label: `${label(per.startTime)}–${label(per.endTime)}`,
        sub: `${per.subject.name} · ${per.room}${per.teacher ? ` · ${per.teacher.lastName}` : ''}${per.sessions[0]?.competency ? ` · ${per.sessions[0].competency.code}` : ''}`,
        align: 'center',
      })),
      { key: 'day', label: f.subject ? 'Status' : 'Day status' },
    ],
    rows: periods.length ? [...rows, totalRow] : [],
    summary: [
      { label: 'Class periods', value: periods.length || `None on ${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dow]}` },
      { label: 'Learners', value: learners.length },
      { label: 'Period attendance', value: recorded ? pct(round1((attended / recorded) * 100)) : '-' },
      { label: f.subject ? 'Absent' : 'Absent all day', value: rows.filter((r) => r.day === 'Absent').length },
      { label: 'Partial days', value: rows.filter((r) => String(r.day).startsWith('Partial')).length },
    ],
  };
}

/** Attendance per learner for a day, week, month or the whole school year. */
async function attendance(user, q, settings) {
  const f = await filters(user, q);
  const p = periodRange(q, settings);
  const lw = learnerWhere(user, { sectionId: f.sectionId, subjectId: f.subjectId });
  const learners = await prisma.learner.findMany({ where: lw, include: { section: true }, orderBy: [{ section: { name: 'asc' } }, { lastName: 'asc' }] });
  const [metrics, series, lessons] = await Promise.all([
    learnerMetrics(learners, settings, { from: p.from, to: p.to, subjectId: f.subjectId }),
    dailySeries(lw, p.from, p.to, { subjectId: f.subjectId }),
    missedLessons({ learnerIds: learners.map((l) => l.id), subjectId: f.subjectId }),
  ]);
  const t = totals(series);
  const sub = p.range === 'year' || p.range === 'month' ? weeklySeries(series).map((w) => ({ label: `Week of ${w.week}`, value: pct(w.rate) })) : [];

  return {
    title: `Attendance Report — ${RANGE_TITLE[p.range]}`,
    subtitle: `${await scopeLabel(user, f)} · ${p.label}`,
    legend: f.subject ? `Counts are ${f.subject.name} class days; rate = ${f.subject.name} periods attended / recorded.` : 'Counts are school days; rate = class periods attended / recorded.',
    columns: cols([
      ['learnerNo', 'Learner ID'],
      ['name', 'Learner'],
      ['section', 'Section'],
      ['days', 'Days', 'right'],
      ['present', 'Present', 'right'],
      ['late', 'Tardy', 'right'],
      ['absent', 'Absent', 'right'],
      ['excused', 'Excused', 'right'],
      ['partial', 'Partial days', 'right'],
      ['missed', 'Periods missed', 'right'],
      ['rate', 'Attendance %', 'right'],
      ['lessons', 'Lessons missed (school year)', 'right'],
    ]),
    rows: learners.map((l) => {
      const m = metrics.get(l.id);
      return {
        learnerNo: l.learnerNo,
        name: learnerName(l),
        section: l.section.name,
        days: m.days,
        present: m.present,
        late: m.late,
        absent: m.absent,
        excused: m.excused,
        partial: m.partialDays,
        missed: m.periodsMissed,
        rate: pct(m.attendanceRate),
        lessons: [...(lessons.missed.get(l.id)?.values() ?? [])].reduce((a, b) => a + b, 0),
      };
    }),
    summary: [
      { label: 'School days', value: series.length },
      { label: 'Attendance rate', value: pct(t.rate) },
      { label: f.subject ? 'Absences' : 'Whole-day absences', value: t.absent },
      { label: 'Tardy', value: t.late },
      { label: 'Partial days', value: t.partial },
      { label: `Below ${settings.attendanceTarget}% target`, value: [...metrics.values()].filter((m) => m.attendanceRate !== null && m.attendanceRate < settings.attendanceTarget).length },
      ...sub,
    ],
  };
}

/** Subject-based attendance summary: per subject (all subjects) or per section (one subject). */
async function subjects(user, q, settings) {
  const f = await filters(user, q);
  const p = periodRange(q, settings);
  const lw = learnerWhere(user, { sectionId: f.sectionId, subjectId: f.subjectId });
  const [rows, schedules] = await Promise.all([
    prisma.attendanceRecord.groupBy({
      by: ['learnerId', 'scheduleId', 'status'],
      where: { learner: lw, date: { gte: p.from, lte: p.to }, ...(f.subjectId && { schedule: { subjectId: f.subjectId } }) },
      _count: { _all: true },
    }),
    prisma.classSchedule.findMany({ include: { subject: true, section: true, teacher: true } }),
  ]);
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));
  const groups = new Map();
  for (const r of rows) {
    const s = scheduleById.get(r.scheduleId);
    const key = f.subjectId ? s.sectionId : s.subjectId;
    const g = groups.get(key) ?? {
      name: f.subjectId ? s.section.name : s.subject.name,
      kind: f.subjectId ? null : s.subject.kind,
      teachers: new Set(),
      PRESENT: 0,
      LATE: 0,
      ABSENT: 0,
      EXCUSED: 0,
      learners: new Map(),
    };
    if (s.teacher) g.teachers.add(`${s.teacher.firstName} ${s.teacher.lastName}`);
    g[r.status] += r._count._all;
    const l = g.learners.get(r.learnerId) ?? { total: 0, attended: 0 };
    l.total += r._count._all;
    if (r.status === 'PRESENT' || r.status === 'LATE') l.attended += r._count._all;
    g.learners.set(r.learnerId, l);
    groups.set(key, g);
  }
  const out = [...groups.values()]
    .map((g) => {
      const total = g.PRESENT + g.LATE + g.ABSENT + g.EXCUSED;
      const rates = [...g.learners.values()].map((l) => rateOf(l.attended, l.total));
      return {
        name: g.name,
        teacher: [...g.teachers].join(', '),
        learners: g.learners.size,
        periods: total,
        present: g.PRESENT,
        late: g.LATE,
        absent: g.ABSENT,
        excused: g.EXCUSED,
        rate: pct(rateOf(g.PRESENT + g.LATE, total)),
        below: rates.filter((r) => r !== null && r < settings.attendanceTarget).length,
        _rate: rateOf(g.PRESENT + g.LATE, total) ?? 0,
      };
    })
    .sort((a, b) => a._rate - b._rate)
    .map(({ _rate, ...r }) => r);
  const all = out.reduce((t, r) => ({ periods: t.periods + r.periods, attended: t.attended + r.present + r.late }), { periods: 0, attended: 0 });
  return {
    title: `Subject Attendance Summary — ${RANGE_TITLE[p.range]}`,
    subtitle: `${await scopeLabel(user, f)} · ${p.label}`,
    legend: 'Counts are class periods (learner × meeting). Rate = periods attended (present + tardy) / periods recorded.',
    columns: cols([
      ['name', f.subjectId ? 'Section' : 'Subject'],
      ['teacher', 'Teacher(s)'],
      ['learners', 'Learners', 'right'],
      ['periods', 'Periods recorded', 'right'],
      ['present', 'Present', 'right'],
      ['late', 'Tardy', 'right'],
      ['absent', 'Absent', 'right'],
      ['excused', 'Excused', 'right'],
      ['rate', 'Attendance %', 'right'],
      ['below', `Learners < ${settings.attendanceTarget}%`, 'right'],
    ]),
    rows: out,
    summary: [
      { label: f.subjectId ? 'Sections' : 'Subjects', value: out.length },
      { label: 'Overall attendance', value: pct(rateOf(all.attended, all.periods)) },
      { label: 'Lowest', value: out[0] ? `${out[0].name} (${out[0].rate})` : '-' },
    ],
  };
}

// ---- Competencies and assessments -----------------------------------------------

async function competencyList(user, f) {
  return prisma.competency.findMany({
    where: { ...competencyWhere(user, { subjectId: f.subjectId, sectionId: f.sectionId }), active: true, ...(f.quarter && { quarter: f.quarter }) },
    orderBy: [{ learningArea: 'asc' }, { quarter: 'asc' }, { learningPeriod: 'asc' }, { code: 'asc' }],
  });
}

/** Competency mastery: learners mastered / in progress / needing support per competency. */
async function competency(user, q, settings) {
  const f = await filters(user, q);
  const learners = await prisma.learner.findMany({ where: learnerWhere(user, f), select: { id: true, sectionId: true } });
  const [metrics, comps] = await Promise.all([learnerMetrics(learners, settings, { quarter: f.quarter, subjectId: f.subjectId }), competencyList(user, f)]);
  const stats = competencyStats(metrics, settings);
  const rows = comps.map((c) => {
    const s = stats.get(c.id);
    return {
      code: c.code,
      learningArea: c.learningArea,
      title: c.title,
      quarter: termLabel(c.quarter),
      assessed: s?.assessed ?? 0,
      mastered: s?.MASTERED ?? 0,
      inProgress: s?.IN_PROGRESS ?? 0,
      needsSupport: s?.NEEDS_SUPPORT ?? 0,
      average: pct(s?.average),
      mastery: pct(s?.masteryRate),
      status: s ? (s.masteryRate >= settings.masteryTarget ? 'On Track' : s.masteryRate >= settings.masteryTarget - 15 ? 'Monitor' : 'Needs Support') : 'Not assessed',
    };
  });
  const rates = comps.map((c) => stats.get(c.id)?.masteryRate).filter((r) => r !== null && r !== undefined);
  return {
    title: 'Competency Mastery Report',
    subtitle: `${await scopeLabel(user, f)} · ${f.quarter ? termLabel(f.quarter) : 'All terms'} · Mastery target ${settings.masteryTarget}%`,
    legend: 'Mastery uses quizzes, performance tasks, exams and post-tests (pre-tests are excluded).',
    columns: cols([
      ['code', 'Code'],
      ['learningArea', 'Subject'],
      ['title', 'Competency'],
      ['quarter', 'Term'],
      ['assessed', 'Assessed', 'right'],
      ['mastered', 'Mastered', 'right'],
      ['inProgress', 'In Progress', 'right'],
      ['needsSupport', 'Needs Support', 'right'],
      ['average', 'Average', 'right'],
      ['mastery', 'Mastery', 'right'],
      ['status', 'Status'],
    ]),
    rows,
    summary: [
      { label: 'Competencies', value: comps.length },
      { label: 'Average mastery rate', value: rates.length ? pct(round1(avg(rates))) : '-' },
      { label: 'Need reteaching', value: rows.filter((r) => r.status === 'Needs Support').length },
    ],
  };
}

/** Competency completion: lessons logged, assessments, pre/post-tests and sections completed. */
async function completionReport(user, q, settings) {
  const f = await filters(user, q);
  const comps = await competencyList(user, f);
  const ids = comps.map((c) => c.id);
  const [cov, assessed] = await Promise.all([
    coverage(user, { subjectId: f.subjectId, sectionId: f.sectionId, competencyIds: ids, settings }),
    prisma.assessment.groupBy({
      by: ['competencyId'],
      where: { competencyId: { in: ids }, section: { ...sectionWhere(user, f.subjectId), ...(f.sectionId && { id: f.sectionId }) } },
      _count: { _all: true },
    }),
  ]);
  const assessmentCount = new Map(assessed.map((a) => [a.competencyId, a._count._all]));
  const rows = comps.map((c) => {
    const done = completion(c, cov, assessmentCount.get(c.id) ?? 0);
    return {
      code: c.code,
      learningArea: c.learningArea,
      title: c.title,
      quarter: termLabel(c.quarter),
      period: c.learningPeriod ?? '',
      lessons: done.lessons,
      lastLesson: done.lastLesson ?? '-',
      assessments: assessmentCount.get(c.id) ?? 0,
      pretest: done.tests.filter((t) => t.preTaken).length,
      posttest: done.completedSections,
      sections: `${done.completedSections}/${done.sections}`,
      status: COMPLETION_LABEL[done.status],
    };
  });
  const count = (s) => rows.filter((r) => r.status === COMPLETION_LABEL[s]).length;
  return {
    title: 'Competency Completion Report',
    subtitle: `${await scopeLabel(user, f)} · ${f.quarter ? termLabel(f.quarter) : 'All terms'} · ${settings.academicYear}`,
    legend: 'Completed = post-test recorded in every section that takes the subject. In progress = lessons logged, pre-test given or assessments recorded.',
    columns: cols([
      ['code', 'Code'],
      ['learningArea', 'Subject'],
      ['title', 'Competency'],
      ['quarter', 'Term'],
      ['period', 'Learning period'],
      ['lessons', 'Lessons logged', 'right'],
      ['lastLesson', 'Last lesson'],
      ['assessments', 'Assessments', 'right'],
      ['pretest', 'Sections pre-tested', 'right'],
      ['posttest', 'Sections post-tested', 'right'],
      ['sections', 'Completed sections', 'right'],
      ['status', 'Status'],
    ]),
    rows,
    summary: [
      { label: 'Competencies', value: rows.length },
      { label: 'Completed', value: count('COMPLETED') },
      { label: 'In progress', value: count('IN_PROGRESS') },
      { label: 'Not started', value: count('NOT_STARTED') },
      { label: 'Completion rate', value: rows.length ? pct(round1((count('COMPLETED') / rows.length) * 100)) : '-' },
    ],
  };
}

async function assessment(user, q, settings) {
  const f = await filters(user, q);
  const list = await prisma.assessment.findMany({
    where: {
      ...(f.quarter && { quarter: f.quarter }),
      ...(f.subjectId && { competency: { subjectId: f.subjectId } }),
      section: { ...sectionWhere(user, f.subjectId), ...(f.sectionId && { id: f.sectionId }) },
    },
    include: { competency: true, section: true, scores: { where: { learner: { status: 'ACTIVE' } } } },
    orderBy: [{ date: 'desc' }],
  });
  const all = [];
  const rows = list.map((a) => {
    const p = a.scores.map((s) => (s.score / a.maxScore) * 100);
    all.push(...p);
    return {
      date: dayKey(a.date),
      title: a.title,
      type: TYPE[a.type],
      competency: a.competency.code,
      learningArea: a.competency.learningArea,
      section: a.section.name,
      maxScore: a.maxScore,
      scored: p.length,
      average: pct(p.length ? round1(avg(p)) : null),
      passed: `${p.filter((x) => x >= settings.masteryTarget).length}/${p.length}`,
      highest: p.length ? pct(round1(Math.max(...p))) : '-',
      lowest: p.length ? pct(round1(Math.min(...p))) : '-',
    };
  });
  return {
    title: 'Assessment Report — Performance Analysis',
    subtitle: `${await scopeLabel(user, f)} · ${f.quarter ? termLabel(f.quarter) : 'All terms'}`,
    columns: cols([
      ['date', 'Date'],
      ['title', 'Assessment'],
      ['type', 'Type'],
      ['competency', 'Competency'],
      ['learningArea', 'Subject'],
      ['section', 'Section'],
      ['maxScore', 'Max', 'right'],
      ['average', 'Average', 'right'],
      ['passed', 'Passed', 'right'],
      ['highest', 'Highest', 'right'],
      ['lowest', 'Lowest', 'right'],
    ]),
    rows,
    summary: [
      { label: 'Assessments', value: list.length },
      { label: 'Scores recorded', value: all.length },
      { label: 'Overall average', value: pct(all.length ? round1(avg(all)) : null) },
      { label: 'Pass rate', value: pct(all.length ? round1((all.filter((x) => x >= settings.masteryTarget).length / all.length) * 100) : null) },
    ],
  };
}

function prePostWhere(user, f, settings, q) {
  return {
    academicYear: settings.academicYear,
    ...(f.quarter && { quarter: f.quarter }),
    ...(optInt(q.competencyId) && { competencyId: optInt(q.competencyId) }),
    ...(f.subjectId && { competency: { subjectId: f.subjectId } }),
    section: { ...sectionWhere(user, f.subjectId), ...(f.sectionId && { id: f.sectionId }) },
  };
}

/** Pre-test and post-test comparison, one row per learner and competency. */
async function prepost(user, q, settings) {
  const f = await filters(user, q);
  const { records } = await loadPrePost(prePostWhere(user, f, settings, q), settings);
  const s = summarize(records, settings);
  records.sort((a, b) => a.quarter - b.quarter || a.competencyCode.localeCompare(b.competencyCode) || a.section.localeCompare(b.section) || a.learner.localeCompare(b.learner));
  return {
    title: 'Pre-test and Post-test Comparison Report',
    subtitle: `${await scopeLabel(user, f)} · ${f.quarter ? termLabel(f.quarter) : 'All terms'} · ${settings.academicYear}`,
    legend: 'Percentage = score / total items × 100. Learning gain = post-test % − pre-test % (percentage points).',
    columns: cols([
      ['learner', "Learner's Name"],
      ['section', 'Section'],
      ['subject', 'Subject'],
      ['quarter', 'Term'],
      ['code', 'Competency'],
      ['title', 'Description'],
      ['pre', 'Pre-test', 'right'],
      ['prePct', 'Pre %', 'right'],
      ['post', 'Post-test', 'right'],
      ['postPct', 'Post %', 'right'],
      ['gain', 'Gain', 'right'],
      ['interpretation', 'Interpretation'],
    ]),
    rows: records.map((r) => ({
      learner: r.learner,
      section: r.section,
      subject: r.subject,
      quarter: termLabel(r.quarter),
      code: r.competencyCode,
      title: r.competencyTitle,
      pre: r.preScore === null ? '-' : `${r.preScore}/${r.preTotal}`,
      prePct: pct(r.prePct),
      post: r.postScore === null ? '-' : `${r.postScore}/${r.postTotal}`,
      postPct: pct(r.postPct),
      gain: signed(r.gain),
      interpretation: r.interpretation,
    })),
    summary: [
      { label: 'Records', value: records.length },
      { label: 'Average pre-test', value: pct(s.avgPre) },
      { label: 'Average post-test', value: pct(s.avgPost) },
      { label: 'Average gain', value: signed(s.avgGain) },
      { label: 'Improved', value: s.improved },
      { label: 'Maintained', value: s.maintained },
      { label: 'Declined', value: s.declined },
      { label: 'Awaiting post-test', value: s.pending },
    ],
  };
}

/** Learning gain analysis per class (section × competency). */
async function gain(user, q, settings) {
  const f = await filters(user, q);
  const { tests, records } = await loadPrePost(prePostWhere(user, f, settings, q), settings);
  const rows = testRows(tests, records, settings);
  const s = summarize(records, settings);
  const verdict = (t) =>
    t.completed === 0
      ? 'Awaiting post-test'
      : t.avgGain >= settings.minLearningGain && t.masteredPost >= t.postTaken / 2
        ? 'Effective'
        : t.avgGain >= settings.minLearningGain
          ? 'Gaining, below mastery'
          : 'Low gain: reteach';
  return {
    title: 'Learning Gain Analysis',
    subtitle: `${await scopeLabel(user, f)} · ${f.quarter ? termLabel(f.quarter) : 'All terms'} · ${settings.academicYear}`,
    legend: `Gain = average post-test % − average pre-test % of learners with both scores. Minimum expected gain ${settings.minLearningGain} points; mastery target ${settings.masteryTarget}%.`,
    columns: cols([
      ['subject', 'Subject'],
      ['code', 'Competency'],
      ['section', 'Section'],
      ['quarter', 'Term'],
      ['completed', 'Learners (pre + post)', 'right'],
      ['avgPre', 'Avg pre %', 'right'],
      ['avgPost', 'Avg post %', 'right'],
      ['avgGain', 'Avg gain', 'right'],
      ['improved', 'Improved', 'right'],
      ['maintained', 'Maintained', 'right'],
      ['declined', 'Declined', 'right'],
      ['mastered', 'Mastered (post)', 'right'],
      ['verdict', 'Interpretation'],
    ]),
    rows: rows.map((t) => ({
      subject: t.subject,
      code: t.competencyCode,
      section: t.section,
      quarter: termLabel(t.quarter),
      completed: t.completed,
      avgPre: pct(t.avgPreCompleted ?? t.avgPre),
      avgPost: pct(t.avgPostCompleted),
      avgGain: signed(t.avgGain),
      improved: t.improved,
      maintained: t.maintained,
      declined: t.declined,
      mastered: t.postTaken ? `${t.masteredPost}/${t.postTaken}` : '-',
      verdict: verdict(t),
    })),
    summary: [
      { label: 'Classes tested', value: rows.length },
      { label: 'Average gain', value: signed(s.avgGain) },
      { label: 'Improved', value: s.improved },
      { label: 'Maintained', value: s.maintained },
      { label: 'Declined', value: s.declined },
      { label: `Gain < ${settings.minLearningGain} (below target)`, value: s.limitedGain },
    ],
  };
}

// ---- Learners and alerts ----------------------------------------------------------

async function performance(user, q, settings, { consolidated = false } = {}) {
  const f = await filters(user, q);
  const learners = await prisma.learner.findMany({ where: learnerWhere(user, f), include: { section: true }, orderBy: [{ lastName: 'asc' }] });
  const metrics = await learnerMetrics(learners, settings, { subjectId: f.subjectId });
  const openAlerts = await prisma.alert.groupBy({
    by: ['learnerId'],
    where: { ...alertScope(user, { subjectId: f.subjectId }), status: { not: 'RESOLVED' }, learnerId: { in: learners.map((l) => l.id) } },
    _count: { _all: true },
  });
  const alertsBy = new Map(openAlerts.map((a) => [a.learnerId, a._count._all]));
  const rows = learners
    .map((l) => {
      const m = metrics.get(l.id);
      const r = learnerRow(l, m);
      const comps = [...m.competencyAvg.values()];
      return {
        learnerNo: r.learnerNo,
        name: r.name,
        section: r.section,
        attendance: pct(r.attendanceRate),
        absences: r.absent,
        average: pct(r.assessmentAvg),
        descriptor: r.descriptor,
        competencies: `${comps.filter((s) => s >= settings.masteryTarget).length}/${comps.length}`,
        alerts: alertsBy.get(l.id) ?? 0,
        status: MONITORING[r.monitoring],
        action: r.action,
        _order: STATUS_ORDER[r.monitoring],
      };
    })
    .sort((a, b) => a._order - b._order || a.name.localeCompare(b.name))
    .map(({ _order, ...r }) => r);

  const count = (s) => rows.filter((r) => r.status === s).length;
  const columns = consolidated
    ? ['learnerNo', 'name', 'section', 'attendance', 'absences', 'average', 'competencies', 'alerts', 'status', 'action']
    : ['learnerNo', 'name', 'section', 'attendance', 'average', 'descriptor', 'competencies', 'status', 'action'];
  const LABELS = {
    learnerNo: 'Learner ID',
    name: 'Learner',
    section: 'Section',
    attendance: 'Attendance',
    absences: 'Absences',
    average: 'Assessment Avg',
    descriptor: 'Descriptor',
    competencies: 'Competencies Mastered',
    alerts: 'Open Alerts',
    status: 'Status',
    action: 'Recommended Action',
  };
  const right = new Set(['attendance', 'absences', 'average', 'competencies', 'alerts']);
  return {
    title: consolidated ? 'Consolidated Report — Attendance + Performance' : 'Learner Performance Report',
    subtitle: `${await scopeLabel(user, f)} · ${settings.academicYear}`,
    columns: columns.map((key) => ({ key, label: LABELS[key], ...(right.has(key) && { align: 'right' }) })),
    rows,
    summary: [
      { label: 'Learners', value: rows.length },
      { label: 'On Track', value: count('On Track') },
      { label: 'Monitor', value: count('Monitor') },
      { label: 'At Risk', value: count('At Risk') },
    ],
  };
}

/** Learners needing instructional support: not on track, or with open alerts, and what to do. */
async function support(user, q, settings) {
  await syncAlerts();
  const f = await filters(user, q);
  const learners = await prisma.learner.findMany({ where: learnerWhere(user, f), include: { section: true }, orderBy: [{ lastName: 'asc' }] });
  const [metrics, alerts] = await Promise.all([
    learnerMetrics(learners, settings, { subjectId: f.subjectId }),
    prisma.alert.findMany({
      where: { ...alertScope(user, { sectionId: f.sectionId, subjectId: f.subjectId }), status: { not: 'RESOLVED' }, learnerId: { in: learners.map((l) => l.id) } },
      include: { competency: true, subject: true },
      orderBy: { level: 'asc' },
    }),
  ]);
  const alertsBy = new Map();
  for (const a of alerts) alertsBy.set(a.learnerId, [...(alertsBy.get(a.learnerId) ?? []), a]);
  const rows = learners
    .map((l) => ({ l, m: metrics.get(l.id), a: alertsBy.get(l.id) ?? [] }))
    .filter(({ m, a }) => m.status !== 'ON_TRACK' || a.length)
    .sort((x, y) => STATUS_ORDER[x.m.status] - STATUS_ORDER[y.m.status] || y.a.length - x.a.length || learnerName(x.l).localeCompare(learnerName(y.l)))
    .map(({ l, m, a }) => ({
      learnerNo: l.learnerNo,
      name: learnerName(l),
      section: l.section.name,
      attendance: pct(m.attendanceRate),
      average: pct(m.assessmentAvg),
      status: MONITORING[m.status],
      issues: a.length ? [...new Set(a.map((x) => x.title))].join('; ') : m.descriptor,
      interventions: [...new Set(a.map((x) => INTERVENTION_LABEL[x.intervention]).filter(Boolean))].join(', ') || '-',
      action: m.action,
    }));
  return {
    title: 'Learners Needing Instructional Support',
    subtitle: `${await scopeLabel(user, f)} · ${settings.academicYear}`,
    legend: 'Learners not on track (attendance or assessment below target) or with open instructional alerts, most urgent first.',
    columns: cols([
      ['learnerNo', 'Learner ID'],
      ['name', 'Learner'],
      ['section', 'Section'],
      ['attendance', 'Attendance', 'right'],
      ['average', 'Assessment Avg', 'right'],
      ['status', 'Status'],
      ['issues', 'Issues'],
      ['interventions', 'Interventions'],
      ['action', 'Recommended Action'],
    ]),
    rows,
    summary: [
      { label: 'Learners in view', value: learners.length },
      { label: 'Needing support', value: rows.length },
      { label: 'At Risk', value: rows.filter((r) => r.status === 'At Risk').length },
      ...Object.entries(INTERVENTION_LABEL).map(([k, label]) => ({ label, value: new Set(alerts.filter((a) => a.intervention === k).map((a) => a.learnerId)).size })),
    ],
  };
}

async function alertsReport(user, q) {
  await syncAlerts();
  const f = await filters(user, q);
  const items = await prisma.alert.findMany({
    where: { ...alertScope(user, { sectionId: f.sectionId, subjectId: f.subjectId }), ...(q.status === 'all' ? {} : { status: { not: 'RESOLVED' } }) },
    include: { learner: true, section: true, followUpBy: true, subject: true, competency: true },
    orderBy: [{ level: 'asc' }, { updatedAt: 'desc' }],
  });
  const count = (level) => items.filter((a) => a.level === level).length;
  return {
    title: 'Instructional Alerts — Summary',
    subtitle: `${await scopeLabel(user, f)} · ${q.status === 'all' ? 'All alerts' : 'Open and followed-up alerts'}`,
    columns: cols([
      ['level', 'Level'],
      ['title', 'Issue'],
      ['learner', 'Learner'],
      ['section', 'Section'],
      ['subject', 'Subject'],
      ['competency', 'Competency'],
      ['detail', 'Reason'],
      ['intervention', 'Intervention'],
      ['action', 'Recommended Action'],
      ['status', 'Status'],
      ['followUp', 'Follow-up'],
      ['date', 'Updated'],
    ]),
    rows: items.map((a) => ({
      level: LEVEL[a.level],
      title: a.title,
      learner: a.learner ? learnerName(a.learner) : '(whole class)',
      section: a.section?.name ?? '-',
      subject: a.subject?.name ?? 'All subjects',
      competency: a.competency?.code ?? '-',
      detail: a.detail,
      intervention: INTERVENTION_LABEL[a.intervention] ?? '-',
      action: a.action,
      status: ALERT_STATUS[a.status],
      followUp: a.followUpNote ? `${a.followUpNote}${a.followUpBy ? ` (${a.followUpBy.firstName} ${a.followUpBy.lastName})` : ''}` : '',
      date: dayKey(a.updatedAt),
    })),
    summary: [
      { label: 'High', value: count('HIGH') },
      { label: 'Medium', value: count('MEDIUM') },
      { label: 'Low', value: count('LOW') },
    ],
  };
}

const REPORTS = {
  sf2,
  dtr,
  attendance,
  subjects,
  competency,
  completion: completionReport,
  assessment,
  prepost,
  gain,
  performance: (u, q, s) => performance(u, q, s),
  support,
  alerts: alertsReport,
  consolidated: (u, q, s) => performance(u, q, s, { consolidated: true }),
};

router.get(
  '/:type',
  asyncHandler(async (req, res) => {
    const build = REPORTS[req.params.type];
    if (!build) throw new HttpError(404, 'Unknown report');
    const settings = await getSettings();
    const report = await build(req.user, req.query, settings);
    if (req.query.log !== '0') logActivity(req.user.id, 'Generated report', 'Report', `${report.title} · ${report.subtitle}`);
    res.json({ type: req.params.type, generatedAt: new Date(), school: settings.schoolName, ...report });
  }),
);

module.exports = router;
