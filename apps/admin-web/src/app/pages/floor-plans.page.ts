import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ApiService, FloorPlan, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { area, val } from '../core/labels';

type Form = Record<'name' | 'code' | 'area' | 'bedrooms' | 'suites' | 'bathrooms' | 'parkingSpaces' | 'description', string>;
const empty: Form = { name: '', code: '', area: '', bedrooms: '', suites: '', bathrooms: '', parkingSpaces: '', description: '' };
const numeric = ['area', 'bedrooms', 'suites', 'bathrooms', 'parkingSpaces'] as const;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head">
        <div><h1>Plantas e tipologias</h1><p class="sub">Cadastre, organize e relacione plantas aos apartamentos.</p></div>
        <div class="controls"><button class="btn blue" (click)="creating.set(!creating())">＋ Nova planta</button></div>
      </div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (creating()) {
        <form class="card shadow" style="margin-bottom:18px" (submit)="create($event)"><div class="pad"><h3>Nova planta</h3>
          <div class="grid g4">
            <div class="field"><label>Nome</label><input class="input" required maxlength="120" [value]="f().name" (input)="set('name', $event)"></div>
            <div class="field"><label>Código</label><input class="input" [value]="f().code" (input)="set('code', $event)"></div>
            <div class="field"><label>Área (m²)</label><input class="input" type="number" step="0.01" min="0" [value]="f().area" (input)="set('area', $event)"></div>
            <div class="field"><label>Quartos</label><input class="input" type="number" min="0" [value]="f().bedrooms" (input)="set('bedrooms', $event)"></div>
            <div class="field"><label>Suítes</label><input class="input" type="number" min="0" [value]="f().suites" (input)="set('suites', $event)"></div>
            <div class="field"><label>Banheiros</label><input class="input" type="number" min="0" [value]="f().bathrooms" (input)="set('bathrooms', $event)"></div>
            <div class="field"><label>Vagas</label><input class="input" type="number" min="0" [value]="f().parkingSpaces" (input)="set('parkingSpaces', $event)"></div>
            <div class="field"><label>Imagem da planta (opcional)</label><input class="input" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" (change)="pick($event)"></div>
          </div>
          <div class="field"><label>Descrição</label><textarea class="input" [value]="f().description" (input)="set('description', $event)"></textarea></div>
          <button class="btn blue" type="submit" [disabled]="busy()">{{ busy() ? 'Salvando…' : 'Salvar planta' }}</button>
        </div></form>
      }
      @if (loaded() && !plans().length) { <div class="notice"><b>Nenhuma planta cadastrada.</b><span>Cadastre as tipologias para vinculá-las às unidades.</span></div> }
      <div class="grid g3">
        @for (p of plans(); track p.id) {
          <div class="card shadow"><div class="cover ph" style="background:#f4f8ff;color:#2478f4">▧</div><div class="pad">
            <span class="tag {{ p._count.units ? '' : 'gray' }}">{{ p._count.units ? 'Ativa' : 'Sem unidades' }}</span>
            <h3 style="margin-top:10px">{{ p.name }}</h3>
            <p>{{ p.bedrooms ?? 0 }} quartos · {{ p.suites ?? 0 }} suíte(s) · {{ p.bathrooms ?? 0 }} banheiros · {{ p.parkingSpaces ?? 0 }} vaga(s)</p>
            <p class="small">{{ area(p.area) }} · {{ p._count.units }} unidade(s) vinculada(s) · {{ p.assets.length }} arquivo(s)</p>
          </div></div>
        }
      </div>
    </div>`,
})
export class FloorPlansPage {
  private readonly api = inject(ApiService);
  private readonly ctx = inject(DevelopmentContext);
  readonly id = input.required<string>();
  readonly area = area;
  readonly plans = signal<FloorPlan[]>([]);
  readonly f = signal<Form>({ ...empty });
  readonly creating = signal(false);
  readonly busy = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  private image: File | null = null;

  ngOnInit() { this.ctx.select(this.id()); void this.load(); }

  set(key: keyof Form, event: Event) { this.f.update((f) => ({ ...f, [key]: val(event) })); }
  pick(event: Event) { this.image = (event.target as HTMLInputElement).files?.[0] ?? null; }

  async load() {
    try { this.plans.set(await this.api.get<FloorPlan[]>(`/developments/${this.id()}/floor-plans`)); this.loaded.set(true); }
    catch (error) { this.error.set(errorMessage(error)); }
  }

  async create(event: Event) {
    event.preventDefault();
    this.busy.set(true); this.error.set(null);
    const f = this.f(); const body: Record<string, unknown> = { name: f.name.trim() };
    if (f.code.trim()) body['code'] = f.code.trim();
    if (f.description.trim()) body['description'] = f.description.trim();
    for (const k of numeric) if (f[k] !== '') body[k] = Number(f[k]);
    try {
      const plan = await this.api.post<FloorPlan>(`/developments/${this.id()}/floor-plans`, body);
      if (this.image) {
        const form = new FormData(); form.append('file', this.image); form.append('kind', 'FLOOR_PLAN'); form.append('floorPlanId', plan.id); form.append('label', plan.name);
        await this.api.upload(`/developments/${this.id()}/assets`, form); this.image = null;
      }
      this.f.set({ ...empty }); this.creating.set(false); await this.load();
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
