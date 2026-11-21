// Instructional alerts generated from attendance and assessment data.
//
// Rules (thresholds come from SchoolSetting):
//   HIGH    Frequent absences       whole-day absences (last 30 school days) >= absenceAlertThreshold, or attendance < target - 10
//   MEDIUM  Missed class periods    partial days (present but absent from some periods) >= missedClassThreshold
//   MEDIUM  Below assessment target average score < masteryTarget
//   MEDIUM  Competency not mastered passing overall but a competency average < masteryTarget - 10
//   LOW     Needs reteaching        a section's mastery rate on a competency < reteachThreshold
//
// Each alert has a stable key, so syncing updates existing rows. Alerts whose
// condition clears are resolved automatically; alerts a teacher resolved by hand stay resolved.
const prisma = require('./prisma');
const { getSettings } = require('./settings');
const { learnerMetrics, competencyStats } = require('./metrics');

const MIN_INTERVAL_MS = 60_000;
let lastRun = 0;
let running = null;

function invalidateAlerts() {
  lastRun = 0;
}

async function buildDesired() {
  const settings = await getSettings();
  const [learners, competencies, sections] = await Promise.all([
    prisma.learner.findMany({ where: { status: 'ACTIVE' }, select: { id: true, sectionId: true, firstName: true, lastName: true } }),
    prisma.competency.findMany(),
    prisma.section.findMany(),
  ]);
  const compById = new Map(competencies.map((c) => [c.id, c]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const metrics = await learnerMetrics(learners, settings);
  const desired = [];

  for (const l of learners) {
    const m = metrics.get(l.id);
    const name = `${l.firstName} ${l.lastName}`;
    const att = m.attendanceRate;

    if (m.recentAbsences >= settings.absenceAlertThreshold || (att !== null && att < settings.attendanceTarget - 10)) {
      desired.push({
        key: `ABS:L${l.id}`,
        type: 'FREQUENT_ABSENCE',
        level: 'HIGH',
        title: 'Frequent absences',
        detail: `${name} was absent the whole day ${m.recentAbsences} time(s) in the last 30 school days; overall period attendance is ${att ?? '-'}%.`,
        action: 'Check attendance and contact the parent/guardian. Consider a parent conference and an attendance plan.',
        learnerId: l.id,
        sectionId: l.sectionId,
      });
    }

    if (m.recentPartial >= settings.missedClassThreshold) {
      desired.push({
        key: `CUT:L${l.id}`,
        type: 'MISSED_CLASSES',
        level: 'MEDIUM',
        title: 'Missed class periods',
        detail: `${name} was in school but missed ${m.recentMissedPeriods} class period(s) on ${m.recentPartial} day(s) in the last 30 school days.`,
        action: 'Verify with the subject teachers and talk with the learner about skipped classes; inform the parent/guardian if it continues.',
        learnerId: l.id,
        sectionId: l.sectionId,
      });
    }

    if (m.assessmentAvg !== null && m.assessmentAvg < settings.masteryTarget) {
      desired.push({
        key: `LOW:L${l.id}`,
        type: 'BELOW_TARGET',
        level: 'MEDIUM',
        title: 'Assessment below target',
        detail: `${name} is averaging ${m.assessmentAvg}% against a ${settings.masteryTarget}% target.`,
        action: 'Provide reteaching and additional practice activities.',
        learnerId: l.id,
        sectionId: l.sectionId,
      });
    } else {
      const gaps = [...m.competencyAvg].filter(([, score]) => score < settings.masteryTarget - 10).map(([id]) => compById.get(id));
      if (gaps.length) {
        desired.push({
          key: `CNM:L${l.id}`,
          type: 'COMPETENCY_NOT_MASTERED',
          level: 'MEDIUM',
          title: gaps.length === 1 ? 'Competency not yet mastered' : `${gaps.length} competencies not yet mastered`,
          detail: `${name}: ${gaps.map((c) => `${c.code} (${c.learningArea})`).join(', ')}.`,
          action: 'Assign supplementary activities for the listed competencies.',
          learnerId: l.id,
          sectionId: l.sectionId,
          competencyId: gaps.length === 1 ? gaps[0].id : null,
        });
      }
    }
  }

  const stats = competencyStats(metrics, settings, { bySection: true });
  for (const s of stats.values()) {
    if (s.assessed < 5 || s.masteryRate >= settings.reteachThreshold) continue;
    const c = compById.get(s.competencyId);
    const section = sectionById.get(s.sectionId);
    desired.push({
      key: `RT:S${s.sectionId}:C${s.competencyId}`,
      type: 'NEEDS_RETEACHING',
      level: 'LOW',
      title: 'Competency needs reteaching',
      detail: `Only ${s.masteryRate}% of ${section?.name ?? 'the section'} mastered ${c.code}: ${c.title}`,
      action: `Reteach ${c.learningArea} (${c.code}) with the whole class, then reassess.`,
      sectionId: s.sectionId,
      competencyId: s.competencyId,
    });
  }
  return desired;
}

async function runSync() {
  const settings = await getSettings();
  if (!settings.enableAlerts) return;
  const desired = await buildDesired();
  const existing = await prisma.alert.findMany();
  const byKey = new Map(existing.map((a) => [a.key, a]));
  const wanted = new Set(desired.map((d) => d.key));
  const ops = [];

  for (const d of desired) {
    const current = byKey.get(d.key);
    if (!current) {
      ops.push(prisma.alert.create({ data: d }));
      continue;
    }
    const reopen = current.status === 'RESOLVED' && !current.followUpById;
    if (reopen || current.detail !== d.detail || current.title !== d.title || current.level !== d.level) {
      ops.push(
        prisma.alert.update({
          where: { id: current.id },
          data: { title: d.title, detail: d.detail, action: d.action, level: d.level, competencyId: d.competencyId ?? null, ...(reopen && { status: 'OPEN', followUpNote: null, followUpAt: null }) },
        }),
      );
    }
  }
  for (const a of existing) {
    if (!wanted.has(a.key) && a.status !== 'RESOLVED') {
      ops.push(
        prisma.alert.update({
          where: { id: a.id },
          data: { status: 'RESOLVED', followUpById: null, followUpAt: new Date(), followUpNote: 'Condition cleared automatically.' },
        }),
      );
    }
  }
  if (ops.length) await prisma.$transaction(ops);
}

/** Recompute alerts if stale (or `force`). Concurrent callers share one run. */
async function syncAlerts(force = false) {
  if (!force && Date.now() - lastRun < MIN_INTERVAL_MS) return;
  if (!running) {
    running = runSync()
      .then(() => {
        lastRun = Date.now();
      })
      .finally(() => {
        running = null;
      });
  }
  await running;
}

module.exports = { syncAlerts, invalidateAlerts };
