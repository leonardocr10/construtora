import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, Building, Floor, Unit, errorMessage } from '../core/api.service';
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
          <div class="field"><label>Torre</label><select class="input" [value]="target()" (change)="target.set(v($event))">
            <option value="">Selecione…</option>@for (b of buildings(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
          </select></div>
          <div class="field"><label>Pavimento inicial</label><input class="input" type="number" [value]="start()" (input)="start.set(+v($event))"></div>
          <div class="field"><label>Pavimento final</label><input class="input" type="number" [value]="end()" (input)="end.set(+v($event))"></div>
          <div class="field"><label>Unidades por andar</label><input class="input" type="number" min="1" [value]="perFloor()" (input)="perFloor.set(+v($event))"></div>
          <div class="field"><label>Padrão de numeração</label><input class="input" [value]="pattern()" (input)="pattern.set(v($event))"></div>
          <div class="field"><label>Exemplo</label><input class="input" disabled [value]="example()"></div>
        </div>
        <p class="small">Variáveis: {{ '{andar}' }}, {{ '{final}' }}, {{ '{final:02}' }} e {{ '{torre}' }}. Pavimentos existentes são reaproveitados e números já cadastrados são ignorados.</p>
      </div></form>

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

  ngOnInit() { this.ctx.select(this.id()); void this.load(); }

  async load() {
    try { const list = await this.api.get<Building[]>(`/developments/${this.id()}/buildings`); this.buildings.set(list); if (!this.target() && list[0]) this.target.set(list[0].id); }
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
    void this.run(async () => {
      const floors = new Map<number, Floor>(building.floors.map((f) => [f.number, f]));
      const existing = new Set((await this.api.get<Unit[]>(`/buildings/${building.id}/units`)).map((u) => u.number));
      let created = 0; const total = (to - from + 1) * per;
      for (let n = from; n <= to; n++) {
        let floor = floors.get(n);
        if (!floor) { floor = await this.api.post<Floor>(`/buildings/${building.id}/floors`, { name: n === 0 ? 'Térreo' : `${n}º pavimento`, number: n }); floors.set(n, floor); }
        for (let i = 1; i <= per; i++) {
          const number = unitNumber(this.pattern(), n, i, building.code);
          this.progress.set(`Gerando ${(n - from) * per + i}/${total}…`);
          if (existing.has(number)) continue;
          await this.api.post(`/buildings/${building.id}/units`, { number, floorId: floor.id, final: String(i).padStart(2, '0') });
          existing.add(number); created++;
        }
      }
      return `${created} unidades criadas em ${building.name}.`;
    });
  }
}
