import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, Building, Unit, UnitStatus, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { area, unitStatus, unitStatuses, val } from '../core/labels';

@Component({
  imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head"><div><h1>Unidades</h1><p class="sub">Gerencie os apartamentos de todas as torres e seus dados comerciais.</p></div></div>
      <div class="stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="stat"><div class="symbol">⌂</div><div><strong>{{ units().length }}</strong><span>Unidades</span></div></div>
        <div class="stat"><div class="symbol">✓</div><div><strong>{{ count('AVAILABLE') }}</strong><span>Disponíveis</span></div></div>
        <div class="stat"><div class="symbol">◷</div><div><strong>{{ count('RESERVED') }}</strong><span>Reservadas</span></div></div>
        <div class="stat"><div class="symbol">×</div><div><strong>{{ count('SOLD') }}</strong><span>Vendidas</span></div></div>
      </div>
      <div class="toolbar">
        <div class="controls">
          <select class="input btn soft" style="width:auto" [value]="buildingId()" (change)="selectBuilding(v($event))">
            @for (b of buildings(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
          </select>
          <select class="input btn" style="width:auto" (change)="floorFilter.set(v($event))">
            <option value="">Todos os pavimentos</option>@for (f of building()?.floors ?? []; track f.id) { <option [value]="f.id">{{ f.name }}</option> }
          </select>
          <select class="input btn" style="width:auto" (change)="statusFilter.set(v($event))">
            <option value="">Filtrar status</option>@for (s of statuses; track s) { <option [value]="s">{{ label[s].label }}</option> }
          </select>
        </div>
        <button class="btn blue" [disabled]="!building()" (click)="creating.set(!creating())">＋ Nova unidade</button>
      </div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (loaded() && !buildings().length) { <div class="notice"><b>Nenhuma torre cadastrada.</b><a class="btn soft" [routerLink]="['/empreendimentos', id(), 'torres']">Cadastrar torres</a></div> }
      @if (creating()) {
        <form class="card shadow filebox pad" style="margin-bottom:16px" (submit)="create($event)">
          <div class="field" style="margin:0"><label>Número</label><input class="input" required maxlength="20" [value]="newNumber()" (input)="newNumber.set(v($event))"></div>
          <div class="field" style="margin:0"><label>Pavimento</label><select class="input" (change)="newFloor.set(v($event))"><option value="">—</option>@for (f of building()?.floors ?? []; track f.id) { <option [value]="f.id">{{ f.name }}</option> }</select></div>
          <div class="field" style="margin:0"><label>Área privativa (m²)</label><input class="input" type="number" step="0.01" min="0" [value]="newArea()" (input)="newArea.set(v($event))"></div>
          <button class="btn blue" type="submit" [disabled]="busy()">Cadastrar</button>
        </form>
      }
      <div class="card shadow"><table class="table">
        <thead><tr><th>Apartamento</th><th>Torre</th><th>Pavimento</th><th>Tipologia</th><th>Área</th><th>Situação</th><th>Ação</th></tr></thead>
        <tbody>
          @for (u of visible(); track u.id) {
            <tr><td>{{ u.number }}</td><td>{{ building()?.name }}</td><td>{{ u.floor?.number ?? '—' }}</td><td>{{ plan(u) }}</td><td>{{ area(u.privateArea) }}</td>
              <td><span class="tag {{ label[u.status].tag }}">{{ label[u.status].label }}</span></td>
              <td><a class="btn soft" [routerLink]="['/empreendimentos', id(), 'torres', u.buildingId, 'unidades', u.id]">Editar</a></td></tr>
          } @empty { <tr><td colspan="7" class="small">{{ loaded() ? 'Nenhuma unidade encontrada.' : 'Carregando…' }}</td></tr> }
        </tbody>
      </table></div>
    </div>`,
})
export class UnitsPage {
  private readonly api = inject(ApiService);
  private readonly ctx = inject(DevelopmentContext);
  readonly id = input.required<string>();
  readonly torre = input<string>();
  readonly v = val; readonly area = area; readonly label = unitStatus; readonly statuses = unitStatuses;
  readonly buildings = signal<Building[]>([]);
  readonly buildingId = signal('');
  readonly units = signal<Unit[]>([]);
  readonly floorFilter = signal('');
  readonly statusFilter = signal('');
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly creating = signal(false);
  readonly busy = signal(false);
  readonly newNumber = signal(''); readonly newFloor = signal(''); readonly newArea = signal('');
  readonly building = computed(() => this.buildings().find((b) => b.id === this.buildingId()) ?? null);
  readonly visible = computed(() => this.units().filter((u) => (!this.floorFilter() || u.floorId === this.floorFilter()) && (!this.statusFilter() || u.status === this.statusFilter())));

  ngOnInit() { this.ctx.select(this.id()); void this.load(); }

  count(status: UnitStatus) { return this.units().filter((u) => u.status === status).length; }
  plan(u: Unit) { return (u.floorPlans.find((p) => p.primary) ?? u.floorPlans[0])?.floorPlan.name ?? u.unitType?.name ?? '—'; }

  async load() {
    try {
      const list = await this.api.get<Building[]>(`/developments/${this.id()}/buildings`);
      this.buildings.set(list);
      const initial = list.find((b) => b.id === this.torre()) ?? list[0];
      if (initial) await this.selectBuilding(initial.id); else this.loaded.set(true);
    } catch (error) { this.error.set(errorMessage(error)); }
  }

  async selectBuilding(id: string) {
    this.buildingId.set(id); this.floorFilter.set(''); this.loaded.set(false);
    try { this.units.set(await this.api.get<Unit[]>(`/buildings/${id}/units`)); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.loaded.set(true); }
  }

  async create(event: Event) {
    event.preventDefault();
    this.busy.set(true); this.error.set(null);
    const body: Record<string, unknown> = { number: this.newNumber().trim() };
    if (this.newFloor()) body['floorId'] = this.newFloor();
    if (this.newArea()) body['privateArea'] = Number(this.newArea());
    try { await this.api.post(`/buildings/${this.buildingId()}/units`, body); this.newNumber.set(''); this.newArea.set(''); this.creating.set(false); await this.selectBuilding(this.buildingId()); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
