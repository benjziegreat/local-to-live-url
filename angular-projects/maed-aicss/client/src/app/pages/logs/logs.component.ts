import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/auth.interceptor';
import { fmtDateTime } from '../../core/format';
import { LogPage } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-logs',
  imports: [FormsModule, IconComponent],
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1><app-icon name="history" [size]="28" /> System Logs</h1>
          <p>Activity history: sign-ins, records, reports and configuration changes.</p>
        </div>
        <div class="tools">
          <input class="input" type="search" placeholder="Search action, user, details…" [(ngModel)]="q" (ngModelChange)="search()" aria-label="Search logs" />
        </div>
      </header>

      @if (error()) {
        <div class="card empty">{{ error() }}</div>
      }
      <article class="panel">
        <header class="panel-head"><h2><app-icon name="list" /> Activity</h2><span class="small">{{ data()?.total ?? 0 }} entries</span></header>
        <div class="table-wrap">
          <table class="table stacked">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Module</th><th>Details</th></tr></thead>
            <tbody>
              @for (a of data()?.items ?? []; track a.id) {
                <tr>
                  <td data-label="When" class="nowrap small">{{ fmtDateTime(a.createdAt) }}</td>
                  <td data-label="User">{{ a.user }} @if (a.role) {<span class="muted small">· {{ a.role === 'ADMIN' ? 'Admin' : 'Teacher' }}</span>}</td>
                  <td data-label="Action"><strong>{{ a.action }}</strong></td>
                  <td data-label="Module">{{ a.entity }}</td>
                  <td data-label="Details" class="small">{{ a.details }}</td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="empty">{{ data() ? 'No matching activity.' : 'Loading…' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (data(); as d) {
          @if (d.total > d.pageSize) {
            <div class="pager">
              <button type="button" class="btn sm" [disabled]="d.page <= 1" (click)="go(d.page - 1)"><app-icon name="chevron-left" [size]="15" /></button>
              <span class="small">Page {{ d.page }} of {{ pages() }}</span>
              <button type="button" class="btn sm" [disabled]="d.page >= pages()" (click)="go(d.page + 1)"><app-icon name="chevron-right" [size]="15" /></button>
            </div>
          }
        }
      </article>
    </div>
  `,
})
export class LogsComponent {
  private api = inject(ApiService);
  protected readonly data = signal<LogPage | null>(null);
  protected readonly error = signal<string | null>(null);
  protected q = '';
  protected readonly fmtDateTime = fmtDateTime;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.go(1);
  }

  protected pages() {
    const d = this.data();
    return d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  }

  protected search() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.go(1), 300);
  }

  protected go(page: number) {
    this.api.logs({ q: this.q, page, pageSize: 25 }).subscribe({
      next: (d) => this.data.set(d),
      error: (err) => this.error.set(errorMessage(err)),
    });
  }
}
