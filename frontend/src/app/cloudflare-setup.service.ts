import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface CloudflareProfile {
  name: string;
  builtIn: boolean;
  active: boolean;
  loggedIn: boolean;
  accountId: string | null;
  zoneId: string | null;
}

export interface CloudflareSetupStatus {
  binary: { found: boolean; path: string | null; version: string | null; source: string | null };
  canInstall: boolean;
  systemBinaryIgnored: boolean;
  /** Return value of the action just performed (e.g. the cert backup path after logout). */
  result?: string | null;
  install: { status: 'idle' | 'downloading' | 'error'; error: string | null };
  activeProfile: string;
  profiles: CloudflareProfile[];
  login: { status: 'idle' | 'waiting' | 'done' | 'error'; profile: string | null; url: string | null; error: string | null };
}

const API_BASE = '/api/cloudflare';

@Injectable({ providedIn: 'root' })
export class CloudflareSetupService {
  /** Latest setup status, shared by the setup tab and the "needs setup" banner. */
  readonly status = signal<CloudflareSetupStatus | null>(null);

  readonly binaryMissing = computed(() => this.status()?.binary.found === false);
  readonly activeLoggedIn = computed(() => {
    const s = this.status();
    return !s || s.profiles.some((p) => p.active && p.loggedIn);
  });

  constructor(private readonly http: HttpClient) {}

  refresh(recheckBinary = false): Observable<CloudflareSetupStatus> {
    const params = recheckBinary ? { refresh: '1' } : undefined;
    return this.track(this.http.get<CloudflareSetupStatus>(`${API_BASE}/status`, { params }));
  }

  install(): Observable<CloudflareSetupStatus> {
    return this.track(this.http.post<CloudflareSetupStatus>(`${API_BASE}/install`, {}));
  }

  uninstall(): Observable<CloudflareSetupStatus> {
    return this.track(this.http.post<CloudflareSetupStatus>(`${API_BASE}/uninstall`, {}));
  }

  useSystem(): Observable<CloudflareSetupStatus> {
    return this.track(this.http.post<CloudflareSetupStatus>(`${API_BASE}/use-system`, {}));
  }

  logout(name: string): Observable<CloudflareSetupStatus> {
    return this.track(this.http.post<CloudflareSetupStatus>(`${API_BASE}/profiles/${encodeURIComponent(name)}/logout`, {}));
  }

  createProfile(name: string): Observable<CloudflareSetupStatus> {
    return this.track(this.http.post<CloudflareSetupStatus>(`${API_BASE}/profiles`, { name }));
  }

  deleteProfile(name: string): Observable<CloudflareSetupStatus> {
    return this.track(this.http.delete<CloudflareSetupStatus>(`${API_BASE}/profiles/${encodeURIComponent(name)}`));
  }

  activate(name: string): Observable<CloudflareSetupStatus> {
    return this.track(this.http.post<CloudflareSetupStatus>(`${API_BASE}/profiles/${encodeURIComponent(name)}/activate`, {}));
  }

  login(name: string): Observable<CloudflareSetupStatus> {
    return this.track(this.http.post<CloudflareSetupStatus>(`${API_BASE}/profiles/${encodeURIComponent(name)}/login`, {}));
  }

  importCert(name: string, pem: string): Observable<CloudflareSetupStatus> {
    return this.track(this.http.put<CloudflareSetupStatus>(`${API_BASE}/profiles/${encodeURIComponent(name)}/cert`, { pem }));
  }

  cancelLogin(): Observable<CloudflareSetupStatus> {
    return this.track(this.http.post<CloudflareSetupStatus>(`${API_BASE}/login/cancel`, {}));
  }

  private track(request: Observable<CloudflareSetupStatus>): Observable<CloudflareSetupStatus> {
    return request.pipe(tap((status) => this.status.set(status)));
  }
}
