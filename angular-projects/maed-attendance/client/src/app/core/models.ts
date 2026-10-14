export type Role = 'STUDENT' | 'TEACHER' | 'ADVISER' | 'PARENT';
export type LocationState = 'IN_ROOM' | 'ON_CAMPUS' | 'OFF_CAMPUS';
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED' | 'CUTTING';
export type RiskLevel = 'SAFE' | 'MODERATE' | 'CRITICAL';
export type Outcome = 'GREEN' | 'YELLOW' | 'RED';
export type AlertType = 'EARLY_WARNING' | 'UNEXCUSED_ABSENCE' | 'CUTTING';

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  role: Role;
  avatarHue: number;
}

export interface Geofence {
  id: number;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
}

export interface GateLog {
  id: number;
  event: 'ENTRY' | 'EXIT';
  timestamp: string;
  verified: boolean;
  gate: string;
}

export interface AttendanceStats {
  total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  cutting: number;
  rate: number;
  unexcusedAbsences: number;
  cuttingRate: number;
  label?: string;
}

export interface ExcuseNote {
  id: number;
  date: string;
  reason: string;
  attachmentName: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

// ---- Student --------------------------------------------------------------

export interface StudentDashboard {
  student: {
    id: number;
    studentNo: string;
    firstName: string;
    lastName: string;
    avatarHue: number;
    section: string;
    adviser: string | null;
    location: LocationState;
    currentRoom: string | null;
    lastLat: number | null;
    lastLng: number | null;
    lastSeenAt: string | null;
    geofenceActive: boolean;
  };
  geofence: Geofence;
  checkIn: { at: string; gate: string } | null;
  gateLogs: GateLog[];
  currentClass: { scheduleId: number; subject: string; room: string } | null;
  rooms: string[];
  todaysClasses: {
    scheduleId: number;
    subject: string;
    teacher: string;
    startTime: string;
    endTime: string;
    room: string;
    status: AttendanceStatus | null;
    inSession: boolean;
  }[];
  health: AttendanceStats;
  excuseNotes: ExcuseNote[];
}

export interface LocationResult {
  inside: boolean;
  distance: number;
  location: LocationState;
  room: string | null;
  event: 'ENTRY' | 'EXIT' | null;
  autoMarked: { subject: string; status: AttendanceStatus } | null;
}

// ---- Teacher --------------------------------------------------------------

export interface TeacherSchedule {
  id: number;
  dayOfWeek: number;
  day: string;
  startTime: string;
  endTime: string;
  room: string;
  section: string;
}

export interface TeacherSubject {
  id: number;
  code: string;
  name: string;
  schedules: TeacherSchedule[];
}

export interface RosterStudent {
  id: number;
  name: string;
  avatarHue: number;
  studentNo: string;
  location: LocationState;
  currentRoom: string | null;
  inThisRoom: boolean;
  suspectedCutting: boolean;
  lastSeenAt: string | null;
  status: AttendanceStatus | null;
  alertRaised: boolean;
}

export interface Roster {
  schedule: {
    id: number;
    subject: string;
    subjectId: number;
    section: string;
    room: string;
    startTime: string;
    endTime: string;
  };
  date: string;
  /** True while this class is in session today; location flags only apply then. */
  live: boolean;
  students: RosterStudent[];
}

export interface TrendPoint {
  date: string;
  label: string;
  rate: number | null;
  total: number;
}

// ---- Adviser --------------------------------------------------------------

export interface Intervention {
  id: number;
  date: string;
  student?: string;
  studentId: number;
  actionTaken: string;
  notes: string | null;
  conductedBy?: string;
  outcome: Outcome;
}

export interface RiskProfile {
  id: number;
  name: string;
  avatarHue: number;
  studentNo: string;
  section: string;
  location: LocationState;
  currentRoom: string | null;
  stats: AttendanceStats;
  risk: RiskLevel;
  lastIntervention: Intervention | null;
}

export interface AdviserOverview {
  sections: { id: number; name: string }[];
  counts: Record<RiskLevel, number>;
  windowDays: number;
  students: RiskProfile[];
}

export interface ChatMessage {
  id: number;
  body: string;
  createdAt: string;
  mine: boolean;
  senderName?: string;
}

export interface AlertItem {
  id: number;
  type: AlertType;
  message: string;
  createdAt: string;
  studentId?: number;
  student?: string;
  subject: string | null;
  raisedBy?: string;
}

export interface StudentHistory {
  student: { id: number; name: string };
  parents: { id: number; name: string; relationship: string }[];
  messages: ChatMessage[];
  interventions: Intervention[];
  alerts: AlertItem[];
}

export interface HeatmapData {
  from: string;
  to: string;
  days: { date: string; rate: number; total: number }[];
}

export interface PendingExcuse {
  id: number;
  date: string;
  reason: string;
  attachmentName: string | null;
  createdAt: string;
  studentId: number;
  student: string;
  submittedBy: string;
}

// ---- Parent ---------------------------------------------------------------

export interface ChildSummary {
  id: number;
  name: string;
  firstName: string;
  avatarHue: number;
  section: string;
  relationship: string;
  location: LocationState;
}

export interface ParentDashboard {
  child: {
    id: number;
    name: string;
    firstName: string;
    avatarHue: number;
    studentNo: string;
    section: string;
    location: LocationState;
    currentRoom: string | null;
    lastLat: number | null;
    lastLng: number | null;
    lastSeenAt: string | null;
  };
  geofence: Geofence;
  gateLogs: GateLog[];
  absences: { id: number; date: string; status: AttendanceStatus; subject: string; startTime: string }[];
  alerts: AlertItem[];
  health: AttendanceStats;
  adviser: { id: number; name: string } | null;
  latestMessage: { body: string; createdAt: string } | null;
  unreadFromAdviser: number;
  excuseNotes: ExcuseNote[];
}
