import { Component, ElementRef, HostListener, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  username = 'admin';
  password = '';
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  @ViewChild('passwordInput') private passwordInput?: ElementRef<HTMLInputElement>;

  constructor(readonly auth: AuthService) {}

  // Reopening the tray window (or switching back to the tab) lands in the password field.
  @HostListener('window:focus')
  focusPassword(): void {
    this.passwordInput?.nativeElement.focus();
  }

  submit(): void {
    if (!this.username || !this.password || this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);
    this.auth.login(this.username, this.password).subscribe({
      next: () => this.submitting.set(false),
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.password = '';
        this.error.set(err.error?.error || 'Unable to sign in. Is the server running?');
      },
    });
  }
}
