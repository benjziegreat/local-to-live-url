import { Component, effect, signal } from '@angular/core';
import { TunnelAdminComponent } from './tunnel-admin/tunnel-admin.component';
import { PublicIpTunnelComponent } from './public-ip-tunnel/public-ip-tunnel.component';
import { LoginComponent } from './login/login.component';
import { AuthService } from './auth.service';
import { IdleService } from './idle.service';

type TunnelTab = 'cloudflare' | 'public-ip';

const IDLE_LOCK_MS = 60 * 1000;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [TunnelAdminComponent, PublicIpTunnelComponent, LoginComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly activeTab = signal<TunnelTab>('cloudflare');

  constructor(readonly auth: AuthService, idle: IdleService) {
    effect(() => {
      if (this.auth.isAuthenticated()) {
        idle.start(IDLE_LOCK_MS, () => this.auth.lock('Locked after 1 minute of inactivity.'));
      } else {
        idle.stop();
      }
    });
  }

  selectTab(tab: TunnelTab): void {
    this.activeTab.set(tab);
  }

  signOut(): void {
    this.auth.lock();
  }
}
