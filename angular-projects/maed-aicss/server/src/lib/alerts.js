// Instructional alerts generated from attendance, competency and assessment data.
//
// Rules (thresholds come from SchoolSetting). Whole-day attendance alerts concern every
// subject; all other alerts carry the subject (and competency) they are about.
//
//   Whole day (all subjects)
//     HIGH    Frequent absences        whole-day absences (last 30 school days) >= absenceAlertThreshold, or attendance < target - 10
//     MEDIUM  Missed class periods     partial days (present but absent from some periods) >= missedClassThreshold
//   Per subject
//     MEDIUM  Absences in a subject    absences from the subject's periods (last 30 school days) >= absenceAlertThreshold
//                                      (only when the learner has no whole-day absence alert, which already covers it)
//     MEDIUM  Below target             subject average < masteryTarget
//     MEDIUM  Competency not mastered  subject average passing but a competency average < masteryTarget - 10
//   Per competency (learner)
//     MEDIUM  Missed lessons           absent from >= 2 (and >= 25%) of the lessons on a competency not yet mastered
//     MEDIUM  Limited improvement      post-test below target and gain < minLearningGain (no change or decline included)
//     LOW     Low pre-test             pre-test < pretestLowThreshold, post-test not yet given
//     LOW     Ready for enrichment     pre-test >= 90%, post-test not yet given
//   Per competency (whole class)
//     LOW     Needs reteaching         section mastery rate < reteachThreshold
//     LOW     Low learning gain        class average gain < minLearningGain
//     LOW     Low class readiness      half the class below pretestLowThreshold on a pre-test (post-test pending)
//
// Each alert has a stable key, so syncing updates existing rows. Alerts whose
// condition clears are resolved automatically; alerts a teacher resolved by hand stay resolved.
const prisma = require('./prisma');
const { getSettings } = require('./settings');
const { learnerMetrics, competencyStats, subjectBreakdown, missedLessons, recentWindowStart, round1, avg } = require('./metrics');
const { loadPrePost } = require('./prepost');

const MIN_INTERVAL_MS = 60_000;
let lastRun = 0;
let running = null;

function invalidateAlerts() {
  lastRun = 0;
}

