export type Role = 'TEACHER' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'INACTIVE';
export type Monitoring = 'ON_TRACK' | 'MONITOR' | 'AT_RISK';
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';
export type AlertLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type AlertStatus = 'OPEN' | 'FOLLOWED_UP' | 'RESOLVED';
export type AssessmentType = 'QUIZ' | 'PERFORMANCE_TASK' | 'QUARTERLY_EXAM';
export type Band = 'MASTERED' | 'IN_PROGRESS' | 'NEEDS_SUPPORT';
export type AreaStatus = 'ON_TRACK' | 'MONITOR' | 'NEEDS_SUPPORT' | 'NO_DATA';

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
  section: string | null;
  competency: string | null;
  followUpNote: string | null;
  followUpBy: string | null;
  followUpAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AreaProgress {
  learningArea: string;
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
  trend: DayPoint[];
  monthly: MonthPoint[];
  competencyProgress: AreaProgress[];
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

export interface AttendanceOverview {
  sections: SectionRef[];
  kpis: { learners: number; rate: number | null; latestDate: string | null; absent: number; late: number; partial: number; present: number };
  trend: DayPoint[];
  summary: Counts;
  schoolYear: Counts;
  monthly: MonthPoint[];
  records: DayPoint[];
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
  learners: RosterEntry[];
}

export interface Competency {
  id: number;
  code: string;
  learningArea: string;
  title: string;
  quarter: number;
  active: boolean;
}

export interface CompetencyWithStats extends Competency {
  assessments: number;
  assessed: number;
  mastered: number;
  inProgress: number;
  needsSupport: number;
  masteryRate: number | null;
  average: number | null;
}

export interface CompetencyOverview {
  sections: SectionRef[];
  masteryTarget: number;
  kpis: { onTrack: number; monitor: number; needsSupport: number; targetCoverage: number };
  areas: AreaProgress[];
  competencies: CompetencyWithStats[];
}

export interface CompetencyDetail {
  competency: Competency;
  assessments: { id: number; title: string; type: AssessmentType; date: string; section: string; maxScore: number }[];
  learners: { id: number; learnerNo: string; name: string; section: string; average: number; band: Band }[];
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
  learners: LearnerRow[];
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
      subject: string;
      startTime: string;
      endTime: string;
      room: string;
      timeIn: string | null;
      remarks: string | null;
    }[];
  };
  assessments: { id: number; title: string; type: AssessmentType; date: string; competency: string; learningArea: string; score: number; maxScore: number; percent: number }[];
  competencies: { id: number; code: string; title: string; learningArea: string; quarter: number; average: number; band: Band }[];
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
