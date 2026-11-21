import { Component, computed, input } from '@angular/core';

/** Initials avatar tinted by a per-user hue. */
@Component({
  selector: 'app-avatar',
  template: `{{ initials() }}`,
  host: {
    role: 'img',
    '[attr.aria-label]': 'name()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.font-size.px]': 'size() * 0.38',
    '[style.background]': 'background()',
  },
  styles: `
    :host {
      flex: none;
      display: inline-grid;
      place-items: center;
      border-radius: 50%;
      color: #fff;
      font-weight: 700;
      letter-spacing: 0.02em;
      border: 2px solid rgba(255, 255, 255, 0.85);
      box-shadow: 0 4px 12px rgba(15, 30, 61, 0.18);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    }
  `,
})
export class AvatarComponent {
  readonly name = input.required<string>();
  readonly hue = input(210);
  readonly size = input(40);

  protected readonly initials = computed(() => {
    // Handles "Cruz, Juan" as well as "Juan Cruz"
    const raw = this.name().includes(',') ? this.name().split(',').reverse().join(' ') : this.name();
    const parts = raw.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  });

  protected readonly background = computed(
    () => `linear-gradient(135deg, hsl(${this.hue()} 70% 55%), hsl(${(this.hue() + 35) % 360} 75% 45%))`,
  );
}
