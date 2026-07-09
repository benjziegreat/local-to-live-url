import { Component, signal } from '@angular/core';
import { TunnelAdminComponent } from './tunnel-admin/tunnel-admin.component';
import { PublicIpTunnelComponent } from './public-ip-tunnel/public-ip-tunnel.component';

type TunnelTab = 'cloudflare' | 'public-ip';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [TunnelAdminComponent, PublicIpTunnelComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly activeTab = signal<TunnelTab>('cloudflare');

  selectTab(tab: TunnelTab): void {
    this.activeTab.set(tab);
  }
}
