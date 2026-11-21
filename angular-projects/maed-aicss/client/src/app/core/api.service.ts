import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AlertItem,
  AlertStatus,
  AlertsResponse,
  AssessmentDetail,
  AssessmentInput,
  AssessmentOverview,
  AttendanceOverview,
  AttendanceStatus,
  ClassPeriod,
  ClassSchedule,
  Competency,
  CompetencyDetail,
  CompetencyOverview,
  Dashboard,
  LearnerInput,
  LearnerList,
  LearnerProfile,
  LogPage,
  Report,
  Roster,
  ScheduleInput,
  SchoolSettings,
  SectionInfo,
  Subject,
  User,
  UserInput,
} from './models';

type Query = Record<string, string | number | boolean | null | undefined>;

/** Build HttpParams, dropping empty values. */
function params(q: Query = {}): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(q)) if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
  return p;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  // ---- Auth & profile ----
  login(email: string, password: string) {
    return this.http.post<{ token: string; user: User }>('/api/auth/login', { email, password });
  }
  me() {
    return this.http.get<User>('/api/auth/me');
  }
  updateProfile(body: { firstName: string; lastName: string }) {
    return this.http.put<User>('/api/profile', body);
  }
  changePassword(current: string, next: string) {
    return this.http.put('/api/profile/password', { current, next });
  }

  // ---- Dashboard ----
  dashboard(q: Query) {
    return this.http.get<Dashboard>('/api/dashboard', { params: params(q) });
  }

  // ---- Attendance ----
  attendanceOverview(q: Query) {
    return this.http.get<AttendanceOverview>('/api/attendance/overview', { params: params(q) });
  }
  /** Class periods on a date that the signed-in user may record. */
  periods(date: string, sectionId?: number | null) {
    return this.http.get<{ date: string; day: string; periods: ClassPeriod[] }>('/api/attendance/periods', { params: params({ date, sectionId }) });
  }
  roster(scheduleId: number, date: string) {
    return this.http.get<Roster>('/api/attendance/roster', { params: params({ scheduleId, date }) });
  }
  saveAttendance(scheduleId: number, date: string, entries: { learnerId: number; status: AttendanceStatus; timeIn?: string; remarks?: string }[]) {
    return this.http.post<{ saved: number; late: number; absent: number }>('/api/attendance/bulk', { scheduleId, date, entries });
  }

  // ---- Competencies ----
  competencies(q: Query) {
    return this.http.get<CompetencyOverview>('/api/competencies', { params: params(q) });
  }
  competency(id: number, q: Query = {}) {
    return this.http.get<CompetencyDetail>(`/api/competencies/${id}`, { params: params(q) });
  }
  saveCompetency(body: Partial<Competency>, id?: number) {
    return id ? this.http.put<Competency>(`/api/competencies/${id}`, body) : this.http.post<Competency>('/api/competencies', body);
  }
  deleteCompetency(id: number) {
    return this.http.delete(`/api/competencies/${id}`);
  }

  // ---- Assessments ----
  assessments(q: Query) {
    return this.http.get<AssessmentOverview>('/api/assessments', { params: params(q) });
  }
  assessment(id: number) {
    return this.http.get<AssessmentDetail>(`/api/assessments/${id}`);
  }
  saveAssessment(body: AssessmentInput, id?: number) {
    return id ? this.http.put<{ id: number }>(`/api/assessments/${id}`, body) : this.http.post<{ id: number }>('/api/assessments', body);
  }
  deleteAssessment(id: number) {
    return this.http.delete(`/api/assessments/${id}`);
  }

  // ---- Alerts ----
  alerts(q: Query) {
    return this.http.get<AlertsResponse>('/api/alerts', { params: params(q) });
  }
  alertCount() {
    return this.http.get<{ open: number; high: number }>('/api/alerts/count');
  }
  followUp(id: number, status: AlertStatus, note: string) {
    return this.http.post<AlertItem>(`/api/alerts/${id}/follow-up`, { status, note });
  }
  refreshAlerts() {
    return this.http.post('/api/alerts/refresh', {});
  }

  // ---- Reports ----
  report(type: string, q: Query) {
    return this.http.get<Report>(`/api/reports/${type}`, { params: params(q) });
  }

  // ---- Learners ----
  learners(q: Query) {
    return this.http.get<LearnerList>('/api/learners', { params: params(q) });
  }
  learner(id: number) {
    return this.http.get<LearnerProfile>(`/api/learners/${id}`);
  }
  saveLearner(body: LearnerInput, id?: number) {
    return id ? this.http.put<{ id: number }>(`/api/learners/${id}`, body) : this.http.post<{ id: number; learnerNo: string }>('/api/learners', body);
  }
  archiveLearner(id: number, archived: boolean) {
    return this.http.post(`/api/learners/${id}/archive`, { archived });
  }

  // ---- Settings & sections ----
  settings() {
    return this.http.get<SchoolSettings>('/api/settings');
  }
  saveSettings(body: SchoolSettings) {
    return this.http.put<SchoolSettings>('/api/settings', body);
  }
  sections() {
    return this.http.get<SectionInfo[]>('/api/sections');
  }
  subjects() {
    return this.http.get<Subject[]>('/api/subjects');
  }
  saveSubject(body: Partial<Subject>, id?: number) {
    return id ? this.http.put<Subject>(`/api/subjects/${id}`, body) : this.http.post<Subject>('/api/subjects', body);
  }
  daySchedule(day: number) {
    return this.http.get<ClassSchedule[]>('/api/schedules', { params: params({ day }) });
  }
  saveSection(body: { name: string; gradeLevel: number; strand: string; room: string; electiveId: number | null; teacherId: number | null }, id?: number) {
    return id ? this.http.put(`/api/sections/${id}`, body) : this.http.post('/api/sections', body);
  }
  deleteSection(id: number) {
    return this.http.delete(`/api/sections/${id}`);
  }
  sectionSchedule(sectionId: number) {
    return this.http.get<ClassSchedule[]>('/api/schedules', { params: params({ sectionId }) });
  }
  mySchedule() {
    return this.http.get<ClassSchedule[]>('/api/schedules', { params: params({ mine: 1 }) });
  }
  saveSchedule(body: ScheduleInput, id?: number) {
    return id ? this.http.put<ClassSchedule>(`/api/schedules/${id}`, body) : this.http.post<ClassSchedule>('/api/schedules', body);
  }
  deleteSchedule(id: number) {
    return this.http.delete(`/api/schedules/${id}`);
  }

  // ---- Admin ----
  users() {
    return this.http.get<User[]>('/api/admin/users');
  }
  saveUser(body: UserInput, id?: number) {
    return id ? this.http.put<User>(`/api/admin/users/${id}`, body) : this.http.post<User>('/api/admin/users', body);
  }
  logs(q: Query) {
    return this.http.get<LogPage>('/api/admin/logs', { params: params(q) });
  }
}
