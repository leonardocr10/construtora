import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { ApiService } from './core/api.service';

const authGuard: CanActivateFn = () => inject(ApiService).authenticated() || inject(Router).parseUrl('/login');
const page = (load: () => Promise<unknown>) => load as never;

export const routes: Routes = [
  { path: 'login', loadComponent: page(() => import('./pages/login.page').then((m) => m.LoginPage)), title: 'Entrar · VistaHub' },
  {
    path: '', canActivate: [authGuard], children: [
      { path: '', loadComponent: page(() => import('./pages/dashboard.page').then((m) => m.DashboardPage)), title: 'Visão geral · VistaHub' },
      { path: 'empreendimentos', loadComponent: page(() => import('./pages/developments.page').then((m) => m.DevelopmentsPage)), title: 'Empreendimentos · VistaHub' },
      { path: 'empreendimentos/novo', loadComponent: page(() => import('./pages/development-form.page').then((m) => m.DevelopmentFormPage)), title: 'Novo empreendimento · VistaHub' },
      { path: 'empreendimentos/:id/editar', loadComponent: page(() => import('./pages/development-form.page').then((m) => m.DevelopmentFormPage)), title: 'Editar empreendimento · VistaHub' },
      { path: 'empreendimentos/:id/arquivos', loadComponent: page(() => import('./pages/assets.page').then((m) => m.AssetsPage)), title: 'Biblioteca de arquivos · VistaHub' },
      { path: 'empreendimentos/:id/torres', loadComponent: page(() => import('./pages/buildings.page').then((m) => m.BuildingsPage)), title: 'Torres e pavimentos · VistaHub' },
      { path: 'empreendimentos/:id/unidades', loadComponent: page(() => import('./pages/units.page').then((m) => m.UnitsPage)), title: 'Unidades · VistaHub' },
      { path: 'empreendimentos/:id/torres/:buildingId/unidades/:unitId', loadComponent: page(() => import('./pages/unit-edit.page').then((m) => m.UnitEditPage)), title: 'Unidade · VistaHub' },
      { path: 'empreendimentos/:id/espelho', loadComponent: page(() => import('./pages/sales-mirror.page').then((m) => m.SalesMirrorPage)), title: 'Espelho de vendas · VistaHub' },
      { path: 'empreendimentos/:id/plantas', loadComponent: page(() => import('./pages/floor-plans.page').then((m) => m.FloorPlansPage)), title: 'Plantas e tipologias · VistaHub' },
      { path: 'empreendimentos/:id/plantas/:planId/vetorizar', loadComponent: page(() => import('./pages/floor-plan-editor.page').then((m) => m.FloorPlanEditorPage)), title: 'Vetorizar planta · VistaHub' },
      { path: 'empreendimentos/:id/implantacao', loadComponent: page(() => import('./pages/implantation-editor.page').then((m) => m.ImplantationEditorPage)), title: 'Editor de implantação · VistaHub' },
      { path: 'empreendimentos/:id/estudio-3d', loadComponent: page(() => import('./pages/studio.page').then((m) => m.StudioPage)), title: 'Estúdio 3D · VistaHub' },
      { path: 'leads', loadComponent: page(() => import('./pages/leads.page').then((m) => m.LeadsPage)), title: 'Leads · VistaHub' },
    ],
  },
  { path: '**', redirectTo: '' },
];
