// Report generation. Every report returns the same tabular shape so the client can
// preview, print and export any of them:
//   { type, title, subtitle, columns: [{ key, label, align? }], rows: [{...}], summary: [{ label, value }] }
const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');
const { getSettings } = require('../lib/settings');
const { syncAlerts } = require('../lib/alerts');
const { logActivity } = require('../lib/log');
const { learnerWhere, sectionWhere, assertSection, optInt } = require('../lib/scope');
const { learnerMetrics, competencyStats, attendanceRate, dayStatus, learnerDays, totals, dailySeries, round1, avg, STATUS_ORDER } = require('../lib/metrics');
const { parseMonth, parseDay, dayKey, addDays, dateOnly, isoWeekdayUtc, schoolYearStart } = require('../lib/time');
const { learnerName, learnerRow } = require('../lib/shape');

const router = express.Router();
router.use(authenticate);

const MONITORING = { ON_TRACK: 'On Track', MONITOR: 'Monitor', AT_RISK: 'At Risk' };
const LEVEL = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const ALERT_STATUS = { OPEN: 'Open', FOLLOWED_UP: 'Followed up', RESOLVED: 'Resolved' };
const TYPE = { QUIZ: 'Quiz', PERFORMANCE_TASK: 'Performance Task', QUARTERLY_EXAM: 'Quarterly Exam' };
const pct = (v) => (v === null || v === undefined ? '-' : `${v}%`);
const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

async function scopeLabel(user, sectionId) {
  if (sectionId) return (await assertSection(user, sectionId)).name;
  return user.role === 'ADMIN' ? 'All sections' : 'My sections';
}

/** SF2-inspired daily attendance grid for one section and month. */
async function sf2(user, q, settings) {
  let sectionId = optInt(q.sectionId);
  if (!sectionId) {
    const first = await prisma.section.findFirst({ where: sectionWhere(user), orderBy: { name: 'asc' } });
    if (!first) throw new HttpError(400, 'No sections assigned');
    sectionId = first.id;
  }
  const section = await assertSection(user, sectionId);
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
    where: { learnerId: { in: learners.map((l) => l.id) }, date: { gte: from, lte: to } },
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
    title: 'School Form 2 (SF2) — Daily Attendance Report of Learners',
    subtitle: `${settings.schoolName} · ${section.name} · ${monthLabel(from)} · Adviser: ${teacher ? `${teacher.firstName} ${teacher.lastName}` : '-'}`,
    legend: 'Day status from the class-period records · Blank = present · x = absent all day · L = late/tardy · E = excused · C = in school but missed some periods',
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
 * for every class period that day, with the subject, time and room of each period.
 */
async function dtr(user, q, settings) {
  let sectionId = optInt(q.sectionId);
  if (!sectionId) {
    const first = await prisma.section.findFirst({ where: sectionWhere(user), orderBy: { name: 'asc' } });
    if (!first) throw new HttpError(400, 'No sections assigned');
    sectionId = first.id;
  }
  const section = await assertSection(user, sectionId);
  const date = parseDay(q.date);
  const dow = isoWeekdayUtc(date);
  const periods = await prisma.classSchedule.findMany({
    where: { sectionId: section.id, dayOfWeek: dow },
    include: { subject: true, teacher: true },
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
    title: 'Daily Time Record (DTR) — Class Attendance',
    subtitle: `${settings.schoolName} · ${section.name} · ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`,
    legend: `Cells show time in (L = late, more than ${settings.lateGraceMinutes} min after the period starts). Blank = not yet recorded.`,
    columns: [
      { key: 'no', label: 'No.', align: 'right' },
      { key: 'name', label: "Learner's Name" },
      { key: 'sex', label: 'Sex' },
      ...periods.map((per) => ({
        key: `p${per.id}`,
        label: `${label(per.startTime)}–${label(per.endTime)}`,
        sub: `${per.subject.name} · ${per.room}${per.teacher ? ` · ${per.teacher.lastName}` : ''}`,
        align: 'center',
      })),
      { key: 'day', label: 'Day status' },
    ],
    rows: periods.length ? [...rows, totalRow] : [],
    summary: [
      { label: 'Class periods', value: periods.length || `None on ${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dow]}` },
      { label: 'Learners', value: learners.length },
      { label: 'Period attendance', value: recorded ? pct(round1((attended / recorded) * 100)) : '-' },
      { label: 'Absent all day', value: rows.filter((r) => r.day === 'Absent').length },
      { label: 'Partial days', value: rows.filter((r) => String(r.day).startsWith('Partial')).length },
    ],
  };
}

/** Attendance summary per learner for a month (or the whole school year). */
async function attendance(user, q, settings) {
  const sectionId = optInt(q.sectionId);
  const whole = q.month === 'year';
  const [from, to] = whole ? [schoolYearStart(settings.academicYear), dateOnly()] : parseMonth(q.month);
  const lw = learnerWhere(user, { sectionId });
  const learners = await prisma.learner.findMany({ where: lw, include: { section: true }, orderBy: [{ section: { name: 'asc' } }, { lastName: 'asc' }] });
  const metrics = await learnerMetrics(learners, settings, { from, to });
  const series = await dailySeries(lw, from, to);
  const t = totals(series);

  // Weekly breakdown for the summary panel
  const weeks = new Map();
  for (const d of series) {
    const day = new Date(`${d.date}T00:00:00Z`);
    const key = dayKey(addDays(day, 1 - (day.getUTCDay() || 7)));
    const list = weeks.get(key) ?? [];
    list.push(d);
    weeks.set(key, list);
  }

  return {
    title: whole ? 'Attendance Summary — School Year' : 'Attendance Summary — Monthly',
    subtitle: `${await scopeLabel(user, sectionId)} · ${whole ? settings.academicYear : monthLabel(from)}`,
    columns: [
      { key: 'learnerNo', label: 'Learner ID' },
      { key: 'name', label: 'Learner' },
      { key: 'section', label: 'Section' },
      { key: 'days', label: 'Days', align: 'right' },
      { key: 'present', label: 'Present', align: 'right' },
      { key: 'late', label: 'Late', align: 'right' },
      { key: 'absent', label: 'Absent', align: 'right' },
      { key: 'excused', label: 'Excused', align: 'right' },
      { key: 'partial', label: 'Partial days', align: 'right' },
      { key: 'missed', label: 'Periods missed', align: 'right' },
      { key: 'rate', label: 'Period rate', align: 'right' },
    ],
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
      };
    }),
    summary: [
      { label: 'School days', value: series.length },
      { label: 'Period attendance rate', value: pct(t.rate) },
      { label: 'Whole-day absences', value: t.absent },
      { label: 'Late days', value: t.late },
      { label: 'Partial days', value: t.partial },
      ...[...weeks].map(([week, list]) => ({ label: `Week of ${week}`, value: pct(totals(list).rate) })),
    ],
  };
}

