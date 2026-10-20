import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'vh-root', imports: [RouterOutlet, RouterLink, RouterLinkActive], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <aside class="sidebar"><a routerLink="/" class="brand">◆ Vista<span>Hub</span></a><p>GERENCIAMENTO</p>
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}">Visão geral</a>
        <a routerLink="/empreendimentos" routerLinkActive="active">Empreendimentos</a>
        <a routerLink="/usuarios" routerLinkActive="active">Usuários e permissões</a>
        <p>CONFIGURAÇÃO</p><a routerLink="/organizacao" routerLinkActive="active">Organização</a><a routerLink="/plano" routerLinkActive="active">Plano e uso</a>
      </aside>
      <main><header><div class="search">Buscar empreendimentos, unidades e arquivos</div><div class="account">Construtora · organização ativa</div></header><router-outlet /></main>
    </div>`,
}) export class AppComponent {}
