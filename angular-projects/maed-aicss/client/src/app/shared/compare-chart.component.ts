import { Component, input } from '@angular/core';

export interface CompareRow {
  label: string;
  sub?: string;
  /** Pre-test % */
  a: number | null;
  /** Post-test % */
  b: number | null;
}

/** Paired horizontal bars (0–100%) comparing pre-test and post-test per row, with the gain. */
@Component({
  selector: 'app-compare-chart',
  template: `
    <div class="legend-row" aria-hidden="true">
      <span><i class="a"></i>{{ aLabel() }}</span>
      <span><i class="b"></i>{{ bLabel() }}</span>
      @if (target() !== null) {
        <span><i class="t"></i>Target {{ target() }}%</span>
      }
    </div>
    <ul class="rows" role="list" [attr.aria-label]="ariaLabel()">
      @for (r of rows(); track r.label) {
        <li [attr.aria-label]="r.label + ': ' + aLabel() + ' ' + fmt(r.a) + ', ' + bLabel() + ' ' + fmt(r.b)">
          <div class="name">
            <strong>{{ r.label }}</strong>
            @if (r.sub) {
              <small>{{ r.sub }}</small>
            }
          </div>
          <div class="bars">
            @if (target() !== null) {
              <span class="target" [style.left.%]="target()"></span>
            }
            <div class="bar"><span class="a" [style.width.%]="r.a ?? 0"></span><em>{{ fmt(r.a) }}</em></div>
            <div class="bar"><span class="b" [style.width.%]="r.b ?? 0"></span><em>{{ fmt(r.b) }}</em></div>
          </div>
          <b class="gain" [class.up]="gain(r) !== null && gain(r)! > 0" [class.down]="gain(r) !== null && gain(r)! < 0">
            {{ gain(r) === null ? '–' : (gain(r)! > 0 ? '+' : '') + gain(r) }}
          </b>
        </li>
      } @empty {
        <li class="none">No pre-test / post-test results yet.</li>
      }
    </ul>
  `,
  styles: `
    :host { display: block; }
    .legend-row { display: flex; flex-wrap: wrap; gap: 14px; font-size: 0.8rem; color: var(--text-2); margin-bottom: 10px; }
    .legend-row i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: -2px; }
    i.a, span.a { background: #f5a524; }
    i.b, span.b { background: var(--brand); }
    i.t { width: 2px !important; background: var(--critical); }
    .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    li { display: grid; grid-template-columns: minmax(90px, 0.9fr) minmax(120px, 2.2fr) 52px; gap: 12px; align-items: center; }
    .name { display: grid; min-width: 0; line-height: 1.2; }
    .name strong { font-size: 0.88rem; }
    .name small { color: var(--text-3); font-size: 0.74rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bars { position: relative; display: grid; gap: 3px; }
    .bar { position: relative; height: 14px; border-radius: 4px; background: var(--muted-soft); }
    .bar span { position: absolute; inset: 0 auto 0 0; border-radius: 4px; transition: width 0.3s ease; }
    .bar em { position: absolute; right: 4px; top: -1px; font-style: normal; font-size: 0.7rem; font-weight: 700; color: var(--text-2); }
    .target { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--critical); opacity: 0.6; z-index: 1; }
    .gain { text-align: right; font-size: 0.92rem; font-variant-numeric: tabular-nums; }
    .gain.up { color: var(--success); }
    .gain.down { color: var(--critical); }
    .none { display: block; color: var(--text-3); text-align: center; padding: 24px 0; }
    @media (max-width: 480px) {
      li { grid-template-columns: minmax(0, 1fr) 48px; }
      .bars { grid-column: 1 / -1; grid-row: 2; }
    }
  `,
})
export class CompareChartComponent {
  readonly rows = input.required<CompareRow[]>();
  readonly aLabel = input('Pre-test');
  readonly bLabel = input('Post-test');
  readonly target = input<number | null>(null);
  readonly ariaLabel = input('Pre-test and post-test comparison');

  protected fmt(v: number | null) {
    return v === null ? '–' : `${Math.round(v)}%`;
  }

  protected gain(r: CompareRow) {
    return r.a === null || r.b === null ? null : Math.round((r.b - r.a) * 10) / 10;
  }
}
