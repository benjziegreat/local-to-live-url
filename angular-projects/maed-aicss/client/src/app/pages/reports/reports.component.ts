import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/auth.interceptor';
import { downloadCsv, fmtDateTime, lastSchoolDay, monthLabel, thisMonth, todayIso, TERMS } from '../../core/format';
import { Report, SectionInfo } from '../../core/models';
import { SubjectFilterService, onSubjectChange } from '../../core/subject-filter.service';
import { downloadXlsx } from '../../core/xlsx';
import { IconComponent } from '../../shared/icon.component';
import { TermPipe } from '../../shared/term.pipe';
import { SubjectFilterComponent } from '../../shared/subject-filter.component';

type Need = 'section' | 'month' | 'quarter' | 'status' | 'year' | 'date' | 'range';
type Range = 'day' | 'week' | 'month' | 'year';

interface ReportDef {
  type: string;
  title: string;
  sub: string;
  icon: string;
  tone: string;
  group: string;
  needs: Need[];
  /** Needs exactly one section (no "All sections") */
  oneSection?: boolean;
}

const REPORTS: ReportDef[] = [
  { group: 'Attendance', type: 'attendance', title: 'Attendance Report', sub: 'Daily, weekly, monthly or school year, per learner', icon: 'calendar', tone: 'blue', needs: ['section', 'range'] },
  { group: 'Attendance', type: 'subjects', title: 'Subject Attendance Summary', sub: 'Rate per subject (or per section for one subject)', icon: 'book', tone: 'blue', needs: ['section', 'range'] },
  { group: 'Attendance', type: 'sf2', title: 'SF2 Daily Attendance', sub: 'School Form 2 grid, per section and month', icon: 'calendar-check', tone: 'blue', needs: ['section', 'month'], oneSection: true },
  { group: 'Attendance', type: 'dtr', title: 'Daily Time Record', sub: 'Time in per class period, with competency taught', icon: 'clock', tone: 'blue', needs: ['section', 'date'], oneSection: true },
  { group: 'Competencies', type: 'completion', title: 'Competency Completion', sub: 'Lessons, pre/post-tests and sections completed', icon: 'check-circle', tone: 'purple', needs: ['section', 'quarter'] },
  { group: 'Competencies', type: 'competency', title: 'Competency Mastery', sub: 'Mastered, in progress, needing support', icon: 'target', tone: 'purple', needs: ['section', 'quarter'] },
  { group: 'Assessments', type: 'prepost', title: 'Pre-test vs Post-test', sub: 'Per learner and competency, with interpretation', icon: 'trend', tone: 'green', needs: ['section', 'quarter'] },
  { group: 'Assessments', type: 'gain', title: 'Learning Gain Analysis', sub: 'Class-level gain per competency', icon: 'chart', tone: 'green', needs: ['section', 'quarter'] },
  { group: 'Assessments', type: 'assessment', title: 'Assessment Report', sub: 'Quizzes, tasks and exams', icon: 'clipboard', tone: 'green', needs: ['section', 'quarter'] },
  { group: 'Learners', type: 'performance', title: 'Learner Performance', sub: 'Attendance, scores and recommended actions', icon: 'users', tone: 'orange', needs: ['section'] },
  { group: 'Learners', type: 'support', title: 'Learners Needing Support', sub: 'Issues and recommended interventions', icon: 'alert', tone: 'orange', needs: ['section'] },
  { group: 'Learners', type: 'alerts', title: 'Instructional Alerts', sub: 'Summary of alerts and follow-ups', icon: 'bell', tone: 'orange', needs: ['section', 'status'] },
  { group: 'Learners', type: 'consolidated', title: 'Consolidated Report', sub: 'Attendance + performance', icon: 'file', tone: 'orange', needs: ['section'] },
];

