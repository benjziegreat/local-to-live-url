import { Component, computed, input, signal } from '@angular/core';

export interface LinePoint {
  label: string;
  value: number | null;
  detail?: string;
}

const W = 520;
const H = 220;
const PAD = { top: 26, right: 18, bottom: 28, left: 42 };

/** Single-series percentage line chart with value labels, crosshair tooltip and gaps for nulls. */
@Component({
  selector: 'app-line-chart',
  template: `
    <div class="wrap">
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel()" (mouseleave)="hover.set(null)">
        @for (t of ticks(); track t) {
          <line [attr.x1]="PAD.left" [attr.x2]="W - PAD.right" [attr.y1]="y(t)" [attr.y2]="y(t)" class="grid" />
          <text [attr.x]="PAD.left - 8" [attr.y]="y(t) + 4" class="axis" text-anchor="end">{{ t }}%</text>
        }
        <path [attr.d]="area()" class="area" />
        <path [attr.d]="line()" class="line" />
        @for (p of plotted(); track p.i) {
          @if (p.value !== null) {
            <line [attr.x1]="p.x" [attr.x2]="p.x" [attr.y1]="p.y" [attr.y2]="H - PAD.bottom" class="drop" />
            <circle [attr.cx]="p.x" [attr.cy]="p.y" r="5" class="dot" [class.active]="hover() === p.i" />
            @if (showValues()) {
              <text [attr.x]="p.x" [attr.y]="p.y - 11" class="val" text-anchor="middle">{{ p.value }}%</text>
            }
          }
          @if (showLabel(p.i)) {
            <text [attr.x]="p.x" [attr.y]="H - 8" class="axis" text-anchor="middle">{{ p.label }}</text>
          }
          <rect [attr.x]="p.x - step() / 2" y="0" [attr.width]="step()" [attr.height]="H" class="hit"
                (mouseenter)="hover.set(p.i)" (touchstart)="hover.set(p.i)" />
        }
      </svg>
      @if (hovered(); as h) {
        <div class="tip" [style.left.%]="(h.x / W) * 100">
          <strong>{{ h.value === null ? 'No data' : h.value + '%' }}</strong>
          <span>{{ h.detail || h.label }}</span>
        </div>
      }
      @if (!points().length) {
        <p class="none">No attendance recorded for this period.</p>
      }
    </div>
  `,
  styles: `
    .wrap { position: relative; }
    svg { width: 100%; height: auto; display: block; overflow: visible; }
    .grid { stroke: var(--line); stroke-width: 1; }
    .axis { font-size: 11px; fill: var(--text-3); font-family: var(--font); }
    .val { font-size: 11.5px; font-weight: 700; fill: var(--text); font-family: var(--font); }
    .line { fill: none; stroke: var(--brand); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
    .area { fill: color-mix(in srgb, var(--brand) 10%, transparent); }
    .drop { stroke: var(--line); stroke-width: 1; }
    .dot { fill: var(--brand); stroke: var(--surface); stroke-width: 2; }
    .dot.active { r: 7; }
    .hit { fill: transparent; cursor: crosshair; }
    .tip {
      position: absolute; top: 0; transform: translate(-50%, -100%);
      padding: 6px 10px; font-size: 0.78rem; pointer-events: none; display: grid;
      white-space: nowrap; border-radius: 8px; background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-lg);
      span { color: var(--text-3); }
    }
    .none { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--text-3); font-size: 0.9rem; }
  `,
})
export class LineChartComponent {
  readonly points = input.required<LinePoint[]>();
  readonly ariaLabel = input('Attendance trend');
  /** Lowest value on the y-axis; 'auto' zooms in on the data like the mockup (80-100%). */
  readonly min = input<number | 'auto'>('auto');
  readonly showValues = input(true);

  protected readonly W = W;
  protected readonly H = H;
  protected readonly PAD = PAD;
  protected readonly hover = signal<number | null>(null);

  protected readonly floor = computed(() => {
    const m = this.min();
    if (m !== 'auto') return m;
    const values = this.points().map((p) => p.value).filter((v): v is number => v !== null);
    if (!values.length) return 0;
    return Math.max(0, Math.min(80, Math.floor((Math.min(...values) - 5) / 10) * 10));
  });

  protected readonly ticks = computed(() => {
    const lo = this.floor();
    const step = (100 - lo) / 4;
    return [0, 1, 2, 3, 4].map((i) => Math.round(lo + step * i));
  });

  protected y(v: number) {
    const lo = this.floor();
    return PAD.top + (1 - (Math.max(v, lo) - lo) / (100 - lo)) * (H - PAD.top - PAD.bottom);
  }

  protected readonly step = computed(() => (W - PAD.left - PAD.right) / Math.max(1, this.points().length));

  /** Thin out x labels when there are many points. */
  protected showLabel(i: number) {
    const n = this.points().length;
    const every = Math.ceil(n / 10);
    return i % every === 0 || i === n - 1;
  }

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
    return i === null ? null : (this.plotted()[i] ?? null);
  });

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
