import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errorMessage } from '../../core/auth.interceptor';
import { AuthService } from '../../core/auth.service';
import { IconComponent } from '../../shared/icon.component';
import { LogoComponent } from '../../shared/logo.component';

const ROLES = [
  {
    role: 'Teacher',
    email: 'teacher@aicss.edu',
    icon: 'user',
    tone: 'teacher',
    heading: 'Monitor and Support Learners',
    perks: ['View attendance and competency data', 'Record attendance and assessment scores', 'Receive instructional alerts', 'Generate reports'],
  },
  {
    role: 'Administrator',
    email: 'admin@aicss.edu',
    icon: 'settings',
    tone: 'admin',
    heading: 'Manage the Entire System',
    perks: ['Manage users and roles', 'Configure school settings', 'View comprehensive reports', 'Monitor system activities'],
  },
];

@Component({
  selector: 'app-login',
  imports: [FormsModule, IconComponent, LogoComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  protected readonly roles = ROLES;
  protected email = '';
  protected password = '';
  protected readonly show = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly forgot = signal(false);

  protected useDemo(email: string) {
    this.email = email;
    this.password = 'password123';
    this.submit();
  }

  protected submit() {
    if (!this.email || !this.password) {
      this.error.set('Enter your email and password');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.auth.login(this.email, this.password).subscribe({
      next: () => this.router.navigateByUrl('/dashboard'),
      error: (err) => {
        this.error.set(errorMessage(err));
        this.busy.set(false);
      },
    });
  }
}
