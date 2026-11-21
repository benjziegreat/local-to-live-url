import { Component, computed, input, signal } from '@angular/core';

export interface BarPoint {
  label: string;
  value: number | null;
  detail?: string;
}

const W = 520;
const H = 220;
const PAD = { top: 26, right: 12, bottom: 28, left: 42 };

/** Percentage bar chart (0-100%) with value labels and hover detail. */
@Component({
  selector: 'app-bar-chart',
  template: `
    <div class="wrap">
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel()" (mouseleave)="hover.set(null)">
        @for (t of ticks; track t) {
          <line [attr.x1]="PAD.left" [attr.x2]="W - PAD.right" [attr.y1]="y(t)" [attr.y2]="y(t)" class="grid" />
          <text [attr.x]="PAD.left - 8" [attr.y]="y(t) + 4" class="axis" text-anchor="end">{{ t }}%</text>
        }
        @for (b of bars(); track b.i) {
          @if (b.value !== null) {
            <rect [attr.x]="b.x" [attr.y]="y(b.value)" [attr.width]="b.w" [attr.height]="y(0) - y(b.value)" rx="3"
                  class="bar" [class.active]="hover() === b.i" />
            <text [attr.x]="b.x + b.w / 2" [attr.y]="y(b.value) - 7" class="val" text-anchor="middle">{{ b.value }}%</text>
          }
          <text [attr.x]="b.x + b.w / 2" [attr.y]="H - 8" class="axis" text-anchor="middle">{{ b.label }}</text>
          <rect [attr.x]="b.x - b.gap / 2" y="0" [attr.width]="b.w + b.gap" [attr.height]="H" class="hit"
                (mouseenter)="hover.set(b.i)" (touchstart)="hover.set(b.i)" />
        }
      </svg>
      @if (hovered(); as h) {
        <div class="tip" [style.left.%]="((h.x + h.w / 2) / W) * 100">
          <strong>{{ h.value === null ? 'No data' : h.value + '%' }}</strong>
          <span>{{ h.detail || h.label }}</span>
        </div>
      }
      @if (!points().length) {
        <p class="none">No data yet.</p>
      }
    </div>
  `,
  styles: `
    .wrap { position: relative; }
    svg { width: 100%; height: auto; display: block; overflow: visible; }
    .grid { stroke: var(--line); stroke-width: 1; }
    .axis { font-size: 11px; fill: var(--text-3); font-family: var(--font); }
    .val { font-size: 11.5px; font-weight: 700; fill: var(--text); font-family: var(--font); }
    .bar { fill: var(--brand); transition: opacity .15s; }
    .bar.active { opacity: 0.8; }
    .hit { fill: transparent; }
    .tip {
      position: absolute; top: 0; transform: translate(-50%, -100%);
      padding: 6px 10px; font-size: 0.78rem; pointer-events: none; display: grid;
      white-space: nowrap; border-radius: 8px; background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-lg);
      span { color: var(--text-3); }
    }
    .none { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--text-3); }
  `,
})
export class BarChartComponent {
  readonly points = input.required<BarPoint[]>();
  readonly ariaLabel = input('Bar chart');

  protected readonly W = W;
  protected readonly H = H;
  protected readonly PAD = PAD;
  protected readonly ticks = [0, 20, 40, 60, 80, 100];
  protected readonly hover = signal<number | null>(null);

  protected y(v: number) {
    return PAD.top + (1 - v / 100) * (H - PAD.top - PAD.bottom);
  }

  protected readonly bars = computed(() => {
    const n = Math.max(1, this.points().length);
    const slot = (W - PAD.left - PAD.right) / n;
    const w = Math.min(64, slot * 0.6);
    return this.points().map((p, i) => ({ ...p, i, w, gap: slot - w, x: PAD.left + slot * i + (slot - w) / 2 }));
  });

  protected readonly hovered = computed(() => {
    const i = this.hover();
    return i === null ? null : (this.bars()[i] ?? null);
  });
}
