import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/auth.interceptor';
import { LOCATION_LABEL, LOCATION_TONE, RISK_TONE, titleCase } from '../../core/format';
import {
  AdviserOverview,
  AlertItem,
  HeatmapData,
  Intervention,
  Outcome,
  PendingExcuse,
  RiskLevel,
  RiskProfile,
  StudentHistory,
} from '../../core/models';
import { poll } from '../../core/polling';
import { ToastService } from '../../core/toast.service';
import { AvatarComponent } from '../../shared/avatar.component';
import { ChatComponent } from '../../shared/chat.component';
import { HeatmapComponent } from '../../shared/heatmap.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';

const ACTIONS = [
  'Parent conference',
  'One-on-one counseling',
  'Home visit',
  'Referred to guidance counselor',
  'Phone call to parent',
  'Peer mentoring assigned',
];

const OUTCOME_LABEL: Record<Outcome, string> = { GREEN: 'Resolved', YELLOW: 'Monitoring', RED: 'Escalated' };
const OUTCOME_TONE: Record<Outcome, string> = { GREEN: 'success', YELLOW: 'warning', RED: 'critical' };
const ALERT_LABEL: Record<string, string> = { EARLY_WARNING: 'Early warning', UNEXCUSED_ABSENCE: 'Unexcused absence', CUTTING: 'Cutting' };

type HistoryTab = 'messages' | 'interventions' | 'alerts';

@Component({
  selector: 'app-adviser-portal',
  imports: [DatePipe, FormsModule, AvatarComponent, ChatComponent, HeatmapComponent, IconComponent, ModalComponent],
  templateUrl: './adviser-portal.component.html',
  styleUrl: './adviser-portal.component.scss',
})
export class AdviserPortalComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  protected readonly overview = signal<AdviserOverview | null>(null);
  protected readonly interventions = signal<Intervention[]>([]);
  protected readonly alerts = signal<AlertItem[]>([]);
  protected readonly excuses = signal<PendingExcuse[]>([]);
  protected readonly heatmap = signal<HeatmapData | null>(null);
  protected readonly riskFilter = signal<RiskLevel | null>(null);
  protected readonly error = signal<string | null>(null);

  // Intervention modal
  protected readonly interventionOpen = signal(false);
  protected form = { studentId: 0, actionTaken: ACTIONS[0], notes: '', outcome: 'YELLOW' as Outcome };

  // History modal
  protected readonly history = signal<StudentHistory | null>(null);
  protected readonly historyTab = signal<HistoryTab>('messages');
  protected readonly chatParentId = signal<number | null>(null);

  protected readonly ACTIONS = ACTIONS;
  protected readonly OUTCOMES: Outcome[] = ['GREEN', 'YELLOW', 'RED'];
  protected readonly OUTCOME_LABEL = OUTCOME_LABEL;
  protected readonly OUTCOME_TONE = OUTCOME_TONE;
  protected readonly ALERT_LABEL = ALERT_LABEL;
  protected readonly RISK_TONE = RISK_TONE;
  protected readonly LOCATION_LABEL = LOCATION_LABEL;
  protected readonly LOCATION_TONE = LOCATION_TONE;
  protected readonly titleCase = titleCase;

  protected readonly profiles = computed(() => {
    const list = this.overview()?.students ?? [];
    const f = this.riskFilter();
    return f ? list.filter((s) => s.risk === f) : list;
  });

  constructor() {
    poll(() => this.loadLive(), 30_000);
    this.api.heatmap(26).subscribe((h) => this.heatmap.set(h));
  }

  private loadLive() {
    this.api.adviserOverview().subscribe({
      next: (o) => {
        this.overview.set(o);
        this.error.set(null);
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
    this.api.interventions().subscribe((i) => this.interventions.set(i));
    this.api.adviserAlerts().subscribe((a) => this.alerts.set(a));
    this.api.pendingExcuses().subscribe((e) => this.excuses.set(e));
  }

  protected toggleRisk(level: RiskLevel) {
    this.riskFilter.set(this.riskFilter() === level ? null : level);
  }

  // ---- Interventions ----
  protected openIntervention(student?: { id: number }) {
    this.form = {
      studentId: student?.id ?? this.overview()?.students[0]?.id ?? 0,
      actionTaken: ACTIONS[0],
      notes: '',
      outcome: 'YELLOW',
    };
    this.interventionOpen.set(true);
  }

  protected saveIntervention() {
    this.api.addIntervention({ ...this.form, studentId: Number(this.form.studentId) }).subscribe({
      next: () => {
        this.interventionOpen.set(false);
        this.toast.success('Intervention logged.');
        this.loadLive();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  // ---- History / communication ----
  protected openHistory(student: RiskProfile | { id: number }, tab: HistoryTab = 'messages') {
    this.historyTab.set(tab);
    this.api.studentHistory(student.id).subscribe({
      next: (h) => {
        this.history.set(h);
        this.chatParentId.set(h.parents[0]?.id ?? null);
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected closeHistory() {
    this.history.set(null);
  }

  // ---- Alerts & excuse notes ----
  protected ack(alert: AlertItem) {
    this.api.ackAlert(alert.id).subscribe(() => {
      this.alerts.update((list) => list.filter((a) => a.id !== alert.id));
    });
  }

  protected decide(note: PendingExcuse, decision: 'APPROVED' | 'REJECTED') {
    this.api.decideExcuse(note.id, decision).subscribe({
      next: (res) => {
        this.excuses.update((list) => list.filter((n) => n.id !== note.id));
        this.toast.success(
          decision === 'APPROVED'
            ? `Excuse approved — ${res.excusedRecords} absence record(s) marked excused.`
            : 'Excuse note rejected.',
        );
        this.loadLive();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }
}
