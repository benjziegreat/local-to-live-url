import { Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { IconComponent } from './icon.component';

const ICON = { success: 'check-circle', warning: 'alert', critical: 'alert', info: 'bell' } as const;

@Component({
  selector: 'app-toast-host',
  imports: [IconComponent],
  template: `
    <div class="stack" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast glass" [class]="t.kind" (click)="toasts.dismiss(t.id)">
          <app-icon [name]="icon[t.kind]" />
          <span>{{ t.text }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    .stack { position: fixed; z-index: 2000; right: 16px; bottom: 16px; display: grid; gap: 8px; max-width: min(380px, calc(100vw - 32px)); }
    .toast { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; cursor: pointer; font-size: 0.9rem;
      background: var(--glass-strong); border-left: 4px solid var(--info); animation: slide .25s ease; }
    .toast.success { border-left-color: var(--success); app-icon { color: var(--success); } }
    .toast.warning { border-left-color: var(--warning); app-icon { color: var(--warning); } }
    .toast.critical { border-left-color: var(--critical); app-icon { color: var(--critical); } }
    @keyframes slide { from { opacity: 0; transform: translateY(10px); } }
    @media (max-width: 720px) { .stack { bottom: 84px; left: 16px; right: 16px; max-width: none; } }
  `,
})
export class ToastHostComponent {
  protected readonly toasts = inject(ToastService);
  protected readonly icon = ICON;
}