@Component({
  selector: 'app-reports',
  imports: [FormsModule, IconComponent, SubjectFilterComponent, TermPipe],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent {
  protected readonly TERMS = TERMS;
  private api = inject(ApiService);
  protected readonly subject = inject(SubjectFilterService);

  protected readonly groups = [...new Set(REPORTS.map((r) => r.group))].map((group) => ({ group, list: REPORTS.filter((r) => r.group === group) }));
  protected readonly selected = signal<ReportDef | null>(null);
  protected readonly report = signal<Report | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sections = signal<SectionInfo[]>([]);
  protected readonly fmtDateTime = fmtDateTime;

  protected sectionId: number | null = null;
  protected month = thisMonth();
  protected range: Range = 'month';
  protected quarter: number | null = null;
  protected alertStatus = '';
  protected date = lastSchoolDay();
  protected readonly today = todayIso();

  /** Months of the current school year (June to now). */
  protected readonly months = computed(() => {
    const out: string[] = [];
    const now = new Date();
    const startYear = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
    for (let d = new Date(startYear, 5, 1); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return out.reverse();
  });
  protected readonly monthLabel = monthLabel;

  private readonly initialType = inject(ActivatedRoute).snapshot.queryParamMap.get('type');

  constructor() {
    // Sections follow the subject filter (a subject teacher sees the sections they teach it in).
    onSubjectChange((first) => {
      this.api.sections(this.subject.selectedId()).subscribe({
        next: (s) => {
          this.sections.set(s);
          if (this.sectionId && !s.some((x) => x.id === this.sectionId)) this.sectionId = null;
          if (first) {
            const def = REPORTS.find((r) => r.type === this.initialType);
            if (def) this.choose(def);
          } else if (this.selected()) {
            this.choose(this.selected()!);
          }
        },
        error: () => {},
      });
    });
  }

  protected choose(def: ReportDef) {
    this.selected.set(def);
    this.report.set(null);
    this.error.set(null);
    if (def.oneSection && !this.sectionId && this.sections().length) this.sectionId = this.sections()[0].id;
    this.generate();
  }

  protected has(need: Need) {
    return this.selected()?.needs.includes(need) ?? false;
  }

  protected generate() {
    const def = this.selected();
    if (!def) return;
    this.loading.set(true);
    this.error.set(null);
    const ranged = this.has('range');
    this.api
      .report(def.type, {
        ...this.subject.query(),
        sectionId: this.has('section') ? this.sectionId : null,
        range: ranged ? this.range : null,
        month: this.has('month') || (ranged && this.range === 'month') ? this.month : null,
        date: this.has('date') || (ranged && (this.range === 'day' || this.range === 'week')) ? this.date : null,
        quarter: this.has('quarter') ? this.quarter : null,
        status: this.has('status') ? this.alertStatus : null,
      })
      .subscribe({
        next: (r) => {
          this.report.set(r);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(errorMessage(err));
          this.loading.set(false);
        },
      });
  }

  private exportColumns(r: Report) {
    return r.columns.map((c) => ({ key: c.key, label: c.sub ? `${c.label} ${c.sub}` : c.label }));
  }

  private fileName(r: Report, ext: string) {
    return `${r.type}-report-${this.subject.selected()?.code ?? 'all-subjects'}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  }

  protected excel() {
    const r = this.report();
    if (!r) return;
    downloadXlsx(this.fileName(r, 'xlsx'), {
      name: r.title.split('—')[0].trim(),
      title: [r.title, `${r.school} · ${r.subtitle}`, ...(r.legend ? [r.legend] : []), `Generated ${fmtDateTime(r.generatedAt)}`],
      columns: this.exportColumns(r),
      rows: r.rows,
      summary: r.summary,
    });
  }

  protected csv() {
    const r = this.report();
    if (!r) return;
    downloadCsv(this.fileName(r, 'csv'), this.exportColumns(r), r.rows);
  }

  /** DTR cells look like "07:52 L" when the learner was late. */
  protected isLate(v: unknown) {
    return typeof v === 'string' && v.endsWith(' L');
  }

  /** Print dialog; choose "Save as PDF" to export a PDF. */
  protected print() {
    window.print();
  }
}
