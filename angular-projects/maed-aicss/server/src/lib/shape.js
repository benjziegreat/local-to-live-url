// Public JSON shapes shared by several routes.

function learnerName(l) {
  return `${l.lastName}, ${l.firstName}`;
}

/** A learner row with monitoring metrics (dashboard table, learner directory, reports). */
function learnerRow(l, m) {
  return {
    id: l.id,
    learnerNo: l.learnerNo,
    lrn: l.lrn ?? null,
    name: learnerName(l),
    firstName: l.firstName,
    lastName: l.lastName,
    sex: l.sex,
    sectionId: l.sectionId,
    section: l.section?.name ?? null,
    status: l.status,
    avatarHue: l.avatarHue,
    attendanceRate: m?.attendanceRate ?? null,
    present: m?.present ?? 0,
    late: m?.late ?? 0,
    absent: m?.absent ?? 0,
    excused: m?.excused ?? 0,
    recentAbsences: m?.recentAbsences ?? 0,
    partialDays: m?.partialDays ?? 0,
    recentPartial: m?.recentPartial ?? 0,
    assessmentAvg: m?.assessmentAvg ?? null,
    assessmentCount: m?.assessmentCount ?? 0,
    descriptor: m?.descriptor ?? 'No scores yet',
    monitoring: m?.status ?? 'ON_TRACK',
    action: m?.action ?? '',
  };
}

function alertRow(a) {
  return {
    id: a.id,
    type: a.type,
    level: a.level,
    title: a.title,
    detail: a.detail,
    action: a.action,
    status: a.status,
    learnerId: a.learnerId,
    learner: a.learner ? learnerName(a.learner) : null,
    learnerNo: a.learner?.learnerNo ?? null,
    sectionId: a.sectionId,
    section: a.section?.name ?? null,
    subjectId: a.subjectId ?? null,
    subject: a.subject?.name ?? null,
    intervention: a.intervention ?? null,
    competencyId: a.competencyId ?? null,
    competency: a.competency ? `${a.competency.code}: ${a.competency.learningArea}` : null,
    competencyCode: a.competency?.code ?? null,
    competencyTitle: a.competency?.title ?? null,
    followUpNote: a.followUpNote,
    followUpBy: a.followUpBy ? `${a.followUpBy.firstName} ${a.followUpBy.lastName}` : null,
    followUpAt: a.followUpAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

const ALERT_INCLUDE = { learner: true, section: true, competency: true, subject: true, followUpBy: true };

const INTERVENTION_LABEL = { RETEACHING: 'Reteaching', REMEDIATION: 'Remediation', ENRICHMENT: 'Enrichment', CATCH_UP: 'Catch-up', ATTENDANCE: 'Attendance follow-up' };

/** The school year has three terms (stored as `quarter`): 1 -> "1st Term". */
function termLabel(n) {
  return n ? `${{ 1: '1st', 2: '2nd', 3: '3rd' }[n] ?? `${n}th`} Term` : '-';
}

module.exports = { learnerName, learnerRow, alertRow, ALERT_INCLUDE, INTERVENTION_LABEL, termLabel };
