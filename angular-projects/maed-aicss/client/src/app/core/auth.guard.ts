import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Role } from './models';

/** Requires a signed-in user; if route data lists `roles`, the user's role must be one of them. */
export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = auth.user();
  if (!auth.isLoggedIn() || !user) return router.parseUrl('/login');

  const roles = route.data['roles'] as Role[] | undefined;
  if (roles && !roles.includes(user.role)) return router.parseUrl(auth.homeUrl());
  return true;
};

/** Sends signed-in users straight to the dashboard. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).parseUrl(auth.homeUrl()) : true;
};
