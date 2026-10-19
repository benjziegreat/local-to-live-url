import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const isAuthCall = req.url.startsWith('/api/auth/');
  const token = auth.token;

  const authedReq =
    token && !isAuthCall ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authedReq).pipe(
    catchError((err: unknown) => {
      if (!isAuthCall && err instanceof HttpErrorResponse && err.status === 401 && auth.isAuthenticated()) {
        auth.expire('Your session has expired. Please sign in again.');
      }
      return throwError(() => err);
    })
  );
};
