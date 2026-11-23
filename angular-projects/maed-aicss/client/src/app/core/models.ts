export type Role = 'TEACHER' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'INACTIVE';
export type Monitoring = 'ON_TRACK' | 'MONITOR' | 'AT_RISK';
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';
export type AlertLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type AlertStatus = 'OPEN' | 'FOLLOWED_UP' | 'RESOLVED';
export type AssessmentType = 'QUIZ' | 'PERFORMANCE_TASK' | 'QUARTERLY_EXAM';
export type Band = 'MASTERED' | 'IN_PROGRESS' | 'NEEDS_SUPPORT';
export type AreaStatus = 'ON_TRACK' | 'MONITOR' | 'NEEDS_SUPPORT' | 'NO_DATA';
export type Intervention = 'RETEACHING' | 'REMEDIATION' | 'ENRICHMENT' | 'CATCH_UP' | 'ATTENDANCE';
export type Completion = 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED';
export type Change = 'IMPROVED' | 'MAINTAINED' | 'DECLINED' | 'PENDING' | 'NO_PRETEST';

/** One option of the shared subject filter. */
export interface SubjectOption {
  id: number;
  code: string;
  name: string;
  kind: SubjectKind;
  /** The signed-in teacher teaches this subject (false = advisory-section subject) */
  teaches: boolean;
}

export interface SubjectOptions {
  /** Whether the "All subjects" overall view is available (admins and advisers) */
  allowAll: boolean;
  subjects: SubjectOption[];
}

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  role: Role;
  status: AccountStatus;
  avatarHue: number;
  lastLoginAt: string | null;
  createdAt: string;
  sections?: string[];
}

export interface SectionRef {
  id: number;
  name: string;
}

export interface SectionInfo extends SectionRef {
  gradeLevel: number;
  strand: string;
  room: string | null;
  electiveId: number | null;
  elective: string | null;
  teacherId: number | null;
  teacher: string | null;
  learners: number;
  classes: number;
}

export type SubjectKind = 'CORE' | 'ELECTIVE' | 'PROGRAM';

export interface Subject {
  id: number;
  code: string;
  name: string;
  kind: SubjectKind;
  track: string | null;
  defaultRoom: string | null;
  active: boolean;
  sections: number;
  classes: number;
}

export interface ClassSchedule {
  id: number;
  sectionId: number;
  section: string | null;
  subjectId: number;
  subjectKind: SubjectKind | null;
  learningArea: string;
  teacherId: number | null;
  teacher: string | null;
  /** 1 = Monday ... 6 = Saturday */
  dayOfWeek: number;
  day: string;
  startTime: string;
  endTime: string;
  room: string;
}

export interface ScheduleInput {
  sectionId: number;
  subjectId: number | null;
  teacherId: number | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room: string;
}

/** Day-level learner counts plus period-level totals. `rate` = periods attended / periods recorded. */
export interface Counts {
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Learners present that day but absent from at least one period */
  partial: number;
  periodsTotal: number;
  periodsAttended: number;
  total: number;
  rate: number | null;
}

export interface DayPoint extends Counts {
  date: string;
}

export interface MonthPoint extends Counts {
  month: string;
  days: number;
}

export interface LearnerRow {
  id: number;
  learnerNo: string;
  lrn: string | null;
  name: string;
  firstName: string;
  lastName: string;
  sex: 'M' | 'F';
  sectionId: number;
  section: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  avatarHue: number;
  attendanceRate: number | null;
  present: number;
  late: number;
  absent: number;
  excused: number;
  recentAbsences: number;
  partialDays: number;
  recentPartial: number;
  assessmentAvg: number | null;
  assessmentCount: number;
  descriptor: string;
  monitoring: Monitoring;
  action: string;
}

