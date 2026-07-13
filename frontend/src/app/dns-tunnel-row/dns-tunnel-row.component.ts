import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import * as QRCode from 'qrcode';
import { PublicIpTunnelService, DnsTunnelState } from '../public-ip-tunnel.service';

const DEFAULT_LOCAL_URL = 'https://localhost/PMS/';

@Component({
  selector: 'app-dns-tunnel-row',
  standalone: true,
  imports: [FormsModule, NgClass],
  templateUrl: './dns-tunnel-row.component.html',
  styleUrl: './dns-tunnel-row.component.css',
})
export class DnsTunnelRowComponent {
  readonly id = input.required<number>();
  readonly state = input.required<DnsTunnelState>();

  private readonly tunnelService = inject(PublicIpTunnelService);

  readonly localUrl = signal(DEFAULT_LOCAL_URL);
  readonly subdomain = signal('');
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly copied = signal(false);
  readonly qrDataUrl = signal<string | null>(null);
  readonly showLogs = signal(false);

  /** Editable public URL field, seeded from the generated tunnel link; the
   * user can append a path and the QR code + open-link href follow it. */
  readonly publicUrlField = signal('');
  private lastKnownPublicUrl: string | null = null;
  private lastKnownLocalUrl: string | null = null;
  private qrDebounceHandle?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => this.applyState(this.state()));
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
    const localUrl = this.localUrl().trim();
    const subdomain = this.subdomain().trim();

    if (!localUrl || !subdomain) {
      this.actionError.set('Local HTTPS server and cloudflared subdomain url are both required.');
      return;
    }

    this.busy.set(true);
    this.actionError.set(null);
    this.tunnelService
      .start(this.id(), { localUrl, subdomain })
      .subscribe({
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
    this.tunnelService.stop(this.id()).subscribe({
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

  get fieldsDisabled(): boolean {
    return this.state().status === 'running' || this.state().status === 'starting' || this.busy();
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

  private applyState(state: DnsTunnelState): void {
    if (state.localUrl && state.localUrl !== this.lastKnownLocalUrl) {
      // Only sync from the server when it reports a genuinely new value
      // (e.g. on first load); otherwise the poll would keep overwriting
      // whatever the user is actively typing with the tunnel's start URL.
      this.lastKnownLocalUrl = state.localUrl;
      this.localUrl.set(state.localUrl);
    } else if (!state.localUrl) {
      this.lastKnownLocalUrl = null;
    }

    if (state.publicUrl && state.publicUrl !== this.lastKnownPublicUrl) {
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
