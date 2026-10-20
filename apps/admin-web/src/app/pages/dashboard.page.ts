import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, DashboardSummary, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { bytes, val } from '../core/labels';
import { DevelopmentCardComponent } from '../shared/development-card.component';

@Component({
  imports: [RouterLink, DevelopmentCardComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head"><div><h1>Visão geral</h1><p class="sub">Gerencie seus empreendimentos, unidades e acompanhe os resultados.</p></div></div>
      @if (error()) { <div class="notice error">{{ error() }} <button class="btn" (click)="load()">Tentar novamente</button></div> }
      @if (summary(); as s) {
        <div class="stats">
          <div class="stat"><div class="symbol">▣</div><div><strong>{{ s.developments }}</strong><span>Empreendimentos</span></div></div>
          <div class="stat"><div class="symbol">▥</div><div><strong>{{ s.buildings }}</strong><span>Torres</span></div></div>
          <div class="stat"><div class="symbol">⌂</div><div><strong>{{ s.units }}</strong><span>Unidades totais</span></div></div>
          <div class="stat"><div class="symbol">⚿</div><div><strong>{{ s.availableUnits }}</strong><span>Disponíveis</span></div></div>
          <div class="stat"><div class="symbol">◷</div><div><strong>{{ s.reservedUnits }}</strong><span>Reservadas</span></div></div>
          <div class="stat"><div class="symbol">×</div><div><strong>{{ s.soldUnits }}</strong><span>Vendidas</span></div></div>
        </div>
        <div class="grid g3" style="margin-bottom:25px">
          <div class="card shadow"><div class="pad"><h3>Situação comercial</h3>
            @for (row of mix(); track row.label) {
              <div class="kv"><span>{{ row.label }}</span><b>{{ row.value }} · {{ row.pct }}%</b></div>
              <div class="pct" style="margin:6px 0 4px"><i [style.width.%]="row.pct" [style.background]="row.color"></i></div>
            }
          </div></div>
          <div class="card shadow"><div class="pad"><h3>Engajamento</h3>
            <div class="kv"><span>Leads recebidos</span><b>{{ s.leads }}</b></div>
            <div class="kv"><span>Visualizações</span><b>{{ s.views }}</b></div>
            <div class="kv"><span>Análises com IA</span><b>{{ s.aiJobs }}</b></div>
            <a class="btn soft" routerLink="/leads" style="margin-top:14px">Ver leads</a>
          </div></div>
          <div class="card shadow"><div class="pad"><h3>Armazenamento</h3>
            <div class="kv"><span>Arquivos enviados</span><b>{{ bytes(s.storageBytes) }}</b></div>
            <p class="small">Soma dos arquivos registrados no livro de uso da organização.</p>
          </div></div>
        </div>
      } @else if (!error()) { <div class="notice">Carregando indicadores…</div> }

      <div class="toolbar">
        <div><h2>Meus empreendimentos</h2><p class="sub">Visualize e gerencie todos os seus projetos</p></div>
        <div class="controls">
          <input class="input" style="width:240px" placeholder="Buscar empreendimento..." [value]="query()" (input)="query.set(v($event))">
          <a class="btn blue" routerLink="/empreendimentos/novo">＋ Novo empreendimento</a>
        </div>
      </div>
      @if (ctx.developments().length === 0 && summary()) {
        <div class="notice"><b>Nenhum empreendimento cadastrado.</b><span>Crie o primeiro empreendimento para configurar torres, unidades e o espelho de vendas.</span></div>
      }
      <div class="grid g4">@for (d of filtered(); track d.id) { <vh-development-card [development]="d" /> }</div>
    </div>`,
})
export class DashboardPage {
  private readonly api = inject(ApiService);
  readonly ctx = inject(DevelopmentContext);
  readonly v = val;
  readonly bytes = bytes;
  readonly summary = signal<DashboardSummary | null>(null);
  readonly error = signal<string | null>(null);
  readonly query = signal('');
  readonly filtered = computed(() => { const q = this.query().toLowerCase(); return this.ctx.developments().filter((d) => d.name.toLowerCase().includes(q)); });
  readonly mix = computed(() => {
    const s = this.summary(); if (!s) return [];
    const pct = (n: number) => (s.units ? Math.round((n / s.units) * 100) : 0);
    return [
      { label: 'Disponíveis', value: s.availableUnits, pct: pct(s.availableUnits), color: '#12c736' },
      { label: 'Reservadas', value: s.reservedUnits, pct: pct(s.reservedUnits), color: '#f6a92c' },
      { label: 'Vendidas', value: s.soldUnits, pct: pct(s.soldUnits), color: '#f13d47' },
    ];
  });

  constructor() { void this.load(); }

  async load() {
    this.error.set(null);
    try { const [summary] = await Promise.all([this.api.get<DashboardSummary>('/dashboard/summary'), this.ctx.refresh()]); this.summary.set(summary); }
    catch (error) { this.error.set(errorMessage(error)); }
  }
}
