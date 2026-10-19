import { Component, effect, signal } from '@angular/core';
import { TunnelAdminComponent } from './tunnel-admin/tunnel-admin.component';
import { PublicIpTunnelComponent } from './public-ip-tunnel/public-ip-tunnel.component';
import { LoginComponent } from './login/login.component';
import { AuthService } from './auth.service';
import { IdleService } from './idle.service';
import { CloudflareSetupComponent } from './cloudflare-setup/cloudflare-setup.component';
import { CloudflareSetupService } from './cloudflare-setup.service';

type TunnelTab = 'cloudflare' | 'public-ip' | 'setup';

const IDLE_LOCK_MS = 60 * 1000;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [TunnelAdminComponent, PublicIpTunnelComponent, LoginComponent, CloudflareSetupComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly activeTab = signal<TunnelTab>('cloudflare');

  constructor(readonly auth: AuthService, idle: IdleService, readonly setup: CloudflareSetupService) {
    effect(() => {
      if (this.auth.isAuthenticated()) {
        idle.start(IDLE_LOCK_MS, () => this.auth.lock('Locked after 1 minute of inactivity.'));
        this.refreshSetup();
      } else {
        idle.stop();
      }
    });
  }

  selectTab(tab: TunnelTab): void {
    this.activeTab.set(tab);
    this.refreshSetup();
  }

  /** Banner text prompting the user to finish Cloudflare setup, if the current tab needs it. */
  setupWarning(): string | null {
    const tab = this.activeTab();
    if (tab === 'setup' || !this.setup.status()) return null;
    if (this.setup.binaryMissing()) return 'cloudflared is not installed on this machine, so tunnels can\'t start.';
    if (tab === 'public-ip' && !this.setup.activeLoggedIn()) {
      return `This machine isn't logged in to Cloudflare (profile "${this.setup.status()!.activeProfile}"), so DNS tunnels can't start.`;
    }
    return null;
  }

  private refreshSetup(): void {
    this.setup.refresh().subscribe({ error: () => {} });
  }

  signOut(): void {
    this.auth.lock();
  }
}
