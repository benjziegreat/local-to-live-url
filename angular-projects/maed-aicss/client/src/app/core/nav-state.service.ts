import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

/** Shared navigation state: the open-alert badge count. */
@Injectable({ providedIn: 'root' })
export class NavStateService {
  private api = inject(ApiService);
  readonly openAlerts = signal(0);
  readonly highAlerts = signal(0);

  refreshAlerts() {
    this.api.alertCount().subscribe({
      next: (c) => {
        this.openAlerts.set(c.open);
        this.highAlerts.set(c.high);
      },
      error: () => {},
    });
  }
}
