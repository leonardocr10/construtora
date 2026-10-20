import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, inject, input, signal, viewChild } from '@angular/core';
import { API_URL, ApiService, VIEWER_URL, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';

type Point = [number, number];
type Kind = 'asphalt' | 'grass' | 'paving' | 'art';
type Tool = 'brush' | 'polygon' | 'pan';
interface Stroke { kind: Kind; shape: 'brush' | 'polygon'; points: Point[]; radius?: number }
interface Layout { siteImageAssetId?: string; imageWidth: number; imageHeight: number; metersPerPixel: number; lot?: Point[]; groundCorrection?: { strokes: Stroke[]; updatedAt?: string } }
interface EditorData { development: { id: string; name: string; slug: string }; layout: Layout | null }

const kinds: { id: Kind; label: string; color: string; hint: string }[] = [
  { id: 'asphalt', label: 'Asfalto', color: '#3b3f46', hint: 'Rua e estacionamento, na cota baixa' },
  { id: 'grass', label: 'Grama', color: '#3fae4a', hint: 'Gramado e canteiro, elevado' },
  { id: 'paving', label: 'Piso', color: '#e9a23b', hint: 'Calçada, deque e praça, elevados' },
  { id: 'art', label: 'Arte', color: '#c04bd8', hint: 'Mantém a imagem original (quadra, piscina…)' },
];
const colorOf = Object.fromEntries(kinds.map((k) => [k.id, k.color])) as Record<Kind, string>;

/**
 * Corrigir o chão do lote: o visualizador deduz asfalto, grama e piso da cor de cada pixel da arte, e uma ilustração
 * de marketing sempre deixa erros (carro sobre a calçada, sombra no gramado). Aqui a área é pintada à mão, com
 * pincel ou polígono, e a correção (traços em pixels da arte) vale por cima da dedução automática.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  styles: [`
    .gc{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;height:calc(100vh - 210px);min-height:560px}
    .pane{position:relative;border:1px solid var(--stroke);border-radius:11px;overflow:hidden;background:#e9eef5}
    .art{width:100%;height:100%;touch-action:none;display:block}
    .art.brush,.art.polygon{cursor:crosshair}.art.pan{cursor:grab}
    .hint{position:absolute;left:10px;bottom:10px;background:#16243de6;color:#fff;padding:6px 10px;border-radius:8px;font-size:12px;pointer-events:none}
    .side{overflow:auto}
    .seg{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:6px 0 12px}
    .seg button,.kinds button{border:1px solid var(--stroke);background:#fff;border-radius:8px;padding:8px 6px;font-size:12px;cursor:pointer;text-align:left}
    .seg button{text-align:center}
    .seg button.on,.kinds button.on{border-color:var(--blue);box-shadow:0 0 0 2px #2478f433;font-weight:700}
    .kinds{display:grid;gap:6px;margin:6px 0 12px}
    .kinds button{display:flex;gap:9px;align-items:center}
    .sw{width:18px;height:18px;border-radius:5px;flex:none;border:1px solid #0002}
    .kinds small{display:block;color:var(--muted,#6b7385);font-weight:400}
    .row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
  `],
  template: `
    <div class="content">
      <div class="head">
        <div><h1>Corrigir chão do lote</h1><p class="sub">Pinte por cima da arte onde o visualizador errou o chão (asfalto, grama, piso). O que você pinta vale sobre a dedução automática; "Arte" mantém a imagem original.</p></div>
        <div class="controls">
          @if (data(); as d) { <a class="btn soft" [href]="viewerUrl + '/' + d.development.slug" target="_blank" rel="noopener">Abrir visualizador</a> }
          <button class="btn blue" [disabled]="busy() || !dirty()" (click)="save()">Salvar correção</button>
        </div>
      </div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (message()) { <div class="notice ok">{{ message() }}</div> }
      <div class="gc">
        <div class="pane">
          @if (imageUrl(); as url) {
            <svg #svg class="art {{ panning() ? 'pan' : tool() }}" [attr.viewBox]="viewBox()" (wheel)="zoom($event)" (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" (pointerleave)="cursor.set(null)" (dblclick)="closePolygon()" (contextmenu)="$event.preventDefault()">
              <image [attr.href]="url" x="0" y="0" [attr.width]="layout()?.imageWidth" [attr.height]="layout()?.imageHeight" />
              <g [attr.opacity]="opacity()">
                @for (s of strokes(); track $index) {
                  @if (s.shape === 'polygon') { <polygon [attr.points]="pts(s.points)" [attr.fill]="color(s.kind)" /> }
                  @else if (s.points.length === 1) { <circle [attr.cx]="s.points[0][0]" [attr.cy]="s.points[0][1]" [attr.r]="s.radius" [attr.fill]="color(s.kind)" /> }
                  @else { <polyline [attr.points]="pts(s.points)" fill="none" [attr.stroke]="color(s.kind)" [attr.stroke-width]="2 * (s.radius ?? 4)" stroke-linecap="round" stroke-linejoin="round" /> }
                }
                @if (drawing(); as d) {
                  @if (d.points.length === 1) { <circle [attr.cx]="d.points[0][0]" [attr.cy]="d.points[0][1]" [attr.r]="d.radius" [attr.fill]="color(d.kind)" /> }
                  @else { <polyline [attr.points]="pts(d.points)" fill="none" [attr.stroke]="color(d.kind)" [attr.stroke-width]="2 * (d.radius ?? 4)" stroke-linecap="round" stroke-linejoin="round" /> }
                }
              </g>
              @if (layout()?.lot?.length) { <polygon [attr.points]="pts(layout()!.lot!)" fill="none" stroke="#2478f4" [attr.stroke-width]="px(2)" [attr.stroke-dasharray]="px(8) + ' ' + px(5)" style="pointer-events:none" /> }
              @if (polygon().length) {
                <polyline [attr.points]="pts(cursor() ? polygon().concat([cursor()!]) : polygon())" [attr.fill]="color(kind())" fill-opacity="0.35" [attr.stroke]="color(kind())" [attr.stroke-width]="px(2)" style="pointer-events:none" />
                @for (p of polygon(); track $index) { <circle [attr.cx]="p[0]" [attr.cy]="p[1]" [attr.r]="px($first ? 6 : 4)" fill="#fff" [attr.stroke]="color(kind())" [attr.stroke-width]="px(2)" style="pointer-events:none" /> }
              }
              @if (tool() === 'brush' && cursor() && !panning()) { <circle [attr.cx]="cursor()![0]" [attr.cy]="cursor()![1]" [attr.r]="radiusPx()" fill="none" stroke="#fff" [attr.stroke-width]="px(1.5)" style="pointer-events:none" /> }
            </svg>
            <div class="hint">{{ hint() }}</div>
          } @else { <div class="small" style="padding:60px 20px;text-align:center">{{ loading() ? 'Carregando a arte…' : 'Envie a imagem da implantação, calibre e desenhe o contorno do terreno no editor de implantação.' }}</div> }
        </div>
        <div class="side">
          <div class="card shadow"><div class="pad">
            <h3>Ferramenta</h3>
            <div class="seg">
              <button [class.on]="tool() === 'brush'" (click)="setTool('brush')" title="B">Pincel</button>
              <button [class.on]="tool() === 'polygon'" (click)="setTool('polygon')" title="P">Polígono</button>
              <button [class.on]="tool() === 'pan'" (click)="setTool('pan')" title="Espaço">Mover</button>
            </div>
            <h3>Pintar como</h3>
            <div class="kinds">
              @for (k of kinds; track k.id; let i = $index) {
                <button [class.on]="kind() === k.id" (click)="kind.set(k.id)" [title]="'Tecla ' + (i + 1)"><span class="sw" [style.background]="k.color"></span><span>{{ k.label }}<small>{{ k.hint }}</small></span></button>
              }
            </div>
            @if (tool() === 'brush') {
              <div class="field"><label>Pincel: {{ brushMeters() | number: '1.1-1' }} m de diâmetro</label>
                <input type="range" min="0.4" max="12" step="0.2" [value]="brushMeters()" (input)="brushMeters.set(+$any($event.target).value)" style="width:100%"></div>
            }
            <div class="field"><label>Opacidade da pintura: {{ opacity() * 100 | number: '1.0-0' }}%</label>
              <input type="range" min="0.15" max="1" step="0.05" [value]="opacity()" (input)="opacity.set(+$any($event.target).value)" style="width:100%"></div>
            <div class="row">
              <button class="btn" [disabled]="!strokes().length && !polygon().length" (click)="undo()" title="Ctrl+Z">Desfazer</button>
              <button class="btn" [disabled]="!redoStack().length" (click)="redo()" title="Ctrl+Shift+Z">Refazer</button>
              <button class="btn" [disabled]="!strokes().length" (click)="clear()">Limpar tudo</button>
            </div>
            <p class="small">{{ strokes().length }} traço(s){{ dirty() ? ' · não salvo' : '' }}@if (updatedAt(); as u) { · salvo em {{ u }} }</p>
            <p class="small">Roda do mouse: zoom. Botão direito, do meio ou Espaço + arrastar: mover. Polígono: clique os vértices e feche no primeiro, com duplo clique ou Enter (Esc cancela, Backspace apaga o último).</p>
          </div></div>
        </div>
      </div>
    </div>`,
})
export class GroundCorrectionPage implements OnDestroy {
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
  readonly tool = signal<Tool>('brush');
  readonly kind = signal<Kind>('asphalt');
  readonly brushMeters = signal(2.4);
  readonly opacity = signal(0.6);
  readonly strokes = signal<Stroke[]>([]);
  readonly redoStack = signal<Stroke[][]>([]);
  readonly drawing = signal<Stroke | null>(null);
  readonly polygon = signal<Point[]>([]);
  readonly cursor = signal<Point | null>(null);
  readonly space = signal(false);
  readonly panning = computed(() => this.tool() === 'pan' || this.space());
  readonly dirty = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly updatedAt = signal<string | null>(null);
  readonly viewBox = computed(() => this.view().join(' '));
  readonly radiusPx = computed(() => this.brushMeters() / 2 / (this.layout()?.metersPerPixel || 0.1));
  readonly hint = computed(() => this.panning() ? 'Arraste para mover a vista'
    : this.tool() === 'brush' ? `Arraste para pintar como ${kinds.find((k) => k.id === this.kind())!.label.toLowerCase()}`
    : this.polygon().length ? `${this.polygon().length} vértice(s): feche no primeiro, com duplo clique ou Enter` : 'Clique para começar o polígono');

  private pan: { x: number; y: number; view: [number, number, number, number] } | null = null;
  /** Desfazer: cada entrada é a lista inteira de traços antes da mudança. */
  private history: Stroke[][] = [];

  color(kind: Kind) { return colorOf[kind] ?? '#000'; }
  pts(points: Point[]) { return points.map((p) => p.join(',')).join(' '); }
  px(n: number) { return (n * this.view()[2]) / 900; }

  async ngOnInit() {
    this.ctx.select(this.id());
    try {
      const data = await this.api.get<EditorData>(`/developments/${this.id()}/implantation`);
      this.data.set(data); this.layout.set(data.layout);
      const layout = data.layout;
      this.strokes.set(layout?.groundCorrection?.strokes ?? []);
      this.updatedAt.set(this.when(layout?.groundCorrection?.updatedAt));
      if (layout?.siteImageAssetId && layout.lot?.length) {
        const response = await fetch(`${API_URL}/developments/${this.id()}/assets/${layout.siteImageAssetId}/file`, { headers: { authorization: `Bearer ${this.api.token()}` } });
        if (response.ok) this.imageUrl.set(URL.createObjectURL(await response.blob()));
        // Vista inicial: o terreno com uma margem.
        const xs = layout.lot.map((p) => p[0]), ys = layout.lot.map((p) => p[1]);
        const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0, m = Math.max(w, h) * 0.05;
        this.view.set([x0 - m, y0 - m, w + 2 * m, h + 2 * m]);
      }
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.loading.set(false); }
  }

  ngOnDestroy() { const url = this.imageUrl(); if (url) URL.revokeObjectURL(url); }

  private when(iso?: string) { return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null; }

  setTool(tool: Tool) { this.tool.set(tool); this.polygon.set([]); }

  // ——— Desfazer ———
  private commit(next: Stroke[]) {
    this.history.push(this.strokes()); if (this.history.length > 200) this.history.shift();
    this.strokes.set(next); this.redoStack.set([]); this.dirty.set(true); this.message.set(null);
  }
  undo() {
    if (this.polygon().length) { this.polygon.update((p) => p.slice(0, -1)); return; }
    const previous = this.history.pop() ?? (this.strokes().length ? this.strokes().slice(0, -1) : null);
    if (!previous) return;
    this.redoStack.update((r) => [...r, this.strokes()]); this.strokes.set(previous); this.dirty.set(true);
  }
  redo() {
    const next = this.redoStack().at(-1); if (!next) return;
    this.redoStack.update((r) => r.slice(0, -1)); this.history.push(this.strokes()); this.strokes.set(next); this.dirty.set(true);
  }
  clear() { if (confirm('Apagar todos os traços da correção? (dá para desfazer antes de salvar)')) this.commit([]); }

  // ——— Vista e desenho ———
  private toImage(event: { clientX: number; clientY: number }): Point {
    const svg = this.svg()!.nativeElement; const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const p = point.matrixTransform(svg.getScreenCTM()!.inverse()); return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  }
  zoom(event: WheelEvent) {
    event.preventDefault();
    const [x, y] = this.toImage(event); const [vx, vy, vw, vh] = this.view(); const k = event.deltaY > 0 ? 1.18 : 1 / 1.18;
    this.view.set([x - (x - vx) * k, y - (y - vy) * k, vw * k, vh * k]);
  }
  down(event: PointerEvent) {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    if (this.panning() || event.button === 1 || event.button === 2) { this.pan = { x: event.clientX, y: event.clientY, view: this.view() }; return; }
    if (event.button !== 0) return;
    const p = this.toImage(event);
    if (this.tool() === 'brush') { this.drawing.set({ kind: this.kind(), shape: 'brush', points: [p], radius: Math.round(this.radiusPx() * 10) / 10 }); return; }
    const poly = this.polygon();
    // Clique perto do primeiro vértice fecha o polígono.
    if (poly.length >= 3 && Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]) < this.px(10)) { this.closePolygon(); return; }
    this.polygon.set([...poly, p]);
  }
  move(event: PointerEvent) {
    const p = this.toImage(event); this.cursor.set(p);
    if (this.pan) {
      const svg = this.svg()!.nativeElement; const scale = this.pan.view[2] / svg.clientWidth;
      this.view.set([this.pan.view[0] - (event.clientX - this.pan.x) * scale, this.pan.view[1] - (event.clientY - this.pan.y) * scale, this.pan.view[2], this.pan.view[3]]);
      return;
    }
    const d = this.drawing(); if (!d) return;
    // Um ponto a cada ~1/3 do raio: traço liso sem inflar o JSON.
    const last = d.points[d.points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= Math.max(0.8, (d.radius ?? 4) / 3)) this.drawing.set({ ...d, points: [...d.points, p] });
  }
  up(event: PointerEvent) {
    if (this.pan) { this.pan = null; return; }
    const d = this.drawing(); if (!d) return;
    this.drawing.set(null);
    const p = this.toImage(event); const last = d.points[d.points.length - 1];
    const points = last[0] === p[0] && last[1] === p[1] ? d.points : [...d.points, p];
    this.commit([...this.strokes(), { ...d, points: points.length === 2 && points[0][0] === points[1][0] && points[0][1] === points[1][1] ? [points[0]] : points }]);
  }
  closePolygon() {
    // O duplo clique também gera dois cliques: tira o vértice repetido do fim.
    const poly = this.polygon().filter((p, i, all) => !i || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > this.px(3));
    if (poly.length < 3) return;
    this.polygon.set([]);
    this.commit([...this.strokes(), { kind: this.kind(), shape: 'polygon', points: poly }]);
  }

  @HostListener('document:keydown', ['$event'])
  key(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
    const k = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && k === 'z') { event.preventDefault(); if (event.shiftKey) this.redo(); else this.undo(); return; }
    if ((event.ctrlKey || event.metaKey) && k === 'y') { event.preventDefault(); this.redo(); return; }
    if ((event.ctrlKey || event.metaKey) && k === 's') { event.preventDefault(); if (this.dirty()) void this.save(); return; }
    if (k === ' ') { event.preventDefault(); this.space.set(true); return; }
    if (k === 'enter') { this.closePolygon(); return; }
    if (k === 'escape') { this.polygon.set([]); this.drawing.set(null); return; }
    if (k === 'backspace' && this.polygon().length) { event.preventDefault(); this.polygon.update((p) => p.slice(0, -1)); return; }
    if (k === 'b') this.setTool('brush'); else if (k === 'p') this.setTool('polygon');
    else if (k >= '1' && k <= '4') this.kind.set(kinds[+k - 1].id);
  }
  @HostListener('document:keyup', ['$event'])
  keyUp(event: KeyboardEvent) { if (event.key === ' ') this.space.set(false); }
  @HostListener('window:beforeunload', ['$event'])
  leave(event: BeforeUnloadEvent) { if (this.dirty()) event.preventDefault(); }

  // ——— Servidor ———
  async save() {
    this.busy.set(true); this.error.set(null); this.message.set(null);
    try {
      const result = await this.api.put<{ groundCorrection: { strokes: Stroke[]; updatedAt: string } | null }>(`/developments/${this.id()}/implantation/ground-correction`, { strokes: this.strokes() });
      this.dirty.set(false); this.updatedAt.set(this.when(result.groundCorrection?.updatedAt));
      this.message.set(this.strokes().length ? 'Correção salva. Recarregue o visualizador para ver o chão corrigido.' : 'Correção removida: o visualizador volta à dedução automática.');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
