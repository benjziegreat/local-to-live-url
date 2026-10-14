import { Component, computed, input, signal } from '@angular/core';

interface Cell {
  key: string;
  date: Date;
  rate: number | null;
  total: number;
  col: number;
  row: number;
}

const ROWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Sequential single-hue scale, light -> dark (brand blue).
const STEPS = [
  { min: 0, label: '<70%', color: 'color-mix(in srgb, var(--brand) 14%, transparent)' },
  { min: 70, label: '70%', color: 'color-mix(in srgb, var(--brand) 32%, transparent)' },
  { min: 80, label: '80%', color: 'color-mix(in srgb, var(--brand) 52%, transparent)' },
  { min: 90, label: '90%', color: 'color-mix(in srgb, var(--brand) 74%, transparent)' },
  { min: 97, label: '97%+', color: 'var(--brand)' },
];

/** Calendar heatmap of daily attendance rate: weeks as columns, Mon–Sat as rows. */
@Component({
  selector: 'app-heatmap',
  template: `
    <div class="scroll">
      <div class="hm" [style.grid-template-columns]="'34px repeat(' + weeks() + ', minmax(12px, 1fr))'">
        <span></span>
        @for (m of monthLabels(); track $index) {
          <span class="month" [style.grid-column]="m.col + 2">{{ m.label }}</span>
        }
        @for (r of rows; track r; let ri = $index) {
          <span class="day" [style.grid-row]="ri + 2">{{ r }}</span>
        }
        @for (c of cells(); track c.key) {
          <button type="button" class="cell" [style.grid-column]="c.col + 2" [style.grid-row]="c.row + 2"
                  [style.background]="color(c.rate)" [class.none]="c.rate === null"
                  [attr.aria-label]="describe(c)"
                  (mouseenter)="active.set(c)" (focus)="active.set(c)" (mouseleave)="active.set(null)"></button>
        }
      </div>
    </div>
    <div class="foot">
      <span class="readout">{{ active() ? describe(active()!) : 'Hover a day for details' }}</span>
      <span class="legend">
        @for (s of steps; track s.label) {
          <i [style.background]="s.color"></i><small>{{ s.label }}</small>
        }
      </span>
    </div>
  `,
  styles: `
    .scroll { overflow-x: auto; padding-bottom: 4px; }
    .hm { display: grid; grid-template-rows: 16px repeat(6, minmax(12px, 18px)); gap: 3px; min-width: 420px; }
    .month, .day { font-size: 0.68rem; color: var(--text-3); align-self: center; }
    .month { white-space: nowrap; grid-row: 1; }
    .day { grid-column: 1; }
    .cell { border: none; padding: 0; border-radius: 4px; cursor: pointer; min-height: 12px; }
    .cell.none { background: var(--muted-soft) !important; opacity: 0.5; }
    .cell:hover, .cell:focus-visible { outline: 2px solid var(--text); outline-offset: 1px; }
    .foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 10px; font-size: 0.78rem; }
    .readout { color: var(--text-2); min-height: 1.2em; }
    .legend { display: inline-flex; align-items: center; gap: 4px; color: var(--text-3);
      i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
      small { margin-right: 4px; } }
  `,
})
export class HeatmapComponent {
  readonly days = input.required<{ date: string; rate: number; total: number }[]>();
  readonly from = input.required<string>();
  readonly to = input.required<string>();

  protected readonly rows = ROWS;
  protected readonly steps = STEPS;
  protected readonly active = signal<Cell | null>(null);

  /** Monday on/before `from`. */
  private readonly start = computed(() => {
    const d = new Date(this.from() + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return d;
  });

  protected readonly cells = computed<Cell[]>(() => {
    const byKey = new Map(this.days().map((d) => [d.date, d]));
    const end = new Date(this.to() + 'T00:00:00');
    const out: Cell[] = [];
    for (let d = new Date(this.start()), i = 0; d <= end; d.setDate(d.getDate() + 1), i++) {
      const row = (d.getDay() + 6) % 7;
      if (row === 6) continue; // skip Sundays
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const hit = byKey.get(key);
      out.push({ key, date: new Date(d), rate: hit ? hit.rate : null, total: hit?.total ?? 0, col: Math.floor(i / 7), row });
    }
    return out;
  });

  protected readonly weeks = computed(() => (this.cells().at(-1)?.col ?? 0) + 1);

  protected readonly monthLabels = computed(() => {
    const labels: { col: number; label: string }[] = [];
    let last = -1;
    for (const c of this.cells()) {
      if (c.row === 0 && c.date.getMonth() !== last) {
        last = c.date.getMonth();
        labels.push({ col: c.col, label: MONTHS[last] });
      }
    }
    return labels;
  });

  protected color(rate: number | null) {
    if (rate === null) return '';
    return [...STEPS].reverse().find((s) => rate >= s.min)!.color;
  }

  protected describe(c: Cell) {
    const day = c.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return c.rate === null ? `${day}: no classes recorded` : `${day}: ${c.rate}% attendance (${c.total} class marks)`;
  }
}
