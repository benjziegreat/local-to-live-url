import { DatePipe } from '@angular/common';
import { Component, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { errorMessage } from '../core/auth.interceptor';
import { ChatMessage } from '../core/models';
import { ToastService } from '../core/toast.service';
import { IconComponent } from './icon.component';

/** Direct-message thread with one other user (parent <-> adviser). */
@Component({
  selector: 'app-chat',
  imports: [FormsModule, DatePipe, IconComponent],
  template: `
    <div class="thread" #thread>
      @for (m of messages(); track m.id) {
        <div class="bubble" [class.mine]="m.mine">
          <p>{{ m.body }}</p>
          <small>{{ m.mine ? 'You' : m.senderName }} · {{ m.createdAt | date: 'MMM d, h:mm a' }}</small>
        </div>
      } @empty {
        <p class="empty">{{ loading() ? 'Loading messages…' : 'No messages yet. Say hello!' }}</p>
      }
    </div>
    <form class="compose" (ngSubmit)="send()">
      <input class="input" name="body" [(ngModel)]="body" placeholder="Write a message…" autocomplete="off" />
      <button class="btn primary icon-only" type="submit" [disabled]="!body.trim() || sending()" aria-label="Send">
        <app-icon name="send" />
      </button>
    </form>
  `,
  styles: `
    .thread { display: grid; gap: 10px; max-height: 46dvh; min-height: 160px; overflow-y: auto; padding: 4px 2px 12px; }
    .bubble { max-width: 82%; padding: 10px 12px; border-radius: 14px 14px 14px 4px; background: var(--glass); border: 1px solid var(--glass-border);
      p { margin: 0 0 4px; white-space: pre-wrap; } small { color: var(--text-3); font-size: 0.72rem; } }
    .bubble.mine { justify-self: end; border-radius: 14px 14px 4px 14px; background: var(--info-soft); }
    .compose { display: flex; gap: 8px; padding-top: 8px; border-top: 1px solid var(--glass-line); }
  `,
})
export class ChatComponent {
  readonly withUserId = input.required<number>();
  readonly studentId = input<number | undefined>(undefined);

  private api = inject(ApiService);
  private toast = inject(ToastService);
  private threadEl = viewChild<ElementRef<HTMLDivElement>>('thread');

  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly loading = signal(true);
  protected readonly sending = signal(false);
  protected body = '';

  constructor() {
    effect(() => {
      const id = this.withUserId();
      this.loading.set(true);
      this.api.thread(id).subscribe({
        next: (list) => {
          this.messages.set(list);
          this.loading.set(false);
          this.scrollToEnd();
        },
        error: (err) => this.toast.error(errorMessage(err)),
      });
    });
  }

  protected send() {
    const body = this.body.trim();
    if (!body) return;
    this.sending.set(true);
    this.api.sendMessage(this.withUserId(), body, this.studentId()).subscribe({
      next: (msg) => {
        this.messages.update((list) => [...list, { ...msg, mine: true }]);
        this.body = '';
        this.sending.set(false);
        this.scrollToEnd();
      },
      error: (err) => {
        this.sending.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }

  private scrollToEnd() {
    setTimeout(() => {
      const el = this.threadEl()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
