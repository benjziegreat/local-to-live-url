import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/auth.interceptor';
import { ATT_LABEL, ATT_SHORT, ATT_TONE, downloadCsv, fmtDate, lastSchoolDay, monthLabel, pct, shortDate, todayIso, weekday } from '../../core/format';
import { AttendanceOverview, AttendanceStatus, ClassPeriod, LearnerAttendance, Roster } from '../../core/models';
import { NavStateService } from '../../core/nav-state.service';
import { SubjectFilterService, onSubjectChange } from '../../core/subject-filter.service';
import { ToastService } from '../../core/toast.service';
import { downloadXlsx } from '../../core/xlsx';
import { AvatarComponent } from '../../shared/avatar.component';
import { IconComponent } from '../../shared/icon.component';
import { TermPipe } from '../../shared/term.pipe';
import { LinePoint, LineChartComponent } from '../../shared/line-chart.component';
import { ModalComponent } from '../../shared/modal.component';
import { RingChartComponent, RingSegment } from '../../shared/ring-chart.component';
import { SubjectFilterComponent } from '../../shared/subject-filter.component';

const STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** "13:30" -> "1:30 PM" */
export function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

@Component({
  selector: 'app-attendance',
  imports: [FormsModule, RouterLink, IconComponent, LineChartComponent, RingChartComponent, ModalComponent, AvatarComponent, SubjectFilterComponent, TermPipe],
  templateUrl: './attendance.component.html',
  styleUrl: './attendance.component.scss',
})
export class AttendanceComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private navState = inject(NavStateService);
  protected readonly auth = inject(AuthService);
  protected readonly subject = inject(SubjectFilterService);

  protected readonly data = signal<AttendanceOverview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected range: 'week' | 'month' = 'week';
  protected sectionId: number | null = null;
  protected readonly learnerQuery = signal('');
  protected readonly onlyBelow = signal(false);
  protected readonly learnerRows = computed(() => {
    const q = this.learnerQuery().trim().toLowerCase();
    return (this.data()?.learners ?? []).filter(
      (l) => (!this.onlyBelow() || l.belowTarget || l.missedLessons) && (!q || l.name.toLowerCase().includes(q) || l.learnerNo.toLowerCase().includes(q)),
    );
  });

  protected readonly pct = pct;
  protected readonly fmtDate = fmtDate;
  protected readonly weekday = weekday;
  protected readonly monthLabel = monthLabel;
  protected readonly to12h = to12h;
  protected readonly STATUSES = STATUSES;
  protected readonly ATT_LABEL = ATT_LABEL;
  protected readonly ATT_SHORT = ATT_SHORT;
  protected readonly ATT_TONE = ATT_TONE;
  protected readonly today = todayIso();

  // ---- Recorder (daily time record per class period) ----
  protected readonly recorderOpen = signal(false);
  protected recDate = lastSchoolDay();
  protected readonly recDay = signal('');
  protected readonly periods = signal<ClassPeriod[] | null>(null);
  protected readonly selected = signal<ClassPeriod | null>(null);
  protected readonly roster = signal<Roster | null>(null);
  protected readonly saving = signal(false);
  /** Competency taught in the selected class meeting */
  protected sessionCompetencyId: number | null = null;
  protected sessionTopic = '';

  /** Periods grouped by section for the picker. */
  protected readonly periodGroups = computed(() => {
    const groups = new Map<string, ClassPeriod[]>();
    for (const p of this.periods() ?? []) groups.set(p.section, [...(groups.get(p.section) ?? []), p]);
    return [...groups.entries()].map(([section, list]) => ({ section, list }));
  });

  protected readonly trendPoints = computed<LinePoint[]>(() =>
    (this.data()?.trend ?? []).map((d) => ({
      label: this.range === 'week' ? weekday(d.date) : shortDate(d.date),
      value: d.rate,
      detail: `${fmtDate(d.date)} · ${d.absent} absent all day, ${d.partial} missed periods`,
    })),
  );

  protected readonly summary = computed<RingSegment[]>(() => {
    const s = this.data()?.summary;
    if (!s || !s.total) return [];
    const share = (n: number) => Math.round((n / s.total) * 1000) / 10;
    return [
      { label: 'Present', value: share(s.present), color: 'var(--brand)' },
      { label: 'Late', value: share(s.late), color: '#f59e0b' },
      { label: 'Absent all day', value: share(s.absent), color: '#e5484d' },
      { label: 'Excused', value: share(s.excused), color: '#34a853' },
    ];
  });

  protected readonly syDays = computed(() => (this.data()?.monthly ?? []).reduce((n, m) => n + m.days, 0));

  protected readonly tally = computed(() => {
    const t: Record<string, number> = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0, NONE: 0 };
    for (const l of this.roster()?.learners ?? []) t[l.status ?? 'NONE']++;
    return t;
  });

  constructor() {
    onSubjectChange((first) => {
      if (!first) this.sectionId = null;
      this.load();
    });
  }

  protected load() {
    this.error.set(null);
    this.api.attendanceOverview({ range: this.range, sectionId: this.sectionId, ...this.subject.query() }).subscribe({
      next: (d) => this.data.set(d),
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  // ---- Recorder ----

  protected openRecorder() {
    this.recorderOpen.set(true);
    this.selected.set(null);
    this.roster.set(null);
    this.loadPeriods();
  }

  protected loadPeriods(keepSelection = false) {
    if (!this.recDate) return;
    if (!keepSelection) {
      this.periods.set(null);
      this.selected.set(null);
      this.roster.set(null);
    }
    this.api.periods(this.recDate, this.subject.selectedId()).subscribe({
      next: (r) => {
        this.recDay.set(r.day);
        this.periods.set(r.periods);
        const sel = this.selected();
        if (sel) this.selected.set(r.periods.find((p) => p.id === sel.id) ?? null);
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected choose(p: ClassPeriod) {
    this.selected.set(p);
    this.roster.set(null);
    this.api.roster(p.id, this.recDate).subscribe({
      next: (r) => {
        this.sessionCompetencyId = r.session.competencyId;
        this.sessionTopic = r.session.topic;
        this.roster.set(r);
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected backToPeriods() {
    this.selected.set(null);
    this.roster.set(null);
  }

  private update(id: number, patch: Partial<Roster['learners'][number]>) {
    this.roster.update((r) => (r ? { ...r, learners: r.learners.map((l) => (l.id === id ? { ...l, ...patch } : l)) } : r));
  }

  /** Late if the time in is past the start of the period plus the grace minutes. */
  private isLate(timeIn: string) {
    const r = this.roster();
    return !!r && !!timeIn && toMin(timeIn) > toMin(r.period.startTime) + r.graceMinutes;
  }

  protected mark(id: number, status: AttendanceStatus) {
    const r = this.roster()!;
    const l = r.learners.find((x) => x.id === id)!;
    const timeIn = status === 'ABSENT' || status === 'EXCUSED' ? '' : l.timeIn || r.period.startTime;
    this.update(id, { status, timeIn });
  }

  protected setTimeIn(id: number, timeIn: string) {
    const l = this.roster()!.learners.find((x) => x.id === id)!;
    let status = l.status;
    if (timeIn && (status === null || status === 'PRESENT' || status === 'LATE')) status = this.isLate(timeIn) ? 'LATE' : 'PRESENT';
    this.update(id, { timeIn, status });
  }

  protected setRemarks(id: number, remarks: string) {
    this.update(id, { remarks });
  }

  protected markAllPresent() {
    const start = this.roster()?.period.startTime ?? '';
    this.roster.update((r) =>
      r ? { ...r, learners: r.learners.map((l) => (l.status ? l : { ...l, status: 'PRESENT' as AttendanceStatus, timeIn: start })) } : r,
    );
  }

  /** Carry over the previous period: absent or excused stays so, everyone else present. */
  protected copyPrevious() {
    const start = this.roster()?.period.startTime ?? '';
    this.roster.update((r) =>
      r
        ? {
            ...r,
            learners: r.learners.map((l) => {
              const prev = l.earlier[l.earlier.length - 1];
              if (!prev) return l;
              const status: AttendanceStatus = prev.status === 'ABSENT' || prev.status === 'EXCUSED' ? prev.status : 'PRESENT';
              return { ...l, status, timeIn: status === 'PRESENT' ? start : '' };
            }),
          }
        : r,
    );
  }

  protected readonly hasEarlier = computed(() => (this.roster()?.learners ?? []).some((l) => l.earlier.length));

  protected save() {
    const r = this.roster();
    if (!r) return;
    const entries = r.learners.filter((l) => l.status).map((l) => ({ learnerId: l.id, status: l.status!, timeIn: l.timeIn || undefined, remarks: l.remarks }));
    if (this.tally()['NONE'] && !confirm(`${this.tally()['NONE']} learner(s) are not marked yet. Save the rest?`)) return;
    this.saving.set(true);
    this.api.saveAttendance(r.period.id, r.date, entries, { competencyId: this.sessionCompetencyId, topic: this.sessionTopic }).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.toast.success(`${r.period.subject} (${to12h(r.period.startTime)}, ${r.period.room}): ${res.saved} saved · ${res.late} late · ${res.absent} absent`);
        this.load();
        this.navState.refreshAlerts();
        this.loadPeriods(true);
        this.backToPeriods();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }

  protected exportRecords() {
    const d = this.data();
    if (!d) return;
    downloadCsv(
      `daily-attendance-${todayIso()}.csv`,
      [
        { key: 'date', label: 'Date' },
        { key: 'day', label: 'Day' },
        { key: 'present', label: 'Present' },
        { key: 'late', label: 'Late' },
        { key: 'absent', label: 'Absent all day' },
        { key: 'excused', label: 'Excused' },
        { key: 'partial', label: 'Missed some periods' },
        { key: 'rate', label: 'Period attendance rate' },
      ],
      d.records.map((r) => ({ ...r, day: weekday(r.date), rate: pct(r.rate) })),
    );
  }

  protected missedText(l: LearnerAttendance) {
    return l.missedCompetencies.map((c) => `${c.code} (${c.missed})`).join(', ');
  }

  /** Per-learner attendance for the subject in view, as an Excel workbook. */
  protected exportLearners() {
    const d = this.data();
    if (!d) return;
    downloadXlsx(`learner-attendance-${this.subject.selected()?.code ?? 'all'}-${todayIso()}.xlsx`, {
      name: 'Learner attendance',
      title: [`Learner Attendance — ${this.subject.label()}`, `School year to date · generated ${new Date().toLocaleString()}`],
      columns: [
        { key: 'learnerNo', label: 'Learner ID' },
        { key: 'name', label: 'Learner' },
        { key: 'section', label: 'Section' },
        { key: 'days', label: 'Days' },
        { key: 'present', label: 'Present' },
        { key: 'late', label: 'Tardy' },
        { key: 'absent', label: 'Absent' },
        { key: 'excused', label: 'Excused' },
        { key: 'rate', label: 'Attendance %' },
        { key: 'missedLessons', label: 'Lessons missed' },
        { key: 'missed', label: 'Competencies missed' },
      ],
      rows: d.learners.map((l) => ({ ...l, rate: pct(l.rate), missed: this.missedText(l) })),
    });
  }
}
