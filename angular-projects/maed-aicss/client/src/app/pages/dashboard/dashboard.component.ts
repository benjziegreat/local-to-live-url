import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/auth.interceptor';
import {
  AREA_LABEL,
  AREA_TONE,
  LEVEL_LABEL,
  LEVEL_TONE,
  MONITORING_LABEL,
  MONITORING_TONE,
  downloadCsv,
  fmtDate,
  fmtDateTime,
  greeting,
  monthLabel,
  pct,
  shortDate,
  weekday,
} from '../../core/format';
import { Dashboard } from '../../core/models';
import { SubjectFilterService, onSubjectChange } from '../../core/subject-filter.service';
import { BarChartComponent } from '../../shared/bar-chart.component';
import { CompareChartComponent, CompareRow } from '../../shared/compare-chart.component';
import { IconComponent } from '../../shared/icon.component';
import { TermPipe } from '../../shared/term.pipe';
import { LinePoint, LineChartComponent } from '../../shared/line-chart.component';
import { RingChartComponent, RingSegment } from '../../shared/ring-chart.component';
import { SubjectFilterComponent } from '../../shared/subject-filter.component';

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule, RouterLink, IconComponent, LineChartComponent, BarChartComponent, RingChartComponent, CompareChartComponent, SubjectFilterComponent, TermPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private api = inject(ApiService);
  private router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly subject = inject(SubjectFilterService);

  protected readonly data = signal<Dashboard | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly range = signal<'week' | 'month'>('week');
  protected sectionId: number | null = null;

  protected readonly greeting = greeting();
  protected readonly pct = pct;
  protected readonly fmtDate = fmtDate;
  protected readonly fmtDateTime = fmtDateTime;
  protected readonly MON_LABEL = MONITORING_LABEL;
  protected readonly MON_TONE = MONITORING_TONE;
  protected readonly LEVEL_LABEL = LEVEL_LABEL;
  protected readonly LEVEL_TONE = LEVEL_TONE;
  protected readonly AREA_LABEL = AREA_LABEL;
  protected readonly AREA_TONE = AREA_TONE;

  protected readonly title = computed(() => {
    const u = this.auth.user();
    if (!u) return '';
    return u.role === 'ADMIN' ? `${this.greeting}, ${u.firstName}!` : `${this.greeting}, Teacher ${u.firstName}!`;
  });

  protected readonly trendPoints = computed<LinePoint[]>(() =>
    (this.data()?.trend ?? []).map((d) => ({
      label: this.range() === 'week' ? weekday(d.date) : shortDate(d.date),
      value: d.rate,
      detail: `${fmtDate(d.date)} · ${d.present + d.late}/${d.total} present`,
    })),
  );

  protected readonly monthPoints = computed(() =>
    (this.data()?.monthly ?? []).slice(-6).map((m) => ({ label: monthLabel(m.month), value: m.rate, detail: `${monthLabel(m.month, true)} · ${m.days} school days` })),
  );

  protected readonly topLearners = computed(() => (this.data()?.learners ?? []).slice(0, 8));

  protected readonly scoreRing = computed<RingSegment[]>(() => {
    const a = this.data()?.assessment;
    if (!a?.scores) return [];
    return [
      { label: 'Excellent (90–100)', value: a.distribution.excellent, color: 'var(--brand)' },
      { label: `Satisfactory (${a.masteryTarget}–89)`, value: a.distribution.satisfactory, color: '#f5b316' },
      { label: 'Needs Improvement', value: a.distribution.needsImprovement, color: '#e5484d' },
    ];
  });

  protected readonly prePostRows = computed<CompareRow[]>(() =>
    (this.data()?.prePost.byCompetency ?? []).map((c) => ({
      label: c.code,
      sub: this.subject.selectedId() ? c.title : c.subject,
      a: c.avgPreCompleted ?? c.avgPre,
      b: c.avgPostCompleted,
    })),
  );

  constructor() {
    onSubjectChange((first) => {
      if (!first) this.sectionId = null;
      this.load();
    });
  }

  protected load() {
    this.error.set(null);
    this.api.dashboard({ range: this.range(), sectionId: this.sectionId, ...this.subject.query() }).subscribe({
      next: (d) => this.data.set(d),
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  protected setRange(r: 'week' | 'month') {
    this.range.set(r);
    this.load();
  }

  protected open(id: number) {
    this.router.navigate(['/learners', id]);
  }

  protected exportLearners() {
    const d = this.data();
    if (!d) return;
    downloadCsv(
      `learner-monitoring-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { key: 'learnerNo', label: 'Learner ID' },
        { key: 'name', label: 'Learner' },
        { key: 'section', label: 'Section' },
        { key: 'attendance', label: 'Attendance' },
        { key: 'status', label: 'Competency Status' },
        { key: 'assessment', label: 'Assessment' },
        { key: 'action', label: 'Recommended Action' },
      ],
      d.learners.map((l) => ({
        learnerNo: l.learnerNo,
        name: l.name,
        section: l.section,
        attendance: pct(l.attendanceRate),
        status: MONITORING_LABEL[l.monitoring],
        assessment: `${pct(l.assessmentAvg)} (${l.descriptor})`,
        action: l.action,
      })),
    );
  }
}
