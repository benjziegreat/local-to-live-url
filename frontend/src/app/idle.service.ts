import { Injectable, NgZone, OnDestroy } from '@angular/core';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

/** Calls `onIdle` once after `timeoutMs` without any user input. */
@Injectable({ providedIn: 'root' })
export class IdleService implements OnDestroy {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onIdle: (() => void) | null = null;
  private timeoutMs = 0;
  private readonly reset = () => this.schedule();

  constructor(private readonly zone: NgZone) {}

  start(timeoutMs: number, onIdle: () => void): void {
    this.stop();
    this.timeoutMs = timeoutMs;
    this.onIdle = onIdle;
    // Activity events fire constantly; keep them out of change detection.
    this.zone.runOutsideAngular(() => {
      for (const event of ACTIVITY_EVENTS) {
        window.addEventListener(event, this.reset, { passive: true, capture: true });
      }
    });
    this.schedule();
  }

  stop(): void {
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, this.reset, { capture: true });
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.onIdle = null;
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => {
        const callback = this.onIdle;
        this.stop();
        if (callback) this.zone.run(callback);
      }, this.timeoutMs);
    });
  }
}
