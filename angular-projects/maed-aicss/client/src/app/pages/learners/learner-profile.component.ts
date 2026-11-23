import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/auth.interceptor';
import {
  ALERT_STATUS_LABEL,
  ALERT_STATUS_TONE,
  ATT_LABEL,
  ATT_TONE,
  BAND_LABEL,
  BAND_TONE,
  CHANGE_LABEL,
  CHANGE_TONE,
  INTERVENTION_LABEL,
  INTERVENTION_TONE,
  LEVEL_LABEL,
  LEVEL_TONE,
  MONITORING_LABEL,
  MONITORING_TONE,
  TYPE_LABEL,
  fmtDate,
  monthLabel,
  pct,
  signed,
} from '../../core/format';
import { LearnerProfile, MonthPoint } from '../../core/models';
import { SubjectFilterService } from '../../core/subject-filter.service';
import { AvatarComponent } from '../../shared/avatar.component';
import { BarChartComponent } from '../../shared/bar-chart.component';
import { CompareChartComponent, CompareRow } from '../../shared/compare-chart.component';
import { IconComponent } from '../../shared/icon.component';
import { TermPipe } from '../../shared/term.pipe';

@Component({
  selector: 'app-learner-profile',
  imports: [RouterLink, IconComponent, AvatarComponent, BarChartComponent, CompareChartComponent, TermPipe],
  templateUrl: './learner-profile.component.html',
  styleUrl: './learner-profile.component.scss',
})
export class LearnerProfileComponent {
  private api = inject(ApiService);
  private filter = inject(SubjectFilterService);

  /** Route param (component input binding). */
  readonly id = input.required<string>();

  protected readonly data = signal<LearnerProfile | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Subject tab: null = all subjects */
  protected readonly subjectId = signal<number | null>(null);

  protected readonly pct = pct;
  protected readonly signed = signed;
  protected readonly fmtDate = fmtDate;
  protected readonly MON_LABEL = MONITORING_LABEL;
  protected readonly MON_TONE = MONITORING_TONE;
  protected readonly ATT_LABEL = ATT_LABEL;
  protected readonly ATT_TONE = ATT_TONE;
  protected readonly BAND_LABEL = BAND_LABEL;
  protected readonly BAND_TONE = BAND_TONE;
  protected readonly LEVEL_LABEL = LEVEL_LABEL;
  protected readonly LEVEL_TONE = LEVEL_TONE;
  protected readonly ST_LABEL = ALERT_STATUS_LABEL;
  protected readonly ST_TONE = ALERT_STATUS_TONE;
  protected readonly TYPE_LABEL = TYPE_LABEL;
  protected readonly CHANGE_LABEL = CHANGE_LABEL;
  protected readonly CHANGE_TONE = CHANGE_TONE;
  protected readonly INTERVENTION_LABEL = INTERVENTION_LABEL;
  protected readonly INTERVENTION_TONE = INTERVENTION_TONE;

  /** The selected subject's summary (null on the All subjects tab). */
  protected readonly current = computed(() => this.data()?.subjects.find((s) => s.id === this.subjectId()) ?? null);

  private bySubject<T extends { subjectId: number | null }>(list: T[] | undefined): T[] {
    const id = this.subjectId();
    return (list ?? []).filter((x) => id === null || x.subjectId === id);
  }

  protected readonly recent = computed(() => this.bySubject(this.data()?.attendance.recent).slice(0, 40));
  protected readonly assessments = computed(() => this.bySubject(this.data()?.assessments));
  protected readonly competencies = computed(() => this.bySubject(this.data()?.competencies));
  protected readonly prePost = computed(() => this.bySubject(this.data()?.prePost));
  protected readonly missed = computed(() => this.bySubject(this.data()?.missedLessons));
  /** Subject alerts plus whole-day attendance alerts (which affect every subject). */
  protected readonly alerts = computed(() => {
    const id = this.subjectId();
    return (this.data()?.alerts ?? []).filter((a) => id === null || a.subjectId === id || a.subjectId === null);
  });

  /** Headline numbers for the tab: the subject's, or the learner's overall. */
  protected readonly kpis = computed(() => {
    const d = this.data();
    if (!d) return null;
    const s = this.current();
    return s
      ? {
          attendance: s.attendanceRate,
          absent: s.absent,
          recentAbsences: s.recentAbsences,
          average: s.assessmentAvg,
          descriptor: s.descriptor,
          competencies: `${s.competenciesMastered}/${s.competenciesAssessed}`,
          monitoring: s.monitoring,
          action: s.action,
        }
      : {
          attendance: d.learner.attendanceRate,
          absent: d.learner.absent,
          recentAbsences: d.learner.recentAbsences,
          average: d.learner.assessmentAvg,
          descriptor: d.learner.descriptor,
          competencies: `${d.competencies.filter((c) => c.band === 'MASTERED').length}/${d.competencies.length}`,
          monitoring: d.learner.monitoring,
          action: d.learner.action,
        };
  });

  protected readonly monthly = computed(() => {
    const d = this.data();
    const list: MonthPoint[] = this.current()?.monthly ?? d?.attendance.monthly ?? [];
    return list.map((m) => ({ label: monthLabel(m.month), value: m.rate, detail: `${monthLabel(m.month, true)} · ${m.absent} absent, ${m.late} late` }));
  });

  protected readonly compareRows = computed<CompareRow[]>(() => this.prePost().map((r) => ({ label: r.competencyCode, sub: this.subjectId() ? r.competencyTitle : r.subject, a: r.prePct, b: r.postPct })));

  constructor() {
    effect(() => {
      const id = this.id();
      this.data.set(null);
      this.error.set(null);
      this.api.learner(id).subscribe({
        next: (d) => {
          // Open on the subject chosen in the shared filter when the learner takes it.
          const wanted = untracked(() => this.filter.selectedId());
          this.subjectId.set(d.subjects.some((s) => s.id === wanted) ? wanted : null);
          this.data.set(d);
        },
        error: (err) => this.error.set(errorMessage(err)),
      });
    });
  }

  protected selectSubject(id: number | null) {
    this.subjectId.set(id);
    // Keep the shared filter in step when the user may use that subject elsewhere.
    if (id === null ? this.filter.allowAll() : this.filter.subjects().some((s) => s.id === id)) this.filter.select(id);
  }
}
