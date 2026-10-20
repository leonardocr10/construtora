import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, Building, Unit, UnitStatus, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { unitStatus, unitStatuses, val } from '../core/labels';

interface Row { label: string; sort: number; units: Unit[]; }

@Component({
  imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head"><div><h1>Espelho de vendas</h1><p class="sub">Acompanhe a disponibilidade por pavimento e visualize cada unidade.</p></div></div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (loaded() && !buildings().length) { <div class="notice"><b>Nenhuma torre cadastrada.</b><a class="btn soft" [routerLink]="['/empreendimentos', id(), 'torres']">Cadastrar torres</a></div> }
      <div class="two" style="grid-template-columns:1.65fr 1fr">
        <div class="card shadow"><div class="pad">
          <div class="toolbar">
            <div><h3>{{ building()?.name?.toUpperCase() }}</h3><p class="small">{{ units().length }} unidades · {{ rows().length }} pavimentos</p></div>
            <div class="controls"><select class="input btn soft" style="width:auto" [value]="buildingId()" (change)="selectBuilding(v($event))">
              @for (b of buildings(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
            </select></div>
          </div>
          @for (row of rows(); track row.label) {
            <div class="floor dyn" [style.--cols]="cols()">
              <b class="small">{{ row.label }}</b>
              @for (u of row.units; track u.id) {
                <div class="unit {{ label[u.status].cell }}" [class.sel]="u.id === selectedId()" [title]="label[u.status].label" (click)="selectUnit(u)">⌂<br>{{ u.number }}</div>
              }
            </div>
          } @empty { @if (loaded() && building()) { <p class="small">Nenhuma unidade cadastrada nesta torre.</p> } }
          <div class="controls" style="margin-top:15px">
            @for (s of statuses; track s) { <span class="tag {{ label[s].tag }}">● {{ label[s].label }}</span> }
          </div>
        </div></div>
        <div class="card shadow"><div class="pad">
          <h3>Resumo comercial</h3>
          <div class="grid g2">
            <div class="card shadow"><div class="pad"><h2>{{ count('AVAILABLE') }}</h2><span class="small">Disponíveis</span></div></div>
            <div class="card shadow"><div class="pad"><h2>{{ count('RESERVED') }}</h2><span class="small">Reservados</span></div></div>
            <div class="card shadow"><div class="pad"><h2>{{ count('SOLD') }}</h2><span class="small">Vendidos</span></div></div>
            <div class="card shadow"><div class="pad"><h2>{{ units().length }}</h2><span class="small">Total</span></div></div>
          </div>
          <div class="divider"></div>
          <h3>Unidade selecionada</h3>
          @if (selected(); as u) {
            <div class="field"><label>Apartamento</label><input class="input" disabled [value]="u.number"></div>
            <div class="field"><label>Status</label><select class="input" [value]="newStatus()" (change)="newStatus.set($any(v($event)))">
              @for (s of statuses; track s) { <option [value]="s">{{ label[s].label }}</option> }
            </select></div>
            <div class="field"><label>Motivo (opcional)</label><input class="input" maxlength="255" [value]="reason()" (input)="reason.set(v($event))"></div>
            @if (message()) { <div class="notice ok">{{ message() }}</div> }
            <div class="controls">
              <button class="btn blue" [disabled]="busy() || newStatus() === u.status" (click)="saveStatus(u)">Salvar status</button>
              <a class="btn" [routerLink]="['/empreendimentos', id(), 'torres', u.buildingId, 'unidades', u.id]">Abrir unidade</a>
            </div>
          } @else { <p class="small">Clique em uma unidade no espelho para abrir os detalhes e alterar o status.</p> }
        </div></div>
      </div>
    </div>`,
})
export class SalesMirrorPage {
  private readonly api = inject(ApiService);
  private readonly ctx = inject(DevelopmentContext);
  readonly id = input.required<string>();
  readonly v = val; readonly label = unitStatus; readonly statuses = unitStatuses;
  readonly buildings = signal<Building[]>([]);
  readonly buildingId = signal('');
  readonly units = signal<Unit[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly newStatus = signal<UnitStatus>('AVAILABLE');
  readonly reason = signal('');
  readonly loaded = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly building = computed(() => this.buildings().find((b) => b.id === this.buildingId()) ?? null);
  readonly selected = computed(() => this.units().find((u) => u.id === this.selectedId()) ?? null);
  readonly rows = computed<Row[]>(() => {
    const map = new Map<string, Row>();
    for (const u of this.units()) {
      const key = u.floorId ?? 'none';
      if (!map.has(key)) map.set(key, { label: u.floor ? String(u.floor.number).padStart(2, '0') : '—', sort: u.floor?.sortOrder ?? -1e9, units: [] });
      map.get(key)!.units.push(u);
    }
    return [...map.values()].sort((a, b) => b.sort - a.sort);
  });
  readonly cols = computed(() => Math.max(1, ...this.rows().map((r) => r.units.length)));

  ngOnInit() { this.ctx.select(this.id()); void this.load(); }

  count(status: UnitStatus) { return this.units().filter((u) => u.status === status).length; }

  async load() {
    try {
      const list = await this.api.get<Building[]>(`/developments/${this.id()}/buildings`);
      this.buildings.set(list);
      if (list[0]) await this.selectBuilding(list[0].id); else this.loaded.set(true);
    } catch (error) { this.error.set(errorMessage(error)); }
  }

  async selectBuilding(id: string) {
    this.buildingId.set(id); this.selectedId.set(null);
    try { this.units.set(await this.api.get<Unit[]>(`/buildings/${id}/units`)); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.loaded.set(true); }
  }

  selectUnit(u: Unit) { this.selectedId.set(u.id); this.newStatus.set(u.status); this.reason.set(''); this.message.set(null); }

  async saveStatus(u: Unit) {
    this.busy.set(true); this.error.set(null);
    try {
      const updated = await this.api.put<Unit>(`/units/${u.id}/status`, { status: this.newStatus(), ...(this.reason().trim() ? { reason: this.reason().trim() } : {}) });
      this.units.update((list) => list.map((x) => (x.id === u.id ? { ...x, status: updated.status } : x)));
      this.message.set(`Unidade ${u.number}: ${this.label[updated.status].label}.`);
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
