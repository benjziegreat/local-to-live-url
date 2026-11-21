import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/auth.interceptor';
import { AREA_LABEL, AREA_TONE, BAND_LABEL, BAND_TONE, TYPE_LABEL, fmtDate, pct } from '../../core/format';
import { AreaStatus, Competency, CompetencyDetail, CompetencyOverview, CompetencyWithStats } from '../../core/models';
import { NavStateService } from '../../core/nav-state.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';
import { RingChartComponent, RingSegment } from '../../shared/ring-chart.component';

const EMPTY: Partial<Competency> = { code: '', learningArea: '', title: '', quarter: 1, active: true };

@Component({
  selector: 'app-competencies',
  imports: [FormsModule, RouterLink, IconComponent, RingChartComponent, ModalComponent],
  templateUrl: './competencies.component.html',
  styleUrl: './competencies.component.scss',
})
export class CompetenciesComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private navState = inject(NavStateService);
  protected readonly auth = inject(AuthService);

  protected readonly data = signal<CompetencyOverview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected sectionId: number | null = null;
  protected quarter: number | null = null;
  protected readonly focusArea = signal<string | null>(null);
  protected readonly areaFilter = signal<string>('');

  protected readonly pct = pct;
  protected readonly fmtDate = fmtDate;
  protected readonly AREA_LABEL = AREA_LABEL;
  protected readonly AREA_TONE = AREA_TONE;
  protected readonly BAND_LABEL = BAND_LABEL;
  protected readonly BAND_TONE = BAND_TONE;
  protected readonly TYPE_LABEL = TYPE_LABEL;

  // Detail + edit modals
  protected readonly detail = signal<CompetencyDetail | null>(null);
  protected readonly detailOpen = signal(false);
  protected readonly editOpen = signal(false);
  protected readonly saving = signal(false);
  protected form: Partial<Competency> = { ...EMPTY };
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
    return (this.data()?.competencies ?? []).filter((c) => !f || c.learningArea === f);
  });

  protected readonly learningAreas = computed(() => [...new Set((this.data()?.competencies ?? []).map((c) => c.learningArea))]);

  constructor() {
    this.load();
  }

  protected load() {
    this.error.set(null);
    this.api.competencies({ sectionId: this.sectionId, quarter: this.quarter }).subscribe({
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
    this.api.competency(c.id, { sectionId: this.sectionId }).subscribe({
      next: (d) => this.detail.set(d),
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected openEdit(c?: Competency) {
    this.editingId = c?.id ?? null;
    this.form = c ? { code: c.code, learningArea: c.learningArea, title: c.title, quarter: c.quarter, active: c.active } : { ...EMPTY };
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
    if (!confirm(`Delete ${c.code}? Its assessments and scores will also be deleted.`)) return;
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
