import { Component, computed, input } from '@angular/core';

export interface RingSegment {
  label: string;
  value: number;
  color: string;
}

const R = 50;
const C = 2 * Math.PI * R;

/** Multi-segment ring (donut) with a big centre value and an optional legend. */
@Component({
  selector: 'app-ring-chart',
  template: `
    <div class="ring" [class.with-legend]="legend()">
      <svg viewBox="0 0 120 120" role="img" [attr.aria-label]="ariaLabel()">
        <circle cx="60" cy="60" [attr.r]="R" class="track" />
        @for (s of arcs(); track s.label) {
          <circle cx="60" cy="60" [attr.r]="R" class="arc" [attr.stroke]="s.color"
                  [attr.stroke-dasharray]="s.dash" [attr.stroke-dashoffset]="s.offset" transform="rotate(-90 60 60)" />
        }
        <text x="60" [attr.y]="caption() ? 60 : 68" class="val">{{ center() }}</text>
        @if (caption()) {
          <text x="60" y="78" class="cap">{{ caption() }}</text>
        }
      </svg>
      @if (legend()) {
        <ul class="legend">
          @for (s of segments(); track s.label) {
            <li><i [style.background]="s.color"></i> {{ s.label }} <b>{{ format(s.value) }}</b></li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .ring { display: grid; gap: 16px; align-items: center; justify-items: center; }
    .ring.with-legend { grid-template-columns: minmax(120px, 190px) minmax(0, 1fr); }
    svg { width: 100%; max-width: 190px; height: auto; display: block; }
    circle { fill: none; stroke-width: 14; }
    .track { stroke: var(--muted-soft); }
    .arc { transition: stroke-dasharray .8s ease; }
    text { text-anchor: middle; fill: var(--text); font-family: var(--font); }
    .val { font-size: 21px; font-weight: 800; }
    .cap { font-size: 8.5px; fill: var(--text-3); font-weight: 600; }
    .legend { width: 100%; }
    @media (max-width: 420px) { .ring.with-legend { grid-template-columns: 1fr; } }
  `,
})
export class RingChartComponent {
  readonly segments = input.required<RingSegment[]>();
  readonly center = input('');
  readonly caption = input('');
  readonly legend = input(true);
  readonly unit = input('%');
  readonly ariaLabel = input('Breakdown');

  protected readonly R = R;

  protected readonly arcs = computed(() => {
    const total = this.segments().reduce((n, s) => n + Math.max(0, s.value), 0) || 1;
    let acc = 0;
    return this.segments().map((s) => {
      const len = (Math.max(0, s.value) / total) * C;
      const arc = { ...s, dash: `${len} ${C - len}`, offset: -acc };
      acc += len;
      return arc;
    });
  });

  protected format(v: number) {
    return `${Math.round(v * 10) / 10}${this.unit()}`;
  }
}
