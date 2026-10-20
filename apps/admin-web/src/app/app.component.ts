import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ApiService } from './core/api.service';
import { DevelopmentContext } from './core/development-context';
import { initials, val } from './core/labels';

interface NavItem { icon: string; label: string; path: string; scoped?: boolean; }

@Component({
  selector: 'vh-root', imports: [RouterOutlet, RouterLink, RouterLinkActive], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bare()) { <router-outlet /> } @else {
    <div class="shell">
      <aside class="side">
        <a class="brand" routerLink="/"><span class="brand-icon">◆</span><span>VistaHub<small>PLATAFORMA IMOBILIÁRIA</small></span></a>
        <div class="sidehead">GERAL</div>
        <a class="item" routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><span class="ico">⌂</span>Dashboard</a>
        <div class="sidehead">EMPREENDIMENTOS</div>
        <a class="item" routerLink="/empreendimentos" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><span class="ico">▤</span>Empreendimentos</a>
        <a class="item" routerLink="/empreendimentos/novo" routerLinkActive="active"><span class="ico">＋</span>Novo empreendimento</a>
        <div class="sidehead">EMPREENDIMENTO ATIVO</div>
        <select class="input devpick" [value]="ctx.selectedId() ?? ''" (change)="pick($event)">
          @if (!ctx.developments().length) { <option value="">Nenhum cadastrado</option> }
          @for (d of ctx.developments(); track d.id) { <option [value]="d.id">{{ d.name }}</option> }
        </select>
        @for (n of scoped; track n.path) {
          @if (ctx.selectedId(); as id) {
            <a class="item" [routerLink]="['/empreendimentos', id, n.path]" routerLinkActive="active"><span class="ico">{{ n.icon }}</span>{{ n.label }}</a>
          } @else { <span class="item off"><span class="ico">{{ n.icon }}</span>{{ n.label }}</span> }
        }
        <div class="sidehead">GESTÃO E CONTA</div>
        <a class="item" routerLink="/leads" routerLinkActive="active"><span class="ico">♧</span>Leads</a>
      </aside>
      <main class="main">
        <header class="top">
          <span class="tenant">▣ &nbsp; {{ ctx.selected()?.name ?? 'Organização ativa' }}</span>
          <div class="profile">
            <span class="avatar">{{ userInitials() }}</span>
            <span>{{ api.user()?.name }}<br><span class="small">{{ api.user()?.role }}</span></span>
            <button class="btn" (click)="api.logout()">Sair</button>
          </div>
        </header>
        <router-outlet />
      </main>
    </div>
    }`,
})
export class AppComponent {
  readonly api = inject(ApiService);
  readonly ctx = inject(DevelopmentContext);
  private readonly router = inject(Router);
  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map((e) => e.urlAfterRedirects)), { initialValue: '' });
  readonly bare = computed(() => this.url().startsWith('/login') || !this.api.authenticated());
  readonly userInitials = computed(() => initials(this.api.user()?.name ?? '?'));
  readonly scoped: NavItem[] = [
    { icon: '▱', label: 'Biblioteca de arquivos', path: 'arquivos' },
    { icon: '▥', label: 'Torres e pavimentos', path: 'torres' },
    { icon: '▦', label: 'Unidades', path: 'unidades' },
    { icon: '▦', label: 'Espelho de vendas', path: 'espelho' },
    { icon: '▧', label: 'Plantas e tipologias', path: 'plantas' },
    { icon: '⌖', label: 'Implantação', path: 'implantacao' },
    { icon: '◎', label: 'Calibrar implantação', path: 'calibrar' },
    { icon: '⬡', label: 'Estúdio 3D', path: 'estudio-3d' },
  ];

  constructor() {
    effect(() => { if (this.api.authenticated()) void this.ctx.refresh().catch(() => undefined); });
  }

  pick(event: Event) {
    const id = val(event) || null;
    this.ctx.select(id);
    const match = this.router.url.match(/^\/empreendimentos\/[^/]+\/([a-z0-9-]+)/);
    if (id && match && match[1] !== 'editar') void this.router.navigate(['/empreendimentos', id, match[1]]);
  }
}
