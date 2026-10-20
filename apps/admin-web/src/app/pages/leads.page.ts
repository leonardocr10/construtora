import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService, Lead, LeadStatus, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { dateTime, leadStatus, leadStatuses, val } from '../core/labels';

type Form = { developmentId: string; name: string; phone: string; email: string; message: string };

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head">
        <div><h1>Leads</h1><p class="sub">Visualize os interessados gerados pelas apresentações imobiliárias.</p></div>
        <div class="controls"><button class="btn blue" [disabled]="!ctx.developments().length" (click)="creating.set(!creating())">＋ Registrar lead</button></div>
      </div>
      <div class="grid g4" style="margin-bottom:18px">
        <div class="card shadow"><div class="pad"><span class="small">Leads totais</span><h1>{{ leads().length }}</h1></div></div>
        <div class="card shadow"><div class="pad"><span class="small">Novos no mês</span><h1>{{ thisMonth() }}</h1></div></div>
        <div class="card shadow"><div class="pad"><span class="small">Em atendimento</span><h1>{{ inProgress() }}</h1></div></div>
        <div class="card shadow"><div class="pad"><span class="small">Convertidos</span><h1>{{ count('WON') }}</h1></div></div>
      </div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (creating()) {
        <form class="card shadow" style="margin-bottom:18px" (submit)="create($event)"><div class="pad"><h3>Registrar lead</h3>
          <div class="grid g4">
            <div class="field"><label>Empreendimento</label><select class="input" required [value]="f().developmentId" (change)="set('developmentId', $event)">
              @for (d of ctx.developments(); track d.id) { <option [value]="d.id">{{ d.name }}</option> }
            </select></div>
            <div class="field"><label>Nome</label><input class="input" required maxlength="160" [value]="f().name" (input)="set('name', $event)"></div>
            <div class="field"><label>Telefone</label><input class="input" required maxlength="40" [value]="f().phone" (input)="set('phone', $event)"></div>
            <div class="field"><label>E-mail</label><input class="input" type="email" [value]="f().email" (input)="set('email', $event)"></div>
          </div>
          <div class="field"><label>Mensagem</label><textarea class="input" [value]="f().message" (input)="set('message', $event)"></textarea></div>
          <button class="btn blue" type="submit" [disabled]="busy()">Salvar lead</button>
        </div></form>
      }
      <div class="card shadow"><table class="table">
        <thead><tr><th>Cliente</th><th>Empreendimento</th><th>Interesse</th><th>Recebido</th><th>Status</th><th>Contato</th></tr></thead>
        <tbody>
          @for (l of leads(); track l.id) {
            <tr>
              <td><b>{{ l.name }}</b>@if (l.message) { <div class="small">{{ l.message }}</div> }</td>
              <td>{{ devName(l.developmentId) }}</td>
              <td>{{ l.unit ? 'Apartamento ' + l.unit.number : (l.source ?? '—') }}</td>
              <td>{{ dateTime(l.createdAt) }}</td>
              <td><select class="input tag {{ label[l.status].tag }}" style="width:auto;border:0" [value]="l.status" (change)="changeStatus(l, $any(v($event)))">
                @for (s of statuses; track s) { <option [value]="s">{{ label[s].label }}</option> }
              </select></td>
              <td class="small">{{ l.phone }}<br>{{ l.email ?? '' }}</td>
            </tr>
          } @empty { <tr><td colspan="6" class="small">{{ loaded() ? 'Nenhum lead recebido.' : 'Carregando…' }}</td></tr> }
        </tbody>
      </table></div>
    </div>`,
})
export class LeadsPage {
  private readonly api = inject(ApiService);
  readonly ctx = inject(DevelopmentContext);
  readonly v = val; readonly dateTime = dateTime; readonly label = leadStatus; readonly statuses = leadStatuses;
  readonly leads = signal<Lead[]>([]);
  readonly loaded = signal(false);
  readonly creating = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly f = signal<Form>({ developmentId: '', name: '', phone: '', email: '', message: '' });
  readonly thisMonth = computed(() => { const now = new Date(); return this.leads().filter((l) => { const d = new Date(l.createdAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length; });
  readonly inProgress = computed(() => this.leads().filter((l) => ['CONTACTED', 'QUALIFIED', 'NEGOTIATING'].includes(l.status)).length);

  constructor() { void this.load(); }

  count(status: LeadStatus) { return this.leads().filter((l) => l.status === status).length; }
  devName(id: string) { return this.ctx.developments().find((d) => d.id === id)?.name ?? '—'; }
  set(key: keyof Form, event: Event) { this.f.update((f) => ({ ...f, [key]: val(event) })); }

  async load() {
    try {
      const developments = await this.ctx.refresh();
      if (!this.f().developmentId) this.f.update((f) => ({ ...f, developmentId: this.ctx.selectedId() ?? developments[0]?.id ?? '' }));
      const lists = await Promise.all(developments.map((d) => this.api.get<Lead[]>(`/developments/${d.id}/leads`)));
      this.leads.set(lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      this.loaded.set(true);
    } catch (error) { this.error.set(errorMessage(error)); }
  }

  async changeStatus(lead: Lead, status: LeadStatus) {
    this.error.set(null);
    try { const updated = await this.api.patch<Lead>(`/leads/${lead.id}`, { status }); this.leads.update((list) => list.map((l) => (l.id === lead.id ? { ...l, status: updated.status } : l))); }
    catch (error) { this.error.set(errorMessage(error)); await this.load(); }
  }

  async create(event: Event) {
    event.preventDefault();
    this.busy.set(true); this.error.set(null);
    const { developmentId, ...f } = this.f();
    const body: Record<string, unknown> = { name: f.name.trim(), phone: f.phone.trim(), source: 'Painel administrativo' };
    if (f.email.trim()) body['email'] = f.email.trim();
    if (f.message.trim()) body['message'] = f.message.trim();
    try { await this.api.post(`/developments/${developmentId}/leads`, body); this.f.set({ developmentId, name: '', phone: '', email: '', message: '' }); this.creating.set(false); await this.load(); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
