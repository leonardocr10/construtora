import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { val } from '../core/labels';
import {
  OpeningKind, PlanLayout, PlanOpening, PlanRoom, PlanWall, RoomKind, Vec, centroid, dist, guessRoomKind, openingKinds, polygonArea, project, roomKinds, round,
} from '../core/plan-layout';

type Tool = 'select' | 'scale' | 'wall' | 'room' | OpeningKind;
type Selection = { type: 'wall' | 'opening' | 'room'; id: string } | null;
interface PlanData { id: string; name: string; developmentId: string; layout: PlanLayout | null; assets: { id: string; kind: string; originalName: string; mimeType: string }[] }

const tools: { id: Tool; icon: string; label: string; hint: string }[] = [
  { id: 'select', icon: '➚', label: 'Selecionar', hint: 'Clique num elemento para editar. Arraste as pontas da parede selecionada. Delete remove.' },
  { id: 'scale', icon: '↔', label: 'Escala', hint: 'Clique nas duas pontas de uma cota conhecida e informe a medida real.' },
  { id: 'wall', icon: '▬', label: 'Parede', hint: 'Clique ponto a ponto. Duplo clique ou Esc encerra. Encaixa nas pontas e em 90°.' },
  { id: 'door', icon: '◜', label: 'Porta', hint: 'Clique sobre uma parede para inserir a porta.' },
  { id: 'window', icon: '▭', label: 'Janela', hint: 'Clique sobre uma parede para inserir a janela.' },
  { id: 'sliding', icon: '⇆', label: 'Porta de correr', hint: 'Clique sobre uma parede (varanda, sala).' },
  { id: 'room', icon: '⬠', label: 'Cômodo', hint: 'Clique nos cantos do cômodo e feche no primeiro ponto.' },
];
const openingColor: Record<OpeningKind, string> = { door: '#e8833a', window: '#2478f4', sliding: '#16a36a' };
const snapRadius = 0.2;
const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emptyLayout = (): PlanLayout => ({ version: 1, wallHeight: 2.6, walls: [], openings: [], rooms: [] });

