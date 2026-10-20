import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, Building, FloorPlan, StatusHistory, Unit, UnitStatus, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { area, dateTime, num, unitStatus, unitStatuses, val } from '../core/labels';

type Form = { number: string; floorId: string; final: string; privateArea: string; totalArea: string; price: string };

@Component({
  imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head">
        <div><h1>Apartamento {{ unit()?.number ?? '' }}</h1><p class="sub">{{ building()?.name }} · {{ unit()?.floor?.name ?? 'sem pavimento' }} · dados cadastrais e disponibilidade.</p></div>
        <div class="controls"><a class="btn" [routerLink]="['/empreendimentos', id(), 'espelho']">← Espelho de vendas</a></div>
      </div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (message()) { <div class="notice ok">{{ message() }}</div> }
      @if (unit(); as u) {
      <div class="two">
        <form class="card shadow" (submit)="save($event)"><div class="pad"><h3>Dados do apartamento</h3>
          <div class="grid g2">
            <div class="field"><label>Número</label><input class="input" required maxlength="20" [value]="f().number" (input)="set('number', $event)"></div>
            <div class="field"><label>Torre</label><input class="input" disabled [value]="building()?.name ?? ''"></div>
            <div class="field"><label>Pavimento</label><select class="input" [value]="f().floorId" (change)="set('floorId', $event)">
              <option value="">—</option>@for (fl of building()?.floors ?? []; track fl.id) { <option [value]="fl.id">{{ fl.name }}</option> }
            </select></div>
            <div class="field"><label>Final</label><input class="input" [value]="f().final" (input)="set('final', $event)"></div>
            <div class="field"><label>Tipologia (planta principal)</label><select class="input" [value]="primaryPlan()?.id ?? ''" (change)="planChoice.set(v($event))">
              <option value="">—</option>@for (p of plans(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
            </select></div>
            <div class="field"><label>Área privativa (m²)</label><input class="input" type="number" step="0.01" min="0" [value]="f().privateArea" (input)="set('privateArea', $event)"></div>
            <div class="field"><label>Área total (m²)</label><input class="input" type="number" step="0.01" min="0" [value]="f().totalArea" (input)="set('totalArea', $event)"></div>
            <div class="field"><label>Valor (R$)</label><input class="input" type="number" step="0.01" min="0" [value]="f().price" (input)="set('price', $event)"></div>
            <div class="field"><label>Quartos</label><input class="input" disabled [value]="primaryPlan()?.bedrooms ?? '—'"></div>
            <div class="field"><label>Suítes</label><input class="input" disabled [value]="primaryPlan()?.suites ?? '—'"></div>
            <div class="field"><label>Vagas</label><input class="input" disabled [value]="primaryPlan()?.parkingSpaces ?? '—'"></div>
            <div class="field"><label>Disponibilidade</label><select class="input" [value]="status()" (change)="status.set($any(v($event)))">
              @for (s of statuses; track s) { <option [value]="s">{{ label[s].label }}</option> }
            </select></div>
          </div>
          @if (status() !== u.status) { <div class="field"><label>Motivo da alteração de status</label><input class="input" maxlength="255" [value]="reason()" (input)="reason.set(v($event))"></div> }
          <button class="btn blue" type="submit" [disabled]="busy()">{{ busy() ? 'Salvando…' : 'Salvar alterações' }}</button>
        </div></form>
        <div class="card shadow"><div class="pad"><h3>Planta vinculada</h3>
          @if (primaryPlan(); as p) {
            <div class="cover ph" style="height:220px">▧</div>
            <p><b>{{ p.name }}</b></p>
            <p class="small">{{ p.bedrooms ?? 0 }} quartos · {{ p.suites ?? 0 }} suítes · {{ p.bathrooms ?? 0 }} banheiros · {{ area(p.area) }}</p>
          } @else { <p class="small">Nenhuma planta vinculada a esta unidade.</p> }
          <div class="divider"></div>
          <a class="btn soft" [routerLink]="['/empreendimentos', id(), 'plantas']">Gerenciar plantas</a>
          <h3 style="margin-top:18px">Histórico recente</h3>
          @for (h of history(); track h.id) {
            <div class="listrow">{{ h.previousStatus ? 'Status alterado para ' + label[h.status].label.toLowerCase() : 'Cadastro criado (' + label[h.status].label.toLowerCase() + ')' }} · {{ dateTime(h.createdAt) }}
              <small>{{ h.changedBy?.name ?? 'Sistema' }}{{ h.reason ? ' · ' + h.reason : '' }}</small></div>
          } @empty { <p class="small">Sem histórico.</p> }
        </div></div>
      </div>
      }
    </div>`,
})
export class UnitEditPage {
  private readonly api = inject(ApiService);
  private readonly ctx = inject(DevelopmentContext);
  readonly id = input.required<string>();
  readonly buildingId = input.required<string>();
  readonly unitId = input.required<string>();
  readonly v = val; readonly area = area; readonly dateTime = dateTime; readonly label = unitStatus; readonly statuses = unitStatuses;
  readonly building = signal<Building | null>(null);
  readonly unit = signal<Unit | null>(null);
  readonly plans = signal<FloorPlan[]>([]);
  readonly history = signal<StatusHistory[]>([]);
  readonly f = signal<Form>({ number: '', floorId: '', final: '', privateArea: '', totalArea: '', price: '' });
  readonly status = signal<UnitStatus>('AVAILABLE');
  readonly reason = signal('');
  readonly planChoice = signal<string | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly primaryPlan = computed(() => {
    const choice = this.planChoice();
    if (choice !== null) return this.plans().find((p) => p.id === choice) ?? null;
    const u = this.unit(); const link = u?.floorPlans.find((p) => p.primary) ?? u?.floorPlans[0];
    return link ? this.plans().find((p) => p.id === link.floorPlanId) ?? link.floorPlan : null;
  });

  ngOnInit() { this.ctx.select(this.id()); void this.load(); }

  set(key: keyof Form, event: Event) { this.f.update((f) => ({ ...f, [key]: val(event) })); }

  async load() {
    try {
      const [buildings, units, plans, history] = await Promise.all([
        this.api.get<Building[]>(`/developments/${this.id()}/buildings`), this.api.get<Unit[]>(`/buildings/${this.buildingId()}/units`),
        this.api.get<FloorPlan[]>(`/developments/${this.id()}/floor-plans`), this.api.get<StatusHistory[]>(`/units/${this.unitId()}/status-history`),
      ]);
      const u = units.find((x) => x.id === this.unitId());
      if (!u) throw new Error('Unidade não encontrada');
      this.building.set(buildings.find((b) => b.id === this.buildingId()) ?? null); this.plans.set(plans); this.history.set(history);
      this.unit.set(u); this.status.set(u.status); this.planChoice.set(null); this.reason.set('');
      const s = (x: string | number | null) => (x === null ? '' : String(num(x)));
      this.f.set({ number: u.number, floorId: u.floorId ?? '', final: u.final ?? '', privateArea: s(u.privateArea), totalArea: s(u.totalArea), price: s(u.price) });
    } catch (error) { this.error.set(errorMessage(error)); }
  }

  async save(event: Event) {
    event.preventDefault();
    const u = this.unit(); if (!u) return;
    this.busy.set(true); this.error.set(null); this.message.set(null);
    const f = this.f();
    const body: Record<string, unknown> = { number: f.number.trim(), final: f.final.trim() || undefined, floorId: f.floorId || undefined };
    for (const k of ['privateArea', 'totalArea', 'price'] as const) if (f[k] !== '') body[k] = Number(f[k]);
    try {
      await this.api.patch(`/units/${u.id}`, body);
      const plan = this.planChoice();
      if (plan) await this.api.post(`/units/${u.id}/floor-plans`, { floorPlanId: plan, primary: true });
      if (this.status() !== u.status) await this.api.put(`/units/${u.id}/status`, { status: this.status(), ...(this.reason().trim() ? { reason: this.reason().trim() } : {}) });
      await this.load();
      this.message.set('Alterações salvas.');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
