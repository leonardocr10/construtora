import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { LocalFrame, pixelToLocal, type CalibrationReport, type LayoutTransform } from '@vistahub/geo';
import maplibregl from 'maplibre-gl';
import { API_URL, ApiService, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';

type Source = 'OSM' | 'SURVEY' | 'GPS' | 'MANUAL';
interface ControlPoint { id?: string; key: string; label: string; pixel: [number, number] | null; latitude: number | null; longitude: number | null; source: Source; note: string | null }
interface Layout { siteImageAssetId?: string; imageWidth: number; imageHeight: number; metersPerPixel: number; origin: [number, number]; azimuth: number; lot?: [number, number][]; calibration?: { status: string; rms?: number | null; points?: number; computedAt?: string } }
interface EditorData { development: { id: string; name: string; latitude: number | null; longitude: number | null }; layout: Layout | null }

const sources: Record<Source, string> = { OSM: 'Feição do OpenStreetMap', SURVEY: 'Levantamento topográfico', GPS: 'GPS no local', MANUAL: 'Outra (manual)' };
const statusLabel: Record<string, string> = { insuficiente: 'Insuficiente', aproximada: 'Aproximada', verificada: 'Verificada', manual: 'Ajuste manual' };

/**
 * Calibrar implantação: pares de pontos entre a arte (esquerda) e o mapa do OpenStreetMap (direita).
 * O cálculo (packages/geo, na API) devolve escala, azimute e origem com o resíduo de cada ponto; a arte
 * calibrada aparece sobre o mapa, com transparência, para conferência visual antes de aplicar.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  styles: [`
    .cal{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 340px;gap:14px;height:calc(100vh - 210px);min-height:560px}
    .pane{position:relative;border:1px solid var(--stroke);border-radius:11px;overflow:hidden;background:#e9eef5}
    .pane .title{position:absolute;left:10px;top:10px;z-index:3;background:#16243de6;color:#fff;padding:6px 10px;border-radius:8px;font-size:12px}
    .art{width:100%;height:100%;cursor:crosshair;touch-action:none}
    .map{position:absolute;inset:0}
    .calside{overflow:auto}
    .pt{border:1px solid var(--stroke);border-radius:9px;padding:10px;margin-bottom:8px;font-size:12px}
    .pt.sel{border-color:var(--blue);box-shadow:0 0 0 2px #2478f433}
    .pt .row{display:flex;gap:6px;align-items:center;justify-content:space-between}
    .num{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#e0622a;color:#fff;font-weight:700;font-size:11px}
    .warn{background:#fff7e6;border:1px solid #f5d38a;color:#7a5200;border-radius:8px;padding:8px 10px;font-size:12px;margin:6px 0}
    .badge{padding:4px 9px;border-radius:20px;font-weight:700;font-size:11px}
    .badge.verificada{background:#e6f8ee;color:#16834b}.badge.aproximada,.badge.manual{background:#fff1cd;color:#936407}.badge.insuficiente{background:#ffedf0;color:#c2323d}
    .mk{width:22px;height:22px;border-radius:50%;background:#e0622a;color:#fff;font:700 11px/22px Inter,Arial;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px #0006;cursor:grab}
    .mk.sel{background:#2478f4}
    .err{color:#c2323d;font-weight:700}
    @media(max-width:1200px){.cal{grid-template-columns:1fr;height:auto}.pane{height:460px}}
  `],
  template: `
    <div class="content">
      <div class="head">
        <div><h1>Calibrar implantação</h1><p class="sub">Ligue pontos da arte a pontos reais no mapa (cruzamentos, cantos do muro, guias). Com 4 ou mais pontos bem espalhados, o sistema mede o erro de alinhamento.</p></div>
        <div class="controls">
          <button class="btn soft" [disabled]="busy()" (click)="addPoint()">＋ Novo ponto</button>
          <button class="btn" [disabled]="busy() || !dirty()" (click)="save()">Salvar pontos</button>
          <button class="btn blue" [disabled]="busy() || dirty() || points().length < 2" (click)="compute(false)">Calcular</button>
        </div>
      </div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (message()) { <div class="notice ok">{{ message() }}</div> }
      @if (data(); as d) {
        @if (d.development.latitude == null) { <div class="notice error">Cadastre a latitude/longitude do empreendimento (origem da cena) antes de calibrar.</div> }
      }
      <div class="cal">
        <div class="pane">
          <div class="title">{{ pending()?.step === 'art' ? 'Clique o ponto na ARTE' : 'Arte da implantação' }}</div>
          @if (imageUrl(); as url) {
            <svg #svg class="art" [attr.viewBox]="viewBox()" (wheel)="zoom($event)" (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)">
              <image [attr.href]="url" x="0" y="0" [attr.width]="layout()?.imageWidth" [attr.height]="layout()?.imageHeight" />
              @if (layout()?.lot?.length) { <polygon [attr.points]="lotPoints()" fill="none" stroke="#2478f4" [attr.stroke-width]="px(2)" [attr.stroke-dasharray]="px(8) + ' ' + px(5)" /> }
              @for (p of points(); track p.key; let i = $index) {
                @if (p.pixel) {
                  <g [attr.transform]="'translate(' + p.pixel[0] + ' ' + p.pixel[1] + ')'" (pointerdown)="select(p.key)">
                    <circle [attr.r]="px(9)" [attr.fill]="selected() === p.key ? '#2478f4' : '#e0622a'" stroke="#fff" [attr.stroke-width]="px(2)" />
                    <text text-anchor="middle" dominant-baseline="central" [attr.font-size]="px(10)" font-weight="700" fill="#fff" style="pointer-events:none">{{ i + 1 }}</text>
                  </g>
                }
              }
            </svg>
          } @else { <div class="small" style="padding:60px 20px;text-align:center">Envie a imagem da implantação e selecione-a no editor de implantação.</div> }
        </div>
        <div class="pane">
          <div class="title">{{ pending()?.step === 'map' ? 'Clique o MESMO ponto no MAPA' : 'Mapa (OpenStreetMap)' }}</div>
          <div #map class="map"></div>
        </div>
        <div class="calside">
          <div class="card shadow"><div class="pad">
            <h3>Resultado</h3>
            @if (layout()?.calibration; as c) { <p class="small">Aplicada: <span class="badge {{ c.status }}">{{ label(c.status) }}</span> @if (c.rms != null) { · erro médio {{ c.rms | number: '1.2-2' }} m } @if (c.points) { · {{ c.points }} pontos }</p> }
            @else { <p class="small">A calibração atual foi feita à mão (sem pontos de controle): o alinhamento não tem medida de erro.</p> }
            @if (report(); as r) {
              <p><span class="badge {{ r.status }}">{{ label(r.status) }}</span></p>
              @if (r.transform; as t) {
                <div class="kv"><span>Escala</span><b>{{ t.metersPerPixel | number: '1.4-4' }} m/px</b></div>
                <div class="kv"><span>Azimute do topo da arte</span><b>{{ t.azimuth | number: '1.2-2' }}°</b></div>
                <div class="kv"><span>Origem (px)</span><b>{{ t.origin[0] | number: '1.1-1' }}, {{ t.origin[1] | number: '1.1-1' }}</b></div>
                <div class="kv"><span>Erro médio / máximo</span><b>{{ r.rms | number: '1.2-2' }} / {{ r.maxError | number: '1.2-2' }} m</b></div>
                @if (r.distortion; as dd) { <div class="kv"><span>Distorção (escala x/y, cisalhamento)</span><b>{{ dd.anisotropy * 100 | number: '1.1-1' }}% · {{ dd.shearDegrees | number: '1.1-1' }}°</b></div> }
              }
              @for (w of r.warnings; track w) { <div class="warn">⚠ {{ w }}</div> }
              @if (r.transform) { <button class="btn blue" style="width:100%;margin-top:8px" [disabled]="busy()" (click)="compute(true)">Aplicar calibração</button> }
            }
            <div class="field" style="margin-top:12px"><label>Transparência da arte sobre o mapa: {{ opacity() * 100 | number: '1.0-0' }}%</label>
              <input type="range" min="0" max="1" step="0.05" [value]="opacity()" (input)="opacity.set(+$any($event.target).value)" style="width:100%"></div>
          </div></div>
          <h3 style="margin:16px 0 8px">Pontos de controle ({{ points().length }})</h3>
          @for (p of points(); track p.key; let i = $index) {
            <div class="pt" [class.sel]="selected() === p.key" (click)="select(p.key)">
              <div class="row"><span><span class="num">{{ i + 1 }}</span> <input class="input" style="width:170px;padding:6px 8px" [value]="p.label" (change)="patch(p.key, { label: $any($event.target).value })"></span>
                <button class="btn" style="padding:5px 9px" (click)="remove(p.key); $event.stopPropagation()">✕</button></div>
              <div class="small" style="margin-top:6px">Arte: {{ p.pixel ? (p.pixel[0] | number: '1.0-0') + ', ' + (p.pixel[1] | number: '1.0-0') + ' px' : '—' }} · Mapa: {{ p.latitude != null ? (p.latitude | number: '1.6-6') + ', ' + (p.longitude | number: '1.6-6') : '—' }}</div>
              <div class="row" style="margin-top:6px">
                <select class="input" style="padding:5px 6px" [value]="p.source" (change)="patch(p.key, { source: $any($event.target).value })">
                  @for (s of sourceList; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
                </select>
                <button class="btn" style="padding:5px 9px" (click)="repick(p.key); $event.stopPropagation()">Remarcar</button>
              </div>
              @if (residual(p.id); as res) { <div class="small" style="margin-top:6px">Resíduo: <span [class.err]="res.error > 3">{{ res.error | number: '1.2-2' }} m</span></div> }
            </div>
          } @empty { <p class="small">Nenhum ponto. Use "Novo ponto": clique na arte e depois no mesmo lugar no mapa.</p> }
        </div>
      </div>
    </div>`,
})
export class CalibrationPage implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly ctx = inject(DevelopmentContext);
  readonly id = input.required<string>();
  readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');
  readonly mapEl = viewChild<ElementRef<HTMLDivElement>>('map');
  readonly sourceList = Object.entries(sources) as [Source, string][];

  readonly data = signal<EditorData | null>(null);
  readonly layout = signal<Layout | null>(null);
  readonly points = signal<ControlPoint[]>([]);
  readonly selected = signal<string | null>(null);
  readonly pending = signal<{ key: string; step: 'art' | 'map' } | null>(null);
  readonly report = signal<CalibrationReport | null>(null);
  readonly imageUrl = signal<string | null>(null);
  readonly view = signal<[number, number, number, number]>([0, 0, 1000, 1000]);
  readonly opacity = signal(0.55);
  readonly dirty = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly viewBox = computed(() => this.view().join(' '));
  readonly lotPoints = computed(() => (this.layout()?.lot ?? []).map((p) => p.join(',')).join(' '));

  private map: maplibregl.Map | null = null;
  private markers = new Map<string, maplibregl.Marker>();
  private pan: { x: number; y: number; view: [number, number, number, number]; moved: boolean } | null = null;
  private keySeq = 0;

  constructor() {
    // Marcadores do mapa e arte sobreposta acompanham os pontos, a seleção e a transparência.
    effect(() => { this.points(); this.selected(); this.syncMarkers(); });
    effect(() => { this.layout(); this.report(); this.opacity(); this.imageUrl(); this.syncOverlay(); });
  }

  label(status: string) { return statusLabel[status] ?? status; }
  px(n: number) { return (n * this.view()[2]) / 900; }
  residual(id?: string) { return id ? this.report()?.residuals.find((r) => r.id === id) ?? null : null; }

  async ngOnInit() {
    this.ctx.select(this.id());
    try {
      const [data, points] = await Promise.all([
        this.api.get<EditorData>(`/developments/${this.id()}/implantation`),
        this.api.get<{ id: string; label: string; pixel: [number, number]; latitude: number; longitude: number; source: Source; note: string | null }[]>(`/developments/${this.id()}/implantation/control-points`),
      ]);
      this.data.set(data); this.layout.set(data.layout);
      this.points.set(points.map((p) => ({ ...p, key: `k${this.keySeq++}` })));
      if (data.layout?.siteImageAssetId) {
        const response = await fetch(`${API_URL}/developments/${this.id()}/assets/${data.layout.siteImageAssetId}/file`, { headers: { authorization: `Bearer ${this.api.token()}` } });
        if (response.ok) { this.imageUrl.set(URL.createObjectURL(await response.blob())); this.view.set([0, 0, data.layout.imageWidth, data.layout.imageHeight]); }
      }
      this.initMap(data);
      if (points.length >= 2) await this.compute(false);
    } catch (error) { this.error.set(errorMessage(error)); }
  }

  ngOnDestroy() { this.map?.remove(); const url = this.imageUrl(); if (url) URL.revokeObjectURL(url); }

  private initMap(data: EditorData) {
    const el = this.mapEl()?.nativeElement; if (!el) return;
    const center: [number, number] = [data.development.longitude ?? -47.93, data.development.latitude ?? -15.78];
    // Tiles do OpenStreetMap (gratuitos, com atribuição). Em produção com muito acesso, usar um servidor de tiles próprio.
    this.map = new maplibregl.Map({
      container: el, center, zoom: data.development.latitude != null ? 17.5 : 4, maxZoom: 21,
      style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© colaboradores do OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    this.map.on('click', (e) => this.mapClick(e.lngLat));
    this.map.on('load', () => { this.syncOverlay(); this.syncMarkers(); });
    this.map.on('error', (e) => console.error('MapLibre', e.error));
  }

  // ——— Pontos ———
  addPoint() {
    const key = `k${this.keySeq++}`;
    this.points.update((list) => [...list, { key, label: `Ponto ${list.length + 1}`, pixel: null, latitude: null, longitude: null, source: 'OSM', note: null }]);
    this.selected.set(key); this.pending.set({ key, step: 'art' }); this.dirty.set(true);
  }
  repick(key: string) { this.selected.set(key); this.pending.set({ key, step: 'art' }); }
  select(key: string) { this.selected.set(key); }
  patch(key: string, change: Partial<ControlPoint>) { this.points.update((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p))); this.dirty.set(true); }
  remove(key: string) { this.points.update((list) => list.filter((p) => p.key !== key)); if (this.pending()?.key === key) this.pending.set(null); this.dirty.set(true); }

  private mapClick(lngLat: maplibregl.LngLat) {
    const pending = this.pending(); if (!pending || pending.step !== 'map') return;
    this.patch(pending.key, { latitude: Math.round(lngLat.lat * 1e7) / 1e7, longitude: Math.round(lngLat.lng * 1e7) / 1e7 });
    this.pending.set(null);
  }

  // ——— Arte: zoom, arrasto e clique ———
  private toImage(event: { clientX: number; clientY: number }): [number, number] {
    const svg = this.svg()!.nativeElement; const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const p = point.matrixTransform(svg.getScreenCTM()!.inverse()); return [p.x, p.y];
  }
  zoom(event: WheelEvent) {
    event.preventDefault();
    const [x, y] = this.toImage(event); const [vx, vy, vw, vh] = this.view(); const k = event.deltaY > 0 ? 1.18 : 1 / 1.18;
    this.view.set([x - (x - vx) * k, y - (y - vy) * k, vw * k, vh * k]);
  }
  down(event: PointerEvent) { this.pan = { x: event.clientX, y: event.clientY, view: this.view(), moved: false }; (event.target as Element).setPointerCapture?.(event.pointerId); }
  move(event: PointerEvent) {
    if (!this.pan) return;
    const dx = event.clientX - this.pan.x, dy = event.clientY - this.pan.y;
    if (Math.hypot(dx, dy) > 4) this.pan.moved = true;
    if (!this.pan.moved) return;
    const svg = this.svg()!.nativeElement; const scale = this.pan.view[2] / svg.clientWidth;
    this.view.set([this.pan.view[0] - dx * scale, this.pan.view[1] - dy * scale, this.pan.view[2], this.pan.view[3]]);
  }
  up(event: PointerEvent) {
    const moved = this.pan?.moved; this.pan = null;
    const pending = this.pending(); if (moved || !pending || pending.step !== 'art') return;
    const [x, y] = this.toImage(event);
    this.patch(pending.key, { pixel: [Math.round(x * 10) / 10, Math.round(y * 10) / 10] });
    this.pending.set({ key: pending.key, step: 'map' });
  }

  // ——— Mapa: marcadores e arte sobreposta ———
  private syncMarkers() {
    const map = this.map; if (!map) return;
    const points = this.points(); const keys = new Set(points.map((p) => p.key));
    for (const [key, marker] of this.markers) if (!keys.has(key)) { marker.remove(); this.markers.delete(key); }
    points.forEach((p, i) => {
      if (p.latitude == null || p.longitude == null) { this.markers.get(p.key)?.remove(); this.markers.delete(p.key); return; }
      let marker = this.markers.get(p.key);
      if (!marker) {
        const el = document.createElement('div'); el.className = 'mk';
        marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p.longitude, p.latitude]).addTo(map);
        marker.on('dragend', () => { const ll = marker!.getLngLat(); this.patch(p.key, { latitude: Math.round(ll.lat * 1e7) / 1e7, longitude: Math.round(ll.lng * 1e7) / 1e7 }); });
        el.addEventListener('click', (e) => { e.stopPropagation(); this.select(p.key); });
        this.markers.set(p.key, marker);
      } else marker.setLngLat([p.longitude, p.latitude]);
      const el = marker.getElement(); el.textContent = String(i + 1); el.classList.toggle('sel', this.selected() === p.key);
    });
  }

  /** Projeta os 4 cantos da arte no mapa com a calibração calculada (ou a atual) e mostra a imagem por cima. */
  private syncOverlay() {
    const map = this.map; const layout = this.layout(); const url = this.imageUrl(); const d = this.data();
    if (!map || !map.isStyleLoaded() || !layout || !url || d?.development.latitude == null || d.development.longitude == null) return;
    const t: LayoutTransform = this.report()?.transform ?? { metersPerPixel: layout.metersPerPixel, azimuth: layout.azimuth, origin: layout.origin };
    const frame = new LocalFrame({ lat: d.development.latitude, lng: d.development.longitude });
    const corner = (px: number, py: number): [number, number] => { const [x, z] = pixelToLocal(t, [px, py]); const g = frame.toGeo({ x, z }); return [g.lng, g.lat]; };
    const coordinates = [corner(0, 0), corner(layout.imageWidth, 0), corner(layout.imageWidth, layout.imageHeight), corner(0, layout.imageHeight)] as [[number, number], [number, number], [number, number], [number, number]];
    const source = map.getSource('art') as maplibregl.ImageSource | undefined;
    if (source) source.setCoordinates(coordinates);
    else { map.addSource('art', { type: 'image', url, coordinates }); map.addLayer({ id: 'art', type: 'raster', source: 'art', paint: { 'raster-opacity': this.opacity(), 'raster-fade-duration': 0 } }); }
    map.setPaintProperty('art', 'raster-opacity', this.opacity());
  }

  // ——— Servidor ———
  async save() {
    const incomplete = this.points().find((p) => !p.pixel || p.latitude == null);
    if (incomplete) { this.error.set(`Complete o ponto "${incomplete.label}" (arte e mapa) antes de salvar.`); return; }
    this.busy.set(true); this.error.set(null); this.message.set(null);
    try {
      const saved = await this.api.put<{ id: string; label: string; pixel: [number, number]; latitude: number; longitude: number; source: Source; note: string | null }[]>(`/developments/${this.id()}/implantation/control-points`, {
        points: this.points().map((p) => ({ id: p.id, label: p.label, pixel: p.pixel, latitude: p.latitude, longitude: p.longitude, source: p.source, note: p.note })),
      });
      this.points.set(saved.map((p) => ({ ...p, key: `k${this.keySeq++}` }))); this.dirty.set(false);
      this.message.set('Pontos salvos.');
      if (saved.length >= 2) await this.compute(false);
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }

  async compute(apply: boolean) {
    if (apply && !confirm('Aplicar esta calibração à implantação? A escala, o azimute e a origem atuais serão substituídos (fica registrado na auditoria).')) return;
    this.busy.set(true); this.error.set(null);
    try {
      const result = await this.api.post<{ report: CalibrationReport; applied: boolean }>(`/developments/${this.id()}/implantation/calibrate`, { apply });
      this.report.set(result.report);
      if (result.applied) {
        const data = await this.api.get<EditorData>(`/developments/${this.id()}/implantation`);
        this.layout.set(data.layout); this.message.set(`Calibração aplicada (${this.label(result.report.status).toLowerCase()}).`);
      }
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
