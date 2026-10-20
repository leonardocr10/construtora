import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardStore } from './dashboard.store';

@Component({
  imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="content"><div class="title-row"><div><h1>Visão geral</h1><p>Acompanhe os indicadores da organização ativa.</p></div><a routerLink="/empreendimentos" class="button">Novo empreendimento</a></div>
      @if (store.state() === 'idle') { <div class="notice"><b>Conecte uma organização para começar.</b><span>O painel não inclui dados demonstrativos. Entre com uma conta provisionada para consultar informações reais.</span></div> }
      @if (store.state() === 'loading') { <div class="notice">Carregando indicadores…</div> }
      @if (store.state() === 'error') { <div class="notice error">{{ store.error() }} <button (click)="load()">Tentar novamente</button></div> }
      @if (store.state() === 'ready' && store.summary(); as summary) {
        <div class="metrics"><article><small>Empreendimentos</small><strong>{{summary.developments}}</strong></article><article><small>Torres</small><strong>{{summary.buildings}}</strong></article><article><small>Unidades cadastradas</small><strong>{{summary.units}}</strong></article><article><small>Unidades disponíveis</small><strong>{{summary.availableUnits}}</strong></article></div>
        @if (store.isEmpty()) { <div class="notice"><b>Nenhum empreendimento cadastrado.</b><span>Crie o primeiro empreendimento para configurar a implantação, as torres e o espelho de vendas.</span><a routerLink="/empreendimentos" class="button">Ir para empreendimentos</a></div> }
      }
    </section>`,
}) export class DashboardPageComponent {
  readonly store = inject(DashboardStore);
  // A organização será obtida do access token após o fluxo de sessão ser conectado.
  load() { this.store.load(sessionStorage.getItem('vistahub.access-token') ?? ''); }
}
