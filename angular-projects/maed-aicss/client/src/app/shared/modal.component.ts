import { Component, HostListener, input, output } from '@angular/core';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-modal',
  imports: [IconComponent],
  template: `
    @if (open()) {
      <div class="overlay" (click)="closed.emit()"></div>
      <section class="dialog glass" role="dialog" aria-modal="true" [attr.aria-label]="title()" [style.max-width.px]="width()">
        <header>
          <h2>{{ title() }}</h2>
          <button type="button" class="btn ghost icon-only" (click)="closed.emit()" aria-label="Close">
            <app-icon name="x" />
          </button>
        </header>
        <div class="body"><ng-content /></div>
      </section>
    }
  `,
  styles: `
    .overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(10, 18, 36, 0.35); backdrop-filter: blur(4px); animation: fade .2s ease; }
    .dialog { position: fixed; z-index: 1001; left: 50%; top: 50%; transform: translate(-50%, -50%);
      width: calc(100% - 32px); max-height: calc(100dvh - 48px); display: flex; flex-direction: column;
      background: var(--glass-strong); animation: pop .22s ease; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px 8px; }
    h2 { font-size: 1.1rem; }
    .body { padding: 8px 18px 18px; overflow-y: auto; }
    @keyframes fade { from { opacity: 0; } }
    @keyframes pop { from { opacity: 0; transform: translate(-50%, -46%) scale(.98); } }
    @media (max-width: 560px) {
      .dialog { top: auto; bottom: 0; transform: translateX(-50%); width: 100%; border-radius: 22px 22px 0 0; max-height: 92dvh; }
      @keyframes pop { from { transform: translate(-50%, 30px); opacity: 0; } }
    }
  `,
})
export class ModalComponent {
  readonly open = input(false);
  readonly title = input('');
  readonly width = input(520);
  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.open()) this.closed.emit();
  }
}
