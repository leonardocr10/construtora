import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DevelopmentStatus, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { DevelopmentCardComponent } from '../shared/development-card.component';

type Filter = 'ALL' | DevelopmentStatus;

@Component({
  imports: [RouterLink, DevelopmentCardComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head"><div><h1>Empreendimentos</h1><p class="sub">Organize todos os projetos e acesse seus ambientes comerciais.</p></div></div>
      <div class="toolbar">
        <div class="switches">
          @for (t of tabs(); track t.key) { <button class="tab" [class.active]="filter() === t.key" (click)="filter.set(t.key)">{{ t.label }} ({{ t.count }})</button> }
        </div>
        <div class="controls"><a class="btn blue" routerLink="/empreendimentos/novo">＋ Novo empreendimento</a></div>
      </div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (loaded() && !visible().length) { <div class="notice"><b>Nenhum empreendimento neste filtro.</b><span>Cadastre um novo empreendimento para começar.</span></div> }
      <div class="grid g4">@for (d of visible(); track d.id) { <vh-development-card [development]="d" /> }</div>
    </div>`,
})
export class DevelopmentsPage {
  readonly ctx = inject(DevelopmentContext);
  readonly filter = signal<Filter>('ALL');
  readonly error = signal<string | null>(null);
  readonly loaded = signal(false);
  readonly tabs = computed(() => {
    const list = this.ctx.developments(); const count = (s: DevelopmentStatus) => list.filter((d) => d.status === s).length;
    return [
      { key: 'ALL' as Filter, label: 'Todos', count: list.length }, { key: 'PUBLISHED' as Filter, label: 'Publicados', count: count('PUBLISHED') },
      { key: 'PREPARING' as Filter, label: 'Em edição', count: count('PREPARING') }, { key: 'DRAFT' as Filter, label: 'Rascunhos', count: count('DRAFT') },
    ];
  });
  readonly visible = computed(() => this.filter() === 'ALL' ? this.ctx.developments() : this.ctx.developments().filter((d) => d.status === this.filter()));

  constructor() { this.ctx.refresh().then(() => this.loaded.set(true), (e) => this.error.set(errorMessage(e))); }
}
