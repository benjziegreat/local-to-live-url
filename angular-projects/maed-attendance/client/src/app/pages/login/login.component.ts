import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errorMessage } from '../../core/auth.interceptor';
import { AuthService } from '../../core/auth.service';
import { IconComponent } from '../../shared/icon.component';

const DEMO = [
  { role: 'Student', email: 'student@maed.edu', icon: 'pin', blurb: 'Mobile check-in' },
  { role: 'Teacher', email: 'teacher@maed.edu', icon: 'users', blurb: 'Live roster' },
  { role: 'Adviser', email: 'adviser@maed.edu', icon: 'shield', blurb: 'Risk & interventions' },
  { role: 'Parent', email: 'parent@maed.edu', icon: 'message', blurb: 'Real-time tracking' },
];

@Component({
  selector: 'app-login',
  imports: [FormsModule, IconComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  protected readonly demo = DEMO;
  protected email = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected useDemo(email: string) {
    this.email = email;
    this.password = 'password123';
    this.submit();
  }

  protected submit() {
    this.busy.set(true);
    this.error.set(null);
    this.auth.login(this.email, this.password).subscribe({
      next: () => this.router.navigateByUrl(this.auth.homeUrl()),
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }
}