async function competency(user, q, settings) {
  const sectionId = optInt(q.sectionId);
  const quarter = optInt(q.quarter);
  const learners = await prisma.learner.findMany({ where: learnerWhere(user, { sectionId }), select: { id: true, sectionId: true } });
  const metrics = await learnerMetrics(learners, settings, { quarter });
  const stats = competencyStats(metrics, settings);
  const comps = await prisma.competency.findMany({ where: { active: true, ...(quarter && { quarter }) }, orderBy: [{ learningArea: 'asc' }, { code: 'asc' }] });
  const rows = comps.map((c) => {
    const s = stats.get(c.id);
    return {
      code: c.code,
      learningArea: c.learningArea,
      title: c.title,
      quarter: `Q${c.quarter}`,
      assessed: s?.assessed ?? 0,
      mastered: s?.MASTERED ?? 0,
      inProgress: s?.IN_PROGRESS ?? 0,
      needsSupport: s?.NEEDS_SUPPORT ?? 0,
      average: pct(s?.average),
      mastery: pct(s?.masteryRate),
      status: s ? (s.masteryRate >= settings.masteryTarget ? 'On Track' : s.masteryRate >= settings.masteryTarget - 15 ? 'Monitor' : 'Needs Support') : 'Not assessed',
    };
  });
  const rates = [...stats.values()].map((s) => s.masteryRate).filter((r) => r !== null);
  return {
    title: 'Competency Report — Progress & Mastery',
    subtitle: `${await scopeLabel(user, sectionId)} · ${quarter ? `Quarter ${quarter}` : 'All quarters'} · Mastery target ${settings.masteryTarget}%`,
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'learningArea', label: 'Learning Area' },
      { key: 'title', label: 'Competency' },
      { key: 'quarter', label: 'Qtr' },
      { key: 'assessed', label: 'Assessed', align: 'right' },
      { key: 'mastered', label: 'Mastered', align: 'right' },
      { key: 'inProgress', label: 'In Progress', align: 'right' },
      { key: 'needsSupport', label: 'Needs Support', align: 'right' },
      { key: 'average', label: 'Average', align: 'right' },
      { key: 'mastery', label: 'Mastery', align: 'right' },
      { key: 'status', label: 'Status' },
    ],
    rows,
    summary: [
      { label: 'Competencies', value: comps.length },
      { label: 'Average mastery rate', value: rates.length ? pct(round1(avg(rates))) : '-' },
      { label: 'Need reteaching', value: rows.filter((r) => r.status === 'Needs Support').length },
    ],
  };
}

