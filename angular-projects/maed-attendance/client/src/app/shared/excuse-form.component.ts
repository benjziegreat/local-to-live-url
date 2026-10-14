import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { errorMessage } from '../core/auth.interceptor';
import { todayIso } from '../core/format';
import { ToastService } from '../core/toast.service';
import { IconComponent } from './icon.component';

/** Excuse note form shared by the student and parent portals. */
@Component({
  selector: 'app-excuse-form',
  imports: [FormsModule, IconComponent],
  template: `
    <form class="stack" (ngSubmit)="submit()">
      <label class="field">
        <span>Date of absence</span>
        <input class="input" type="date" name="date" [(ngModel)]="date" [max]="today" required />
      </label>
      <label class="field">
        <span>Reason</span>
        <textarea class="input" name="reason" [(ngModel)]="reason" required minlength="5"
                  placeholder="e.g. Fever — consulted the school clinic"></textarea>
      </label>
      <label class="field">
        <span>Supporting document (optional)</span>
        <input class="input" type="file" accept="image/*,.pdf" (change)="onFile($event)" />
        <small class="muted">Medical certificate, clinic slip or parent letter. The file name is attached to the note.</small>
      </label>
      <button class="btn primary block" type="submit" [disabled]="busy() || reason.trim().length < 5">
        <app-icon name="upload" /> {{ busy() ? 'Submitting…' : 'Submit excuse note' }}
      </button>
    </form>
  `,
})
export class ExcuseFormComponent {
  /** Required when a parent submits on behalf of a child. */
  readonly studentId = input<number | undefined>(undefined);
  readonly submitted = output<void>();

  private api = inject(ApiService);
  private toast = inject(ToastService);

  protected readonly today = todayIso();
  protected date = todayIso();
  protected reason = '';
  protected attachmentName?: string;
  protected readonly busy = signal(false);

  protected onFile(event: Event) {
    this.attachmentName = (event.target as HTMLInputElement).files?.[0]?.name;
  }

  protected submit() {
    this.busy.set(true);
    this.api
      .submitExcuse({ studentId: this.studentId(), date: this.date, reason: this.reason, attachmentName: this.attachmentName })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.reason = '';
          this.attachmentName = undefined;
          this.toast.success('Excuse note submitted to the adviser for review.');
          this.submitted.emit();
        },
        error: (err) => {
          this.busy.set(false);
          this.toast.error(errorMessage(err));
        },
      });
  }
}
