import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/auth.interceptor';
import { ClassSchedule, ScheduleInput, SchoolSettings, SectionInfo, Subject, SubjectKind, User } from '../../core/models';

function groupByDay(rows: ClassSchedule[]) {
  const days = new Map<number, { day: string; classes: ClassSchedule[] }>();
  for (const r of rows) {
    if (!days.has(r.dayOfWeek)) days.set(r.dayOfWeek, { day: r.day, classes: [] });
    days.get(r.dayOfWeek)!.classes.push(r);
  }
  return [...days.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** "13:00" -> "1:00 PM" */
function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
import { NavStateService } from '../../core/nav-state.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { TERMS } from '../../core/format';
import { TermPipe } from '../../shared/term.pipe';
import { ModalComponent } from '../../shared/modal.component';

type Tab = 'school' | 'monitoring' | 'sections' | 'subjects' | 'rooms' | 'account';

/** Daily bell schedule: class periods plus fixed breaks and the ARAL program block. */
const BELL: { start: string; end: string; label: string; kind: 'class' | 'break' }[] = [
  { start: '07:30', end: '08:30', label: '1st period', kind: 'class' },
  { start: '08:30', end: '09:30', label: '2nd period', kind: 'class' },
  { start: '09:30', end: '09:45', label: 'Recess', kind: 'break' },
  { start: '09:45', end: '10:45', label: '3rd period', kind: 'class' },
  { start: '10:45', end: '11:45', label: '4th period', kind: 'class' },
  { start: '11:45', end: '12:30', label: 'Lunch', kind: 'break' },
  { start: '12:30', end: '13:30', label: 'ARAL Program', kind: 'class' },
  { start: '13:30', end: '14:30', label: '5th period', kind: 'class' },
  { start: '14:30', end: '15:30', label: '6th period', kind: 'class' },
];

@Component({
  selector: 'app-settings',
  imports: [FormsModule, IconComponent, ModalComponent, TermPipe],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  protected readonly TERMS = TERMS;
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private navState = inject(NavStateService);
  protected readonly auth = inject(AuthService);

  protected readonly tab = signal<Tab>(this.auth.isAdmin() ? 'school' : 'account');
  protected readonly settings = signal<SchoolSettings | null>(null);
  protected readonly sections = signal<SectionInfo[]>([]);
  protected readonly teachers = signal<User[]>([]);
  protected readonly saving = signal(false);
  protected form: SchoolSettings | null = null;

  protected profile = { firstName: this.auth.user()?.firstName ?? '', lastName: this.auth.user()?.lastName ?? '' };
  protected pw = { current: '', next: '', confirm: '' };

  protected readonly sectionOpen = signal(false);
  protected sectionForm = { name: '', gradeLevel: 11, strand: '', room: '', electiveId: null as number | null, teacherId: null as number | null };
  protected sectionEditing: number | null = null;

  // Subjects catalog
  protected readonly subjects = signal<Subject[]>([]);
  protected readonly electives = computed(() => this.subjects().filter((s) => s.kind === 'ELECTIVE' && s.active));
  protected readonly KIND_LABEL: Record<SubjectKind, string> = { CORE: 'Core', ELECTIVE: 'Elective', PROGRAM: 'Program' };
  protected readonly subjectOpen = signal(false);
  protected subjectForm: Partial<Subject> = {};
  protected subjectEditing: number | null = null;

  // Class schedules
  protected readonly DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  /** The school's bell schedule (used as quick-pick periods). */
  protected readonly PERIODS = BELL;
  protected readonly scheduleSection = signal<SectionInfo | null>(null);
  protected readonly schedule = signal<ClassSchedule[] | null>(null);
  protected readonly mySchedule = signal<ClassSchedule[] | null>(null);
  protected classForm: ScheduleInput | null = null;
  protected classEditing: number | null = null;

  /** Subjects offered to the open section: core + program + that section's elective (or any elective if none set). */
  protected readonly sectionSubjects = computed(() => {
    const s = this.scheduleSection();
    return this.subjects().filter((x) => x.active && (x.kind !== 'ELECTIVE' || !s?.electiveId || x.id === s.electiveId));
  });

  // Room utilization (admin)
  protected readonly roomDay = signal(1);
  protected readonly roomRows = signal<ClassSchedule[] | null>(null);
  protected readonly roomGrid = computed(() => {
    const rows = this.roomRows() ?? [];
    const rooms = [...new Set(rows.map((r) => r.room))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const cell = new Map(rows.map((r) => [`${r.room}|${r.startTime}`, r]));
    return rooms.map((room) => ({ room, cells: BELL.map((p) => (p.kind === 'class' ? (cell.get(`${room}|${p.start}`) ?? null) : undefined)) }));
  });

  /** Timetable grouped by day for display. */
  protected readonly byDay = computed(() => groupByDay(this.schedule() ?? []));
  protected readonly myByDay = computed(() => groupByDay(this.mySchedule() ?? []));
  protected readonly to12h = to12h;

  protected readonly years = (() => {
    const y = new Date().getFullYear();
    return [y - 1, y, y + 1].map((s) => `${s}-${s + 1}`);
  })();

  constructor() {
    this.api.settings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.form = { ...s };
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
    this.loadSections();
    if (this.auth.isAdmin()) this.api.users().subscribe({ next: (u) => this.teachers.set(u.filter((x) => x.role === 'TEACHER' && x.status === 'ACTIVE')), error: () => {} });
    else this.api.mySchedule().subscribe({ next: (s) => this.mySchedule.set(s), error: () => {} });
    this.loadSubjects();
  }

  private loadSubjects() {
    this.api.subjects().subscribe({ next: (s) => this.subjects.set(s), error: () => {} });
  }

  // ---- Subjects ----

  protected openSubject(s?: Subject) {
    this.subjectEditing = s?.id ?? null;
    this.subjectForm = s ? { ...s } : { code: '', name: '', kind: 'ELECTIVE', track: 'TechPro', defaultRoom: '', active: true };
    this.subjectOpen.set(true);
  }

  protected saveSubject() {
    this.api.saveSubject(this.subjectForm, this.subjectEditing ?? undefined).subscribe({
      next: () => {
        this.subjectOpen.set(false);
        this.toast.success('Subject saved');
        this.loadSubjects();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  // ---- Room utilization ----

  protected openRooms() {
    this.tab.set('rooms');
    this.loadRooms();
  }

  protected loadRooms() {
    this.roomRows.set(null);
    this.api.daySchedule(this.roomDay()).subscribe({
      next: (r) => this.roomRows.set(r),
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  // ---- Class schedule ----

  protected openSchedule(s: SectionInfo) {
    this.scheduleSection.set(s);
    this.classForm = null;
    this.loadSchedule();
  }

  private loadSchedule() {
    const s = this.scheduleSection();
    if (!s) return;
    this.schedule.set(null);
    this.api.sectionSchedule(s.id).subscribe({
      next: (rows) => this.schedule.set(rows),
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected newClass() {
    const s = this.scheduleSection()!;
    this.classEditing = null;
    this.classForm = { sectionId: s.id, subjectId: null, teacherId: null, dayOfWeek: 1, startTime: '07:30', endTime: '08:30', room: s.room ?? '' };
  }

  protected editClass(c: ClassSchedule) {
    this.classEditing = c.id;
    this.classForm = { sectionId: c.sectionId, subjectId: c.subjectId, teacherId: c.teacherId, dayOfWeek: c.dayOfWeek, startTime: c.startTime, endTime: c.endTime, room: c.room };
  }

  /** Picking a subject fills in its usual room (e.g. a laboratory), else the section's room. */
  protected subjectPicked(id: number | null) {
    if (!this.classForm) return;
    const subj = this.subjects().find((x) => x.id === id);
    this.classForm.room = subj?.defaultRoom || this.scheduleSection()?.room || this.classForm.room;
  }

  protected setPeriod(value: string) {
    if (!this.classForm || !value) return;
    const [start, end] = value.split('-');
    this.classForm.startTime = start;
    this.classForm.endTime = end;
  }

  protected saveClass() {
    if (!this.classForm) return;
    this.api.saveSchedule(this.classForm, this.classEditing ?? undefined).subscribe({
      next: () => {
        this.toast.success('Class schedule saved');
        this.classForm = null;
        this.loadSchedule();
        this.loadSections();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected deleteClass(c: ClassSchedule) {
    if (!confirm(`Remove ${c.learningArea} on ${c.day} ${c.startTime}–${c.endTime}?`)) return;
    this.api.deleteSchedule(c.id).subscribe({
      next: () => {
        this.toast.success('Class removed');
        this.loadSchedule();
        this.loadSections();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  private loadSections() {
    this.api.sections().subscribe({ next: (s) => this.sections.set(s), error: () => {} });
  }

  protected saveSettings() {
    if (!this.form) return;
    this.saving.set(true);
    this.api.saveSettings(this.form).subscribe({
      next: (s) => {
        this.saving.set(false);
        this.settings.set(s);
        this.form = { ...s };
        this.toast.success('Settings saved');
        this.navState.refreshAlerts();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }

  protected saveProfile() {
    this.api.updateProfile(this.profile).subscribe({
      next: (u) => {
        this.auth.setUser(u);
        this.toast.success('Profile updated');
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected changePassword() {
    if (this.pw.next !== this.pw.confirm) {
      this.toast.error('New passwords do not match');
      return;
    }
    this.api.changePassword(this.pw.current, this.pw.next).subscribe({
      next: () => {
        this.pw = { current: '', next: '', confirm: '' };
        this.toast.success('Password changed');
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected openSection(s?: SectionInfo) {
    this.sectionEditing = s?.id ?? null;
    this.sectionForm = s
      ? { name: s.name, gradeLevel: s.gradeLevel, strand: s.strand, room: s.room ?? '', electiveId: s.electiveId, teacherId: s.teacherId }
      : { name: '', gradeLevel: 11, strand: '', room: '', electiveId: null, teacherId: null };
    this.sectionOpen.set(true);
  }

  protected saveSection() {
    this.api.saveSection(this.sectionForm, this.sectionEditing ?? undefined).subscribe({
      next: () => {
        this.sectionOpen.set(false);
        this.toast.success('Section saved');
        this.loadSections();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected deleteSection(s: SectionInfo) {
    if (!confirm(`Delete ${s.name}?`)) return;
    this.api.deleteSection(s.id).subscribe({
      next: () => {
        this.toast.success('Section deleted');
        this.loadSections();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }
}