async function assessment(user, q, settings) {
  const sectionId = optInt(q.sectionId);
  const quarter = optInt(q.quarter);
  const list = await prisma.assessment.findMany({
    where: { ...(quarter && { quarter }), section: { ...sectionWhere(user), ...(sectionId && { id: sectionId }) } },
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
    subtitle: `${await scopeLabel(user, sectionId)} · ${quarter ? `Quarter ${quarter}` : 'All quarters'}`,
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'title', label: 'Assessment' },
      { key: 'type', label: 'Type' },
      { key: 'competency', label: 'Competency' },
      { key: 'learningArea', label: 'Learning Area' },
      { key: 'section', label: 'Section' },
      { key: 'maxScore', label: 'Max', align: 'right' },
      { key: 'average', label: 'Average', align: 'right' },
      { key: 'passed', label: 'Passed', align: 'right' },
      { key: 'highest', label: 'Highest', align: 'right' },
      { key: 'lowest', label: 'Lowest', align: 'right' },
    ],
    rows,
    summary: [
      { label: 'Assessments', value: list.length },
      { label: 'Scores recorded', value: all.length },
      { label: 'Overall average', value: pct(all.length ? round1(avg(all)) : null) },
      { label: 'Pass rate', value: pct(all.length ? round1((all.filter((x) => x >= settings.masteryTarget).length / all.length) * 100) : null) },
    ],
  };
}

async function performance(user, q, settings, { consolidated = false } = {}) {
  const sectionId = optInt(q.sectionId);
  const learners = await prisma.learner.findMany({ where: learnerWhere(user, { sectionId }), include: { section: true }, orderBy: [{ lastName: 'asc' }] });
  const metrics = await learnerMetrics(learners, settings);
  const openAlerts = await prisma.alert.groupBy({ by: ['learnerId'], where: { status: { not: 'RESOLVED' }, learnerId: { in: learners.map((l) => l.id) } }, _count: { _all: true } });
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
    : ['learnerNo', 'name', 'section', 'attendance', 'average', 'descriptor', 'status', 'action'];
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
    title: consolidated ? 'Consolidated Report — Attendance + Performance' : 'Learner Performance Report — Analytics',
    subtitle: `${await scopeLabel(user, sectionId)} · ${settings.academicYear}`,
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

async function alerts(user, q) {
  await syncAlerts();
  const sectionId = optInt(q.sectionId);
  const items = await prisma.alert.findMany({
    where: { section: { ...sectionWhere(user), ...(sectionId && { id: sectionId }) }, ...(q.status === 'all' ? {} : { status: { not: 'RESOLVED' } }) },
    include: { learner: true, section: true, followUpBy: true },
    orderBy: [{ level: 'asc' }, { updatedAt: 'desc' }],
  });
  const count = (level) => items.filter((a) => a.level === level).length;
  return {
    title: 'Instructional Alerts — Summary',
    subtitle: `${await scopeLabel(user, sectionId)} · ${q.status === 'all' ? 'All alerts' : 'Open and followed-up alerts'}`,
    columns: [
      { key: 'level', label: 'Level' },
      { key: 'title', label: 'Issue' },
      { key: 'learner', label: 'Learner' },
      { key: 'section', label: 'Section' },
      { key: 'detail', label: 'Detail' },
      { key: 'action', label: 'Recommended Action' },
      { key: 'status', label: 'Status' },
      { key: 'followUp', label: 'Follow-up' },
      { key: 'date', label: 'Updated' },
    ],
    rows: items.map((a) => ({
      level: LEVEL[a.level],
      title: a.title,
      learner: a.learner ? learnerName(a.learner) : '(whole class)',
      section: a.section?.name ?? '-',
      detail: a.detail,
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
  competency,
  assessment,
  performance: (u, q, s) => performance(u, q, s),
  alerts,
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
