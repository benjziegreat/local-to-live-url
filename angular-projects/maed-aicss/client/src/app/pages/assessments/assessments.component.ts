import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/auth.interceptor';
import { CHANGE_LABEL, CHANGE_TONE, TYPE_LABEL, fmtDate, pct, signed, todayIso, TERMS, termLabel } from '../../core/format';
import {
  AssessmentInput,
  AssessmentListItem,
  AssessmentOverview,
  AssessmentType,
  CompetencyOption,
  PrePostOverview,
  PrePostSheet,
  PrePostTestRow,
} from '../../core/models';
import { NavStateService } from '../../core/nav-state.service';
import { SubjectFilterService, onSubjectChange } from '../../core/subject-filter.service';
import { ToastService } from '../../core/toast.service';
import { downloadXlsx } from '../../core/xlsx';
import { CompareChartComponent, CompareRow } from '../../shared/compare-chart.component';
import { IconComponent } from '../../shared/icon.component';
import { TermPipe } from '../../shared/term.pipe';
import { ModalComponent } from '../../shared/modal.component';
import { RingChartComponent, RingSegment } from '../../shared/ring-chart.component';
import { SubjectFilterComponent } from '../../shared/subject-filter.component';

interface ScoreRow {
  id: number;
  learnerNo: string;
  name: string;
  score: number | null;
}

interface SheetRow {
  id: number;
  learnerNo: string;
  name: string;
  preScore: number | null;
  postScore: number | null;
}

type Tab = 'prepost' | 'other';
type Phase = '' | 'pending' | 'complete';

const PAGE = 150;
const blankValue = (v: unknown) => v === null || v === undefined || v === '';
const percentOf = (score: number | null, total: number) => (blankValue(score) || !total ? null : Math.round((Number(score) / total) * 1000) / 10);

@Component({
  selector: 'app-assessments',
  imports: [FormsModule, RouterLink, IconComponent, RingChartComponent, ModalComponent, CompareChartComponent, SubjectFilterComponent, TermPipe],
  templateUrl: './assessments.component.html',
  styleUrl: './assessments.component.scss',
})
export class AssessmentsComponent {
  protected readonly TERMS = TERMS;
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private navState = inject(NavStateService);
  protected readonly auth = inject(AuthService);
  protected readonly subject = inject(SubjectFilterService);

  protected readonly tab = signal<Tab>(inject(ActivatedRoute).snapshot.queryParamMap.get('tab') === 'other' ? 'other' : 'prepost');

  // Shared filters
  protected quarter: number | null = null;
  protected sectionId: number | null = null;
  protected competencyId: number | null = null;

  protected readonly pct = pct;
  protected readonly signed = signed;
  protected readonly fmtDate = fmtDate;
  protected readonly TYPE_LABEL = TYPE_LABEL;
  protected readonly CHANGE_LABEL = CHANGE_LABEL;
  protected readonly CHANGE_TONE = CHANGE_TONE;
  protected readonly TYPES: AssessmentType[] = ['QUIZ', 'PERFORMANCE_TASK', 'QUARTERLY_EXAM'];

  // ---- Pre-test / post-test ----
  protected readonly pp = signal<PrePostOverview | null>(null);
  protected readonly ppError = signal<string | null>(null);
  protected phase: Phase = '';
  protected readonly recordQuery = signal('');
  protected readonly shown = signal(PAGE);

  protected readonly records = computed(() => {
    const q = this.recordQuery().trim().toLowerCase();
    const list = this.pp()?.records ?? [];
    return q ? list.filter((r) => r.learner.toLowerCase().includes(q) || r.competencyCode.toLowerCase().includes(q) || (r.learnerNo ?? '').toLowerCase().includes(q)) : list;
  });
  protected readonly visibleRecords = computed(() => this.records().slice(0, this.shown()));

  protected readonly compareRows = computed<CompareRow[]>(() =>
    (this.pp()?.byCompetency ?? []).map((c) => ({
      label: c.code,
      sub: `${this.subject.selectedId() ? '' : c.subject + ' · '}${c.completed}/${c.learners} with both`,
      a: c.avgPreCompleted ?? c.avgPre,
      b: c.avgPostCompleted,
    })),
  );

  protected readonly changeRing = computed<RingSegment[]>(() => {
    const s = this.pp()?.summary;
    if (!s || !s.completed) return [];
    const share = (n: number) => Math.round((n / s.completed) * 1000) / 10;
    return [
      { label: 'Improved', value: share(s.improved), color: 'var(--success)' },
      { label: 'Maintained', value: share(s.maintained), color: '#f5b316' },
      { label: 'Declined', value: share(s.declined), color: '#e5484d' },
    ];
  });