async function buildDesired() {
  const settings = await getSettings();
  const [learners, competencies, sections, subjects] = await Promise.all([
    prisma.learner.findMany({ where: { status: 'ACTIVE' }, select: { id: true, sectionId: true, firstName: true, lastName: true } }),
    prisma.competency.findMany(),
    prisma.section.findMany(),
    prisma.subject.findMany(),
  ]);
  const compById = new Map(competencies.map((c) => [c.id, c]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const subjectName = (id) => subjectById.get(id)?.name ?? 'the subject';
  const ids = learners.map((l) => l.id);
  const windowStart = await recentWindowStart(30);
  const [metrics, bySubject, lessons, prePost] = await Promise.all([
    learnerMetrics(learners, settings),
    subjectBreakdown(ids, settings, windowStart),
    missedLessons({ learnerIds: ids }),
    loadPrePost({ academicYear: settings.academicYear }, settings),
  ]);
  const desired = [];

  for (const l of learners) {
    const m = metrics.get(l.id);
    const name = `${l.firstName} ${l.lastName}`;
    const att = m.attendanceRate;
    const wholeDay = m.recentAbsences >= settings.absenceAlertThreshold || (att !== null && att < settings.attendanceTarget - 10);

    if (wholeDay) {
      desired.push({
        key: `ABS:L${l.id}`,
        type: 'FREQUENT_ABSENCE',
        level: 'HIGH',
        intervention: 'ATTENDANCE',
        title: 'Frequent absences',
        detail: `${name} was absent the whole day ${m.recentAbsences} time(s) in the last 30 school days; overall period attendance is ${att ?? '-'}%.`,
        action: 'Check attendance and contact the parent/guardian. Consider a parent conference and an attendance plan; give catch-up activities for missed lessons.',
        learnerId: l.id,
        sectionId: l.sectionId,
      });
    }

    if (m.recentPartial >= settings.missedClassThreshold) {
      desired.push({
        key: `CUT:L${l.id}`,
        type: 'MISSED_CLASSES',
        level: 'MEDIUM',
        intervention: 'ATTENDANCE',
        title: 'Missed class periods',
        detail: `${name} was in school but missed ${m.recentMissedPeriods} class period(s) on ${m.recentPartial} day(s) in the last 30 school days.`,
        action: 'Verify with the subject teachers and talk with the learner about skipped classes; inform the parent/guardian if it continues.',
        learnerId: l.id,
        sectionId: l.sectionId,
      });
    }

    for (const [subjectId, s] of bySubject.get(l.id) ?? []) {
      if (!subjectId) continue;
      const subj = subjectName(subjectId);
      if (!wholeDay && s.recentAbsent >= settings.absenceAlertThreshold) {
        desired.push({
          key: `SABS:L${l.id}:S${subjectId}`,
          type: 'SUBJECT_ABSENCE',
          level: 'MEDIUM',
          intervention: 'CATCH_UP',
          title: `Frequent absences in ${subj}`,
          detail: `${name} missed ${s.recentAbsent} of ${s.recentPeriods} ${subj} class(es) in the last 30 school days; ${subj} attendance is ${s.rate ?? '-'}%.`,
          action: `Talk with the learner about missing ${subj}, provide catch-up activities for the lessons missed, and inform the parent/guardian if it continues.`,
          learnerId: l.id,
          sectionId: l.sectionId,
          subjectId,
        });
      }
      if (s.average !== null && s.average < settings.masteryTarget) {
        desired.push({
          key: `LOW:L${l.id}:S${subjectId}`,
          type: 'BELOW_TARGET',
          level: 'MEDIUM',
          intervention: 'REMEDIATION',
          title: `Below target in ${subj}`,
          detail: `${name} is averaging ${s.average}% in ${subj} against a ${settings.masteryTarget}% target.`,
          action: `Provide remediation in ${subj}: reteach the least-mastered competencies in a small group and give additional practice.`,
          learnerId: l.id,
          sectionId: l.sectionId,
          subjectId,
        });
      } else {
        const gaps = [...s.competencyAvg].filter(([, score]) => score < settings.masteryTarget - 10).map(([id]) => compById.get(id)).filter(Boolean);
        if (gaps.length) {
          desired.push({
            key: `CNM:L${l.id}:S${subjectId}`,
            type: 'COMPETENCY_NOT_MASTERED',
            level: 'MEDIUM',
            intervention: 'REMEDIATION',
            title: gaps.length === 1 ? `Competency not yet mastered (${subj})` : `${gaps.length} ${subj} competencies not yet mastered`,
            detail: `${name}: ${gaps.map((c) => c.code).join(', ')}.`,
            action: 'Assign remediation activities for the listed competencies, then reassess.',
            learnerId: l.id,
            sectionId: l.sectionId,
            subjectId,
            competencyId: gaps.length === 1 ? gaps[0].id : null,
          });
        }
      }
    }

    // Lessons missed through absence, for competencies the learner has not yet mastered
    for (const [competencyId, missed] of lessons.missed.get(l.id) ?? []) {
      const c = compById.get(competencyId);
      const taught = lessons.taught.get(`${l.sectionId}|${competencyId}`) ?? 0;
      if (!c || missed < Math.max(2, Math.ceil(taught * 0.25))) continue;
      const score = m.competencyAvg.get(competencyId);
      if (score !== undefined && score >= settings.masteryTarget) continue;
      desired.push({
        key: `MISS:L${l.id}:C${competencyId}`,
        type: 'MISSED_LESSONS',
        level: 'MEDIUM',
        intervention: 'CATCH_UP',
        title: `Missed lessons on ${c.code}`,
        detail: `${name} was absent from ${missed} of ${taught} ${c.learningArea} lesson(s) on ${c.code}: ${c.title}${score === undefined ? '' : ` Current result: ${score}%.`}`,
        action: `Provide catch-up activities for ${c.code} (learning packet, peer tutoring or a make-up session) before the post-test.`,
        learnerId: l.id,
        sectionId: l.sectionId,
        subjectId: c.subjectId,
        competencyId,
      });
    }
  }

  // Competency-level pre-test / post-test results
  for (const r of prePost.records) {
    const base = { learnerId: r.learnerId, sectionId: r.sectionId, subjectId: r.subjectId, competencyId: r.competencyId };
    if (r.postPct === null && r.prePct !== null) {
      if (r.prePct < settings.pretestLowThreshold) {
        desired.push({
          ...base,
          key: `PRE:L${r.learnerId}:C${r.competencyId}`,
          type: 'LOW_PRETEST',
          level: 'LOW',
          intervention: 'REMEDIATION',
          title: `Low pre-test score (${r.competencyCode})`,
          detail: `${r.learner} scored ${r.preScore}/${r.preTotal} (${r.prePct}%) on the ${r.subject} pre-test for ${r.competencyCode}: ${r.competencyTitle}`,
          action: `Remediate prerequisite skills for ${r.competencyCode} during instruction (scaffolded tasks, guided practice) and check progress before the post-test.`,
        });
      } else if (r.prePct >= 90) {
        desired.push({
          ...base,
          key: `ENR:L${r.learnerId}:C${r.competencyId}`,
          type: 'ENRICHMENT',
          level: 'LOW',
          intervention: 'ENRICHMENT',
          title: `Ready for enrichment (${r.competencyCode})`,
          detail: `${r.learner} already scored ${r.prePct}% on the ${r.competencyCode} pre-test before instruction.`,
          action: `Provide enrichment for ${r.competencyCode}: advanced tasks, extension projects or peer-mentoring roles.`,
        });
      }
    }
    if (r.gain !== null && r.postPct < settings.masteryTarget && r.gain < settings.minLearningGain) {
      desired.push({
        ...base,
        key: `GAIN:L${r.learnerId}:C${r.competencyId}`,
        type: 'LIMITED_GAIN',
        level: 'MEDIUM',
        intervention: 'REMEDIATION',
        title: r.gain < 0 ? `Post-test declined (${r.competencyCode})` : r.gain === 0 ? `No improvement after instruction (${r.competencyCode})` : `Limited improvement (${r.competencyCode})`,
        detail: `${r.learner}: pre-test ${r.prePct}% → post-test ${r.postPct}% (${r.gain >= 0 ? '+' : ''}${r.gain} points) on ${r.competencyCode}, ${r.subject}.`,
        action: `Provide remediation for ${r.competencyCode}: reteach in a small group using a different strategy, then give a short reassessment.`,
      });
    }
  }

  // Whole-class pre/post patterns
  const byTest = new Map();
  for (const r of prePost.records) byTest.set(r.testId, [...(byTest.get(r.testId) ?? []), r]);
  for (const t of prePost.tests) {
    const list = byTest.get(t.id) ?? [];
    const c = t.competency;
    const both = list.filter((r) => r.gain !== null);
    const base = { sectionId: t.sectionId, subjectId: c.subjectId, competencyId: c.id };
    if (both.length >= 5) {
      const gain = round1(avg(both.map((r) => r.gain)));
      if (gain < settings.minLearningGain) {
        desired.push({
          ...base,
          key: `CLG:S${t.sectionId}:C${c.id}`,
          type: 'CLASS_LOW_GAIN',
          level: 'LOW',
          intervention: 'RETEACHING',
          title: 'Low class learning gain',
          detail: `${t.section.name} gained only ${gain} points on average from pre-test to post-test on ${c.code}: ${c.title}`,
          action: `Review how ${c.code} was taught; reteach the whole class with a different approach, then reassess.`,
        });
      }
    }
    const pre = list.filter((r) => r.prePct !== null && r.postPct === null);
    if (pre.length >= 5 && pre.filter((r) => r.prePct < settings.pretestLowThreshold).length / pre.length >= 0.5) {
      desired.push({
        ...base,
        key: `CPRE:S${t.sectionId}:C${c.id}`,
        type: 'CLASS_LOW_PRETEST',
        level: 'LOW',
        intervention: 'RETEACHING',
        title: 'Many learners low on pre-test',
        detail: `${pre.filter((r) => r.prePct < settings.pretestLowThreshold).length} of ${pre.length} learners in ${t.section.name} scored below ${settings.pretestLowThreshold}% on the ${c.code} pre-test.`,
        action: `Review prerequisite skills with the whole class and plan scaffolded instruction for ${c.code}.`,
      });
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
      intervention: 'RETEACHING',
      title: 'Competency needs reteaching',
      detail: `Only ${s.masteryRate}% of ${section?.name ?? 'the section'} mastered ${c.code}: ${c.title}`,
      action: `Reteach ${c.learningArea} (${c.code}) with the whole class, then reassess.`,
      sectionId: s.sectionId,
      subjectId: c.subjectId,
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
    const changed =
      current.detail !== d.detail ||
      current.title !== d.title ||
      current.level !== d.level ||
      current.type !== d.type ||
      current.intervention !== d.intervention ||
      (current.subjectId ?? null) !== (d.subjectId ?? null) ||
      (current.competencyId ?? null) !== (d.competencyId ?? null);
    if (reopen || changed) {
      ops.push(
        prisma.alert.update({
          where: { id: current.id },
          data: {
            type: d.type,
            title: d.title,
            detail: d.detail,
            action: d.action,
            level: d.level,
            intervention: d.intervention,
            subjectId: d.subjectId ?? null,
            competencyId: d.competencyId ?? null,
            ...(reopen && { status: 'OPEN', followUpNote: null, followUpAt: null }),
          },
        }),
      );
    }
  }
  for (const a of existing) {
    if (!wanted.has(a.key) && a.status !== 'RESOLVED') {
      ops.push(
        prisma.alert.update({
          where: { id: a.id },
          data: {
            status: 'RESOLVED',
            followUpById: null,
            followUpAt: new Date(),
            // Keep a teacher's earlier note in the history
            followUpNote: a.followUpNote && a.followUpById ? `${a.followUpNote} · Condition cleared automatically.` : 'Condition cleared automatically.',
          },
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
