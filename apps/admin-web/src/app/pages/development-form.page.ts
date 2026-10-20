import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, Development, DevelopmentStatus, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { developmentStatus, slugify, val } from '../core/labels';

type Form = Record<'name' | 'slug' | 'code' | 'city' | 'state' | 'zipCode' | 'deliveryDate' | 'address' | 'description', string> & { status: DevelopmentStatus };
const empty: Form = { name: '', slug: '', code: '', city: '', state: '', zipCode: '', deliveryDate: '', address: '', description: '', status: 'DRAFT' };

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head"><div><h1>{{ id() ? 'Editar empreendimento' : 'Novo empreendimento' }}</h1><p class="sub">Configure as informações básicas do projeto e avance para a estrutura.</p></div></div>
      <div class="steps"><span class="step on">1 Informações</span><span class="step" [class.on]="!!id()">2 Arquivos</span><span class="step">3 Estrutura</span><span class="step">4 Publicação</span></div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (saved()) { <div class="notice ok">Alterações salvas.</div> }
      <form class="two" (submit)="save($event)">
        <div class="card shadow"><div class="pad"><h3>Dados do empreendimento</h3>
          <div class="grid g2">
            <div class="field"><label>Nome</label><input class="input" required maxlength="160" [value]="f().name" (input)="setName($event)"></div>
            <div class="field"><label>Identificador (slug)</label><input class="input" required pattern="[a-z0-9]+(-[a-z0-9]+)*" [value]="f().slug" (input)="set('slug', $event)"></div>
            <div class="field"><label>Cidade</label><input class="input" [value]="f().city" (input)="set('city', $event)"></div>
            <div class="field"><label>Estado</label><input class="input" maxlength="2" [value]="f().state" (input)="set('state', $event)"></div>
            <div class="field"><label>CEP</label><input class="input" [value]="f().zipCode" (input)="set('zipCode', $event)"></div>
            <div class="field"><label>Previsão de entrega</label><input class="input" type="date" [value]="f().deliveryDate" (input)="set('deliveryDate', $event)"></div>
            <div class="field"><label>Código interno</label><input class="input" [value]="f().code" (input)="set('code', $event)"></div>
            @if (id()) {
              <div class="field"><label>Situação</label><select class="input" [value]="f().status" (change)="set('status', $event)">
                @for (s of statuses; track s) { <option [value]="s">{{ statusLabel[s].label }}</option> }
              </select></div>
            }
          </div>
          <div class="field"><label>Endereço</label><input class="input" [value]="f().address" (input)="set('address', $event)"></div>
          <div class="field"><label>Descrição</label><textarea class="input" [value]="f().description" (input)="set('description', $event)"></textarea></div>
          <button class="btn blue" type="submit" [disabled]="busy()">{{ busy() ? 'Salvando…' : id() ? 'Salvar alterações' : 'Salvar e continuar →' }}</button>
        </div></div>
        <div class="card shadow"><div class="pad"><h3>Imagem de capa</h3>
          <div class="cover ph">{{ f().name ? f().name.slice(0, 1).toUpperCase() : '◆' }}</div>
          <p class="small">A imagem de fachada enviada é registrada na biblioteca de arquivos do empreendimento (PNG, JPEG ou WEBP).</p>
          <input class="input" type="file" accept="image/png,image/jpeg,image/webp" (change)="cover = file($event)">
          @if (cover) { <p class="small">Será enviada ao salvar: {{ cover.name }}</p> }
          <div class="divider"></div>
          <h3>Próximos passos</h3>
          <p class="small">Depois de salvar, cadastre torres e pavimentos, gere as unidades e acompanhe o espelho de vendas.</p>
        </div></div>
      </form>
    </div>`,
})
export class DevelopmentFormPage {
  private readonly api = inject(ApiService);
  private readonly ctx = inject(DevelopmentContext);
  private readonly router = inject(Router);
  readonly id = input<string>();
  readonly f = signal<Form>({ ...empty });
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);
  readonly statuses = Object.keys(developmentStatus) as DevelopmentStatus[];
  readonly statusLabel = developmentStatus;
  cover: File | null = null;
  private slugTouched = false;

  ngOnInit() { if (this.id()) void this.load(this.id()!); }

  private async load(id: string) {
    try {
      const d = await this.api.get<Development>(`/developments/${id}`);
      this.ctx.select(id); this.slugTouched = true;
      this.f.set({ name: d.name, slug: d.slug, code: d.code ?? '', city: d.city ?? '', state: d.state ?? '', zipCode: d.zipCode ?? '', deliveryDate: d.deliveryDate?.slice(0, 10) ?? '', address: d.address ?? '', description: d.description ?? '', status: d.status });
    } catch (error) { this.error.set(errorMessage(error)); }
  }

  set(key: keyof Form, event: Event) { this.f.update((f) => ({ ...f, [key]: val(event) })); if (key === 'slug') this.slugTouched = true; }
  setName(event: Event) { const name = val(event); this.f.update((f) => ({ ...f, name, slug: this.slugTouched ? f.slug : slugify(name) })); }
  file(event: Event) { return (event.target as HTMLInputElement).files?.[0] ?? null; }

  async save(event: Event) {
    event.preventDefault();
    this.busy.set(true); this.error.set(null); this.saved.set(false);
    const { status, ...f } = this.f();
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) if (v.trim()) body[k] = v.trim();
    try {
      const d = this.id()
        ? await this.api.patch<Development>(`/developments/${this.id()}`, { ...body, status })
        : await this.api.post<Development>('/developments', body);
      if (this.cover) {
        const form = new FormData(); form.append('file', this.cover); form.append('kind', 'FACADE'); form.append('label', 'Capa');
        await this.api.upload(`/developments/${d.id}/assets`, form); this.cover = null;
      }
      await this.ctx.refresh(); this.ctx.select(d.id);
      if (this.id()) this.saved.set(true); else await this.router.navigate(['/empreendimentos', d.id, 'torres']);
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
