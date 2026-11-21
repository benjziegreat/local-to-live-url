import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/auth.interceptor';
import { downloadCsv, fmtDateTime, lastSchoolDay, monthLabel, thisMonth, todayIso } from '../../core/format';
import { Report, SectionInfo } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';

interface ReportDef {
  type: string;
  title: string;
  sub: string;
  icon: string;
  tone: string;
  needs: ('section' | 'month' | 'quarter' | 'status' | 'year' | 'date')[];
}

const REPORTS: ReportDef[] = [
  { type: 'dtr', title: 'Daily Time Record', sub: 'Time in per class period, room & schedule', icon: 'clock', tone: 'blue', needs: ['section', 'date'] },
  { type: 'sf2', title: 'SF2 Daily Attendance', sub: 'School Form 2 inspired, per section', icon: 'calendar-check', tone: 'blue', needs: ['section', 'month'] },
  { type: 'attendance', title: 'Attendance Report', sub: 'Weekly / monthly summary', icon: 'calendar', tone: 'blue', needs: ['section', 'month', 'year'] },
  { type: 'competency', title: 'Competency Report', sub: 'Progress & mastery', icon: 'target', tone: 'purple', needs: ['section', 'quarter'] },
  { type: 'assessment', title: 'Assessment Report', sub: 'Performance analysis', icon: 'clipboard', tone: 'purple', needs: ['section', 'quarter'] },
  { type: 'performance', title: 'Learner Performance', sub: 'Analytics & recommended actions', icon: 'trend', tone: 'green', needs: ['section'] },
  { type: 'alerts', title: 'Instructional Alerts', sub: 'Summary of interventions', icon: 'bell', tone: 'orange', needs: ['section', 'status'] },
  { type: 'consolidated', title: 'Consolidated Report', sub: 'Attendance + performance', icon: 'file', tone: 'green', needs: ['section'] },
];

@Component({
  selector: 'app-reports',
  imports: [FormsModule, IconComponent],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent {
  private api = inject(ApiService);

  protected readonly reports = REPORTS;
  protected readonly selected = signal<ReportDef | null>(null);
  protected readonly report = signal<Report | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sections = signal<SectionInfo[]>([]);
  protected readonly fmtDateTime = fmtDateTime;

  protected sectionId: number | null = null;
  protected month = thisMonth();
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

  constructor() {
    this.api.sections().subscribe({ next: (s) => this.sections.set(s), error: () => {} });
    const type = inject(ActivatedRoute).snapshot.queryParamMap.get('type');
    const def = REPORTS.find((r) => r.type === type);
    if (def) this.choose(def);
  }

  protected choose(def: ReportDef) {
    this.selected.set(def);
    this.report.set(null);
    this.error.set(null);
    if ((def.type === 'sf2' || def.type === 'dtr') && !this.sectionId && this.sections().length) this.sectionId = this.sections()[0].id;
    if (def.type !== 'attendance' && this.month === 'year') this.month = thisMonth();
    this.generate();
  }

  protected has(need: ReportDef['needs'][number]) {
    return this.selected()?.needs.includes(need) ?? false;
  }

  protected generate() {
    const def = this.selected();
    if (!def) return;
    this.loading.set(true);
    this.error.set(null);
    this.api
      .report(def.type, {
        sectionId: this.has('section') ? this.sectionId : null,
        month: this.has('month') ? this.month : null,
        quarter: this.has('quarter') ? this.quarter : null,
        status: this.has('status') ? this.alertStatus : null,
        date: this.has('date') ? this.date : null,
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

  protected csv() {
    const r = this.report();
    if (!r) return;
    const cols = r.columns.map((c) => ({ key: c.key, label: c.sub ? `${c.label} ${c.sub}` : c.label }));
    downloadCsv(`${r.type}-report-${new Date().toISOString().slice(0, 10)}.csv`, cols, r.rows);
  }

  /** DTR cells look like "07:52 L" when the learner was late. */
  protected isLate(v: unknown) {
    return typeof v === 'string' && v.endsWith(' L');
  }

  protected print() {
    window.print();
  }
}
