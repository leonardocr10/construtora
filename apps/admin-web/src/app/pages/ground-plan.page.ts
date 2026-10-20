import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, inject, input, signal, viewChild } from '@angular/core';
import { API_URL, ApiService, VIEWER_URL, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { closeMask, dominantAngle, maskToLoop, pointInPolygon, polygonArea, segmentDistance, simplifyLoop, snapToVertices, straighten, type Point } from '../core/polygon-tools';
import type { Prompt, Segmenter } from '../core/segmenter';

type Kind = 'asphalt' | 'grass' | 'paving' | 'art';
type Tool = 'ai' | 'polygon' | 'edit' | 'pan';
interface Shape { kind: Kind; points: Point[] }
interface Layout { siteImageAssetId?: string; imageWidth: number; imageHeight: number; metersPerPixel: number; lot?: Point[]; groundPlan?: { polygons: Shape[]; updatedAt?: string } }
interface EditorData { development: { id: string; name: string; slug: string }; layout: Layout | null }

const kinds: { id: Kind; label: string; color: string; hint: string }[] = [
  { id: 'asphalt', label: 'Asfalto', color: '#4a4f58', hint: 'Rua e estacionamento (o lote já começa em asfalto)' },
  { id: 'grass', label: 'Grama', color: '#3fae4a', hint: 'Gramado e canteiro, elevado com meio-fio' },
  { id: 'paving', label: 'Piso', color: '#e9a23b', hint: 'Calçada, deque e praça, elevados' },
  { id: 'art', label: 'Arte', color: '#c04bd8', hint: 'Mostra a imagem original (quadra, piscina…)' },
];
const colorOf = Object.fromEntries(kinds.map((k) => [k.id, k.color])) as Record<Kind, string>;
const labelOf = Object.fromEntries(kinds.map((k) => [k.id, k.label])) as Record<Kind, string>;

/**
 * Chão do lote em polígonos: o visualizador deixa de deduzir asfalto, grama e piso pela cor da arte (que sempre
 * erra numa ilustração de marketing) e monta o chão direto destes polígonos, com bordas retas e cantos vivos.
 * A IA (Segment Anything no navegador) contorna a área clicada, e o contorno é endireitado na direção do lote;
 * depois os vértices podem ser ajustados à mão. O lote começa todo em asfalto e o último polígono vence.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  styles: [`
    .gp{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:14px;height:calc(100vh - 210px);min-height:560px}
    .pane{position:relative;border:1px solid var(--stroke);border-radius:11px;overflow:hidden;background:#e9eef5}
    .art{width:100%;height:100%;touch-action:none;display:block;cursor:crosshair}
    .art.pan{cursor:grab}.art.edit{cursor:default}
    .hint{position:absolute;left:10px;bottom:10px;right:10px;background:#16243de6;color:#fff;padding:6px 10px;border-radius:8px;font-size:12px;pointer-events:none;width:fit-content}
    .status{position:absolute;left:10px;top:10px;background:#fff;border:1px solid var(--stroke);padding:6px 10px;border-radius:8px;font-size:12px;box-shadow:0 2px 8px #0002}
    .side{overflow:auto}
    .seg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:6px 0 12px}
    .seg button,.kinds button{border:1px solid var(--stroke);background:#fff;border-radius:8px;padding:8px 6px;font-size:12px;cursor:pointer}
    .seg button.on,.kinds button.on{border-color:var(--blue);box-shadow:0 0 0 2px #2478f433;font-weight:700}
    .kinds{display:grid;gap:6px;margin:6px 0 12px}
    .kinds button{display:flex;gap:9px;align-items:center;text-align:left}
    .sw{width:16px;height:16px;border-radius:4px;flex:none;border:1px solid #0002}
    .kinds small{display:block;color:var(--muted,#6b7385);font-weight:400}
    .row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
    .list{display:grid;gap:4px;margin-top:6px}
    .item{display:flex;gap:6px;align-items:center;border:1px solid var(--stroke);border-radius:8px;padding:5px 7px;font-size:12px;cursor:pointer;background:#fff}
    .item.sel{border-color:var(--blue);box-shadow:0 0 0 2px #2478f433}
    .item span.grow{flex:1}
    .item button{border:none;background:none;cursor:pointer;padding:2px 4px;font-size:12px}
    .check{display:flex;gap:6px;align-items:center;font-size:12px;margin:6px 0}
    @media(max-width:1000px){.gp{grid-template-columns:1fr;height:auto}.pane{height:70vh}}
  `],
  template: `
    <div class="content">
      <div class="head">
        <div><h1>Chão do lote</h1><p class="sub">Desenhe o chão em polígonos sobre a arte: a IA contorna a área que você clicar, com bordas retas. Com o chão desenhado, o visualizador para de adivinhar pela cor.</p></div>
        <div class="controls">
          @if (data(); as d) { <a class="btn soft" [href]="viewerUrl + '/' + d.development.slug" target="_blank" rel="noopener">Abrir visualizador</a> }
          <button class="btn blue" [disabled]="busy() || !dirty()" (click)="save()">Salvar chão</button>
        </div>
      </div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (message()) { <div class="notice ok">{{ message() }}</div> }
      <div class="gp">
        <div class="pane">
          @if (imageUrl(); as url) {
            <svg #svg class="art" [class.pan]="panning()" [class.edit]="tool() === 'edit' && !panning()" [attr.viewBox]="viewBox()" (wheel)="zoom($event)" (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up()" (pointerleave)="cursor.set(null)" (dblclick)="dbl($event)" (contextmenu)="$event.preventDefault()">
              <image [attr.href]="url" x="0" y="0" [attr.width]="layout()?.imageWidth" [attr.height]="layout()?.imageHeight" />
              <g [attr.opacity]="opacity()">
                @if (layout()?.lot?.length) { <polygon [attr.points]="pts(layout()!.lot!)" [attr.fill]="color('asphalt')" opacity="0.35" /> }
                @for (s of shapes(); track $index) { <polygon [attr.points]="pts(s.points)" [attr.fill]="color(s.kind)" /> }
              </g>
              @for (s of shapes(); track $index; let i = $index) { <polygon [attr.points]="pts(s.points)" fill="none" [attr.stroke]="selected() === i ? '#2478f4' : '#ffffffaa'" [attr.stroke-width]="px(selected() === i ? 2.5 : 1)" style="pointer-events:none" /> }
              @if (layout()?.lot?.length) { <polygon [attr.points]="pts(layout()!.lot!)" fill="none" stroke="#2478f4" [attr.stroke-width]="px(2)" [attr.stroke-dasharray]="px(8) + ' ' + px(5)" style="pointer-events:none" /> }
              @if (selectedShape(); as s) {
                @for (p of s.points; track $index; let v = $index) { <rect [attr.x]="p[0] - px(5)" [attr.y]="p[1] - px(5)" [attr.width]="px(10)" [attr.height]="px(10)" [attr.fill]="vertex() === v ? '#2478f4' : '#fff'" stroke="#2478f4" [attr.stroke-width]="px(1.5)" style="pointer-events:none" /> }
              }
              @if (pending(); as pd) {
                @if (pd.loop) { <polygon [attr.points]="pts(pd.loop)" [attr.fill]="color(kind())" fill-opacity="0.45" [attr.stroke]="color(kind())" [attr.stroke-width]="px(2.5)" [attr.stroke-dasharray]="px(6) + ' ' + px(4)" style="pointer-events:none" /> }
                @for (p of pd.prompts; track $index) { <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="px(6)" [attr.fill]="p.positive ? '#16a34a' : '#dc2626'" stroke="#fff" [attr.stroke-width]="px(2)" style="pointer-events:none" /> }
              }
              @if (draft().length) {
                <polyline [attr.points]="pts(cursor() ? draft().concat([cursor()!]) : draft())" [attr.fill]="color(kind())" fill-opacity="0.35" [attr.stroke]="color(kind())" [attr.stroke-width]="px(2)" style="pointer-events:none" />
                @for (p of draft(); track $index) { <circle [attr.cx]="p[0]" [attr.cy]="p[1]" [attr.r]="px($first ? 6 : 4)" fill="#fff" [attr.stroke]="color(kind())" [attr.stroke-width]="px(2)" style="pointer-events:none" /> }
              }
            </svg>
            @if (aiStatus()) { <div class="status">{{ aiStatus() }}</div> }
            <div class="hint">{{ hint() }}</div>
          } @else { <div class="small" style="padding:60px 20px;text-align:center">{{ loading() ? 'Carregando a arte…' : 'Envie a imagem da implantação, calibre e desenhe o contorno do terreno no editor de implantação.' }}</div> }
        </div>
        <div class="side">
          <div class="card shadow"><div class="pad">
            <h3>Ferramenta</h3>
            <div class="seg">
              <button [class.on]="tool() === 'ai'" (click)="setTool('ai')" title="A">IA</button>
              <button [class.on]="tool() === 'polygon'" (click)="setTool('polygon')" title="P">Polígono</button>
              <button [class.on]="tool() === 'edit'" (click)="setTool('edit')" title="E">Editar</button>
              <button [class.on]="tool() === 'pan'" (click)="setTool('pan')" title="Espaço">Mover</button>
            </div>
            <h3>{{ tool() === 'edit' && selected() != null ? 'Classe do polígono' : 'Desenhar como' }}</h3>
            <div class="kinds">
              @for (k of kinds; track k.id; let i = $index) {
                <button [class.on]="(selectedShape()?.kind ?? kind()) === k.id" (click)="pickKind(k.id)" [title]="'Tecla ' + (i + 1)"><span class="sw" [style.background]="k.color"></span><span>{{ k.label }}<small>{{ k.hint }}</small></span></button>
              }
            </div>
            @if (tool() === 'ai') {
              <label class="check"><input type="checkbox" [checked]="straight()" (change)="straight.set($any($event.target).checked); traceChoice()"> Endireitar (retas e cantos em esquadro)</label>
              <div class="field"><label>Ignorar detalhes menores que {{ detail() | number: '1.1-1' }} m</label>
                <input type="range" min="0.2" max="4" step="0.1" [value]="detail()" (change)="detail.set(+$any($event.target).value); traceChoice()" style="width:100%"></div>
              @if (pending() && candidates().length > 1) {
                <div class="row"><button class="btn" [disabled]="choice() === 0" (click)="stepChoice(-1)" title="[">− Área menor</button><button class="btn" [disabled]="choice() === candidates().length - 1" (click)="stepChoice(1)" title="]">Área maior +</button></div>
              }
              @if (pending()?.loop) { <div class="row"><button class="btn blue" (click)="acceptPending()">Adicionar (Enter)</button><button class="btn" (click)="pending.set(null)">Cancelar (Esc)</button></div> }
            }
            <div class="field"><label>Opacidade dos polígonos: {{ opacity() * 100 | number: '1.0-0' }}%</label>
              <input type="range" min="0" max="1" step="0.05" [value]="opacity()" (input)="opacity.set(+$any($event.target).value)" style="width:100%"></div>
            <div class="row">
              <button class="btn" [disabled]="!history.length" (click)="undo()" title="Ctrl+Z">Desfazer</button>
              <button class="btn" [disabled]="!future.length" (click)="redo()" title="Ctrl+Shift+Z">Refazer</button>
              <button class="btn" [disabled]="!shapes().length" (click)="clear()">Apagar tudo</button>
            </div>
            <p class="small">{{ shapes().length }} polígono(s){{ dirty() ? ' · não salvo' : '' }}@if (updatedAt(); as u) { · salvo em {{ u }} }</p>
            <details class="small"><summary>Atalhos</summary>
              <p>IA: clique dentro da área (pontos verdes); botão direito ou Alt+clique marca o que NÃO faz parte (vermelho). Enter adiciona.</p>
              <p>Polígono: clique os vértices e feche no primeiro, com duplo clique ou Enter.</p>
              <p>Editar: clique um polígono, arraste os quadrados; duplo clique na borda cria vértice; Delete apaga o vértice marcado (ou o polígono).</p>
              <p>Roda: zoom. Espaço, botão do meio ou botão direito + arrastar: mover a vista. 1–4 trocam a classe.</p>
            </details>
          </div></div>
          <h3 style="margin:14px 0 6px">Polígonos (o de baixo vence)</h3>
          <div class="list">
            @for (s of shapes(); track $index; let i = $index) {
              <div class="item" [class.sel]="selected() === i" (click)="select(i)">
                <span class="sw" [style.background]="color(s.kind)"></span><span class="grow">{{ i + 1 }}. {{ label(s.kind) }} · {{ areaOf(s) | number: '1.0-0' }} m²</span>
                <button title="Subir (vence menos)" [disabled]="i === 0" (click)="reorder(i, -1); $event.stopPropagation()">↑</button>
                <button title="Descer (vence mais)" [disabled]="i === shapes().length - 1" (click)="reorder(i, 1); $event.stopPropagation()">↓</button>
                <button title="Apagar" (click)="remove(i); $event.stopPropagation()">✕</button>
              </div>
            } @empty { <p class="small">Nenhum polígono: o visualizador usa a dedução automática pela cor da arte.</p> }
          </div>
        </div>
      </div>
    </div>`,
})
export class GroundPlanPage implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly ctx = inject(DevelopmentContext);
  readonly id = input.required<string>();
  readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');
  readonly kinds = kinds; readonly viewerUrl = VIEWER_URL;

  readonly data = signal<EditorData | null>(null);
  readonly layout = signal<Layout | null>(null);
  readonly imageUrl = signal<string | null>(null);
  readonly loading = signal(true);
  readonly view = signal<[number, number, number, number]>([0, 0, 1000, 1000]);
  readonly tool = signal<Tool>('ai');
  readonly kind = signal<Kind>('grass');
  readonly opacity = signal(0.55);
  readonly straight = signal(true);
  /** Detalhe ignorado no contorno da IA (metros): recortes de carro e vaga menores que isso somem. */
  readonly detail = signal(1.2);
  readonly shapes = signal<Shape[]>([]);
  readonly selected = signal<number | null>(null);
  readonly vertex = signal<number | null>(null);
  readonly draft = signal<Point[]>([]);
  readonly pending = signal<{ prompts: Prompt[]; loop: Point[] | null } | null>(null);
  /** Candidatas do SAM para os cliques atuais (da menor para a maior) e a escolhida. */
  readonly candidates = signal<{ mask: Uint8Array; score: number; area: number }[]>([]);
  readonly choice = signal(0);
  readonly aiStatus = signal<string | null>(null);
  readonly cursor = signal<Point | null>(null);
  readonly space = signal(false);
  readonly panning = computed(() => this.tool() === 'pan' || this.space());
  readonly dirty = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly updatedAt = signal<string | null>(null);
  readonly viewBox = computed(() => this.view().join(' '));
  readonly selectedShape = computed(() => { const i = this.selected(); return i == null ? null : this.shapes()[i] ?? null; });
  readonly hint = computed(() => {
    if (this.panning()) return 'Arraste para mover a vista';
    switch (this.tool()) {
      case 'ai': return this.pending()?.loop ? 'Clique mais pontos para ajustar (botão direito exclui); Enter adiciona' : `Clique dentro de uma área para a IA contornar como ${labelOf[this.kind()].toLowerCase()}`;
      case 'polygon': return this.draft().length ? `${this.draft().length} vértice(s): feche no primeiro, com duplo clique ou Enter` : 'Clique para começar o polígono';
      default: return this.selected() == null ? 'Clique num polígono para editar' : 'Arraste os vértices; duplo clique na borda cria vértice; Delete apaga';
    }
  });

  /** Desfazer: cada entrada é a lista inteira de polígonos antes da mudança. */
  history: Shape[][] = []; future: Shape[][] = [];
  private pan: { x: number; y: number; view: [number, number, number, number] } | null = null;
  private drag: { index: number; vertex: number; before: Shape[]; moved: boolean } | null = null;
  private segmenter: Segmenter | null = null;
  private crop: { x: number; y: number; data: ImageData } | null = null;
  private analysed: Promise<void> | null = null;
  private image: HTMLImageElement | null = null;

  color(kind: Kind) { return colorOf[kind] ?? '#000'; }
  label(kind: Kind) { return labelOf[kind] ?? kind; }
  pts(points: Point[]) { return points.map((p) => p.join(',')).join(' '); }
  px(n: number) { return (n * this.view()[2]) / 900; }
  areaOf(s: Shape) { const m = this.layout()?.metersPerPixel ?? 0; return polygonArea(s.points) * m * m; }
  private meters(m: number) { return m / (this.layout()?.metersPerPixel || 0.1); }

  async ngOnInit() {
    this.ctx.select(this.id());
    try {
      const data = await this.api.get<EditorData>(`/developments/${this.id()}/implantation`);
      this.data.set(data); this.layout.set(data.layout);
      const layout = data.layout;
      this.shapes.set(layout?.groundPlan?.polygons ?? []);
      this.updatedAt.set(this.when(layout?.groundPlan?.updatedAt));
      if (layout?.siteImageAssetId && layout.lot?.length) {
        const blob = await this.api.blob(`/developments/${this.id()}/assets/${layout.siteImageAssetId}/file`);
        const url = URL.createObjectURL(blob); this.imageUrl.set(url);
        this.image = new Image(); this.image.src = url;
        const xs = layout.lot.map((p) => p[0]), ys = layout.lot.map((p) => p[1]);
        const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0, m = Math.max(w, h) * 0.05;
        this.view.set([x0 - m, y0 - m, w + 2 * m, h + 2 * m]);
        void this.analyse();
      }
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.loading.set(false); }
  }

  ngOnDestroy() { const url = this.imageUrl(); if (url) URL.revokeObjectURL(url); }

  private when(iso?: string) { return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null; }

  // ——— IA: análise da arte (uma vez) e contorno por clique ———
  private analyse() {
    if (this.analysed) return this.analysed;
    const layout = this.layout(); if (!layout?.lot?.length || !this.image) return Promise.resolve();
    this.analysed = (async () => {
      try {
        this.aiStatus.set('Carregando a IA (≈ 15 MB na primeira vez)…');
        const { Segmenter } = await import('../core/segmenter');
        this.segmenter = new Segmenter(); await this.segmenter.load();
        this.aiStatus.set('IA analisando a arte do lote…');
        if (!this.image!.complete) await this.image!.decode();
        // Recorte do lote (com margem): a IA trabalha em até 1024 px, então o recorte mantém o detalhe.
        const xs = layout.lot!.map((p) => p[0]), ys = layout.lot!.map((p) => p[1]); const pad = 16;
        const x = Math.max(0, Math.floor(Math.min(...xs)) - pad), y = Math.max(0, Math.floor(Math.min(...ys)) - pad);
        const w = Math.min(layout.imageWidth, Math.ceil(Math.max(...xs)) + pad) - x, h = Math.min(layout.imageHeight, Math.ceil(Math.max(...ys)) + pad) - y;
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        const c2d = canvas.getContext('2d', { willReadFrequently: true })!; c2d.drawImage(this.image!, -x, -y);
        this.crop = { x, y, data: c2d.getImageData(0, 0, w, h) };
        await this.segmenter.setImage(this.crop.data);
        this.aiStatus.set(null);
      } catch (error) {
        console.error(error); this.analysed = null;
        this.aiStatus.set(null); this.error.set(`Não foi possível carregar a IA: ${errorMessage(error)}. Use a ferramenta Polígono.`);
      }
    })();
    return this.analysed;
  }

  private aiRun = 0;
  async refreshPending() {
    const pending = this.pending(); if (!pending?.prompts.length) return;
    await this.analyse(); const crop = this.crop; if (!this.segmenter || !crop) return;
    const run = ++this.aiRun;
    const candidates = await this.segmenter.segment(pending.prompts.map((p) => ({ ...p, x: p.x - crop.x, y: p.y - crop.y })));
    if (run !== this.aiRun) return;
    this.candidates.set(candidates);
    // A maior área com nota razoável: no chão o clique costuma cair num carro, que o SAM prefere.
    let pick = candidates.length - 1; while (pick > 0 && candidates[pick].score < 0.55) pick--;
    this.choice.set(Math.max(0, pick));
    this.traceChoice();
  }

  /** Alterna entre as áreas candidatas (−1 menor, +1 maior). */
  stepChoice(delta: number) {
    const next = this.choice() + delta; if (next < 0 || next >= this.candidates().length) return;
    this.choice.set(next); this.traceChoice();
  }

  /** Contorno da candidata escolhida: fecha recortes, simplifica, endireita e encosta nos vértices vizinhos. */
  traceChoice() {
    const pending = this.pending(); const crop = this.crop; const candidate = this.candidates()[this.choice()];
    if (!pending || !crop || !candidate) { if (pending) this.pending.set({ ...pending, loop: null }); return; }
    const { width: w, height: h } = crop.data;
    const seed = pending.prompts.find((p) => p.positive);
    const closed = closeMask(candidate.mask, w, h, Math.round(this.meters(this.detail())));
    let loop = maskToLoop(closed, w, h, seed ? [seed.x - crop.x, seed.y - crop.y] : undefined);
    if (!loop) { this.pending.set({ ...pending, loop: null }); return; }
    loop = loop.map(([x, y]) => [x + crop.x, y + crop.y] as Point);
    loop = simplifyLoop(loop, Math.max(2, this.meters(Math.max(0.3, this.detail() * 0.4))));
    if (this.straight()) loop = straighten(loop, dominantAngle([this.layout()!.lot!]), (14 * Math.PI) / 180, this.meters(Math.max(0.6, this.detail())));
    const others = [...(this.layout()?.lot ?? []), ...this.shapes().flatMap((s) => s.points)];
    loop = snapToVertices(loop, others, this.meters(0.4)).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Point);
    this.pending.set({ prompts: pending.prompts, loop });
  }

  acceptPending() {
    const loop = this.pending()?.loop; if (!loop || loop.length < 3) return;
    this.commit([...this.shapes(), { kind: this.kind(), points: loop }]);
    this.pending.set(null);
  }

  // ——— Edição ———
  setTool(tool: Tool) { this.tool.set(tool); this.draft.set([]); this.pending.set(null); if (tool !== 'edit') { this.selected.set(null); this.vertex.set(null); } if (tool === 'ai') void this.analyse(); }
  select(i: number) { this.tool.set('edit'); this.draft.set([]); this.pending.set(null); this.selected.set(i); this.vertex.set(null); }
  pickKind(kind: Kind) {
    this.kind.set(kind);
    const i = this.selected();
    if (this.tool() === 'edit' && i != null && this.shapes()[i]?.kind !== kind) this.commit(this.shapes().map((s, k) => (k === i ? { ...s, kind } : s)));
  }
  remove(i: number) { this.commit(this.shapes().filter((_, k) => k !== i)); this.selected.set(null); this.vertex.set(null); }
  reorder(i: number, delta: number) {
    const list = [...this.shapes()]; const j = i + delta; if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]]; this.commit(list);
    if (this.selected() === i) this.selected.set(j);
  }
  clear() { if (confirm('Apagar todos os polígonos? (dá para desfazer antes de salvar)')) { this.commit([]); this.selected.set(null); } }

  private commit(next: Shape[], before = this.shapes()) {
    this.history.push(before); if (this.history.length > 200) this.history.shift();
    this.future = []; this.shapes.set(next); this.dirty.set(true); this.message.set(null);
  }
  undo() {
    if (this.draft().length) { this.draft.update((p) => p.slice(0, -1)); return; }
    if (this.pending()) { this.pending.set(null); return; }
    const previous = this.history.pop(); if (!previous) return;
    this.future.push(this.shapes()); this.shapes.set(previous); this.dirty.set(true); this.fixSelection();
  }
  redo() {
    const next = this.future.pop(); if (!next) return;
    this.history.push(this.shapes()); this.shapes.set(next); this.dirty.set(true); this.fixSelection();
  }
  private fixSelection() { const i = this.selected(); if (i != null && i >= this.shapes().length) { this.selected.set(null); this.vertex.set(null); } }

  // ——— Vista e ponteiro ———
  private toImage(event: { clientX: number; clientY: number }): Point {
    const svg = this.svg()!.nativeElement; const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const p = point.matrixTransform(svg.getScreenCTM()!.inverse()); return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  }
  zoom(event: WheelEvent) {
    event.preventDefault();
    const [x, y] = this.toImage(event); const [vx, vy, vw, vh] = this.view(); const k = event.deltaY > 0 ? 1.18 : 1 / 1.18;
    this.view.set([x - (x - vx) * k, y - (y - vy) * k, vw * k, vh * k]);
  }
  private startPan(event: PointerEvent) { this.pan = { x: event.clientX, y: event.clientY, view: this.view() }; }
  down(event: PointerEvent) {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const p = this.toImage(event); const tool = this.tool();
    const negative = event.button === 2 || event.altKey;
    if (tool === 'ai' && (event.button === 0 || event.button === 2) && !this.space()) {
      const pending = this.pending() ?? { prompts: [], loop: null };
      if (negative && !pending.prompts.length) { this.startPan(event); return; }
      this.pending.set({ ...pending, prompts: [...pending.prompts, { x: p[0], y: p[1], positive: !negative }] });
      void this.refreshPending(); return;
    }
    if (this.panning() || event.button !== 0) { this.startPan(event); return; }
    if (tool === 'polygon') {
      const draft = this.draft();
      if (draft.length >= 3 && Math.hypot(p[0] - draft[0][0], p[1] - draft[0][1]) < this.px(10)) { this.closeDraft(); return; }
      this.draft.set([...draft, p]); return;
    }
    // Editar: vértice do selecionado, senão o polígono de cima sob o clique, senão mover a vista.
    const sel = this.selectedShape();
    if (sel) {
      const v = sel.points.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < this.px(8));
      if (v >= 0) { this.vertex.set(v); this.drag = { index: this.selected()!, vertex: v, before: this.shapes(), moved: false }; return; }
    }
    const shapes = this.shapes();
    for (let i = shapes.length - 1; i >= 0; i--) if (pointInPolygon(p, shapes[i].points)) { this.selected.set(i); this.vertex.set(null); this.kind.set(shapes[i].kind); return; }
    this.selected.set(null); this.vertex.set(null); this.startPan(event);
  }
  move(event: PointerEvent) {
    const p = this.toImage(event); this.cursor.set(p);
    if (this.pan) {
      const svg = this.svg()!.nativeElement; const scale = this.pan.view[2] / svg.clientWidth;
      this.view.set([this.pan.view[0] - (event.clientX - this.pan.x) * scale, this.pan.view[1] - (event.clientY - this.pan.y) * scale, this.pan.view[2], this.pan.view[3]]);
      return;
    }
    const drag = this.drag; if (!drag) return;
    // Encosta em vértices de outros polígonos e do lote (sem frestas entre áreas vizinhas).
    const others = [...(this.layout()?.lot ?? []), ...this.shapes().flatMap((s, k) => (k === drag.index ? [] : s.points))];
    const [q] = snapToVertices([p], others, this.px(8));
    drag.moved = true;
    this.shapes.set(this.shapes().map((s, k) => (k === drag.index ? { ...s, points: s.points.map((v, n) => (n === drag.vertex ? q : v)) } : s)));
  }
  up() {
    this.pan = null;
    const drag = this.drag; this.drag = null;
    if (drag?.moved) this.commit(this.shapes(), drag.before);
  }
  dbl(event: MouseEvent) {
    if (this.tool() === 'polygon') { this.closeDraft(); return; }
    const i = this.selected(); const s = this.selectedShape(); if (this.tool() !== 'edit' || i == null || !s) return;
    const p = this.toImage(event);
    let best = -1, bd = this.px(8);
    s.points.forEach((a, k) => { const d = segmentDistance(p, a, s.points[(k + 1) % s.points.length]).distance; if (d < bd) { bd = d; best = k; } });
    if (best < 0) return;
    const points = [...s.points]; points.splice(best + 1, 0, p);
    this.commit(this.shapes().map((x, k) => (k === i ? { ...x, points } : x))); this.vertex.set(best + 1);
  }
  closeDraft() {
    // O duplo clique também gera dois cliques: tira o vértice repetido do fim.
    const poly = this.draft().filter((p, i, all) => !i || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > this.px(3));
    if (poly.length < 3) return;
    this.draft.set([]);
    this.commit([...this.shapes(), { kind: this.kind(), points: poly }]);
  }

  @HostListener('document:keydown', ['$event'])
  key(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
    const k = event.key.toLowerCase(); const mod = event.ctrlKey || event.metaKey;
    if (mod && k === 'z') { event.preventDefault(); if (event.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && k === 'y') { event.preventDefault(); this.redo(); return; }
    if (mod && k === 's') { event.preventDefault(); if (this.dirty()) void this.save(); return; }
    if (mod) return;
    if (k === ' ') { event.preventDefault(); this.space.set(true); return; }
    if (k === 'enter') { if (this.pending()) this.acceptPending(); else this.closeDraft(); return; }
    if (k === 'escape') { this.draft.set([]); this.pending.set(null); this.vertex.set(null); return; }
    if ((k === 'delete' || k === 'backspace')) {
      event.preventDefault();
      if (this.draft().length) { this.draft.update((p) => p.slice(0, -1)); return; }
      const i = this.selected(), v = this.vertex(); const s = this.selectedShape(); if (i == null || !s) return;
      if (v != null && s.points.length > 3) { this.commit(this.shapes().map((x, n) => (n === i ? { ...x, points: x.points.filter((_, m) => m !== v) } : x))); this.vertex.set(null); }
      else this.remove(i);
      return;
    }
    if (k === '[' && this.pending()) { this.stepChoice(-1); return; }
    if (k === ']' && this.pending()) { this.stepChoice(1); return; }
    if (k === 'a') this.setTool('ai'); else if (k === 'p') this.setTool('polygon'); else if (k === 'e') this.setTool('edit');
    else if (k >= '1' && k <= '4') this.pickKind(kinds[+k - 1].id);
  }
  @HostListener('document:keyup', ['$event'])
  keyUp(event: KeyboardEvent) { if (event.key === ' ') this.space.set(false); }
  @HostListener('window:beforeunload', ['$event'])
  leave(event: BeforeUnloadEvent) { if (this.dirty()) event.preventDefault(); }

  // ——— Servidor ———
  async save() {
    this.busy.set(true); this.error.set(null); this.message.set(null);
    try {
      const result = await this.api.put<{ groundPlan: { polygons: Shape[]; updatedAt: string } | null }>(`/developments/${this.id()}/implantation/ground-plan`, { polygons: this.shapes() });
      this.dirty.set(false); this.updatedAt.set(this.when(result.groundPlan?.updatedAt));
      this.message.set(this.shapes().length ? 'Chão salvo. Recarregue o visualizador para ver.' : 'Chão desenhado removido: o visualizador volta à dedução automática.');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
