import { Component, computed, inject, input, signal, effect } from '@angular/core';
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
  LEVEL_LABEL,
  LEVEL_TONE,
  MONITORING_LABEL,
  MONITORING_TONE,
  TYPE_LABEL,
  fmtDate,
  monthLabel,
  pct,
} from '../../core/format';
import { LearnerProfile } from '../../core/models';
import { AvatarComponent } from '../../shared/avatar.component';
import { BarChartComponent } from '../../shared/bar-chart.component';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-learner-profile',
  imports: [RouterLink, IconComponent, AvatarComponent, BarChartComponent],
  templateUrl: './learner-profile.component.html',
  styleUrl: './learner-profile.component.scss',
})
export class LearnerProfileComponent {
  private api = inject(ApiService);

  /** Route param (component input binding). */
  readonly id = input.required<string>();

  protected readonly data = signal<LearnerProfile | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly pct = pct;
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

  protected readonly monthly = computed(() =>
    (this.data()?.attendance.monthly ?? []).map((m) => ({
      label: monthLabel(m.month),
      value: m.rate,
      detail: `${monthLabel(m.month, true)} · ${m.absent} absent, ${m.late} late`,
    })),
  );

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.data.set(null);
      this.error.set(null);
      this.api.learner(id).subscribe({
        next: (d) => this.data.set(d),
        error: (err) => this.error.set(errorMessage(err)),
      });
    });
  }
}
