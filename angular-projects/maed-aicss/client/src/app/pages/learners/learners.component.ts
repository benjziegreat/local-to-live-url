import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/auth.interceptor';
import { MONITORING_LABEL, MONITORING_TONE, downloadCsv, pct, todayIso } from '../../core/format';
import { LearnerInput, LearnerList, LearnerRow, Monitoring } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { AvatarComponent } from '../../shared/avatar.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';

const BLANK: LearnerInput = { firstName: '', lastName: '', sex: 'M', sectionId: null, lrn: '', birthDate: '', guardian: '', contactNo: '' };

@Component({
  selector: 'app-learners',
  imports: [FormsModule, RouterLink, IconComponent, AvatarComponent, ModalComponent],
  templateUrl: './learners.component.html',
  styleUrl: './learners.component.scss',
})
export class LearnersComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly data = signal<LearnerList | null>(null);
  protected readonly error = signal<string | null>(null);
  protected q = '';
  protected sectionId: number | null = null;
  protected monitoring: Monitoring | '' = '';
  protected archived = false;
  protected sort: 'name' | 'risk';

  protected readonly pct = pct;
  protected readonly MON_LABEL = MONITORING_LABEL;
  protected readonly MON_TONE = MONITORING_TONE;

  protected readonly formOpen = signal(false);
  protected readonly saving = signal(false);
  protected form: LearnerInput = { ...BLANK };
  protected editingId: number | null = null;

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const qp = inject(ActivatedRoute).snapshot.queryParamMap;
    this.sort = qp.get('sort') === 'risk' ? 'risk' : 'name';
    this.load();
  }

  protected load() {
    this.error.set(null);
    this.api
      .learners({ q: this.q, sectionId: this.sectionId, monitoring: this.monitoring, status: this.archived ? 'ARCHIVED' : null, sort: this.sort })
      .subscribe({
        next: (d) => this.data.set(d),
        error: (err) => this.error.set(errorMessage(err)),
      });
  }

  protected search() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 300);
  }

  protected open(l: LearnerRow) {
    this.router.navigate(['/learners', l.id]);
  }

  protected openForm(l?: LearnerRow) {
    this.editingId = l?.id ?? null;
    if (l) {
      // Fetch the full record for birthdate/guardian/contact
      this.api.learner(l.id).subscribe({
        next: (p) => {
          const x = p.learner;
          this.form = {
            firstName: x.firstName,
            lastName: x.lastName,
            sex: x.sex,
            sectionId: x.sectionId,
            lrn: x.lrn ?? '',
            birthDate: x.birthDate ? x.birthDate.slice(0, 10) : '',
            guardian: x.guardian ?? '',
            contactNo: x.contactNo ?? '',
          };
          this.formOpen.set(true);
        },
        error: (err) => this.toast.error(errorMessage(err)),
      });
    } else {
      this.form = { ...BLANK, sectionId: this.sectionId ?? this.data()?.sections[0]?.id ?? null };
      this.formOpen.set(true);
    }
  }

  protected save() {
    this.saving.set(true);
    this.api.saveLearner(this.form, this.editingId ?? undefined).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.toast.success(this.editingId ? 'Learner updated' : `Learner added as ${'learnerNo' in res ? res.learnerNo : ''}`);
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }

  protected toggleArchive(l: LearnerRow) {
    const archive = l.status === 'ACTIVE';
    if (archive && !confirm(`Archive ${l.name}? Their records are kept but they leave monitoring.`)) return;
    this.api.archiveLearner(l.id, archive).subscribe({
      next: () => {
        this.toast.success(archive ? `${l.name} archived` : `${l.name} restored`);
        this.load();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected export() {
    const d = this.data();
    if (!d) return;
    downloadCsv(
      `learners-${todayIso()}.csv`,
      [
        { key: 'learnerNo', label: 'Learner ID' },
        { key: 'lrn', label: 'LRN' },
        { key: 'name', label: 'Name' },
        { key: 'sex', label: 'Sex' },
        { key: 'section', label: 'Grade & Section' },
        { key: 'attendance', label: 'Attendance' },
        { key: 'assessment', label: 'Assessment Avg' },
        { key: 'status', label: 'Monitoring' },
      ],
      d.learners.map((l) => ({ ...l, attendance: pct(l.attendanceRate), assessment: pct(l.assessmentAvg), status: MONITORING_LABEL[l.monitoring] })),
    );
  }
}
