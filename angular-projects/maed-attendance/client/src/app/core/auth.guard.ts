import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Role } from './models';

/** Requires a signed-in user whose role is listed in route data `roles`. */
export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = auth.user();
  if (!auth.isLoggedIn() || !user) return router.parseUrl('/login');

  const roles = route.data['roles'] as Role[] | undefined;
  if (roles && !roles.includes(user.role)) return router.parseUrl(auth.homeUrl());
  return true;
};

/** Sends signed-in users straight to their portal. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).parseUrl(auth.homeUrl()) : true;
};
