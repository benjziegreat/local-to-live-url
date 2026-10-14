import { AttendanceStatus, LocationState, RiskLevel } from './models';

export type Tone = 'success' | 'warning' | 'critical' | 'info' | 'muted';

export const STATUS_TONE: Record<AttendanceStatus, Tone> = {
  PRESENT: 'success',
  LATE: 'warning',
  EXCUSED: 'info',
  ABSENT: 'critical',
  CUTTING: 'critical',
};

export const RISK_TONE: Record<RiskLevel, Tone> = { SAFE: 'success', MODERATE: 'warning', CRITICAL: 'critical' };

export const LOCATION_LABEL: Record<LocationState, string> = {
  IN_ROOM: 'In Room',
  ON_CAMPUS: 'On Campus',
  OFF_CAMPUS: 'Outside Campus',
};

export const LOCATION_TONE: Record<LocationState, Tone> = {
  IN_ROOM: 'success',
  ON_CAMPUS: 'success',
  OFF_CAMPUS: 'warning',
};

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** "14:30" -> "2:30 PM" */
export function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