@Component({
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .editor{display:grid;grid-template-columns:150px minmax(0,1fr) 280px;gap:14px;align-items:start}
    .tools{display:flex;flex-direction:column;gap:6px}
    .tools .btn{justify-content:flex-start}
    .tools .btn.on{background:var(--blue);color:#fff;border-color:var(--blue)}
    .canvas{position:relative;height:calc(100vh - 230px);min-height:480px;background:#f7f9fc;border-radius:11px;border:1px solid var(--stroke);overflow:hidden}
    .canvas svg{width:100%;height:100%;display:block;touch-action:none;user-select:none}
    .canvas .hint{position:absolute;left:12px;bottom:12px;right:12px;background:#16243de6;color:#fff;padding:9px 12px;border-radius:8px;font-size:12px;pointer-events:none}
    .canvas .zoom{position:absolute;right:12px;top:12px;display:flex;gap:6px}
    .list{max-height:240px;overflow:auto;margin:0;padding:0;list-style:none}
    .list li button{width:100%;text-align:left;border:0;background:none;padding:7px 4px;cursor:pointer;display:flex;gap:8px;align-items:center;border-radius:6px;font-size:12px}
    .list li button.on{background:#eaf2ff}
    .list i{width:12px;height:12px;border-radius:3px;display:inline-block}
    @media(max-width:1100px){.editor{grid-template-columns:1fr}.tools{flex-direction:row;flex-wrap:wrap}}
  `],
  template: `
    <div class="content">
      <div class="head">
        <div><h1>Vetorizar planta{{ plan() ? ' · ' + plan()!.name : '' }}</h1>
          <p class="sub">Desenhe paredes, portas, janelas e cômodos sobre a imagem. O visualizador gera a planta 3D mobiliada e o tour interno.</p></div>
        <div class="controls">
          <a class="btn" [routerLink]="['/empreendimentos', id(), 'plantas']">‹ Plantas</a>
          <button class="btn" [disabled]="!history().length" (click)="undo()">↶ Desfazer</button>
          <button class="btn blue" [disabled]="busy() || !plan()" (click)="save()">{{ busy() ? 'Salvando…' : 'Salvar planta 3D' }}</button>
        </div>
      </div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (message()) { <div class="notice ok">{{ message() }}</div> }
      @if (!image() && plan()) { <div class="notice"><b>Planta sem imagem.</b><span>Envie a imagem da planta (PNG/JPG) para desenhar por cima; sem ela, use a grade de 1 m.</span></div> }
      <div class="editor">
        <div class="card shadow"><div class="pad tools">
          @for (t of tools; track t.id) { <button class="btn" [class.on]="tool() === t.id" (click)="setTool(t.id)">{{ t.icon }} {{ t.label }}</button> }
          <div class="divider"></div>
          <div class="small">Escala: {{ fmt(ppm(), 0) }} px/m</div>
          <div class="small">{{ layout().walls.length }} paredes · {{ layout().openings.length }} aberturas · {{ layout().rooms.length }} cômodos</div>
        </div></div>

        <div class="canvas">
          <svg #svg [attr.viewBox]="viewBox()" (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" (dblclick)="finish()" (wheel)="wheel($event)" (contextmenu)="$event.preventDefault()">
            <defs><pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#d9e2ee" stroke-width="0.02"/></pattern></defs>
            <rect x="-50" y="-50" width="160" height="160" fill="url(#grid)"/>
            @if (image(); as img) { <image [attr.href]="img.url" x="0" y="0" [attr.width]="img.w / ppm()" [attr.height]="img.h / ppm()" opacity="0.75" preserveAspectRatio="none"/> }
            @for (r of rooms(); track r.id) {
              <polygon [attr.points]="r.svg" [attr.fill]="r.color" fill-opacity="0.45" [attr.stroke]="r.selected ? '#16243d' : 'none'" stroke-width="0.04"/>
              <text [attr.x]="r.label[0]" [attr.y]="r.label[1]" text-anchor="middle" font-size="0.28" font-weight="700" fill="#16243d">{{ r.name }}</text>
              <text [attr.x]="r.label[0]" [attr.y]="r.label[1] + 0.32" text-anchor="middle" font-size="0.22" fill="#4a5b75">{{ r.area }} m²</text>
            }
            @for (w of layout().walls; track w.id) {
              <line [attr.x1]="w.a[0]" [attr.y1]="w.a[1]" [attr.x2]="w.b[0]" [attr.y2]="w.b[1]" [attr.stroke]="isSel('wall', w.id) ? '#2478f4' : '#26324a'" [attr.stroke-width]="w.thickness" stroke-linecap="square"/>
            }
            @for (o of openings(); track o.id) {
              <line [attr.x1]="o.a[0]" [attr.y1]="o.a[1]" [attr.x2]="o.b[0]" [attr.y2]="o.b[1]" stroke="#fff" [attr.stroke-width]="o.thickness + 0.02"/>
              <line [attr.x1]="o.a[0]" [attr.y1]="o.a[1]" [attr.x2]="o.b[0]" [attr.y2]="o.b[1]" [attr.stroke]="o.color" [attr.stroke-width]="o.selected ? o.thickness : o.thickness * 0.55" [attr.stroke-dasharray]="o.kind === 'window' ? '0.12 0.06' : null"/>
            }
            @if (selectedWall(); as w) {
              <circle [attr.cx]="w.a[0]" [attr.cy]="w.a[1]" r="0.14" fill="#fff" stroke="#2478f4" stroke-width="0.04"/>
              <circle [attr.cx]="w.b[0]" [attr.cy]="w.b[1]" r="0.14" fill="#fff" stroke="#2478f4" stroke-width="0.04"/>
            }
            @if (draftPath(); as d) { <polyline [attr.points]="d" fill="none" [attr.stroke]="tool() === 'scale' ? '#e8833a' : '#2478f4'" stroke-width="0.05" stroke-dasharray="0.15 0.08"/> }
            @if (cursor(); as c) { <circle [attr.cx]="c[0]" [attr.cy]="c[1]" r="0.07" [attr.fill]="snapped() ? '#16a36a' : '#2478f4'"/> }
          </svg>
          <div class="zoom"><button class="btn" (click)="zoomBy(0.8)">＋</button><button class="btn" (click)="zoomBy(1.25)">－</button><button class="btn" (click)="fit()">⊡</button></div>
          <div class="hint">{{ hint() }}</div>
        </div>

        <div class="card shadow"><div class="pad">
          @if (tool() === 'scale' && draft().length === 2) {
            <h3>Calibrar escala</h3>
            <p class="small">Medida no desenho: {{ fmt(draftLength(), 2) }} m. Informe a medida real dessa cota.</p>
            <div class="field"><label>Medida real (m)</label><input class="input" type="number" step="0.01" min="0.1" [value]="scaleInput()" (input)="scaleInput.set(v($event))"></div>
            <button class="btn blue" (click)="applyScale()">Aplicar escala</button>
            <div class="divider"></div>
          }
          @if (selectedWall(); as w) {
            <h3>Parede</h3>
            <p class="small">Comprimento {{ fmt(wallLength(w), 2) }} m</p>
            <div class="field"><label>Espessura (m)</label><input class="input" type="number" step="0.01" min="0.05" max="0.6" [value]="w.thickness" (change)="updateWall(w.id, { thickness: num($event, 0.05, 0.6) })"></div>
            <button class="btn" (click)="remove()">Excluir parede</button>
            <div class="divider"></div>
          }
          @if (selectedOpening(); as o) {
            <h3>{{ openingKinds[o.kind].label }}</h3>
            <div class="field"><label>Tipo</label><select class="input" [value]="o.kind" (change)="updateOpening(o.id, { kind: $any(v($event)) })">
              @for (k of openingKindList; track k) { <option [value]="k">{{ openingKinds[k].label }}</option> }
            </select></div>
            <div class="field"><label>Largura (m)</label><input class="input" type="number" step="0.05" min="0.3" max="6" [value]="o.width" (change)="updateOpening(o.id, { width: num($event, 0.3, 6) })"></div>
            <div class="field"><label>Posição a partir do início da parede (m)</label><input class="input" type="number" step="0.05" min="0" [value]="o.offset" (change)="updateOpening(o.id, { offset: num($event, 0, 60) })"></div>
            @if (o.kind === 'window') { <div class="field"><label>Peitoril (m)</label><input class="input" type="number" step="0.05" min="0" max="2" [value]="o.sill ?? 1.1" (change)="updateOpening(o.id, { sill: num($event, 0, 2) })"></div> }
            <button class="btn" (click)="remove()">Excluir abertura</button>
            <div class="divider"></div>
          }
          @if (selectedRoom(); as r) {
            <h3>Cômodo</h3>
            <div class="field"><label>Nome</label><input class="input" maxlength="60" [value]="r.name" (change)="renameRoom(r.id, v($event))"></div>
            <div class="field"><label>Tipo (define o mobiliário)</label><select class="input" [value]="r.kind" (change)="updateRoom(r.id, { kind: $any(v($event)) })">
              @for (k of roomKindList; track k) { <option [value]="k">{{ roomKinds[k].label }}</option> }
            </select></div>
            <p class="small">Área {{ fmt(roomArea(r), 2) }} m²</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn soft" (click)="wallsAround(r)">Criar paredes no contorno</button><button class="btn" (click)="remove()">Excluir</button></div>
            <div class="divider"></div>
          }
          <h3>Projeto</h3>
          <div class="field"><label>Pé-direito (m)</label><input class="input" type="number" step="0.05" min="2.2" max="4" [value]="layout().wallHeight" (change)="commit({ ...layout(), wallHeight: num($event, 2.2, 4) })"></div>
          <div class="field"><label>Espessura das novas paredes (m)</label><input class="input" type="number" step="0.01" min="0.05" max="0.6" [value]="thickness()" (change)="thickness.set(num($event, 0.05, 0.6))"></div>
          <h3 style="margin-top:6px">Cômodos</h3>
          <ul class="list">
            @for (r of layout().rooms; track r.id) {
              <li><button [class.on]="isSel('room', r.id)" (click)="select({ type: 'room', id: r.id })"><i [style.background]="roomKinds[r.kind].color"></i>{{ r.name }}<span class="small right">{{ fmt(roomArea(r), 1) }} m²</span></button></li>
            } @empty { <li class="small">Nenhum cômodo. Use a ferramenta Cômodo.</li> }
          </ul>
        </div></div>
      </div>
    </div>`,
})
export class FloorPlanEditorPage implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly ctx = inject(DevelopmentContext);
  readonly id = input.required<string>();
  readonly planId = input.required<string>();
  readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  readonly tools = tools;
  readonly roomKinds = roomKinds;
  readonly openingKinds = openingKinds;
  readonly roomKindList = Object.keys(roomKinds) as RoomKind[];
  readonly openingKindList = Object.keys(openingKinds) as OpeningKind[];

  readonly plan = signal<PlanData | null>(null);
  readonly layout = signal<PlanLayout>(emptyLayout());
  readonly history = signal<PlanLayout[]>([]);
  readonly image = signal<{ url: string; w: number; h: number } | null>(null);
  readonly ppm = signal(50);
  readonly tool = signal<Tool>('select');
  readonly selection = signal<Selection>(null);
  readonly draft = signal<Vec[]>([]);
  readonly cursor = signal<Vec | null>(null);
  readonly snapped = signal(false);
  readonly thickness = signal(0.15);
  readonly scaleInput = signal('');
  readonly view = signal({ x: -1, y: -1, w: 16, h: 12 });
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  readonly viewBox = computed(() => { const v = this.view(); return `${v.x} ${v.y} ${v.w} ${v.h}`; });
  readonly hint = computed(() => tools.find((t) => t.id === this.tool())!.hint);
  readonly selectedWall = computed(() => { const s = this.selection(); return s?.type === 'wall' ? this.layout().walls.find((w) => w.id === s.id) ?? null : null; });
  readonly selectedOpening = computed(() => { const s = this.selection(); return s?.type === 'opening' ? this.layout().openings.find((o) => o.id === s.id) ?? null : null; });
  readonly selectedRoom = computed(() => { const s = this.selection(); return s?.type === 'room' ? this.layout().rooms.find((r) => r.id === s.id) ?? null : null; });
  readonly draftLength = computed(() => { const d = this.draft(); return d.length === 2 ? dist(d[0], d[1]) : 0; });
  readonly draftPath = computed(() => {
    const d = this.draft(); const c = this.cursor();
    if (!d.length) return null;
    const pts = this.tool() === 'scale' && d.length === 2 ? d : c ? [...d, c] : d;
    return pts.map((p) => p.join(',')).join(' ');
  });
  readonly rooms = computed(() => this.layout().rooms.map((r) => ({
    id: r.id, name: r.name, color: roomKinds[r.kind].color, svg: r.points.map((p) => p.join(',')).join(' '),
    label: centroid(r.points), area: polygonArea(r.points).toLocaleString('pt-BR', { maximumFractionDigits: 1 }), selected: this.isSel('room', r.id),
  })));
  readonly openings = computed(() => {
    const walls = new Map(this.layout().walls.map((w) => [w.id, w]));
    return this.layout().openings.flatMap((o) => {
      const w = walls.get(o.wallId); if (!w) return [];
      const len = dist(w.a, w.b); const ux = (w.b[0] - w.a[0]) / len, uy = (w.b[1] - w.a[1]) / len;
      const at = (t: number): Vec => [w.a[0] + ux * t, w.a[1] + uy * t];
      return [{ id: o.id, kind: o.kind, a: at(o.offset - o.width / 2), b: at(o.offset + o.width / 2), thickness: w.thickness, color: openingColor[o.kind], selected: this.isSel('opening', o.id) }];
    });
  });

  private pan: { x: number; y: number; view: { x: number; y: number; w: number; h: number } } | null = null;
  private drag: { wallId: string; end: 'a' | 'b'; others: { wallId: string; end: 'a' | 'b' }[]; before: PlanLayout } | null = null;

  ngOnInit() { this.ctx.select(this.id()); void this.load(); }
  ngOnDestroy() { const img = this.image(); if (img) URL.revokeObjectURL(img.url); }

  v(event: Event) { return val(event); }
  num(event: Event, min: number, max: number) { const n = Number(val(event)); return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)); }
  fmt(n: number, digits: number) { return n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
  isSel(type: 'wall' | 'opening' | 'room', id: string) { const s = this.selection(); return s?.type === type && s.id === id; }
  wallLength(w: PlanWall) { return dist(w.a, w.b); }
  roomArea(r: PlanRoom) { return polygonArea(r.points); }

  async load() {
    try {
      const plan = await this.api.get<PlanData>(`/floor-plans/${this.planId()}/layout`);
      this.plan.set(plan);
      const layout = plan.layout ?? emptyLayout();
      this.layout.set(layout);
      const asset = plan.assets.find((a) => a.id === layout.imageAssetId) ?? plan.assets.find((a) => a.mimeType.startsWith('image/'));
      if (asset) {
        const url = URL.createObjectURL(await this.api.blob(`/floor-plans/${plan.id}/assets/${asset.id}`));
        const img = new Image(); img.src = url; await img.decode();
        this.image.set({ url, w: img.naturalWidth, h: img.naturalHeight });
        // Sem calibração, supõe a planta com ~12 m de largura até o usuário ajustar a escala.
        this.ppm.set(layout.pxPerMeter ?? img.naturalWidth / 12);
        this.layout.update((l) => ({ ...l, imageAssetId: asset.id }));
      } else if (layout.pxPerMeter) this.ppm.set(layout.pxPerMeter);
      this.fit();
    } catch (error) { this.error.set(errorMessage(error)); }
  }

  fit() {
    const img = this.image(); const pts = this.layout().walls.flatMap((w) => [w.a, w.b]).concat(this.layout().rooms.flatMap((r) => r.points));
    let w = 15, h = 12;
    if (img) { w = img.w / this.ppm(); h = img.h / this.ppm(); }
    else if (pts.length) { w = Math.max(...pts.map((p) => p[0])) + 1; h = Math.max(...pts.map((p) => p[1])) + 1; }
    const el = this.svg().nativeElement.getBoundingClientRect(); const aspect = el.width / Math.max(el.height, 1) || 1.4;
    const vw = Math.max(w + 1, (h + 1) * aspect); const vh = vw / aspect;
    this.view.set({ x: w / 2 - vw / 2, y: h / 2 - vh / 2, w: vw, h: vh });
  }

  zoomBy(factor: number, at?: Vec) {
    const v = this.view(); const c = at ?? [v.x + v.w / 2, v.y + v.h / 2];
    this.view.set({ x: c[0] - (c[0] - v.x) * factor, y: c[1] - (c[1] - v.y) * factor, w: v.w * factor, h: v.h * factor });
  }

  wheel(event: WheelEvent) { event.preventDefault(); this.zoomBy(event.deltaY > 0 ? 1.15 : 0.87, this.toPlan(event)); }

  setTool(tool: Tool) { this.tool.set(tool); this.draft.set([]); this.scaleInput.set(''); if (tool !== 'select') this.selection.set(null); }
  select(selection: Selection) { this.selection.set(selection); }

  /** Registra o estado anterior para desfazer e aplica o novo. */
  commit(next: PlanLayout, before = this.layout()) {
    this.history.update((h) => [...h.slice(-49), before]);
    this.layout.set(next); this.message.set(null);
  }
  undo() {
    const h = this.history(); if (!h.length) return;
    this.layout.set(h[h.length - 1]); this.history.set(h.slice(0, -1)); this.selection.set(null);
  }

  private toPlan(event: MouseEvent): Vec {
    const svg = this.svg().nativeElement; const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const p = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x, p.y];
  }

  /** Encaixe nas pontas existentes; sem encaixe, trava em 0°/90° a partir do ponto anterior. */
  private snap(p: Vec, from?: Vec): Vec {
    const l = this.layout(); const candidates = [...l.walls.flatMap((w) => [w.a, w.b]), ...l.rooms.flatMap((r) => r.points), ...this.draft()];
    let best: Vec | null = null; let bestD = snapRadius;
    for (const c of candidates) { const d = dist(p, c); if (d < bestD) { bestD = d; best = c; } }
    this.snapped.set(!!best);
    if (best) return [best[0], best[1]];
    let [x, y] = p;
    if (from) {
      const angle = Math.abs(Math.atan2(y - from[1], x - from[0]) * 180 / Math.PI) % 90;
      if (angle < 8 || angle > 82) { if (Math.abs(x - from[0]) > Math.abs(y - from[1])) y = from[1]; else x = from[0]; }
    }
    return [Math.max(0, round(x)), Math.max(0, round(y))];
  }

  down(event: PointerEvent) {
    if (event.button === 2 || event.button === 1) {
      this.pan = { x: event.clientX, y: event.clientY, view: this.view() };
      this.svg().nativeElement.setPointerCapture(event.pointerId); return;
    }
    if (event.button !== 0) return;
    const raw = this.toPlan(event); const tool = this.tool(); const d = this.draft();
    if (tool === 'select') {
      const wall = this.selectedWall();
      if (wall) {
        const end = dist(raw, wall.a) < 0.25 ? 'a' : dist(raw, wall.b) < 0.25 ? 'b' : null;
        if (end) {
          const point = wall[end];
          const others = this.layout().walls.flatMap((w) => w.id === wall.id ? [] : (['a', 'b'] as const).filter((e) => dist(w[e], point) < 0.01).map((e) => ({ wallId: w.id, end: e })));
          this.drag = { wallId: wall.id, end, others, before: this.layout() };
          this.svg().nativeElement.setPointerCapture(event.pointerId); return;
        }
      }
      this.selection.set(this.hit(raw)); return;
    }
    if (tool === 'scale') { this.draft.set(d.length >= 2 ? [raw] : [...d, raw]); if (this.draft().length === 2) this.scaleInput.set(''); return; }
    if (tool === 'wall') {
      const p = this.snap(raw, d[d.length - 1]);
      if (d.length && dist(d[d.length - 1], p) >= 0.1) {
        this.commit({ ...this.layout(), walls: [...this.layout().walls, { id: uid('w'), a: d[d.length - 1], b: p, thickness: this.thickness() }] });
      }
      this.draft.set([p]); return;
    }
    if (tool === 'room') {
      const p = this.snap(raw, d[d.length - 1]);
      if (d.length >= 3 && dist(p, d[0]) < 0.25) { this.closeRoom(d); return; }
      this.draft.set([...d, p]); return;
    }
    this.addOpening(tool, raw);
  }

  move(event: PointerEvent) {
    if (this.pan) {
      const rect = this.svg().nativeElement.getBoundingClientRect(); const v = this.pan.view;
      const k = Math.max(v.w / rect.width, v.h / rect.height);
      this.view.set({ ...v, x: v.x - (event.clientX - this.pan.x) * k, y: v.y - (event.clientY - this.pan.y) * k }); return;
    }
    const raw = this.toPlan(event);
    if (this.drag) {
      const drag = this.drag; const p = this.snap(raw);
      const moved = new Map<string, ('a' | 'b')[]>([[drag.wallId, [drag.end]]]);
      for (const o of drag.others) moved.set(o.wallId, [...(moved.get(o.wallId) ?? []), o.end]);
      this.layout.update((l) => this.clampOpenings({ ...l, walls: l.walls.map((w) => { const ends = moved.get(w.id); if (!ends) return w; const next = { ...w }; for (const e of ends) next[e] = p; return next; }) }));
      return;
    }
    const d = this.draft(); const tool = this.tool();
    this.cursor.set(tool === 'wall' || tool === 'room' ? this.snap(raw, d[d.length - 1]) : tool === 'select' ? null : raw);
  }

  up(event: PointerEvent) {
    if (this.pan) { this.pan = null; return; }
    if (this.drag) {
      const drag = this.drag; this.drag = null;
      const wall = this.layout().walls.find((w) => w.id === drag.wallId);
      if (wall && dist(wall.a, wall.b) < 0.1) { this.layout.set(drag.before); return; }
      this.commit(this.layout(), drag.before);
    }
    void event;
  }

  finish() {
    const d = this.draft();
    if (this.tool() === 'room' && d.length >= 3) { this.closeRoom(d); return; }
    if (this.tool() !== 'scale') this.draft.set([]);
  }

  @HostListener('document:keydown', ['$event'])
  key(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    if (event.key === 'Escape') { if (this.draft().length) this.finish(); else this.selection.set(null); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.remove(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); this.undo(); }
  }

  private hit(p: Vec): Selection {
    const l = this.layout(); const walls = new Map(l.walls.map((w) => [w.id, w]));
    for (const o of l.openings) {
      const w = walls.get(o.wallId); if (!w) continue;
      const pr = project(p, w.a, w.b);
      if (pr.distance < w.thickness / 2 + 0.08 && Math.abs(pr.t - o.offset) <= o.width / 2) return { type: 'opening', id: o.id };
    }
    for (const w of l.walls) if (project(p, w.a, w.b).distance < w.thickness / 2 + 0.08) return { type: 'wall', id: w.id };
    for (const r of [...l.rooms].reverse()) if (inside(p, r.points)) return { type: 'room', id: r.id };
    return null;
  }

  private addOpening(kind: OpeningKind, p: Vec) {
    let best: { wall: PlanWall; t: number; len: number } | null = null; let bestD = 0.5;
    for (const w of this.layout().walls) { const pr = project(p, w.a, w.b); if (pr.distance < bestD) { bestD = pr.distance; best = { wall: w, t: pr.t, len: pr.len }; } }
    if (!best) { this.error.set('Clique sobre uma parede para inserir a abertura.'); return; }
    this.error.set(null);
    const width = Math.min(openingKinds[kind].width, round(best.len - 0.02, 0.05));
    if (width < 0.3) { this.error.set('Parede curta demais para essa abertura.'); return; }
    const offset = round(Math.min(best.len - width / 2, Math.max(width / 2, best.t)));
    const opening: PlanOpening = { id: uid('o'), wallId: best.wall.id, offset, width, kind };
    if (kind === 'window') opening.sill = 1.1;
    this.commit({ ...this.layout(), openings: [...this.layout().openings, opening] });
    this.selection.set({ type: 'opening', id: opening.id });
  }

  private closeRoom(points: Vec[]) {
    const count = this.layout().rooms.length + 1;
    const room: PlanRoom = { id: uid('r'), name: `Cômodo ${count}`, kind: 'living', points };
    this.commit({ ...this.layout(), rooms: [...this.layout().rooms, room] });
    this.draft.set([]); this.tool.set('select'); this.selection.set({ type: 'room', id: room.id });
  }

  applyScale() {
    const real = Number(this.scaleInput().replace(',', '.')); const measured = this.draftLength();
    if (!(real > 0.1) || measured < 0.05) { this.error.set('Informe a medida real em metros.'); return; }
    const k = real / measured; const s = (p: Vec): Vec => [round(p[0] * k, 0.001), round(p[1] * k, 0.001)];
    const l = this.layout();
    this.ppm.set(this.ppm() / k);
    this.commit({
      ...l, pxPerMeter: round(this.ppm(), 0.001),
      walls: l.walls.map((w) => ({ ...w, a: s(w.a), b: s(w.b) })),
      openings: l.openings.map((o) => ({ ...o, offset: round(o.offset * k, 0.001) })),
      rooms: l.rooms.map((r) => ({ ...r, points: r.points.map(s) })),
    });
    this.draft.set([]); this.tool.set('select'); this.error.set(null); this.fit();
    this.message.set(`Escala aplicada: ${this.ppm().toFixed(1)} px/m.`);
  }

  updateWall(id: string, patch: Partial<PlanWall>) { this.commit({ ...this.layout(), walls: this.layout().walls.map((w) => w.id === id ? { ...w, ...patch } : w) }); }
  updateOpening(id: string, patch: Partial<PlanOpening>) { this.commit(this.clampOpenings({ ...this.layout(), openings: this.layout().openings.map((o) => o.id === id ? { ...o, ...patch } : o) })); }
  updateRoom(id: string, patch: Partial<PlanRoom>) { this.commit({ ...this.layout(), rooms: this.layout().rooms.map((r) => r.id === id ? { ...r, ...patch } : r) }); }
  renameRoom(id: string, name: string) {
    const room = this.layout().rooms.find((r) => r.id === id); if (!room || !name.trim()) return;
    // O tipo acompanha o nome enquanto o usuário não o escolheu explicitamente (cômodo novo = "Sala").
    const kind = /^Cômodo \d+$/.test(room.name) ? guessRoomKind(name) : room.kind;
    this.updateRoom(id, { name: name.trim(), kind });
  }

  wallsAround(room: PlanRoom) {
    const l = this.layout(); const same = (a: Vec, b: Vec) => dist(a, b) < 0.05;
    const add: PlanWall[] = [];
    room.points.forEach((a, i) => {
      const b = room.points[(i + 1) % room.points.length];
      if (dist(a, b) < 0.1) return;
      const exists = [...l.walls, ...add].some((w) => (same(w.a, a) && same(w.b, b)) || (same(w.a, b) && same(w.b, a)));
      if (!exists) add.push({ id: uid('w'), a, b, thickness: this.thickness() });
    });
    if (add.length) this.commit({ ...l, walls: [...l.walls, ...add] });
    this.message.set(add.length ? `${add.length} parede(s) criada(s) no contorno.` : 'O contorno já tem paredes.');
  }

  remove() {
    const s = this.selection(); if (!s) return; const l = this.layout();
    if (s.type === 'wall') this.commit({ ...l, walls: l.walls.filter((w) => w.id !== s.id), openings: l.openings.filter((o) => o.wallId !== s.id) });
    if (s.type === 'opening') this.commit({ ...l, openings: l.openings.filter((o) => o.id !== s.id) });
    if (s.type === 'room') this.commit({ ...l, rooms: l.rooms.filter((r) => r.id !== s.id) });
    this.selection.set(null);
  }

  /** Mantém cada abertura dentro da parede (largura e posição) depois de editar a geometria. */
  private clampOpenings(l: PlanLayout): PlanLayout {
    const walls = new Map(l.walls.map((w) => [w.id, dist(w.a, w.b)]));
    return { ...l, openings: l.openings.flatMap((o) => {
      const len = walls.get(o.wallId); if (len == null || len < 0.32) return [];
      const width = Math.min(o.width, round(len - 0.02, 0.01));
      return [{ ...o, width, offset: round(Math.min(len - width / 2, Math.max(width / 2, o.offset)), 0.001) }];
    }) };
  }

  async save() {
    this.busy.set(true); this.error.set(null); this.message.set(null);
    try {
      const layout = { ...this.clampOpenings(this.layout()), pxPerMeter: this.image() ? round(this.ppm(), 0.001) : this.layout().pxPerMeter };
      await this.api.put(`/floor-plans/${this.planId()}/layout`, { layout });
      this.message.set('Planta 3D salva. Ela aparece no visualizador em "Planta 3D" nos apartamentos com esta planta.');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}

function inside(p: Vec, poly: Vec[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
