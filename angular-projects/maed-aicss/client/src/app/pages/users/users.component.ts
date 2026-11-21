import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/auth.interceptor';
import { fmtDateTime } from '../../core/format';
import { User, UserInput } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { AvatarComponent } from '../../shared/avatar.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';

const BLANK: UserInput = { email: '', firstName: '', lastName: '', role: 'TEACHER', status: 'ACTIVE', password: '' };

/** Permission matrix shown for reference (mirrors the server's scoping rules). */
const PERMISSIONS = [
  ['Dashboard', 'View (assigned sections)', 'View all school data'],
  ['Attendance', 'Record, view, edit', 'View, manage, correct'],
  ['Competencies', 'View, update', 'Manage and monitor'],
  ['Assessment Records', 'Record, view, edit', 'View and manage'],
  ['Instructional Alerts', 'View, monitor, follow up', 'View and monitor'],
  ['Reports', 'Generate, view', 'Generate all reports'],
  ['Learners', 'View assigned learners', 'Add, edit, archive'],
  ['Settings', 'Limited personal settings', 'Full access'],
  ['User Management', '-', 'Create, edit, deactivate accounts'],
  ['System Logs', '-', 'View activity history'],
];

@Component({
  selector: 'app-users',
  imports: [FormsModule, IconComponent, AvatarComponent, ModalComponent],
  templateUrl: './users.component.html',
})
export class UsersComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  protected readonly users = signal<User[] | null>(null);
  protected readonly q = signal('');
  protected readonly formOpen = signal(false);
  protected readonly saving = signal(false);
  protected form: UserInput = { ...BLANK };
  protected editingId: number | null = null;
  protected readonly fmtDateTime = fmtDateTime;
  protected readonly PERMISSIONS = PERMISSIONS;

  protected readonly filtered = computed(() => {
    const q = this.q().toLowerCase();
    return (this.users() ?? []).filter((u) => !q || `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q));
  });

  constructor() {
    this.load();
  }

  private load() {
    this.api.users().subscribe({ next: (u) => this.users.set(u), error: (err) => this.toast.error(errorMessage(err)) });
  }

  protected open(u?: User) {
    this.editingId = u?.id ?? null;
    this.form = u ? { email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, status: u.status, password: '' } : { ...BLANK };
    this.formOpen.set(true);
  }

  protected save() {
    this.saving.set(true);
    this.api.saveUser(this.form, this.editingId ?? undefined).subscribe({
      next: (u) => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.toast.success(this.editingId ? `${u.name} updated` : `${u.name} created`);
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }

  protected toggleStatus(u: User) {
    const status = u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (status === 'INACTIVE' && !confirm(`Deactivate ${u.name}? They will be signed out and unable to log in.`)) return;
    this.api.saveUser({ email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, status, password: '' }, u.id).subscribe({
      next: () => {
        this.toast.success(status === 'ACTIVE' ? `${u.name} activated` : `${u.name} deactivated`);
        this.load();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }
}
