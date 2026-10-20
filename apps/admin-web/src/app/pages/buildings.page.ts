import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, Building, FloorPlan, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { initials, val } from '../core/labels';

/** Aplica o padrão de numeração: {andar}, {final}, {final:02} e {torre}. */
export function unitNumber(pattern: string, floor: number, final: number, building: string) {
  return pattern
    .replace(/\{andar\}/g, String(floor))
    .replace(/\{final(?::(\d+))?\}/g, (_m, pad?: string) => String(final).padStart(pad ? Number(pad) : 1, '0'))
    .replace(/\{torre\}/g, building);
}

@Component({
  imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head"><div><h1>Torres e pavimentos</h1><p class="sub">Estruture blocos, pavimentos e regras de numeração para cada torre.</p></div></div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (message()) { <div class="notice ok">{{ message() }}</div> }
      <div class="grid g4" style="margin-bottom:20px">
        @for (b of buildings(); track b.id) {
          <div class="card shadow"><div class="thumb ph">{{ initials(b.name) }}</div><div class="pad">
            <span class="tag {{ b._count.units ? '' : 'yellow' }}">{{ b._count.units ? 'Configurada' : 'Pendente' }}</span>
            <h3 style="margin-top:10px">{{ b.name }}</h3>
            <p class="small">{{ b.floors.length }} pavimentos · {{ b._count.units }} unidades · código {{ b.code }}</p>
            <a class="btn soft" [routerLink]="['/empreendimentos', id(), 'unidades']" [queryParams]="{ torre: b.id }">Configurar torre</a>
          </div></div>
        }
        <form class="card shadow" (submit)="addBuilding($event)"><div class="pad">
          <h3>Nova torre</h3>
          <div class="field"><label>Nome</label><input class="input" required maxlength="120" placeholder="Torre 01" [value]="newName()" (input)="newName.set(v($event))"></div>
          <div class="field"><label>Código</label><input class="input" required maxlength="40" placeholder="T01" [value]="newCode()" (input)="newCode.set(v($event))"></div>
          <button class="btn blue" type="submit" [disabled]="busy()">＋ Adicionar torre</button>
        </div></form>
      </div>

      <form class="card shadow" (submit)="generate($event)"><div class="pad">
        <div class="toolbar"><h3>Gerador de unidades e pavimentos</h3><button class="btn blue" type="submit" [disabled]="busy() || !target()">{{ busy() ? progress() : 'Gerar unidades' }}</button></div>
        <div class="grid g4">
          <div class="field"><label>Torre</label><select class="input" [value]="target()" (change)="target.set(v($event)); fill3d(selected())">
            <option value="">Selecione…</option>@for (b of buildings(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
          </select></div>
          <div class="field"><label>Pavimento inicial</label><input class="input" type="number" [value]="start()" (input)="start.set(+v($event))"></div>
          <div class="field"><label>Pavimento final</label><input class="input" type="number" [value]="end()" (input)="end.set(+v($event))"></div>
          <div class="field"><label>Unidades por andar</label><input class="input" type="number" min="1" [value]="perFloor()" (input)="perFloor.set(+v($event))"></div>
          <div class="field"><label>Padrão de numeração</label><input class="input" [value]="pattern()" (input)="pattern.set(v($event))"></div>
          <div class="field"><label>Exemplo</label><input class="input" disabled [value]="example()"></div>
        </div>
        @if (plans().length) {
          <p class="small" style="margin-top:4px"><b>Planta por final</b> (opcional)</p>
          <div class="grid g4">
            @for (fin of finals(); track fin) {
              <div class="field"><label>Final {{ fin }}</label><select class="input" [value]="planByFinal()[fin] ?? ''" (change)="setPlan(fin, v($event))">
                <option value="">Sem planta</option>@for (p of plans(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
              </select></div>
            }
          </div>
        }
        <p class="small">Variáveis: {{ '{andar}' }}, {{ '{final}' }}, {{ '{final:02}' }} e {{ '{torre}' }}. Tudo é gravado numa única operação: se algo falhar, nada é criado. Pavimentos existentes são reaproveitados e números já cadastrados são ignorados.</p>
      </div></form>

      @if (selected(); as b) {
        <form class="card shadow" style="margin-top:20px" (submit)="save3d($event, b)"><div class="pad">
          <div class="toolbar"><h3>Maquete 3D · {{ b.name }}</h3><button class="btn blue" type="submit" [disabled]="busy()">Salvar parâmetros 3D</button></div>
          <p class="small">A torre é desenhada automaticamente no visualizador a partir destes parâmetros. A posição é medida em metros a partir do centro da implantação.</p>
          <div class="grid g4">
            <div class="field"><label>Pé-direito (m)</label><input class="input" type="number" step="0.05" min="2" [value]="m3().floorHeight" (input)="set3('floorHeight', $event)"></div>
            <div class="field"><label>Largura (m)</label><input class="input" type="number" step="0.1" min="4" [value]="m3().width" (input)="set3('width', $event)"></div>
            <div class="field"><label>Profundidade (m)</label><input class="input" type="number" step="0.1" min="4" [value]="m3().depth" (input)="set3('depth', $event)"></div>
            <div class="field"><label>Elevadores</label><input class="input" type="number" min="0" [value]="m3().elevators" (input)="set3('elevators', $event)"></div>
            <div class="field"><label>Posição X (m)</label><input class="input" type="number" step="0.5" [value]="m3().x" (input)="set3('x', $event)"></div>
            <div class="field"><label>Posição Z (m)</label><input class="input" type="number" step="0.5" [value]="m3().z" (input)="set3('z', $event)"></div>
            <div class="field"><label>Rotação (graus)</label><input class="input" type="number" step="1" [value]="m3().rotation" (input)="set3('rotation', $event)"></div>
            <div class="field"><label>Cores (fachada / destaque)</label><div style="display:flex;gap:8px"><input class="input" type="color" [value]="m3().facade" (input)="set3('facade', $event)"><input class="input" type="color" [value]="m3().accent" (input)="set3('accent', $event)"></div></div>
          </div>
        </div></form>
      }

      @if (selected(); as b) {
        <div class="card shadow" style="margin-top:20px"><div class="pad"><h3>Pavimentos · {{ b.name }}</h3>
          @for (f of b.floors; track f.id) { <div class="kv"><span>{{ f.name }}</span><b>nº {{ f.number }}</b></div> }
          @empty { <p class="small">Nenhum pavimento cadastrado.</p> }
          <form class="filebox" style="margin-top:14px" (submit)="addFloor($event, b)">
            <div class="field" style="margin:0"><label>Nome</label><input class="input" required [value]="floorName()" (input)="floorName.set(v($event))"></div>
            <div class="field" style="margin:0"><label>Número</label><input class="input" type="number" required [value]="floorNumber()" (input)="floorNumber.set(+v($event))"></div>
            <button class="btn soft" type="submit" [disabled]="busy()">＋ Adicionar pavimento</button>
          </form>
        </div></div>
      }
    </div>`,
})
export class BuildingsPage {
  private readonly api = inject(ApiService);
  private readonly ctx = inject(DevelopmentContext);
  readonly id = input.required<string>();
  readonly v = val; readonly initials = initials;
  readonly buildings = signal<Building[]>([]);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly busy = signal(false);
  readonly progress = signal('');
  readonly newName = signal(''); readonly newCode = signal('');
  readonly target = signal('');
  readonly start = signal(1); readonly end = signal(10); readonly perFloor = signal(4);
  readonly pattern = signal('{andar}{final:02}');
  readonly floorName = signal(''); readonly floorNumber = signal(0);
  readonly selected = () => this.buildings().find((b) => b.id === this.target()) ?? null;
  readonly example = () => unitNumber(this.pattern(), this.start(), 1, this.selected()?.code ?? 'T01');

  readonly plans = signal<FloorPlan[]>([]);
  readonly planByFinal = signal<Record<string, string>>({});
  readonly finals = () => Array.from({ length: Math.max(1, Math.min(this.perFloor(), 64)) }, (_, i) => String(i + 1).padStart(2, '0'));
  readonly m3 = signal({ floorHeight: 2.9, width: 30, depth: 16, elevators: 2, x: 0, z: 0, rotation: 0, facade: '#eceeea', accent: '#e0622a' });

  ngOnInit() { this.ctx.select(this.id()); void this.load(); }

  setPlan(final: string, planId: string) { this.planByFinal.update((m) => { const next = { ...m }; if (planId) next[final] = planId; else delete next[final]; return next; }); }
  set3(key: string, event: Event) { const raw = val(event); this.m3.update((m) => ({ ...m, [key]: key === 'facade' || key === 'accent' ? raw : Number(raw) })); }

  fill3d(b: Building | null) {
    if (!b) return;
    this.m3.set({ floorHeight: Number(b.floorHeight ?? 2.9), width: b.model3d?.width ?? 30, depth: b.model3d?.depth ?? 16, elevators: b.model3d?.elevators ?? 2, x: b.position?.x ?? 0, z: b.position?.z ?? 0, rotation: b.position?.rotation ?? 0, facade: b.model3d?.colors?.facade ?? '#eceeea', accent: b.model3d?.colors?.accent ?? '#e0622a' });
  }

  save3d(event: Event, b: Building) {
    event.preventDefault();
    const m = this.m3();
    void this.run(async () => {
      await this.api.patch(`/buildings/${b.id}`, { floorHeight: m.floorHeight, position: { x: m.x, z: m.z, rotation: m.rotation }, model3d: { ...(b.model3d ?? {}), width: m.width, depth: m.depth, elevators: m.elevators, colors: { ...(b.model3d?.colors ?? {}), facade: m.facade, accent: m.accent } } });
      return `Parâmetros 3D de ${b.name} salvos.`;
    });
  }

  async load() {
    try {
      const [list, plans] = await Promise.all([this.api.get<Building[]>(`/developments/${this.id()}/buildings`), this.api.get<FloorPlan[]>(`/developments/${this.id()}/floor-plans`)]);
      this.buildings.set(list); this.plans.set(plans);
      if (!this.target() && list[0]) this.target.set(list[0].id);
      this.fill3d(this.selected());
    }
    catch (error) { this.error.set(errorMessage(error)); }
  }

  private async run(task: () => Promise<string>) {
    this.busy.set(true); this.error.set(null); this.message.set(null);
    try { this.message.set(await task()); await this.load(); await this.ctx.refresh(); }
    catch (error) { this.error.set(errorMessage(error)); await this.load(); }
    finally { this.busy.set(false); this.progress.set(''); }
  }

  addBuilding(event: Event) {
    event.preventDefault();
    void this.run(async () => {
      const b = await this.api.post<Building>(`/developments/${this.id()}/buildings`, { name: this.newName().trim(), code: this.newCode().trim(), sortOrder: this.buildings().length + 1 });
      this.newName.set(''); this.newCode.set(''); this.target.set(b.id);
      return `${b.name} cadastrada.`;
    });
  }

  addFloor(event: Event, b: Building) {
    event.preventDefault();
    void this.run(async () => { await this.api.post(`/buildings/${b.id}/floors`, { name: this.floorName().trim(), number: this.floorNumber() }); this.floorName.set(''); return 'Pavimento cadastrado.'; });
  }

  generate(event: Event) {
    event.preventDefault();
    const building = this.selected(); if (!building) return;
    const [from, to, per] = [this.start(), this.end(), this.perFloor()];
    if (to < from || per < 1) { this.error.set('Intervalo de pavimentos ou quantidade de unidades inválido.'); return; }
    this.progress.set('Gerando…');
    void this.run(async () => {
      const r = await this.api.post<{ created: number; floorsCreated: number }>(`/buildings/${building.id}/generate`, { from, to, perFloor: per, pattern: this.pattern(), floorPlansByFinal: this.planByFinal() });
      return `${r.created} unidades e ${r.floorsCreated} pavimentos criados em ${building.name}.`;
    });
  }
}
