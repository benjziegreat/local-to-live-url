import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { ApiService } from './api.service';
import { Role, User } from './models';

const TOKEN_KEY = 'maed.token';
const USER_KEY = 'maed.user';

export const ROLE_HOME: Record<Role, string> = {
  STUDENT: '/student',
  TEACHER: '/teacher',
  ADVISER: '/adviser',
  PARENT: '/parent',
};

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

  login(email: string, password: string) {
    return this.api.login(email, password).pipe(
      tap(({ token, user }) => {
        this.token.set(token);
        this.user.set(user);
        try {
          localStorage.setItem(TOKEN_KEY, token);
          localStorage.setItem(USER_KEY, JSON.stringify(user));
        } catch {
          /* storage unavailable: session lasts until reload */
        }
      }),
    );
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
    const user = this.user();
    return user ? ROLE_HOME[user.role] : '/login';
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
