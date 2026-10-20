import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import QRCode from 'qrcode';
import { ApiService, ModelVersion, SHARE_URL, VIEWER_URL, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { bytes, dateTime, val } from '../core/labels';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head"><div><h1>Estúdio 3D</h1><p class="sub">Gerencie as versões do modelo tridimensional e a configuração do visualizador.</p></div></div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (message()) { <div class="notice ok">{{ message() }}</div> }
      <div class="card shadow" style="margin-bottom:18px"><div class="pad" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:260px"><h3>Maquete 3D paramétrica</h3>
          <p class="small">Gerada automaticamente a partir da implantação, das torres (pavimentos, apartamentos por andar e posição) e do entorno real do OpenStreetMap. O espelho de vendas atualiza as cores em tempo real.</p>
          @if (dev(); as d) { @if (d.status !== 'PUBLISHED') { <p class="small"><b>O visualizador público só abre empreendimentos publicados.</b> Status atual: {{ d.status }}.</p> } }
        </div>
        @if (dev(); as d) { <a class="btn blue" [href]="viewerUrl + '/' + d.slug" target="_blank" rel="noopener">Abrir visualizador 3D</a> }
        <button class="btn soft" [disabled]="busy()" (click)="refreshSurroundings()">Atualizar entorno (OSM)</button>
      </div></div>
      @if (dev(); as d) {
        <div class="card shadow" style="margin-bottom:18px"><div class="pad" style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">
          <div style="flex:1;min-width:280px">
            <h3>Publicação por link</h3>
            @if (d.status === 'PUBLISHED') {
              <p class="small">Publicado. Página exclusiva do empreendimento, pronta para enviar pelo WhatsApp (com título, descrição e imagem de capa na prévia).</p>
              <div class="field"><label>Link para compartilhar</label><input class="input" readonly [value]="shareLink()" (focus)="select($event)"></div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn soft" (click)="copy()">{{ copied() ? 'Copiado ✓' : 'Copiar link' }}</button>
                <a class="btn blue" [href]="whatsapp()" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>
                <button class="btn soft" [disabled]="busy()" (click)="setPublished(false)">Despublicar</button>
              </div>
              <p class="small" style="margin-top:10px">A prévia do WhatsApp só aparece quando a API estiver num endereço público (https). Em ambiente local o link funciona apenas neste computador.</p>
            } @else {
              <p class="small">Ainda não publicado (situação: {{ d.status }}). Ao publicar, a página 3D fica acessível a qualquer pessoa com o link.</p>
              <button class="btn blue" [disabled]="busy()" (click)="setPublished(true)">Publicar empreendimento</button>
            }
          </div>
          @if (d.status === 'PUBLISHED' && qr()) { <div style="text-align:center"><img [src]="qr()" width="168" height="168" alt="QR code do link"><p class="small"><a [href]="qr()" [attr.download]="d.slug + '-qrcode.png'">Baixar QR code</a></p></div> }
        </div></div>
      }
      <div class="three">
        <div class="card shadow"><div class="pad"><h3>Versões do modelo</h3>
          @for (m of models(); track m.id) {
            <div class="listrow">
              <b>v{{ m.version }}</b> {{ m.label ?? m.asset.originalName }}
              @if (m.active) { <span class="tag blue right">Ativo</span> }
              <small>{{ bytes(m.asset.byteSize) }} · {{ dateTime(m.createdAt) }}</small>
              @if (!m.active) { <button class="btn soft" style="margin-top:8px" [disabled]="busy()" (click)="activate(m)">Ativar</button> }
            </div>
          } @empty { <p class="small">Nenhum modelo GLB enviado.</p> }
          <div class="divider"></div>
          <div class="field"><label>Descrição da versão</label><input class="input" maxlength="120" [value]="label()" (input)="label.set(v($event))"></div>
          <input class="input" type="file" accept=".glb,model/gltf-binary" (change)="pick($event)">
          <button class="btn soft" style="margin-top:10px" [disabled]="!file() || busy()" (click)="upload()">{{ busy() ? 'Enviando…' : 'Importar GLB' }}</button>
        </div></div>
        <div class="card shadow"><div style="background:#dfeaf4;padding:17px">
          <div class="toolbar"><b>Vista 3D · {{ camera() }}</b><span class="tag blue">{{ active() ? 'Versão ' + active()!.version : 'Sem modelo ativo' }}</span></div>
          <div class="mapframe" style="height:520px;display:grid;place-items:center;background:linear-gradient(160deg,#cfe3f3,#9ec4e6)">
            <div style="text-align:center;color:#16243d">
              <div style="font-size:72px">⬡</div>
              @if (active(); as m) { <b>{{ m.asset.originalName }}</b><p class="small">SHA-256 {{ m.asset.checksum.slice(0, 16) }}…</p> }
              @else { <b>Importe um arquivo GLB para habilitar o visualizador.</b> }
            </div>
          </div>
        </div></div>
        <div class="card shadow"><div class="pad"><h3>Propriedades do visualizador</h3>
          <div class="field"><label>Escala</label><input class="input" type="number" step="0.01" min="0.01" [value]="scale()" (input)="scale.set(+v($event))"></div>
          <div class="field"><label>Rotação Y (graus)</label><input class="input" type="number" step="1" [value]="rotationY()" (input)="rotationY.set(+v($event))"></div>
          <div class="field"><label>Intensidade da luz (%)</label><input class="input" type="number" min="0" max="200" [value]="light()" (input)="light.set(+v($event))"></div>
          <div class="field"><label>Câmera inicial</label><select class="input" [value]="camera()" (change)="camera.set(v($event))">
            @for (c of cameras; track c) { <option [value]="c">{{ c }}</option> }
          </select></div>
          <div class="field"><label>Rotação automática</label><select class="input" [value]="autoRotate() ? '1' : ''" (change)="autoRotate.set(!!v($event))"><option value="1">Ativada</option><option value="">Desativada</option></select></div>
          <div class="divider"></div>
          <p class="small">A configuração é gravada no visualizador público do empreendimento.</p>
          <button class="btn blue" [disabled]="busy()" (click)="saveViewer()">Salvar configuração</button>
        </div></div>
      </div>
    </div>`,
})
export class StudioPage {
  private readonly api = inject(ApiService);
  private readonly ctx = inject(DevelopmentContext);
  readonly id = input.required<string>();
  readonly v = val; readonly bytes = bytes; readonly dateTime = dateTime;
  readonly cameras = ['Perspectiva aérea', 'Frontal', 'Lateral', 'Superior'];
  readonly models = signal<ModelVersion[]>([]);
  readonly active = computed(() => this.models().find((m) => m.active) ?? null);
  readonly file = signal<File | null>(null);
  readonly label = signal('');
  readonly scale = signal(1); readonly rotationY = signal(0); readonly light = signal(80);
  readonly camera = signal('Perspectiva aérea'); readonly autoRotate = signal(false);
  readonly busy = signal(false);
  readonly viewerUrl = VIEWER_URL;
  readonly dev = signal<{ slug: string; status: string; name: string } | null>(null);
  readonly shareLink = computed(() => this.dev() ? `${SHARE_URL}/${this.dev()!.slug}` : '');
  readonly whatsapp = computed(() => `https://wa.me/?text=${encodeURIComponent(`${this.dev()?.name ?? ''} em 3D: escolha sua unidade ${this.shareLink()}`)}`);
  readonly qr = signal<string | null>(null);
  readonly copied = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  ngOnInit() { this.ctx.select(this.id()); void this.load(); }

  pick(event: Event) { this.file.set((event.target as HTMLInputElement).files?.[0] ?? null); }

  async load() {
    try {
      this.models.set(await this.api.get<ModelVersion[]>(`/developments/${this.id()}/models`));
      this.dev.set(await this.api.get<{ slug: string; status: string; name: string }>(`/developments/${this.id()}`));
      this.qr.set(this.dev()!.status === 'PUBLISHED' ? await QRCode.toDataURL(this.shareLink(), { width: 336, margin: 1 }) : null);
    }
    catch (error) { this.error.set(errorMessage(error)); }
  }

  private async run(task: () => Promise<string>) {
    this.busy.set(true); this.error.set(null); this.message.set(null);
    try { this.message.set(await task()); await this.load(); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }

  upload() {
    const file = this.file(); if (!file) return;
    void this.run(async () => {
      const form = new FormData(); form.append('file', file); form.append('kind', 'MODEL_3D');
      if (this.label().trim()) form.append('label', this.label().trim());
      await this.api.upload(`/developments/${this.id()}/assets`, form);
      this.file.set(null); this.label.set('');
      return 'Modelo importado.';
    });
  }

  setPublished(publish: boolean) {
    void this.run(async () => { await this.api.post(`/developments/${this.id()}/${publish ? 'publish' : 'unpublish'}`, {}); await this.ctx.refresh(); return publish ? 'Empreendimento publicado.' : 'Empreendimento despublicado.'; });
  }

  select(event: Event) { (event.target as HTMLInputElement).select(); }
  async copy() { await navigator.clipboard.writeText(this.shareLink()); this.copied.set(true); setTimeout(() => this.copied.set(false), 2000); }

  refreshSurroundings() {
    void this.run(async () => {
      const r = await this.api.post<{ roads: number; buildings: number; green: number }>(`/developments/${this.id()}/surroundings/refresh`, {});
      return `Entorno atualizado: ${r.roads} vias, ${r.buildings} edificações e ${r.green} áreas verdes.`;
    });
  }

  activate(m: ModelVersion) {
    void this.run(async () => { await this.api.put(`/developments/${this.id()}/viewer/active-model`, { modelVersionId: m.id }); return `Versão ${m.version} ativada.`; });
  }

  saveViewer() {
    void this.run(async () => {
      await this.api.patch(`/developments/${this.id()}/viewer`, {
        camera: { preset: this.camera(), scale: this.scale(), rotationY: this.rotationY() },
        lighting: { intensity: this.light() / 100 },
        interaction: { autoRotate: this.autoRotate() },
      });
      return 'Configuração do visualizador salva.';
    });
  }
}
