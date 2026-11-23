import { AlertLevel, AlertStatus, AreaStatus, AssessmentType, AttendanceStatus, Band, Change, Completion, Intervention, Monitoring } from './models';

export type Tone = 'success' | 'warning' | 'critical' | 'info' | 'muted' | 'purple';

export const MONITORING_LABEL: Record<Monitoring, string> = { ON_TRACK: 'On Track', MONITOR: 'Monitor', AT_RISK: 'At Risk' };
export const MONITORING_TONE: Record<Monitoring, Tone> = { ON_TRACK: 'success', MONITOR: 'warning', AT_RISK: 'critical' };

export const AREA_LABEL: Record<AreaStatus, string> = { ON_TRACK: 'On Track', MONITOR: 'Monitor', NEEDS_SUPPORT: 'Needs Support', NO_DATA: 'No data' };
export const AREA_TONE: Record<AreaStatus, Tone> = { ON_TRACK: 'success', MONITOR: 'warning', NEEDS_SUPPORT: 'critical', NO_DATA: 'muted' };

export const BAND_LABEL: Record<Band, string> = { MASTERED: 'Mastered', IN_PROGRESS: 'In Progress', NEEDS_SUPPORT: 'Needs Support' };
export const BAND_TONE: Record<Band, Tone> = { MASTERED: 'success', IN_PROGRESS: 'warning', NEEDS_SUPPORT: 'critical' };

export const ATT_LABEL: Record<AttendanceStatus, string> = { PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent', EXCUSED: 'Excused' };
export const ATT_SHORT: Record<AttendanceStatus, string> = { PRESENT: 'P', LATE: 'L', ABSENT: 'A', EXCUSED: 'E' };
export const ATT_TONE: Record<AttendanceStatus, Tone> = { PRESENT: 'success', LATE: 'warning', ABSENT: 'critical', EXCUSED: 'info' };

export const LEVEL_LABEL: Record<AlertLevel, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
export const LEVEL_TONE: Record<AlertLevel, Tone> = { HIGH: 'critical', MEDIUM: 'warning', LOW: 'info' };
export const LEVEL_ICON: Record<AlertLevel, string> = { HIGH: 'alert-octagon', MEDIUM: 'alert', LOW: 'info' };

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = { OPEN: 'Open', FOLLOWED_UP: 'Followed up', RESOLVED: 'Resolved' };
export const ALERT_STATUS_TONE: Record<AlertStatus, Tone> = { OPEN: 'critical', FOLLOWED_UP: 'warning', RESOLVED: 'success' };

export const TYPE_LABEL: Record<AssessmentType, string> = { QUIZ: 'Quiz', PERFORMANCE_TASK: 'Performance Task', QUARTERLY_EXAM: 'Term Exam' };

/**
 * The school year has three terms. (Stored as `quarter` / `currentQuarter` in the database
 * so existing records keep their values.)
 */
export const TERMS = [1, 2, 3] as const;
const ORDINAL: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' };

/** 1 -> "1st Term" */
export function termLabel(n: number | null | undefined): string {
  return n === null || n === undefined ? '-' : `${ORDINAL[n] ?? `${n}th`} Term`;
}

export const INTERVENTION_LABEL: Record<Intervention, string> = {
  RETEACHING: 'Reteaching',
  REMEDIATION: 'Remediation',
  ENRICHMENT: 'Enrichment',
  CATCH_UP: 'Catch-up',
  ATTENDANCE: 'Attendance follow-up',
};
export const INTERVENTION_TONE: Record<Intervention, Tone> = { RETEACHING: 'purple', REMEDIATION: 'warning', ENRICHMENT: 'success', CATCH_UP: 'info', ATTENDANCE: 'critical' };

export const COMPLETION_LABEL: Record<Completion, string> = { COMPLETED: 'Completed', IN_PROGRESS: 'In progress', NOT_STARTED: 'Not started' };
export const COMPLETION_TONE: Record<Completion, Tone> = { COMPLETED: 'success', IN_PROGRESS: 'info', NOT_STARTED: 'muted' };

export const CHANGE_LABEL: Record<Change, string> = { IMPROVED: 'Improved', MAINTAINED: 'Maintained', DECLINED: 'Declined', PENDING: 'Awaiting post-test', NO_PRETEST: 'No pre-test' };
export const CHANGE_TONE: Record<Change, Tone> = { IMPROVED: 'success', MAINTAINED: 'warning', DECLINED: 'critical', PENDING: 'muted', NO_PRETEST: 'muted' };

/** "+12.5", "-3", "0" (or "-" when null). */
export function signed(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '-';
  const s = v.toFixed(digits).replace(/\.0+$/, '');
  return v > 0 ? `+${s}` : s;
}

/** Colours used for learning areas / chart segments (match the .c-N classes in styles.scss). */
export const SERIES = ['#2f7cf0', '#34a853', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899'];

export function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? '-' : `${v.toFixed(digits)}%`;
}

/** "2026-11-21" or ISO timestamp -> "Nov 21, 2026" */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "2026-11-21" -> "Mon" */
export function weekday(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
}

/** "2026-11-21" -> "Nov 21" */
export function shortDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "2026-11" -> "Nov" (or "November 2026" with long=true) */
export function monthLabel(ym: string, long = false): string {
  const d = new Date(`${ym}-01T00:00:00`);
  return long ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : d.toLocaleDateString('en-US', { month: 'short' });
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function thisMonth(): string {
  return todayIso().slice(0, 7);
}

/** Most recent weekday on or before today, as YYYY-MM-DD. */
export function lastSchoolDay(): string {
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Download rows as a CSV file (Excel-friendly, UTF-8 with BOM). */
export function downloadCsv(filename: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.-]+/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
