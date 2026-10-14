import { Component, computed, input, signal } from '@angular/core';

export interface LinePoint {
  label: string;
  value: number | null;
  detail?: string;
}

const W = 320;
const H = 170;
const PAD = { top: 14, right: 12, bottom: 26, left: 34 };

/** Single-series line chart (0–100 %) with crosshair tooltip. Gaps for null values. */
@Component({
  selector: 'app-line-chart',
  template: `
    <div class="wrap">
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel()"
           (mouseleave)="hover.set(null)">
        @for (t of ticks; track t) {
          <line [attr.x1]="PAD.left" [attr.x2]="W - PAD.right" [attr.y1]="y(t)" [attr.y2]="y(t)" class="grid" />
          <text [attr.x]="PAD.left - 6" [attr.y]="y(t) + 3" class="axis" text-anchor="end">{{ t }}</text>
        }
        <path [attr.d]="area()" class="area" />
        <path [attr.d]="line()" class="line" />
        @for (p of plotted(); track p.i) {
          @if (p.value !== null) {
            <circle [attr.cx]="p.x" [attr.cy]="p.y" r="4" class="dot" [class.active]="hover() === p.i" />
          }
          <text [attr.x]="p.x" [attr.y]="H - 8" class="axis" text-anchor="middle">{{ p.label }}</text>
          <rect [attr.x]="p.x - step() / 2" y="0" [attr.width]="step()" [attr.height]="H" class="hit"
                (mouseenter)="hover.set(p.i)" (touchstart)="hover.set(p.i)" />
        }
        @if (hovered(); as h) {
          <line [attr.x1]="h.x" [attr.x2]="h.x" [attr.y1]="PAD.top" [attr.y2]="H - PAD.bottom" class="cross" />
        }
      </svg>
      @if (hovered(); as h) {
        <div class="tip glass" [style.left.%]="(h.x / W) * 100">
          <strong>{{ h.value === null ? 'No class' : h.value + '%' }}</strong>
          <span>{{ h.detail || h.label }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    .wrap { position: relative; }
    svg { width: 100%; height: auto; display: block; overflow: visible; }
    .grid { stroke: var(--glass-line); stroke-width: 1; }
    .axis { font-size: 9px; fill: var(--text-3); font-family: var(--font); }
    .line { fill: none; stroke: var(--brand); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .area { fill: var(--info-soft); }
    .dot { fill: var(--brand); stroke: var(--glass-strong); stroke-width: 2; }
    .dot.active { r: 6; }
    .cross { stroke: var(--text-3); stroke-dasharray: 3 3; }
    .hit { fill: transparent; cursor: crosshair; }
    .tip {
      position: absolute; top: -6px; transform: translate(-50%, -100%);
      padding: 6px 10px; font-size: 0.78rem; pointer-events: none; display: grid;
      white-space: nowrap; border-radius: 10px; background: var(--glass-strong);
      span { color: var(--text-3); }
    }
  `,
})
export class LineChartComponent {
  readonly points = input.required<LinePoint[]>();
  readonly ariaLabel = input('Attendance trend');

  protected readonly W = W;
  protected readonly H = H;
  protected readonly PAD = PAD;
  protected readonly ticks = [0, 25, 50, 75, 100];
  protected readonly hover = signal<number | null>(null);

  protected y(v: number) {
    return PAD.top + (1 - v / 100) * (H - PAD.top - PAD.bottom);
  }

  protected readonly step = computed(() => (W - PAD.left - PAD.right) / Math.max(1, this.points().length));

  protected readonly plotted = computed(() =>
    this.points().map((p, i) => ({
      ...p,
      i,
      x: PAD.left + this.step() * (i + 0.5),
      y: p.value === null ? 0 : this.y(p.value),
    })),
  );

  protected readonly hovered = computed(() => {
    const i = this.hover();
    return i === null ? null : this.plotted()[i] ?? null;
  });

  /** Segments split at null values so missing days are gaps, not drops to zero. */
  private segments() {
    const segs: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    for (const p of this.plotted()) {
      if (p.value === null) {
        if (cur.length) segs.push(cur);
        cur = [];
      } else cur.push({ x: p.x, y: p.y });
    }
    if (cur.length) segs.push(cur);
    return segs;
  }

  protected readonly line = computed(() =>
    this.segments()
      .map((s) => s.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(''))
      .join(''),
  );

  protected readonly area = computed(() => {
    const base = H - PAD.bottom;
    return this.segments()
      .filter((s) => s.length > 1)
      .map((s) => `M${s[0].x},${base}` + s.map((p) => `L${p.x},${p.y}`).join('') + `L${s[s.length - 1].x},${base}Z`)
      .join('');
  });
}
