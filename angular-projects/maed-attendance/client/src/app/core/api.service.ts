import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AdviserOverview,
  AlertItem,
  AttendanceStatus,
  ChatMessage,
  ChildSummary,
  Geofence,
  HeatmapData,
  Intervention,
  LocationResult,
  Outcome,
  ParentDashboard,
  PendingExcuse,
  Roster,
  StudentDashboard,
  StudentHistory,
  TeacherSubject,
  TrendPoint,
  User,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  // ---- Auth & shared ----
  login(email: string, password: string) {
    return this.http.post<{ token: string; user: User }>('/api/auth/login', { email, password });
  }
  me() {
    return this.http.get<User>('/api/auth/me');
  }
  geofence() {
    return this.http.get<Geofence>('/api/geofence');
  }
  thread(withUserId: number) {
    return this.http.get<ChatMessage[]>('/api/messages/thread', { params: { with: withUserId } });
  }
  sendMessage(recipientId: number, body: string, studentId?: number) {
    return this.http.post<ChatMessage>('/api/messages', { recipientId, body, studentId });
  }
  submitExcuse(body: { studentId?: number; date: string; reason: string; attachmentName?: string }) {
    return this.http.post('/api/excuse-notes', body);
  }

  // ---- Student ----
  studentDashboard() {
    return this.http.get<StudentDashboard>('/api/student/dashboard');
  }
  sendLocation(lat: number, lng: number, room?: string | null) {
    return this.http.post<LocationResult>('/api/student/location', { lat, lng, room });
  }

  // ---- Teacher ----
  teacherSchedules() {
    return this.http.get<{ today: number; subjects: TeacherSubject[] }>('/api/teacher/schedules');
  }
  roster(scheduleId: number, date?: string) {
    const params = date ? new HttpParams().set('date', date) : undefined;
    return this.http.get<Roster>(`/api/teacher/roster/${scheduleId}`, { params });
  }
  markAttendance(scheduleId: number, studentId: number, status: AttendanceStatus, date?: string) {
    return this.http.post('/api/teacher/attendance', { scheduleId, studentId, status, date });
  }
  raiseAlert(scheduleId: number, studentId: number, message: string) {
    return this.http.post('/api/teacher/alerts', { scheduleId, studentId, message });
  }
  trends(subjectId: number) {
    return this.http.get<TrendPoint[]>(`/api/teacher/trends/${subjectId}`);
  }

  // ---- Adviser ----
  adviserOverview() {
    return this.http.get<AdviserOverview>('/api/adviser/overview');
  }
  interventions() {
    return this.http.get<Intervention[]>('/api/adviser/interventions');
  }
  addIntervention(body: { studentId: number; actionTaken: string; notes: string; outcome: Outcome }) {
    return this.http.post<Intervention>('/api/adviser/interventions', body);
  }
  studentHistory(studentId: number) {
    return this.http.get<StudentHistory>(`/api/adviser/students/${studentId}/history`);
  }
  heatmap(weeks = 26) {
    return this.http.get<HeatmapData>('/api/adviser/heatmap', { params: { weeks } });
  }
  adviserAlerts() {
    return this.http.get<AlertItem[]>('/api/adviser/alerts');
  }
  ackAlert(id: number) {
    return this.http.post(`/api/adviser/alerts/${id}/ack`, {});
  }
  pendingExcuses() {
    return this.http.get<PendingExcuse[]>('/api/adviser/excuse-notes');
  }
  decideExcuse(id: number, decision: 'APPROVED' | 'REJECTED') {
    return this.http.post<{ excusedRecords: number }>(`/api/adviser/excuse-notes/${id}`, { decision });
  }

  // ---- Parent ----
  children() {
    return this.http.get<ChildSummary[]>('/api/parent/children');
  }
  childDashboard(studentId: number) {
    return this.http.get<ParentDashboard>(`/api/parent/children/${studentId}/dashboard`);
  }
}
