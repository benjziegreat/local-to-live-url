import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import * as QRCode from 'qrcode';
import { TunnelService, TunnelState } from './tunnel.service';

const DEFAULT_LOCAL_URL = 'https://localhost/PMS/';
const POLL_INTERVAL_MS = 2000;

const EMPTY_STATE: TunnelState = {
  status: 'stopped',
  localUrl: null,
  publicUrl: null,
  startedAt: null,
  error: null,
  logs: [],
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, NgClass],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  private readonly tunnelService = inject(TunnelService);
  private readonly destroyRef = inject(DestroyRef);

  readonly localUrl = signal(DEFAULT_LOCAL_URL);
  readonly state = signal<TunnelState>(EMPTY_STATE);
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly copied = signal(false);
  readonly qrDataUrl = signal<string | null>(null);
  readonly showLogs = signal(false);

  /** Editable public URL field, seeded from the generated tunnel link; the
   * user can append a path (e.g. "/PMS") and the QR code + open-link href
   * follow whatever is typed here. */
  readonly publicUrlField = signal('');
  private lastKnownPublicUrl: string | null = null;
  private qrDebounceHandle?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    interval(POLL_INTERVAL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.tunnelService.getStatus().pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => {
        if (state) this.applyState(state);
      });
  }

  toggleTunnel(): void {
    const status = this.state().status;
    if (status === 'running' || status === 'starting') {
      this.stopTunnel();
    } else {
      this.startTunnel();
    }
  }

  startTunnel(): void {
    const url = this.localUrl().trim();
    if (!url) {
      this.actionError.set('Enter the local HTTPS server URL first.');
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    this.tunnelService.start(url).subscribe({
      next: (state) => {
        this.applyState(state);
        this.busy.set(false);
      },
      error: (err) => {
        this.actionError.set(err?.error?.error ?? 'Failed to start tunnel.');
        this.busy.set(false);
      },
    });
  }

  stopTunnel(): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.tunnelService.stop().subscribe({
      next: (state) => {
        this.applyState(state);
        this.busy.set(false);
      },
      error: (err) => {
        this.actionError.set(err?.error?.error ?? 'Failed to stop tunnel.');
        this.busy.set(false);
      },
    });
  }

  onPublicUrlFieldChange(value: string): void {
    this.publicUrlField.set(value);
    if (this.qrDebounceHandle) clearTimeout(this.qrDebounceHandle);
    this.qrDebounceHandle = setTimeout(() => this.generateQr(value), 300);
  }

  async copyPublicUrl(): Promise<void> {
    const url = this.publicUrlField();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }

  toggleLogs(): void {
    this.showLogs.update((v) => !v);
  }

  get isToggleDisabled(): boolean {
    return this.busy() || this.state().status === 'stopping';
  }

  get toggleLabel(): string {
    switch (this.state().status) {
      case 'running':
        return 'Stop Tunnel';
      case 'starting':
        return 'Starting…';
      case 'stopping':
        return 'Stopping…';
      default:
        return 'Start Tunnel';
    }
  }

  get statusBadgeClasses(): string {
    switch (this.state().status) {
      case 'running':
        return 'bg-emerald-100 text-emerald-700 ring-emerald-600/20';
      case 'starting':
      case 'stopping':
        return 'bg-amber-100 text-amber-700 ring-amber-600/20';
      case 'error':
        return 'bg-red-100 text-red-700 ring-red-600/20';
      default:
        return 'bg-slate-100 text-slate-600 ring-slate-500/20';
    }
  }

  private applyState(state: TunnelState): void {
    this.state.set(state);
    if (state.localUrl) this.localUrl.set(state.localUrl);

    if (state.publicUrl && state.publicUrl !== this.lastKnownPublicUrl) {
      // A new tunnel link was generated (or we just loaded) — (re)seed the
      // editable field with it, discarding any previously appended text.
      this.lastKnownPublicUrl = state.publicUrl;
      this.publicUrlField.set(state.publicUrl);
      this.generateQr(state.publicUrl);
    } else if (!state.publicUrl) {
      this.lastKnownPublicUrl = null;
      this.publicUrlField.set('');
      this.qrDataUrl.set(null);
    }
  }

  private generateQr(url: string): void {
    const trimmed = url.trim();
    if (!trimmed) {
      this.qrDataUrl.set(null);
      return;
    }
    QRCode.toDataURL(trimmed, { margin: 1, width: 220 })
      .then((dataUrl) => this.qrDataUrl.set(dataUrl))
      .catch(() => this.qrDataUrl.set(null));
  }
}
