import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { ApiService } from './api.service';
import { User } from './models';

const TOKEN_KEY = 'aicss.token';
const USER_KEY = 'aicss.user';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private router = inject(Router);

  readonly token = signal<string | null>(readStorage(TOKEN_KEY));
  readonly user = signal<User | null>(this.restoreUser());
  readonly isLoggedIn = computed(() => !!this.token() && !!this.user());
  readonly isAdmin = computed(() => this.user()?.role === 'ADMIN');

  login(email: string, password: string) {
    return this.api.login(email, password).pipe(
      tap(({ token, user }) => {
        this.token.set(token);
        this.setUser(user);
        try {
          localStorage.setItem(TOKEN_KEY, token);
        } catch {
          /* storage unavailable: session lasts until reload */
        }
      }),
    );
  }

  /** Update the cached user (after login or a profile edit). */
  setUser(user: User) {
    this.user.set(user);
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* ignore */
    }
  }

  /** Re-read the account from the server so role/status changes apply. */
  refresh() {
    if (!this.token()) return;
    this.api.me().subscribe({ next: (u) => this.setUser(u), error: () => {} });
  }

  logout() {
    this.token.set(null);
    this.user.set(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
    this.router.navigateByUrl('/login');
  }

  homeUrl(): string {
    return this.user() ? '/dashboard' : '/login';
  }

  private restoreUser(): User | null {
    const raw = readStorage(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  }
}
