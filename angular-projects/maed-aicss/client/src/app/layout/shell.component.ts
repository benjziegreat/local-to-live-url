import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../core/auth.service';
import { NavStateService } from '../core/nav-state.service';
import { poll } from '../core/polling';
import { ApiService } from '../core/api.service';
import { AvatarComponent } from '../shared/avatar.component';
import { IconComponent } from '../shared/icon.component';
import { LogoComponent } from '../shared/logo.component';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  badge?: boolean;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'home' },
  { path: '/attendance', label: 'Attendance', icon: 'calendar-check' },
  { path: '/competencies', label: 'Competencies', icon: 'target' },
  { path: '/assessments', label: 'Assessment Records', icon: 'clipboard' },
  { path: '/alerts', label: 'Instructional Alerts', icon: 'bell', badge: true },
  { path: '/reports', label: 'Reports', icon: 'chart' },
  { path: '/learners', label: 'Learners', icon: 'users' },
  { path: '/users', label: 'User Management', icon: 'user-plus', adminOnly: true },
  { path: '/logs', label: 'System Logs', icon: 'history', adminOnly: true },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];

type Theme = 'light' | 'dark';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AvatarComponent, IconComponent, LogoComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly nav = inject(NavStateService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly items = computed(() => NAV.filter((n) => !n.adminOnly || this.auth.isAdmin()));
  protected readonly portal = computed(() => (this.auth.isAdmin() ? 'Admin Portal' : 'Teacher Portal'));
  protected readonly drawer = signal(false);
  protected readonly menu = signal(false);
  protected readonly theme = signal<Theme>(this.initialTheme());
  protected readonly school = signal({ schoolLevel: 'Senior High School', academicYear: '' });

  constructor() {
    this.auth.refresh();
    poll(() => this.nav.refreshAlerts(), 60_000);
    this.api.settings().subscribe({ next: (s) => this.school.set({ schoolLevel: s.schoolLevel, academicYear: s.academicYear }), error: () => {} });
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.drawer.set(false);
        this.menu.set(false);
      });
  }

  protected toggleTheme() {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    document.documentElement.dataset['theme'] = next;
    try {
      localStorage.setItem('aicss.theme', next);
    } catch {
      /* ignore */
    }
  }

  private initialTheme(): Theme {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('aicss.theme');
    } catch {
      /* ignore */
    }
    const theme: Theme =
      stored === 'dark' || stored === 'light' ? stored : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (stored) document.documentElement.dataset['theme'] = theme;
    return theme;
  }
}
