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
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'Dashboard · AICSS',
        loadComponent: () => import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'attendance',
        title: 'Attendance · AICSS',
        loadComponent: () => import('./pages/attendance/attendance.component').then((m) => m.AttendanceComponent),
      },
      {
        path: 'competencies',
        title: 'Competencies · AICSS',
        loadComponent: () => import('./pages/competencies/competencies.component').then((m) => m.CompetenciesComponent),
      },
      {
        path: 'assessments',
        title: 'Assessment Records · AICSS',
        loadComponent: () => import('./pages/assessments/assessments.component').then((m) => m.AssessmentsComponent),
      },
      {
        path: 'alerts',
        title: 'Instructional Alerts · AICSS',
        loadComponent: () => import('./pages/alerts/alerts.component').then((m) => m.AlertsComponent),
      },
      {
        path: 'reports',
        title: 'Reports · AICSS',
        loadComponent: () => import('./pages/reports/reports.component').then((m) => m.ReportsComponent),
      },
      {
        path: 'learners',
        title: 'Learners · AICSS',
        loadComponent: () => import('./pages/learners/learners.component').then((m) => m.LearnersComponent),
      },
      {
        path: 'learners/:id',
        title: 'Learner Profile · AICSS',
        loadComponent: () => import('./pages/learners/learner-profile.component').then((m) => m.LearnerProfileComponent),
      },
      {
        path: 'settings',
        title: 'Settings · AICSS',
        loadComponent: () => import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'users',
        title: 'User Management · AICSS',
        data: { roles: ['ADMIN'] },
        canActivate: [roleGuard],
        loadComponent: () => import('./pages/users/users.component').then((m) => m.UsersComponent),
      },
      {
        path: 'logs',
        title: 'System Logs · AICSS',
        data: { roles: ['ADMIN'] },
        canActivate: [roleGuard],
        loadComponent: () => import('./pages/logs/logs.component').then((m) => m.LogsComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
