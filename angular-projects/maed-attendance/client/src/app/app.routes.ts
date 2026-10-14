import { Routes } from '@angular/router';
import { guestGuard, roleGuard } from './core/auth.guard';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [roleGuard],
    children: [
      {
        path: 'student',
        data: { roles: ['STUDENT'] },
        canActivate: [roleGuard],
        loadComponent: () => import('./pages/student/student-portal.component').then((m) => m.StudentPortalComponent),
      },
      {
        path: 'teacher',
        data: { roles: ['TEACHER'] },
        canActivate: [roleGuard],
        loadComponent: () => import('./pages/teacher/teacher-portal.component').then((m) => m.TeacherPortalComponent),
      },
      {
        path: 'adviser',
        data: { roles: ['ADVISER'] },
        canActivate: [roleGuard],
        loadComponent: () => import('./pages/adviser/adviser-portal.component').then((m) => m.AdviserPortalComponent),
      },
      {
        path: 'parent',
        data: { roles: ['PARENT'] },
        canActivate: [roleGuard],
        loadComponent: () => import('./pages/parent/parent-portal.component').then((m) => m.ParentPortalComponent),
      },
      // Bare "/" lands on the signed-in user's own portal (roleGuard redirects).
      { path: '', pathMatch: 'full', children: [], canActivate: [roleGuard], data: { roles: [] } },
    ],
  },
  { path: '**', redirectTo: '' },
];
