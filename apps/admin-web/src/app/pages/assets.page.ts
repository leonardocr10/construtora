import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ApiService, Asset, AssetKind, Building, FloorPlan, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { assetKind, assetKinds, bytes, date, val } from '../core/labels';

type Tab = 'ALL' | 'IMAGE' | 'PDF' | 'MODEL';
const icon = (a: Asset) => a.mimeType === 'application/pdf' ? 'PDF' : a.mimeType === 'model/gltf-binary' ? '⬡' : '▧';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head"><div><h1>Biblioteca de arquivos</h1><p class="sub">Organize imagens, documentos e modelos 3D de {{ ctx.selected()?.name ?? 'empreendimento' }}.</p></div></div>
      <div class="toolbar">
        <div class="switches">@for (t of tabs; track t.key) { <button class="tab" [class.active]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button> }</div>
        <button class="btn blue" (click)="showUpload.set(!showUpload())">＋ Adicionar arquivos</button>
      </div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (showUpload()) {
        <form class="card shadow" style="margin-bottom:18px" (submit)="upload($event)"><div class="pad">
          <div class="drop" style="margin-bottom:16px"><b>Selecione um PDF, imagem (PNG/JPEG/WEBP) ou modelo GLB</b><p class="small">Até 200 MB. O tipo do conteúdo é validado pelo servidor.</p>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.glb" (change)="pickFile($event)"></div>
          <div class="grid g4">
            <div class="field"><label>Categoria</label><select class="input" [value]="kind()" (change)="kind.set($any(v($event)))">@for (k of kinds; track k) { <option [value]="k">{{ kindLabel[k] }}</option> }</select></div>
            <div class="field"><label>Descrição</label><input class="input" maxlength="120" [value]="label()" (input)="label.set(v($event))"></div>
            <div class="field"><label>Torre (opcional)</label><select class="input" (change)="buildingId.set(v($event))"><option value="">—</option>@for (b of buildings(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }</select></div>
            <div class="field"><label>Planta (opcional)</label><select class="input" (change)="floorPlanId.set(v($event))"><option value="">—</option>@for (p of plans(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }</select></div>
          </div>
          <button class="btn blue" type="submit" [disabled]="!file() || busy()">{{ busy() ? 'Enviando…' : 'Enviar arquivo' }}</button>
        </div></form>
      }
      @if (loaded() && !visible().length) { <div class="notice"><b>Nenhum arquivo nesta categoria.</b><span>Use “Adicionar arquivos” para enviar o primeiro.</span></div> }
      <div class="grid g3">
        @for (a of visible(); track a.id) {
          <div class="card shadow"><div class="thumb ph">{{ icon(a) }}</div><div class="pad">
            <b>{{ a.originalName }}</b>
            <p class="small">{{ kindLabel[a.kind] }} · {{ bytes(a.byteSize) }} · Enviado em {{ date(a.createdAt) }}</p>
            <div class="controls">
              @if (a.buildingId) { <span class="tag blue">{{ buildingName(a.buildingId) }}</span> }
              @if (a.floorPlanId) { <span class="tag blue">{{ planName(a.floorPlanId) }}</span> }
            </div>
          </div></div>
        }
      </div>
    </div>`,
})
export class AssetsPage {
  private readonly api = inject(ApiService);
  readonly ctx = inject(DevelopmentContext);
  readonly id = input.required<string>();
  readonly v = val; readonly bytes = bytes; readonly date = date; readonly icon = icon;
  readonly kinds = assetKinds; readonly kindLabel = assetKind;
  readonly tabs: { key: Tab; label: string }[] = [{ key: 'ALL', label: 'Todos' }, { key: 'IMAGE', label: 'Imagens' }, { key: 'PDF', label: 'PDFs' }, { key: 'MODEL', label: 'Modelos 3D' }];
  readonly tab = signal<Tab>('ALL');
  readonly assets = signal<Asset[]>([]);
  readonly buildings = signal<Building[]>([]);
  readonly plans = signal<FloorPlan[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly showUpload = signal(false);
  readonly busy = signal(false);
  readonly file = signal<File | null>(null);
  readonly kind = signal<AssetKind>('FACADE');
  readonly label = signal('');
  readonly buildingId = signal('');
  readonly floorPlanId = signal('');
  readonly visible = computed(() => this.assets().filter((a) => {
    switch (this.tab()) {
      case 'IMAGE': return a.mimeType.startsWith('image/');
      case 'PDF': return a.mimeType === 'application/pdf';
      case 'MODEL': return a.mimeType === 'model/gltf-binary';
      default: return true;
    }
  }));

  ngOnInit() { this.ctx.select(this.id()); void this.load(); }

  async load() {
    try {
      const [assets, buildings, plans] = await Promise.all([
        this.api.get<Asset[]>(`/developments/${this.id()}/assets`), this.api.get<Building[]>(`/developments/${this.id()}/buildings`), this.api.get<FloorPlan[]>(`/developments/${this.id()}/floor-plans`),
      ]);
      this.assets.set(assets); this.buildings.set(buildings); this.plans.set(plans); this.loaded.set(true);
    } catch (error) { this.error.set(errorMessage(error)); }
  }

  pickFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null; this.file.set(file);
    if (file?.name.toLowerCase().endsWith('.glb')) this.kind.set('MODEL_3D');
    else if (file?.name.toLowerCase().endsWith('.pdf') && this.kind() === 'FACADE') this.kind.set('EBOOK');
  }

  async upload(event: Event) {
    event.preventDefault();
    const file = this.file(); if (!file) return;
    this.busy.set(true); this.error.set(null);
    const form = new FormData();
    form.append('file', file); form.append('kind', this.kind());
    if (this.label().trim()) form.append('label', this.label().trim());
    if (this.buildingId()) form.append('buildingId', this.buildingId());
    if (this.floorPlanId()) form.append('floorPlanId', this.floorPlanId());
    try { await this.api.upload(`/developments/${this.id()}/assets`, form); this.file.set(null); this.label.set(''); this.showUpload.set(false); await this.load(); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }

  buildingName(id: string) { return this.buildings().find((b) => b.id === id)?.name ?? 'Torre'; }
  planName(id: string) { return this.plans().find((p) => p.id === id)?.name ?? 'Planta'; }
}
