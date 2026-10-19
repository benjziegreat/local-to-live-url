import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, interval, of, startWith, switchMap } from 'rxjs';
import { CloudflareProfile, CloudflareSetupService, CloudflareSetupStatus } from '../cloudflare-setup.service';

const POLL_INTERVAL_MS = 2000;

@Component({
  selector: 'app-cloudflare-setup',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './cloudflare-setup.component.html',
})
export class CloudflareSetupComponent implements OnInit {
  readonly setup = inject(CloudflareSetupService);
  private readonly destroyRef = inject(DestroyRef);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  newProfileName = '';
  private importTarget: string | null = null;

  ngOnInit(): void {
    // Poll so download and browser-login progress show up without a manual refresh.
    interval(POLL_INTERVAL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.setup.refresh().pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  recheck(): void {
    this.run(this.setup.refresh(true), (s) => (s.binary.found ? 'cloudflared found.' : 'cloudflared still not found.'));
  }

  install(): void {
    this.run(this.setup.install(), () => 'Downloading cloudflared from Cloudflare\'s GitHub releases…');
  }

  uninstall(): void {
    const s = this.setup.status();
    const external = s?.binary.found && s.binary.source !== 'bundled';
    const detail = external
      ? `The copy at ${s!.binary.path} will not be removed, only ignored by this app until you click "Use system cloudflared again".`
      : 'The downloaded copy in this app\'s bin folder will be deleted.';
    if (!confirm(`Uninstall cloudflared to simulate a fresh machine?\n\n${detail}`)) return;
    this.run(this.setup.uninstall(), () => 'cloudflared uninstalled. This app now behaves like a machine without it.');
  }

  useSystem(): void {
    this.run(this.setup.useSystem(), (s) =>
      s.binary.found ? `Using ${s.binary.path}.` : 'No system copy of cloudflared found.'
    );
  }

  logout(profile: CloudflareProfile): void {
    if (!confirm(`Log profile "${profile.name}" out of Cloudflare?\n\nIts cert.pem is moved to a backup file (not deleted), and cached tunnel credentials are cleared.`)) return;
    this.run(this.setup.logout(profile.name), (s) =>
      `Logged out "${profile.name}".${s.result ? ` Previous cert.pem saved as ${s.result}` : ''}`
    );
  }

  createProfile(): void {
    const name = this.newProfileName.trim();
    if (!name) return;
    this.run(this.setup.createProfile(name), () => {
      this.newProfileName = '';
      return `Profile "${name}" created. Log in or import a cert.pem for it, then click "Use".`;
    });
  }

  activate(profile: CloudflareProfile): void {
    this.run(this.setup.activate(profile.name), () => `New DNS tunnels will now use profile "${profile.name}".`);
  }

  login(profile: CloudflareProfile): void {
    if (profile.loggedIn && !confirm(`Replace the current login for "${profile.name}" with a new one?`)) return;
    this.run(this.setup.login(profile.name), () => null);
  }

  cancelLogin(): void {
    this.run(this.setup.cancelLogin(), () => null);
  }

  remove(profile: CloudflareProfile): void {
    if (!confirm(`Delete profile "${profile.name}" and its saved Cloudflare login and tunnel credentials?`)) return;
    this.run(this.setup.deleteProfile(profile.name), () => `Profile "${profile.name}" deleted.`);
  }

  chooseCertFile(profile: CloudflareProfile, input: HTMLInputElement): void {
    this.importTarget = profile.name;
    input.value = '';
    input.click();
  }

  onCertFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    const target = this.importTarget;
    if (!file || !target) return;
    file.text().then((pem) => {
      this.run(this.setup.importCert(target, pem), () => `cert.pem imported into profile "${target}".`);
    });
  }

  private run(request: Observable<CloudflareSetupStatus>, message: (s: CloudflareSetupStatus) => string | null): void {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    request.subscribe({
      next: (status) => {
        this.busy.set(false);
        this.notice.set(message(status));
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(err.error?.error ?? 'Request failed.');
      },
    });
  }
}
