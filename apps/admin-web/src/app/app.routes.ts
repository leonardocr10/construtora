import { Routes } from '@angular/router';
import { DashboardPageComponent } from './dashboard-page.component';
import { PlaceholderPageComponent } from './placeholder-page.component';

export const routes: Routes = [
  { path: '', component: DashboardPageComponent, title: 'Visão geral · VistaHub' },
  { path: ':feature', component: PlaceholderPageComponent, title: 'VistaHub' },
  { path: '**', redirectTo: '' },
];
