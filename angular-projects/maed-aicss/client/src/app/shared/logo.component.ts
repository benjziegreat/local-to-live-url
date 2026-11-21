import { Component, input } from '@angular/core';

/** AICSS emblem: an open book with a flame, framed by laurel leaves. */
@Component({
  selector: 'app-logo',
  host: { style: 'display:inline-flex;flex:none', role: 'img', 'aria-label': 'AICSS logo' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 64 64">
      <!-- laurel -->
      <g fill="#f2b705">
        @for (i of leaves; track i) {
          <ellipse [attr.cx]="0" [attr.cy]="0" rx="2.4" ry="5" [attr.transform]="leafLeft(i)" />
          <ellipse [attr.cx]="0" [attr.cy]="0" rx="2.4" ry="5" [attr.transform]="leafRight(i)" />
        }
      </g>
      <!-- flame -->
      <path d="M32 6c4 5 7 8 7 13a7 7 0 0 1-14 0c0-3 1.6-5 3.4-6.6.2 2.4 1.2 3.8 2.6 4.6C30.6 13 31 9.6 32 6z" fill="#f26b1d" />
      <path d="M32 14c2 2.4 3.4 4 3.4 6.2a3.4 3.4 0 0 1-6.8 0c0-1.8 1-3 2.2-4 .2 1 .6 1.6 1.2 2 0-1.4 0-2.8 0-4.2z" fill="#ffc23d" />
      <!-- book -->
      <path d="M12 30c7-2 14-1 20 3 6-4 13-5 20-3v20c-7-2-14-1-20 3-6-4-13-5-20-3z" fill="#fff" stroke="#1d4fa8" stroke-width="2.4" stroke-linejoin="round" />
      <path d="M32 33v20" stroke="#1d4fa8" stroke-width="2.4" />
      <path d="M16 35c4.5-.8 8.5-.2 12 1.6M16 40c4.5-.8 8.5-.2 12 1.6M48 35c-4.5-.8-8.5-.2-12 1.6M48 40c-4.5-.8-8.5-.2-12 1.6" stroke="#8fb3ee" stroke-width="1.6" fill="none" stroke-linecap="round" />
    </svg>
  `,
})
export class LogoComponent {
  readonly size = input(56);
  protected readonly leaves = [0, 1, 2, 3, 4];

  // Leaves sit tangent to an arc around the lower half of the emblem.
  protected leafLeft(i: number) {
    return this.leaf(225 - i * 20);
  }

  protected leafRight(i: number) {
    return this.leaf(-45 + i * 20);
  }

  private leaf(deg: number) {
    const a = (deg * Math.PI) / 180;
    const x = 32 + 27 * Math.cos(a);
    const y = 36 - 27 * Math.sin(a);
    return `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${-deg})`;
  }
}
