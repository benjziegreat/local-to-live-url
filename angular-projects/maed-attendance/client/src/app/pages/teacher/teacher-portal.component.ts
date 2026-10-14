import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/auth.interceptor';
import { STATUS_TONE, titleCase, to12h } from '../../core/format';
import { AttendanceStatus, Roster, RosterStudent, TeacherSubject, TrendPoint } from '../../core/models';
import { poll } from '../../core/polling';
import { ToastService } from '../../core/toast.service';
import { AvatarComponent } from '../../shared/avatar.component';
import { IconComponent } from '../../shared/icon.component';
import { LineChartComponent, LinePoint } from '../../shared/line-chart.component';
import { ModalComponent } from '../../shared/modal.component';

type Filter = 'ALL' | 'IN_ROOM' | 'FLAGGED' | 'OFF_CAMPUS' | 'UNMARKED';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'ALL', label: 'All students' },
  { id: 'IN_ROOM', label: 'In room' },
  { id: 'FLAGGED', label: 'Out of room (flag)' },
  { id: 'OFF_CAMPUS', label: 'Outside campus' },
  { id: 'UNMARKED', label: 'Not yet marked' },
];

const STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'CUTTING'];

@Component({
  selector: 'app-teacher-portal',
  imports: [FormsModule, AvatarComponent, IconComponent, LineChartComponent, ModalComponent],
  templateUrl: './teacher-portal.component.html',
  styleUrl: './teacher-portal.component.scss',
})
export class TeacherPortalComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  protected readonly subjects = signal<TeacherSubject[]>([]);
  protected readonly today = signal(1);
  protected readonly subjectId = signal<number | null>(null);
  protected readonly scheduleId = signal<number | null>(null);
  protected readonly roster = signal<Roster | null>(null);
  protected readonly trends = signal<TrendPoint[]>([]);
  protected readonly filter = signal<Filter>('ALL');
  protected readonly saving = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly alertOpen = signal(false);
  protected alertStudentId: number | null = null;
  protected alertMessage = '';

  protected readonly FILTERS = FILTERS;
  protected readonly STATUSES = STATUSES;
  protected readonly STATUS_TONE = STATUS_TONE;
  protected readonly titleCase = titleCase;
  protected readonly to12h = to12h;

  protected readonly subject = computed(() => this.subjects().find((s) => s.id === this.subjectId()) ?? null);

  /** Today's slots first, then the rest of the week. */
  protected readonly schedules = computed(() => {
    const list = this.subject()?.schedules ?? [];
    const today = this.today();
    return [...list].sort((a, b) => {
      const da = (a.dayOfWeek - today + 7) % 7;
      const db = (b.dayOfWeek - today + 7) % 7;
      return da - db || a.startTime.localeCompare(b.startTime);
    });
  });

  protected readonly students = computed(() => {
    const list = this.roster()?.students ?? [];
    switch (this.filter()) {
      case 'IN_ROOM':
        return list.filter((s) => s.inThisRoom);
      case 'FLAGGED':
        return list.filter((s) => s.suspectedCutting);
      case 'OFF_CAMPUS':
        return list.filter((s) => s.location === 'OFF_CAMPUS');
      case 'UNMARKED':
        return list.filter((s) => !s.status);
      default:
        return list;
    }
  });

  protected readonly counts = computed(() => {
    const list = this.roster()?.students ?? [];
    return {
      inRoom: list.filter((s) => s.inThisRoom).length,
      flagged: list.filter((s) => s.suspectedCutting).length,
      off: list.filter((s) => s.location === 'OFF_CAMPUS').length,
      marked: list.filter((s) => s.status).length,
      total: list.length,
    };
  });

  protected readonly trendPoints = computed<LinePoint[]>(() =>
    this.trends().map((t) => ({
      label: t.label,
      value: t.rate,
      detail: `${t.date} · ${t.total} marks`,
    })),
  );

  constructor() {
    this.api.teacherSchedules().subscribe({
      next: ({ today, subjects }) => {
        this.today.set(today);
        this.subjects.set(subjects);
        this.pickDefault(subjects, today);
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
    poll(() => this.loadRoster(), 10_000);
  }

  /** Default to the class happening now (or next) today. */
  private pickDefault(subjects: TeacherSubject[], today: number) {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const todays = subjects
      .flatMap((s) => s.schedules.map((sc) => ({ s, sc })))
      .filter(({ sc }) => sc.dayOfWeek === today)
      .sort((a, b) => a.sc.startTime.localeCompare(b.sc.startTime));
    const pick =
      todays.find(({ sc }) => sc.endTime >= hhmm) ?? todays.at(-1) ?? (subjects[0]?.schedules[0] && { s: subjects[0], sc: subjects[0].schedules[0] });
    if (!pick) return;
    this.subjectId.set(pick.s.id);
    this.scheduleId.set(pick.sc.id);
    this.loadRoster();
    this.loadTrends();
  }

  protected onSubjectChange(id: number) {
    this.subjectId.set(Number(id));
    this.scheduleId.set(this.schedules()[0]?.id ?? null);
    this.roster.set(null);
    this.loadRoster();
    this.loadTrends();
  }

  protected onScheduleChange(id: number) {
    this.scheduleId.set(Number(id));
    this.roster.set(null);
    this.loadRoster();
  }

  protected loadRoster() {
    const id = this.scheduleId();
    if (!id) return;
    this.api.roster(id).subscribe({
      next: (r) => {
        if (r.schedule.id === this.scheduleId()) this.roster.set(r);
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  private loadTrends() {
    const id = this.subjectId();
    if (id) this.api.trends(id).subscribe((t) => this.trends.set(t));
  }

  protected mark(student: RosterStudent, status: AttendanceStatus) {
    const scheduleId = this.scheduleId();
    if (!scheduleId) return;
    this.saving.set(student.id);
    this.api.markAttendance(scheduleId, student.id, status).subscribe({
      next: () => {
        this.saving.set(null);
        this.toast.show(
          status === 'CUTTING' ? `${student.name} flagged for cutting — adviser notified.` : `${student.name}: ${titleCase(status)}`,
          status === 'CUTTING' ? 'warning' : 'success',
        );
        this.loadRoster();
        this.loadTrends();
      },
      error: (err) => {
        this.saving.set(null);
        this.toast.error(errorMessage(err));
      },
    });
  }

  protected onMore(student: RosterStudent, event: Event) {
    const select = event.target as HTMLSelectElement;
    const status = select.value as AttendanceStatus;
    select.value = '';
    if (status) this.mark(student, status);
  }

  protected openAlert(student?: RosterStudent) {
    const r = this.roster();
    this.alertStudentId = student?.id ?? r?.students.find((s) => s.suspectedCutting || s.location === 'OFF_CAMPUS')?.id ?? r?.students[0]?.id ?? null;
    this.alertMessage = '';
    this.alertOpen.set(true);
  }

  protected sendAlert() {
    const scheduleId = this.scheduleId();
    if (!scheduleId || !this.alertStudentId) return;
    this.api.raiseAlert(scheduleId, this.alertStudentId, this.alertMessage).subscribe({
      next: () => {
        this.alertOpen.set(false);
        this.toast.success('Early alert sent to the class adviser.');
        this.loadRoster();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }
}
