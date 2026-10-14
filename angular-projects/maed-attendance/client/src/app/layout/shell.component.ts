import { Component, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Role } from '../core/models';
import { AvatarComponent } from '../shared/avatar.component';
import { IconComponent } from '../shared/icon.component';

interface NavItem {
  id: string;
  label: string;
  icon: string;
}

const PORTALS: Record<Role, { title: string; subtitle: string; nav: NavItem[] }> = {
  STUDENT: {
    title: 'Student Portal',
    subtitle: 'Mobile check-in',
    nav: [
      { id: 'top', label: 'Home', icon: 'home' },
      { id: 'location', label: 'Location', icon: 'pin' },
      { id: 'classes', label: 'Classes', icon: 'book' },
      { id: 'health', label: 'Health', icon: 'chart' },
    ],
  },
  TEACHER: {
    title: 'Subject Teacher Portal',
    subtitle: 'Live class dashboard',
    nav: [
      { id: 'top', label: 'Roster', icon: 'users' },
      { id: 'trends', label: 'Trends', icon: 'trend' },
    ],
  },
  ADVISER: {
    title: 'Adviser Portal',
    subtitle: 'Data & intervention',
    nav: [
      { id: 'top', label: 'Overview', icon: 'home' },
      { id: 'risk', label: 'Risk', icon: 'shield' },
      { id: 'alerts', label: 'Alerts', icon: 'bell' },
      { id: 'interventions', label: 'Log', icon: 'history' },
      { id: 'analytics', label: 'Analytics', icon: 'chart' },
    ],
  },
  PARENT: {
    title: 'Parent Portal',
    subtitle: 'Real-time tracking',
    nav: [
      { id: 'top', label: 'Tracking', icon: 'pin' },
      { id: 'logs', label: 'Logs', icon: 'clock' },
      { id: 'alerts', label: 'Alerts', icon: 'bell' },
      { id: 'messages', label: 'Messages', icon: 'message' },
    ],
  },
};

type Theme = 'light' | 'dark';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, AvatarComponent, IconComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly portal = computed(() => PORTALS[this.auth.user()?.role ?? 'STUDENT']);
  protected readonly active = signal('top');
  protected readonly theme = signal<Theme>(this.initialTheme());

  protected go(item: NavItem) {
    this.active.set(item.id);
    const el = document.getElementById(item.id);
    if (item.id === 'top' || !el) window.scrollTo({ top: 0, behavior: 'smooth' });
    else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected toggleTheme() {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    document.documentElement.dataset['theme'] = next;
    try {
      localStorage.setItem('maed.theme', next);
    } catch {
      /* ignore */
    }
  }

  private initialTheme(): Theme {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('maed.theme');
    } catch {
      /* ignore */
    }
    const theme: Theme =
      stored === 'dark' || stored === 'light'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    if (stored) document.documentElement.dataset['theme'] = theme;
    return theme;
  }
}
