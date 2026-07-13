import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import { DnsTunnelRowComponent } from '../dns-tunnel-row/dns-tunnel-row.component';
import { PublicIpTunnelService, DnsTunnelState } from '../public-ip-tunnel.service';

const SLOT_COUNT = 5;
const POLL_INTERVAL_MS = 2000;

function emptyState(id: number): DnsTunnelState {
  return { id, status: 'stopped', localUrl: null, publicUrl: null, startedAt: null, error: null, logs: [] };
}

@Component({
  selector: 'app-public-ip-tunnel',
  standalone: true,
  imports: [DnsTunnelRowComponent],
  templateUrl: './public-ip-tunnel.component.html',
  styleUrl: './public-ip-tunnel.component.css',
})
export class PublicIpTunnelComponent implements OnInit {
  private readonly tunnelService = inject(PublicIpTunnelService);
  private readonly destroyRef = inject(DestroyRef);

  readonly slotIds = Array.from({ length: SLOT_COUNT }, (_, i) => i);
  readonly states = signal<DnsTunnelState[]>(this.slotIds.map(emptyState));

  ngOnInit(): void {
    interval(POLL_INTERVAL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.tunnelService.getAllStatus().pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((states) => {
        if (states) this.states.set(states);
      });
  }

  stateFor(id: number): DnsTunnelState {
    return this.states().find((s) => s.id === id) ?? emptyState(id);
  }
}
