import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/auth.interceptor';
import { TYPE_LABEL, downloadCsv, fmtDate, pct, todayIso } from '../../core/format';
import { AssessmentInput, AssessmentListItem, AssessmentOverview, AssessmentType, Competency } from '../../core/models';
import { NavStateService } from '../../core/nav-state.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';
import { RingChartComponent, RingSegment } from '../../shared/ring-chart.component';

interface ScoreRow {
  id: number;
  learnerNo: string;
  name: string;
  score: number | null;
}

@Component({
  selector: 'app-assessments',
  imports: [FormsModule, IconComponent, RingChartComponent, ModalComponent],
  templateUrl: './assessments.component.html',
  styleUrl: './assessments.component.scss',
})
export class AssessmentsComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private navState = inject(NavStateService);
  protected readonly auth = inject(AuthService);

  protected readonly data = signal<AssessmentOverview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected learningArea = '';
  protected quarter: number | null = null;
  protected sectionId: number | null = null;

  protected readonly pct = pct;
  protected readonly fmtDate = fmtDate;
  protected readonly TYPE_LABEL = TYPE_LABEL;
  protected readonly TYPES: AssessmentType[] = ['QUIZ', 'PERFORMANCE_TASK', 'QUARTERLY_EXAM'];

  // Editor
  protected readonly editorOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly rows = signal<ScoreRow[]>([]);
  protected readonly loadingRoster = signal(false);
  protected readonly competencies = signal<Competency[]>([]);
  protected editingId: number | null = null;
  protected form: Omit<AssessmentInput, 'scores'> = this.blank();

  protected readonly distribution = computed<RingSegment[]>(() => {
    const d = this.data()?.distribution;
    if (!d || !this.data()?.summary.scores) return [];
    return [
      { label: 'Excellent (90–100)', value: d.excellent, color: 'var(--brand)' },
      { label: `Satisfactory (${this.data()!.masteryTarget}–89)`, value: d.satisfactory, color: '#f5b316' },
      { label: 'Needs Improvement', value: d.needsImprovement, color: '#e5484d' },
    ];
  });

  protected readonly scored = computed(() => this.rows().filter((r) => r.score !== null && (r.score as unknown) !== '').length);

  constructor() {
    this.load();
    this.api.competencies({}).subscribe({ next: (c) => this.competencies.set(c.competencies.filter((x) => x.active)), error: () => {} });
  }

  private blank(): Omit<AssessmentInput, 'scores'> {
    return { title: '', type: 'QUIZ', competencyId: null, sectionId: null, date: todayIso(), maxScore: 20 };
  }

  protected load() {
    this.error.set(null);
    this.api.assessments({ learningArea: this.learningArea, quarter: this.quarter, sectionId: this.sectionId }).subscribe({
      next: (d) => this.data.set(d),
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  protected openNew() {
    this.editingId = null;
    this.form = { ...this.blank(), sectionId: this.sectionId ?? this.data()?.sections[0]?.id ?? null };
    this.editorOpen.set(true);
    this.loadRoster();
  }

  protected openEdit(a: AssessmentListItem) {
    this.editingId = a.id;
    this.editorOpen.set(true);
    this.loadingRoster.set(true);
    this.rows.set([]);
    this.api.assessment(a.id).subscribe({
      next: (d) => {
        this.form = { title: d.title, type: d.type, competencyId: d.competencyId, sectionId: d.sectionId, date: d.date.slice(0, 10), maxScore: d.maxScore };
        this.rows.set(d.learners);
        this.loadingRoster.set(false);
      },
      error: (err) => {
        this.toast.error(errorMessage(err));
        this.editorOpen.set(false);
      },
    });
  }

  /** New assessment: load the chosen section's learners with empty scores. */
  protected loadRoster() {
    if (this.editingId || !this.form.sectionId) return;
    this.loadingRoster.set(true);
    this.api.learners({ sectionId: this.form.sectionId }).subscribe({
      next: (l) => {
        this.rows.set(l.learners.map((x) => ({ id: x.id, learnerNo: x.learnerNo, name: x.name, score: null })));
        this.loadingRoster.set(false);
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected setScore(id: number, value: number | null) {
    this.rows.update((rows) => rows.map((r) => (r.id === id ? { ...r, score: value } : r)));
  }

  protected percent(score: number | null) {
    if (score === null || (score as unknown) === '' || !this.form.maxScore) return '';
    return `${Math.round((Number(score) / this.form.maxScore) * 100)}%`;
  }

  protected save() {
    this.saving.set(true);
    const body: AssessmentInput = { ...this.form, scores: this.rows().map((r) => ({ learnerId: r.id, score: r.score })) };
    this.api.saveAssessment(body, this.editingId ?? undefined).subscribe({
      next: () => {
        this.saving.set(false);
        this.editorOpen.set(false);
        this.toast.success(`Assessment saved with ${this.scored()} score(s)`);
        this.load();
        this.navState.refreshAlerts();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }

  protected remove(a: AssessmentListItem) {
    if (!confirm(`Delete "${a.title}" (${a.section}) and its ${a.scored} score(s)?`)) return;
    this.api.deleteAssessment(a.id).subscribe({
      next: () => {
        this.toast.success('Assessment deleted');
        this.load();
        this.navState.refreshAlerts();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected export() {
    const d = this.data();
    if (!d) return;
    downloadCsv(
      `assessment-records-${todayIso()}.csv`,
      [
        { key: 'date', label: 'Date' },
        { key: 'title', label: 'Assessment' },
        { key: 'type', label: 'Type' },
        { key: 'competency', label: 'Competency' },
        { key: 'learningArea', label: 'Learning Area' },
        { key: 'section', label: 'Section' },
        { key: 'maxScore', label: 'Max Score' },
        { key: 'average', label: 'Average' },
        { key: 'passed', label: 'Passed' },
      ],
      d.assessments.map((a) => ({ ...a, date: a.date.slice(0, 10), type: TYPE_LABEL[a.type], average: pct(a.average), passed: `${a.passed}/${a.scored}` })),
    );
  }
}
