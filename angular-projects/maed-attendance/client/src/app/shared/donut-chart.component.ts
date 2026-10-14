import { Component, computed, input } from '@angular/core';

/** Single-value ring meter (e.g. overall attendance rate). Tone follows status thresholds. */
@Component({
  selector: 'app-donut-chart',
  template: `
    <svg viewBox="0 0 120 120" role="img" [attr.aria-label]="caption() + ': ' + value() + '%'">
      <circle cx="60" cy="60" r="50" class="track" />
      <circle cx="60" cy="60" r="50" class="arc" [attr.stroke]="color()"
              [attr.stroke-dasharray]="dash()" transform="rotate(-90 60 60)" />
      <text x="60" y="52" class="cap">{{ caption() }}</text>
      <text x="60" y="76" class="val">{{ value() }}%</text>
    </svg>
  `,
  styles: `
    :host { display: block; width: 100%; max-width: 170px; margin-inline: auto; }
    svg { width: 100%; height: auto; display: block; }
    circle { fill: none; stroke-width: 12; }
    .track { stroke: var(--muted-soft); }
    .arc { stroke-linecap: round; transition: stroke-dasharray 0.8s ease; }
    text { text-anchor: middle; fill: var(--text); font-family: var(--font); }
    .cap { font-size: 9px; fill: var(--text-3); font-weight: 600; }
    .val { font-size: 22px; font-weight: 800; }
  `,
})
export class DonutChartComponent {
  readonly value = input.required<number>();
  readonly caption = input('Overall Rate');

  private readonly circumference = 2 * Math.PI * 50;

  protected readonly dash = computed(() => {
    const filled = (Math.max(0, Math.min(100, this.value())) / 100) * this.circumference;
    return `${filled} ${this.circumference}`;
  });

  protected readonly color = computed(() =>
    this.value() >= 90 ? 'var(--success)' : this.value() >= 80 ? 'var(--warning)' : 'var(--critical)',
  );
}