  // Encoding sheet
  protected readonly sheetOpen = signal(false);
  protected readonly sheet = signal<PrePostSheet | null>(null);
  protected readonly sheetRows = signal<SheetRow[]>([]);
  protected readonly sheetLoading = signal(false);
  protected readonly sheetSaving = signal(false);
  protected sheetSectionId: number | null = null;
  protected sheetCompetencyId: number | null = null;
  protected preTotal = 20;
  protected postTotal = 20;
  protected preDate: string | null = todayIso();
  protected postDate: string | null = null;

  protected readonly sheetStats = computed(() => {
    const rows = this.sheetRows();
    const pre = rows.filter((r) => !blankValue(r.preScore)).length;
    const post = rows.filter((r) => !blankValue(r.postScore)).length;
    return { pre, post, total: rows.length };
  });

  // ---- Regular assessments ----
  protected readonly data = signal<AssessmentOverview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly editorOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly rows = signal<ScoreRow[]>([]);
  protected readonly loadingRoster = signal(false);
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

  protected readonly scored = computed(() => this.rows().filter((r) => !blankValue(r.score)).length);

  /** Competency options of the current view (from whichever tab loaded last). */
  protected readonly competencyOptions = computed<CompetencyOption[]>(() => this.pp()?.competencies ?? this.data()?.competencies ?? []);
  protected readonly sectionOptions = computed(() => this.pp()?.sections ?? this.data()?.sections ?? []);

  constructor() {
    onSubjectChange((first) => {
      if (!first) {
        this.sectionId = null;
        this.competencyId = null;
      }
      this.load();
    });
  }

  protected setTab(t: Tab) {
    this.tab.set(t);
    this.load();
  }

  protected load() {
    if (this.tab() === 'prepost') this.loadPrePost();
    else this.loadOther();
  }

  private filters() {
    return { quarter: this.quarter, sectionId: this.sectionId, competencyId: this.competencyId, ...this.subject.query() };
  }

  // ---- Pre-test / post-test ----

  protected loadPrePost() {
    this.ppError.set(null);
    this.shown.set(PAGE);
    this.api.prePost({ ...this.filters(), phase: this.phase }).subscribe({
      next: (d) => this.pp.set(d),
      error: (err) => this.ppError.set(errorMessage(err)),
    });
  }

  protected openSheet(t?: PrePostTestRow) {
    this.sheet.set(null);
    this.sheetRows.set([]);
    this.sheetSectionId = t?.sectionId ?? this.sectionId ?? this.sectionOptions()[0]?.id ?? null;
    this.sheetCompetencyId = t?.competencyId ?? this.competencyId ?? null;
    this.sheetOpen.set(true);
    this.loadSheet();
  }

