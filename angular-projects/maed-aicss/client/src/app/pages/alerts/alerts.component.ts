import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/auth.interceptor';
import { ALERT_STATUS_LABEL, ALERT_STATUS_TONE, LEVEL_ICON, LEVEL_LABEL, LEVEL_TONE, fmtDate, fmtDateTime } from '../../core/format';
import { AlertItem, AlertLevel, AlertStatus, AlertsResponse } from '../../core/models';
import { NavStateService } from '../../core/nav-state.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';

@Component({
  selector: 'app-alerts',
  imports: [FormsModule, RouterLink, IconComponent, ModalComponent],
  templateUrl: './alerts.component.html',
  styleUrl: './alerts.component.scss',
})
export class AlertsComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private navState = inject(NavStateService);

  protected readonly data = signal<AlertsResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly refreshing = signal(false);
  protected level: AlertLevel | '' = '';
  protected status: AlertStatus | '' = '';
  protected sectionId: number | null = null;

  protected readonly LEVELS: AlertLevel[] = ['HIGH', 'MEDIUM', 'LOW'];
  protected readonly LEVEL_LABEL = LEVEL_LABEL;
  protected readonly LEVEL_TONE = LEVEL_TONE;
  protected readonly LEVEL_ICON = LEVEL_ICON;
  protected readonly STATUS_LABEL = ALERT_STATUS_LABEL;
  protected readonly STATUS_TONE = ALERT_STATUS_TONE;
  protected readonly fmtDate = fmtDate;
  protected readonly fmtDateTime = fmtDateTime;

  // Follow-up modal
  protected readonly current = signal<AlertItem | null>(null);
  protected readonly saving = signal(false);
  protected fuStatus: AlertStatus = 'FOLLOWED_UP';
  protected fuNote = '';

  protected readonly insight = computed(() => {
    const d = this.data();
    if (!d) return '';
    const c = d.counts;
    if (c.HIGH) return `${c.HIGH} learner(s) with frequent absences may be at risk of falling behind. Follow up with their parents or guardians first.`;
    if (c.MEDIUM) return `${c.MEDIUM} learner(s) or competencies are below target. Plan reteaching and supplementary activities.`;
    if (c.LOW) return `${c.LOW} competency(ies) could use a short whole-class review.`;
    return 'No open alerts. Learners are on track.';
  });

  constructor() {
    this.load();
  }

  protected load() {
    this.error.set(null);
    this.api.alerts({ level: this.level, status: this.status, sectionId: this.sectionId }).subscribe({
      next: (d) => this.data.set(d),
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  protected filterLevel(l: AlertLevel) {
    this.level = this.level === l ? '' : l;
    this.load();
  }

  protected refresh() {
    this.refreshing.set(true);
    this.api.refreshAlerts().subscribe({
      next: () => {
        this.refreshing.set(false);
        this.toast.success('Alerts recalculated from the latest attendance and assessment data');
        this.load();
        this.navState.refreshAlerts();
      },
      error: (err) => {
        this.refreshing.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }

  protected openFollowUp(a: AlertItem) {
    this.current.set(a);
    this.fuStatus = a.status === 'OPEN' ? 'FOLLOWED_UP' : a.status;
    this.fuNote = a.followUpNote && a.followUpBy ? a.followUpNote : '';
  }

  protected saveFollowUp() {
    const a = this.current();
    if (!a) return;
    this.saving.set(true);
    this.api.followUp(a.id, this.fuStatus, this.fuNote).subscribe({
      next: () => {
        this.saving.set(false);
        this.current.set(null);
        this.toast.success(this.fuStatus === 'RESOLVED' ? 'Alert resolved' : this.fuStatus === 'OPEN' ? 'Alert reopened' : 'Follow-up recorded');
        this.load();
        this.navState.refreshAlerts();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }
}
