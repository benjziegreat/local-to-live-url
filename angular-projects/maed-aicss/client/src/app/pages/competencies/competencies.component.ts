import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/auth.interceptor';
import { AREA_LABEL, AREA_TONE, BAND_LABEL, BAND_TONE, COMPLETION_LABEL, COMPLETION_TONE, TYPE_LABEL, fmtDate, pct, signed, TERMS } from '../../core/format';
import { AreaStatus, Competency, CompetencyDetail, CompetencyOverview, CompetencyWithStats, Completion } from '../../core/models';
import { NavStateService } from '../../core/nav-state.service';
import { SubjectFilterService, onSubjectChange } from '../../core/subject-filter.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { TermPipe } from '../../shared/term.pipe';
import { ModalComponent } from '../../shared/modal.component';
import { RingChartComponent, RingSegment } from '../../shared/ring-chart.component';
import { SubjectFilterComponent } from '../../shared/subject-filter.component';

type CompetencyForm = Pick<Competency, 'code' | 'subjectId' | 'title' | 'quarter' | 'learningPeriod' | 'active'>;

/** Competencies grouped by quarter, then learning period. */
interface QuarterGroup {
  quarter: number;
  periods: { period: string; list: CompetencyWithStats[] }[];
}

@Component({
  selector: 'app-competencies',
  imports: [FormsModule, RouterLink, IconComponent, RingChartComponent, ModalComponent, SubjectFilterComponent, TermPipe],
  templateUrl: './competencies.component.html',
  styleUrl: './competencies.component.scss',
})
export class CompetenciesComponent {
  protected readonly TERMS = TERMS;
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private navState = inject(NavStateService);
  protected readonly auth = inject(AuthService);
  protected readonly subject = inject(SubjectFilterService);

  protected readonly data = signal<CompetencyOverview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected sectionId: number | null = null;
  protected quarter: number | null = null;
  protected readonly focusArea = signal<string | null>(null);
  /** Learning-area filter for the "All subjects" view */
  protected readonly areaFilter = signal<string>('');
  protected readonly completionFilter = signal<Completion | ''>('');

  protected readonly pct = pct;
  protected readonly signed = signed;
  protected readonly fmtDate = fmtDate;
  protected readonly AREA_LABEL = AREA_LABEL;
  protected readonly AREA_TONE = AREA_TONE;
  protected readonly BAND_LABEL = BAND_LABEL;
  protected readonly BAND_TONE = BAND_TONE;
  protected readonly TYPE_LABEL = TYPE_LABEL;
  protected readonly COMPLETION_LABEL = COMPLETION_LABEL;
  protected readonly COMPLETION_TONE = COMPLETION_TONE;

  // Detail + edit modals
  protected readonly detail = signal<CompetencyDetail | null>(null);
  protected readonly detailOpen = signal(false);
  protected readonly editOpen = signal(false);
  protected readonly saving = signal(false);
  protected form: CompetencyForm = this.blank();
  protected editingId: number | null = null;

  protected readonly area = computed(() => {
    const d = this.data();
    if (!d?.areas.length) return null;
    return d.areas.find((a) => a.learningArea === this.focusArea()) ?? d.areas[0];
  });

  protected readonly areaRing = computed<RingSegment[]>(() => {
    const a = this.area();
    if (!a || !a.assessed) return [];
    const share = (n: number) => Math.round((n / a.assessed) * 1000) / 10;
    return [
      { label: 'Mastered', value: share(a.mastered), color: 'var(--brand)' },
      { label: 'In Progress', value: share(a.inProgress), color: '#f5b316' },
      { label: 'Needs Support', value: share(a.needsSupport), color: '#e5484d' },
    ];
  });

  protected readonly list = computed(() => {
    const f = this.areaFilter();
    const c = this.completionFilter();
    return (this.data()?.competencies ?? []).filter((x) => (!f || x.learningArea === f) && (!c || x.completion === c));
  });

  /** The list organised by quarter and learning period. */
  protected readonly groups = computed<QuarterGroup[]>(() => {
    const byQuarter = new Map<number, Map<string, CompetencyWithStats[]>>();
    for (const c of this.list()) {
      const q = byQuarter.get(c.quarter) ?? new Map<string, CompetencyWithStats[]>();
      const key = c.learningPeriod ?? 'Learning period not set';
      q.set(key, [...(q.get(key) ?? []), c]);
      byQuarter.set(c.quarter, q);
    }
    return [...byQuarter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([quarter, periods]) => ({ quarter, periods: [...periods.entries()].map(([period, list]) => ({ period, list })) }));
  });

  protected readonly learningAreas = computed(() => [...new Set((this.data()?.competencies ?? []).map((c) => c.learningArea))]);

  constructor() {
    onSubjectChange((first) => {
      if (!first) {
        this.sectionId = null;
        this.areaFilter.set('');
        this.focusArea.set(null);
      }
      this.load();
    });
  }

  private blank(): CompetencyForm {
    return { code: '', subjectId: this.subject?.selectedId() ?? null, title: '', quarter: this.data()?.currentQuarter ?? 1, learningPeriod: '', active: true };
  }

  protected load() {
    this.error.set(null);
    this.api.competencies({ sectionId: this.sectionId, quarter: this.quarter, ...this.subject.query() }).subscribe({
      next: (d) => this.data.set(d),
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  protected status(c: CompetencyWithStats): AreaStatus {
    const target = this.data()?.masteryTarget ?? 75;
    if (c.masteryRate === null) return 'NO_DATA';
    return c.masteryRate >= target ? 'ON_TRACK' : c.masteryRate >= target - 15 ? 'MONITOR' : 'NEEDS_SUPPORT';
  }

  protected openDetail(c: CompetencyWithStats) {
    this.detail.set(null);
    this.detailOpen.set(true);
    this.api.competency(c.id, { sectionId: this.sectionId, ...this.subject.query() }).subscribe({
      next: (d) => this.detail.set(d),
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected openEdit(c?: Competency) {
    this.editingId = c?.id ?? null;
    this.form = c
      ? { code: c.code, subjectId: c.subjectId, title: c.title, quarter: c.quarter, learningPeriod: c.learningPeriod ?? '', active: c.active }
      : this.blank();
    this.editOpen.set(true);
  }

  protected save() {
    this.saving.set(true);
    this.api.saveCompetency(this.form, this.editingId ?? undefined).subscribe({
      next: (c) => {
        this.saving.set(false);
        this.editOpen.set(false);
        this.toast.success(`${c.code} saved`);
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }

  protected remove(c: Competency) {
    if (!confirm(`Delete ${c.code}? Its assessments, pre/post-tests and scores will also be deleted.`)) return;
    this.api.deleteCompetency(c.id).subscribe({
      next: () => {
        this.toast.success(`${c.code} deleted`);
        this.load();
        this.navState.refreshAlerts();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }
}