  protected loadSheet() {
    if (!this.sheetSectionId || !this.sheetCompetencyId) return;
    this.sheetLoading.set(true);
    this.api.prePostSheet(this.sheetSectionId, this.sheetCompetencyId).subscribe({
      next: (s) => {
        this.sheet.set(s);
        this.preTotal = s.test?.preTotal ?? 20;
        this.postTotal = s.test?.postTotal ?? s.test?.preTotal ?? 20;
        this.preDate = s.test?.preDate ?? todayIso();
        this.postDate = s.test?.postDate ?? null;
        this.sheetRows.set(s.learners.map((l) => ({ id: l.id, learnerNo: l.learnerNo, name: l.name, preScore: l.preScore, postScore: l.postScore })));
        this.sheetLoading.set(false);
      },
      error: (err) => {
        this.sheetLoading.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }

  protected setSheetScore(id: number, field: 'preScore' | 'postScore', value: number | null) {
    this.sheetRows.update((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  protected prePct(r: SheetRow) {
    return percentOf(r.preScore, this.preTotal);
  }
  protected postPct(r: SheetRow) {
    return percentOf(r.postScore, this.postTotal);
  }
  protected gain(r: SheetRow) {
    const a = this.prePct(r);
    const b = this.postPct(r);
    return a === null || b === null ? null : Math.round((b - a) * 10) / 10;
  }

  protected saveSheet() {
    if (!this.sheetSectionId || !this.sheetCompetencyId) return;
    if (this.sheetStats().post && !this.postDate) this.postDate = todayIso();
    this.sheetSaving.set(true);
    this.api
      .savePrePost({
        sectionId: this.sheetSectionId,
        competencyId: this.sheetCompetencyId,
        preTotal: this.preTotal,
        postTotal: this.postTotal,
        preDate: this.preDate || null,
        postDate: this.postDate || null,
        scores: this.sheetRows().map((r) => ({ learnerId: r.id, preScore: blankValue(r.preScore) ? null : r.preScore, postScore: blankValue(r.postScore) ? null : r.postScore })),
      })
      .subscribe({
        next: (res) => {
          this.sheetSaving.set(false);
          this.sheetOpen.set(false);
          this.toast.success(`Saved ${res.pre} pre-test and ${res.post} post-test score(s)`);
          this.loadPrePost();
          this.navState.refreshAlerts();
        },
        error: (err) => {
          this.sheetSaving.set(false);
          this.toast.error(errorMessage(err));
        },
      });
  }

  protected removeTest(t: PrePostTestRow) {
    if (!confirm(`Delete the ${t.competencyCode} pre-test/post-test of ${t.section} and all ${t.learners} learner score(s)?`)) return;
    this.api.deletePrePost(t.id).subscribe({
      next: () => {
        this.toast.success('Pre/post-test deleted');
        this.loadPrePost();
        this.navState.refreshAlerts();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected exportPrePost() {
    const d = this.pp();
    if (!d) return;
    const s = d.summary;
    downloadXlsx(`prepost-${this.subject.selected()?.code ?? 'all'}-${todayIso()}.xlsx`, {
      name: 'Pre-test Post-test',
      title: [`Pre-test and Post-test Records — ${this.subject.label()}`, `School year ${d.academicYear} · generated ${new Date().toLocaleString()}`],
      columns: [
        { key: 'learner', label: "Learner's Name" },
        { key: 'learnerNo', label: 'Learner ID' },
        { key: 'subject', label: 'Subject' },
        { key: 'section', label: 'Section' },
        { key: 'quarter', label: 'Term' },
        { key: 'competencyCode', label: 'Competency Code' },
        { key: 'competencyTitle', label: 'Competency Description' },
        { key: 'preScore', label: 'Pre-test Score' },
        { key: 'preTotal', label: 'Pre-test Total Items' },
        { key: 'prePctText', label: 'Pre-test %' },
        { key: 'postScore', label: 'Post-test Score' },
        { key: 'postTotal', label: 'Post-test Total Items' },
        { key: 'postPctText', label: 'Post-test %' },
        { key: 'gainText', label: 'Learning Gain (points)' },
        { key: 'interpretation', label: 'Performance Interpretation' },
      ],
      rows: this.records().map((r) => ({ ...r, quarter: termLabel(r.quarter), prePctText: pct(r.prePct), postPctText: pct(r.postPct), gainText: signed(r.gain) })),
      summary: [
        { label: 'Average pre-test', value: pct(s.avgPre) },
        { label: 'Average post-test', value: pct(s.avgPost) },
        { label: 'Average learning gain', value: signed(s.avgGain) },
        { label: 'Improved / maintained / declined', value: `${s.improved} / ${s.maintained} / ${s.declined}` },
        { label: 'Awaiting post-test', value: s.pending },
      ],
    });
  }

  // ---- Regular assessments ----

  private blank(): Omit<AssessmentInput, 'scores'> {
    return { title: '', type: 'QUIZ', competencyId: null, sectionId: null, date: todayIso(), maxScore: 20 };
  }

  protected loadOther() {
    this.error.set(null);
    this.api.assessments(this.filters()).subscribe({
      next: (d) => this.data.set(d),
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  protected openNew() {
    this.editingId = null;
    this.form = { ...this.blank(), sectionId: this.sectionId ?? this.data()?.sections[0]?.id ?? null, competencyId: this.competencyId };
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
    this.api.learners({ sectionId: this.form.sectionId, ...this.subject.query() }).subscribe({
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
    if (blankValue(score) || !this.form.maxScore) return '';
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
        this.loadOther();
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
        this.loadOther();
        this.navState.refreshAlerts();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected export() {
    const d = this.data();
    if (!d) return;
    downloadXlsx(`assessment-records-${this.subject.selected()?.code ?? 'all'}-${todayIso()}.xlsx`, {
      name: 'Assessments',
      title: [`Assessment Records — ${this.subject.label()}`, `Generated ${new Date().toLocaleString()}`],
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'title', label: 'Assessment' },
        { key: 'type', label: 'Type' },
        { key: 'competency', label: 'Competency' },
        { key: 'learningArea', label: 'Subject' },
        { key: 'section', label: 'Section' },
        { key: 'maxScore', label: 'Max Score' },
        { key: 'average', label: 'Average' },
        { key: 'passed', label: 'Passed' },
      ],
      rows: d.assessments.map((a) => ({ ...a, date: a.date.slice(0, 10), type: TYPE_LABEL[a.type], average: pct(a.average), passed: `${a.passed}/${a.scored}` })),
    });
  }
}
