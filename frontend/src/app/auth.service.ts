import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

interface LoginResponse {
  token: string;
  username: string;
}

const API_BASE = '/api/auth';
const TOKEN_KEY = 'tunnel-admin-token';

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenSignal = signal<string | null>(readStoredToken());

  readonly isAuthenticated = computed(() => this.tokenSignal() !== null);
  /** Why the user was signed out, shown on the login screen (e.g. inactivity lock). */
  readonly lockReason = signal<string | null>(null);

  constructor(private readonly http: HttpClient) {}

  get token(): string | null {
    return this.tokenSignal();
  }

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API_BASE}/login`, { username, password }).pipe(
      tap(({ token }) => {
        this.setToken(token);
        this.lockReason.set(null);
      })
    );
  }

  /** Revokes the session on the server and returns to the login screen. */
  lock(reason: string | null = null): void {
    const token = this.token;
    if (token) {
      this.http
        .post(`${API_BASE}/logout`, {}, { headers: { Authorization: `Bearer ${token}` } })
        .subscribe({ error: () => {} });
    }
    this.expire(reason);
  }

  /** Clears the local session without contacting the server (e.g. after a 401). */
  expire(reason: string | null = null): void {
    this.lockReason.set(reason);
    this.setToken(null);
  }

  private setToken(token: string | null): void {
    this.tokenSignal.set(token);
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage unavailable (private mode); the session just won't survive a reload.
    }
  }
}