export interface AlertItem {
  id: number;
  type: string;
  level: AlertLevel;
  title: string;
  detail: string;
  action: string;
  status: AlertStatus;
  learnerId: number | null;
  learner: string | null;
  learnerNo: string | null;
  sectionId: number | null;
  section: string | null;
  subjectId: number | null;
  subject: string | null;
  intervention: Intervention | null;
  competencyId: number | null;
  competency: string | null;
  competencyCode: string | null;
  competencyTitle: string | null;
  followUpNote: string | null;
  followUpBy: string | null;
  followUpAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AreaProgress {
  /** Learning area (all subjects) or competency code (one subject) */
  learningArea: string;
  title?: string;
  competencies: number;
  assessed: number;
  mastered: number;
  inProgress: number;
  needsSupport: number;
  masteryRate: number | null;
  status: AreaStatus;
}

export interface ActivityItem {
  id: number;
  action: string;
  entity: string;
  details: string | null;
  user: string;
  role?: Role | null;
  createdAt: string;
}

export interface Dashboard {
  settings: { schoolName: string; schoolLevel: string; academicYear: string; currentQuarter: number };
  sections: SectionRef[];
  kpis: {
    enrolled: number;
    averageAttendance: number | null;
    attendanceDelta: number | null;
    competenciesMonitored: number;
    needSupport: number;
    atRisk: number;
    openAlerts: number;
  };
  subjectId: number | null;
  trend: DayPoint[];
  monthly: MonthPoint[];
  progressBy: 'area' | 'competency';
  competencyProgress: AreaProgress[];
  assessment: ScoreDistribution & { masteryTarget: number };
  prePost: { summary: PrePostSummary & { tests: number }; byCompetency: PrePostCompetency[] };
  alerts: AlertItem[];
  learners: LearnerRow[];
  system?: {
    users: number;
    activeUsers: number;
    teachers: number;
    sections: number;
    reportsGenerated: number;
    activity: ActivityItem[];
  };
}

export interface ScoreDistribution {
  average: number | null;
  scores: number;
  passRate: number;
  distribution: { excellent: number; satisfactory: number; needsImprovement: number };
}

export interface WeekPoint extends Counts {
  /** Monday of the week */
  week: string;
  end: string;
  days: number;
}

/** Attendance of one learner (for the selected subject when one is chosen). */
export interface LearnerAttendance {
  id: number;
  learnerNo: string;
  name: string;
  section: string;
  days: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  periodsTotal: number;
  periodsAttended: number;
  rate: number | null;
  recentAbsences: number;
  belowTarget: boolean;
  /** Lessons (class meetings with a competency) missed through absence */
  missedLessons: number;
  missedCompetencies: { code: string; missed: number }[];
}

export interface AttendanceOverview {
  subjectId: number | null;
  attendanceTarget: number;
  sections: SectionRef[];
  kpis: { learners: number; belowTarget: number; rate: number | null; latestDate: string | null; absent: number; late: number; partial: number; present: number };
  trend: DayPoint[];
  summary: Counts;
  schoolYear: Counts;
  weekly: WeekPoint[];
  monthly: MonthPoint[];
  records: DayPoint[];
  learners: LearnerAttendance[];
}

export interface CompetencyOption {
  id: number;
  code: string;
  title: string;
  quarter: number;
  learningPeriod: string | null;
  learningArea?: string;
  subjectId?: number | null;
}

/** One class period (a ClassSchedule row) as offered for attendance recording. */
export interface ClassPeriod {
  id: number;
  sectionId: number;
  section: string;
  subject: string;
  subjectKind: SubjectKind;
  room: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  teacherId: number | null;
  teacher: string | null;
  recorded?: number;
  learners?: number;
  mine?: boolean;
  /** Competency code logged for this meeting */
  competency?: string | null;
}

export interface RosterEntry {
  id: number;
  learnerNo: string;
  name: string;
  sex: 'M' | 'F';
  avatarHue: number;
  status: AttendanceStatus | null;
  timeIn: string;
  remarks: string;
  recordedBy: string | null;
  /** This learner's records in earlier periods the same day */
  earlier: { startTime: string; subject: string; status: AttendanceStatus }[];
}

export interface Roster {
  period: ClassPeriod;
  date: string;
  graceMinutes: number;
  recorded: boolean;
  currentQuarter: number;
  /** Competencies of the period's subject */
  competencies: CompetencyOption[];
  /** Competency taught in this meeting (or the previous meeting's, as a suggestion) */
  session: { competencyId: number | null; topic: string; saved: boolean };
  learners: RosterEntry[];
}

export interface Competency {
  id: number;
  code: string;
  subjectId: number | null;
  learningArea: string;
  title: string;
  quarter: number;
  learningPeriod: string | null;
  active: boolean;
}

export interface CompetencyWithStats extends Competency {
  subject: string;
  subjectCode: string | null;
  assessments: number;
  assessed: number;
  mastered: number;
  inProgress: number;
  needsSupport: number;
  masteryRate: number | null;
  average: number | null;
  completion: Completion;
  /** Sections in view that take the subject / that completed the post-test */
  sections: number;
  completedSections: number;
  lessons: number;
  lastLesson: string | null;
  prePost: { tests: number; avgPre: number | null; avgPost: number | null; avgGain: number | null; completed: number };
}

export interface CompetencyOverview {
  sections: SectionRef[];
  masteryTarget: number;
  currentQuarter: number;
  kpis: {
    onTrack: number;
    monitor: number;
    needsSupport: number;
    targetCoverage: number;
    coverage: number;
    completed: number;
    inProgressCount: number;
    notStarted: number;
    total: number;
  };
  areas: AreaProgress[];
  competencies: CompetencyWithStats[];
}

export interface CompetencyDetail {
  competency: Competency & { subject: string };
  assessments: { id: number; title: string; type: AssessmentType; date: string; section: string; maxScore: number }[];
  prePost: PrePostTestRow[];
  lessons: { section: string; lessons: number; last: string | null }[];
  learners: {
    id: number;
    learnerNo: string;
    name: string;
    section: string;
    average: number | null;
    band: Band | null;
    prePct: number | null;
    postPct: number | null;
    gain: number | null;
  }[];
}

// ---- Competency-level pre-test / post-test ----

export interface PrePostRecord {
  testId: number;
  learnerId: number;
  learnerNo: string | null;
  learner: string;
  sectionId: number;
  section: string;
  subjectId: number | null;
  subject: string;
  quarter: number;
  competencyId: number;
  competencyCode: string;
  competencyTitle: string;
  preScore: number | null;
  preTotal: number;
  postScore: number | null;
  postTotal: number;
  prePct: number | null;
  postPct: number | null;
  /** Post-test % minus pre-test % (percentage points) */
  gain: number | null;
  change: Change;
  performance: string;
  interpretation: string;
  preDate: string | null;
  postDate: string | null;
}

export interface PrePostSummary {
  learners: number;
  preTaken: number;
  postTaken: number;
  completed: number;
  avgPre: number | null;
  avgPost: number | null;
  avgGain: number | null;
  avgPreCompleted: number | null;
  avgPostCompleted: number | null;
  improved: number;
  maintained: number;
  declined: number;
  pending: number;
  masteredPost: number;
  lowPre: number;
  limitedGain: number;
}

/** Class-level summary of one test (section × competency). */
export interface PrePostTestRow extends PrePostSummary {
  id: number;
  sectionId: number;
  section: string;
  subjectId: number | null;
  subject: string;
  competencyId: number;
  competencyCode: string;
  competencyTitle: string;
  quarter: number;
  preTotal: number;
  postTotal: number;
  preDate: string | null;
  postDate: string | null;
}

export interface PrePostCompetency extends PrePostSummary {
  competencyId: number;
  code: string;
  title: string;
  subject: string;
  quarter: number;
}

export interface PrePostOverview {
  academicYear: string;
  masteryTarget: number;
  minLearningGain: number;
  pretestLowThreshold: number;
  sections: SectionRef[];
  competencies: CompetencyOption[];
  summary: PrePostSummary & { tests: number };
  tests: PrePostTestRow[];
  byCompetency: PrePostCompetency[];
  records: PrePostRecord[];
}

export interface PrePostSheet {
  test: { id: number; preTotal: number; postTotal: number; preDate: string | null; postDate: string | null } | null;
  section: SectionRef;
  competency: { id: number; code: string; title: string; quarter: number; subject: string };
  learners: { id: number; learnerNo: string; name: string; sex: 'M' | 'F'; preScore: number | null; postScore: number | null }[];
}

export interface PrePostInput {
  sectionId: number;
  competencyId: number;
  preTotal: number;
  postTotal: number;
  preDate: string | null;
  postDate: string | null;
  scores: { learnerId: number; preScore: number | null; postScore: number | null }[];
}

export interface AssessmentListItem {
  id: number;
  title: string;
  type: AssessmentType;
  date: string;
  quarter: number;
  maxScore: number;
  competencyId: number;
  competency: string;
  competencyTitle: string;
  learningArea: string;
  subjectId: number | null;
  sectionId: number;
  section: string;
  scored: number;
  average: number | null;
  passed: number;
  createdBy: string | null;
}

export interface AssessmentOverview {
  sections: SectionRef[];
  learningAreas: string[];
  competencies: CompetencyOption[];
  masteryTarget: number;
  summary: { average: number | null; previousAverage: number | null; delta: number | null; assessments: number; scores: number; passRate: number };
  distribution: { excellent: number; satisfactory: number; needsImprovement: number };
  assessments: AssessmentListItem[];
}

export interface AssessmentDetail {
  id: number;
  title: string;
  type: AssessmentType;
  competencyId: number;
  sectionId: number;
  date: string;
  maxScore: number;
  quarter: number;
  competency: Competency;
  section: SectionRef;
  learners: { id: number; learnerNo: string; name: string; score: number | null }[];
}

export interface AssessmentInput {
  title: string;
  type: AssessmentType;
  competencyId: number | null;
  sectionId: number | null;
  date: string;
  maxScore: number;
  scores: { learnerId: number; score: number | null }[];
}

export interface AlertsResponse {
  sections: SectionRef[];
  counts: Record<AlertLevel, number>;
  byStatus: Record<AlertStatus, number>;
  byIntervention: Partial<Record<Intervention, number>>;
  items: AlertItem[];
}

export interface ReportColumn {
  key: string;
  label: string;
  sub?: string;
  align?: 'right' | 'center';
}

export interface Report {
  type: string;
  title: string;
  subtitle: string;
  school: string;
  legend?: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
  summary: { label: string; value: string | number }[];
}

export interface LearnerList {
  sections: (SectionRef & { gradeLevel: number; strand: string; teacher: string | null })[];
  /** subjectTeacher is set when a subject is selected */
  learners: (LearnerRow & { subjectTeacher?: string | null })[];
}

/** A learner's standing in one subject. */
export interface LearnerSubject {
  id: number;
  code: string;
  name: string;
  kind: SubjectKind;
  teacher: string | null;
  meetingsPerWeek: number;
  attendanceRate: number | null;
  present: number;
  late: number;
  absent: number;
  excused: number;
  periodsMissed: number;
  recentAbsences: number;
  assessmentAvg: number | null;
  assessmentCount: number;
  descriptor: string;
  monitoring: Monitoring;
  action: string;
  competenciesAssessed: number;
  competenciesMastered: number;
  prePost: { tests: number; avgPre: number | null; avgPost: number | null; avgGain: number | null };
  openAlerts: number;
  monthly: MonthPoint[];
}

export interface LearnerProfile {
  learner: LearnerRow & {
    birthDate: string | null;
    guardian: string | null;
    contactNo: string | null;
    gradeLevel: number;
    strand: string;
    room: string | null;
    teacher: string | null;
  };
  attendance: {
    monthly: MonthPoint[];
    partialDays: number;
    periodsMissed: number;
    recent: {
      date: string;
      status: AttendanceStatus;
      subjectId: number;
      subject: string;
      startTime: string;
      endTime: string;
      room: string;
      timeIn: string | null;
      remarks: string | null;
    }[];
  };
  assessments: {
    id: number;
    title: string;
    type: AssessmentType;
    date: string;
    competency: string;
    learningArea: string;
    subjectId: number | null;
    score: number;
    maxScore: number;
    percent: number;
  }[];
  competencies: { id: number; code: string; title: string; learningArea: string; subjectId: number | null; quarter: number; average: number; band: Band }[];
  subjects: LearnerSubject[];
  prePost: PrePostRecord[];
  missedLessons: { competencyId: number; code: string; title: string; subjectId: number | null; missed: number; taught: number }[];
  alerts: AlertItem[];
}

export interface LearnerInput {
  firstName: string;
  lastName: string;
  sex: 'M' | 'F';
  sectionId: number | null;
  lrn: string;
  birthDate: string;
  guardian: string;
  contactNo: string;
}

export interface SchoolSettings {
  schoolName: string;
  schoolId: string;
  schoolLevel: string;
  division: string;
  region: string;
  academicYear: string;
  currentQuarter: number;
  enableAttendance: boolean;
  enableCompetency: boolean;
  enableAlerts: boolean;
  attendanceTarget: number;
  masteryTarget: number;
  absenceAlertThreshold: number;
  reteachThreshold: number;
  lateGraceMinutes: number;
  missedClassThreshold: number;
  pretestLowThreshold: number;
  minLearningGain: number;
}

export interface UserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: AccountStatus;
  password: string;
}

export interface LogPage {
  total: number;
  page: number;
  pageSize: number;
  items: ActivityItem[];
}
