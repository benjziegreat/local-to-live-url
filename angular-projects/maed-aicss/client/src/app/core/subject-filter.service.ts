import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { SubjectOption } from './models';

/**
 * The one subject filter shared by every module (Dashboard, Attendance, Competencies,
 * Assessment Records, Instructional Alerts, Reports, Learners).
 *
 * The selection is global: switching subjects on one page carries over to the others, and
 * it is remembered per user. `null` means "All subjects", which is only offered to users
 * with an overall view (admins and section advisers); everyone else always has a subject.
 */
@Injectable({ providedIn: 'root' })
export class SubjectFilterService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly subjects = signal<SubjectOption[]>([]);
  readonly allowAll = signal(true);
  /** True once the options are loaded and the selection is valid. */
  readonly ready = signal(false);
  readonly selectedId = signal<number | null>(null);
  readonly selected = computed(() => this.subjects().find((s) => s.id === this.selectedId()) ?? null);
  /** Label of the current view, e.g. "General Mathematics" or "All subjects". */
  readonly label = computed(() => this.selected()?.name ?? 'All subjects');

  private loadedFor: number | null = null;

  /** Load the options for the signed-in user (once per user). */
  load(force = false) {
    const userId = this.auth.user()?.id ?? null;
    if (!userId || (!force && this.loadedFor === userId)) return;
    this.loadedFor = userId;
    this.ready.set(false);
    this.api.mySubjects().subscribe({
      next: (r) => {
        this.subjects.set(r.subjects);
        this.allowAll.set(r.allowAll);
        const stored = this.restore(userId);
        const valid = stored !== null && r.subjects.some((s) => s.id === stored);
        // Without an overall view, default to the first subject the teacher teaches.
        this.selectedId.set(valid ? stored : r.allowAll ? null : (r.subjects[0]?.id ?? null));
        this.ready.set(true);
      },
      error: () => {
        this.subjects.set([]);
        this.allowAll.set(true);
        this.selectedId.set(null);
        this.ready.set(true);
      },
    });
  }

  select(id: number | null) {
    if (id === null && !this.allowAll()) return;
    this.selectedId.set(id);
    const userId = this.auth.user()?.id;
    if (!userId) return;
    try {
      localStorage.setItem(this.key(userId), id === null ? '' : String(id));
    } catch {
      /* storage unavailable: selection lasts until reload */
    }
  }

  /** The filter as API query params. */
  query(): { subjectId: number | null } {
    return { subjectId: this.selectedId() };
  }

  private key(userId: number) {
    return `aicss.subject.${userId}`;
  }

  private restore(userId: number): number | null {
    try {
      const v = localStorage.getItem(this.key(userId));
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  }
}

/**
 * Run `load` whenever the subject filter changes (and once it is ready). `first` is true on
 * the initial run, so pages can keep their own filters then and reset them on later
 * subject switches. Call in an injection context (a component constructor).
 */
export function onSubjectChange(load: (first: boolean) => void) {
  const filter = inject(SubjectFilterService);
  let first = true;
  effect(() => {
    if (!filter.ready()) return;
    filter.selectedId();
    untracked(() => load(first));
    first = false;
  });
}
