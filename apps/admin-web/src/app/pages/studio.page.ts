import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ApiService, ModelVersion, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { bytes, dateTime, val } from '../core/labels';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content">
      <div class="head"><div><h1>Estúdio 3D</h1><p class="sub">Gerencie as versões do modelo tridimensional e a configuração do visualizador.</p></div></div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (message()) { <div class="notice ok">{{ message() }}</div> }
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
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  ngOnInit() { this.ctx.select(this.id()); void this.load(); }

  pick(event: Event) { this.file.set((event.target as HTMLInputElement).files?.[0] ?? null); }

  async load() {
    try { this.models.set(await this.api.get<ModelVersion[]>(`/developments/${this.id()}/models`)); }
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
