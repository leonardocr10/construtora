import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, inject, input, signal, viewChild } from '@angular/core';
import { API_URL, ApiService, UnitStatus, VIEWER_URL, errorMessage } from '../core/api.service';
import { DevelopmentContext } from '../core/development-context';
import { unitStatus, unitStatuses, val } from '../core/labels';

type Point = [number, number];
interface Layout { siteImageAssetId?: string; imageWidth: number; imageHeight: number; metersPerPixel: number; origin: Point; azimuth: number; lot?: Point[]; [key: string]: unknown }
interface EBuilding { id: string; name: string; code: string; position: { x: number; z: number; rotation?: number } | null; model3d: { kind?: string; width?: number; depth?: number } | null; floorCount: number | null; _count: { units: number } }
interface EAmenity { key: string; id?: string; name: string; marker: number | null; position: { x: number; z: number } | null }
interface EUnit { id: string; number: string; final: string | null; status: UnitStatus; privateArea: number | null; totalArea: number | null; buildingId: string; floor: number | null }
interface ELot { key: string; id?: string; name: string; points: Point[]; unitId: string | null }
interface EModel { id: string; version: number; label: string | null; assetId: string; originalName: string; active: boolean }
interface EditorData {
  development: { id: string; name: string; slug: string; status: string; latitude: number | null; longitude: number | null };
  layout: Layout | null; assets: { id: string; kind: string; originalName: string }[];
  buildings: EBuilding[]; amenities: Omit<EAmenity, 'key'>[]; units: EUnit[]; lots: Omit<ELot, 'key'>[]; models: EModel[];
}
type Selection = { type: 'building' | 'amenity' | 'lot'; key: string } | { type: 'outline' } | null;
type Tool = 'select' | 'lot' | 'outline' | 'origin' | 'measure';
type Drag =
  | { kind: 'pan'; start: Point; box: Box }
  | { kind: 'building' | 'amenity'; key: string; start: Point; at: Point }
  | { kind: 'rotate'; key: string }
  | { kind: 'vertex'; target: 'lot' | 'outline'; key: string; index: number }
  | { kind: 'lot'; key: string; start: Point; points: Point[] };
interface Box { x: number; y: number; w: number; h: number }

/** Cores por status, iguais às do visualizador público. */
const statusFill: Record<UnitStatus, string> = { AVAILABLE: '#22a565', RESERVED: '#f2a33a', SOLD: '#9a95a6', BLOCKED: '#6b6f78', UNAVAILABLE: '#6b6f78' };
const QUADRA = 'QUADRA';
let seq = 0;
const key = () => `n${++seq}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Nós nomeados de um GLB (lidos do bloco JSON, sem carregar a geometria). Nomes como o GLTFLoader os normaliza. */
export function glbNodes(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('O arquivo não é um GLB válido');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true)))) as { nodes?: { name?: string; mesh?: number; children?: number[] }[] };
  const sanitize = (name: string) => name.replace(/\s/g, '_').replace(/[[\]\.:\/]/g, '');
  const names = (json.nodes ?? []).filter((n) => n.name && (n.mesh != null || n.children?.length)).map((n) => ({ name: sanitize(n.name!), mesh: n.mesh != null, children: n.children?.length ?? 0 }));
  return [...new Map(names.map((n) => [n.name, n])).values()];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .editor{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px;align-items:start}
    .stage{position:relative;height:calc(100vh - 230px);min-height:520px;background:#e9eef5;border-radius:11px;overflow:hidden;border:1px solid var(--stroke)}
    .stage svg{width:100%;height:100%;display:block;touch-action:none;user-select:none}
    .tools{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
    .tools .btn.on{background:#16243d;color:#fff;border-color:#16243d}
    .hint{position:absolute;left:12px;bottom:12px;background:#16243dde;color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;max-width:70%}
    .compass{position:absolute;right:12px;top:12px;width:54px;height:54px;border-radius:50%;background:#fffd;display:grid;place-items:center;font-weight:800;font-size:11px;color:#c0392b;box-shadow:0 2px 8px #0002}
    .tabs{display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap}.tabs button{border:0;background:#edf1f7;border-radius:7px;padding:8px 10px;font-size:12px;cursor:pointer;font-weight:650}.tabs button.on{background:var(--blue);color:#fff}
    .side-panel{max-height:calc(100vh - 170px);overflow:auto}
    .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
    .list{max-height:300px;overflow:auto;border:1px solid var(--stroke);border-radius:8px}
    .list button{display:flex;width:100%;justify-content:space-between;gap:8px;border:0;border-bottom:1px solid #eef2f7;background:#fff;padding:8px 10px;cursor:pointer;font-size:12px;text-align:left}
    .list button.on{background:#eaf2ff}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle}
    .field{margin-bottom:12px}.small{font-size:12px;color:var(--muted)}
  `],
  template: `
    <div class="content">
      <div class="head"><div><h1>Editor de implantação</h1><p class="sub">Calibre a implantação no mapa, posicione torres e áreas comuns, desenhe os lotes e vincule cada um a uma unidade.</p></div>
        <div class="controls">
          @if (dirty()) { <span class="tag yellow">Alterações não salvas</span> }
          @if (data(); as d) { <a class="btn soft" [href]="viewerUrl + '/' + d.development.slug" target="_blank" rel="noopener">Abrir visualizador</a> }
          <button class="btn blue" [disabled]="busy() || !layout()" (click)="save()">{{ busy() ? 'Salvando…' : 'Salvar implantação' }}</button>
        </div>
      </div>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      @if (message()) { <div class="notice ok">{{ message() }}</div> }

      @if (data() && !layout()) {
        <div class="card shadow"><div class="pad">
          <h3>Escolha a imagem da implantação</h3>
          <p class="small">Envie a arte na Biblioteca de arquivos (tipo Implantação) e selecione aqui. A escala e a posição no mapa são ajustadas em seguida.</p>
          <select class="input" style="max-width:420px" (change)="chooseImage(v($event))"><option value="">Selecione…</option>
            @for (a of data()!.assets; track a.id) { <option [value]="a.id">{{ a.originalName }} ({{ a.kind }})</option> }
          </select>
        </div></div>
      }

      @if (layout(); as l) {
        <div class="editor">
          <div>
            <div class="tools">
              @for (t of toolList; track t[0]) { <button class="btn" [class.on]="tool() === t[0]" (click)="setTool(t[0])" [title]="t[2]">{{ t[1] }}</button> }
              <span style="flex:1"></span>
              <button class="btn" (click)="zoom(1 / 1.3)" title="Aproximar">＋</button><button class="btn" (click)="zoom(1.3)" title="Afastar">－</button><button class="btn" (click)="fit()">Enquadrar</button>
            </div>
            <div class="stage">
              <svg #svg [attr.viewBox]="box().x + ' ' + box().y + ' ' + box().w + ' ' + box().h" (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" (pointercancel)="up($event)" (wheel)="wheel($event)" (dblclick)="finishDraft()" (contextmenu)="$event.preventDefault()">
                @if (imageUrl()) { <image [attr.href]="imageUrl()" x="0" y="0" [attr.width]="l.imageWidth" [attr.height]="l.imageHeight" /> }
                @else { <rect x="0" y="0" [attr.width]="l.imageWidth" [attr.height]="l.imageHeight" fill="#f5f7fa" /> }
                @if (l.lot?.length) {
                  <polygon [attr.points]="pts(l.lot!)" fill="none" stroke="#2478f4" [attr.stroke-width]="px(3)" [attr.stroke-dasharray]="px(10) + ' ' + px(6)" (pointerdown)="pick($event, { type: 'outline' })" style="cursor:pointer" />
                }
                @for (lot of lots(); track lot.key) {
                  <polygon [attr.points]="pts(lot.points)" [attr.fill]="lotColor(lot)" [attr.fill-opacity]="isSel('lot', lot.key) ? 0.7 : 0.45" [attr.stroke]="isSel('lot', lot.key) ? '#16243d' : '#fff'" [attr.stroke-width]="px(isSel('lot', lot.key) ? 3 : 1.5)" [attr.stroke-dasharray]="lot.unitId ? null : px(5) + ' ' + px(4)" (pointerdown)="grabLot($event, lot)" style="cursor:move" />
                  <text [attr.x]="centroid(lot.points)[0]" [attr.y]="centroid(lot.points)[1]" text-anchor="middle" dominant-baseline="middle" [attr.font-size]="px(12)" font-weight="700" fill="#10203a" style="pointer-events:none">{{ lot.name }}</text>
                }
                @for (b of towers(); track b.id) {
                  @if (b.position) {
                    <g [attr.transform]="'translate(' + toPx(b.position.x, b.position.z).join(' ') + ') rotate(' + (b.position.rotation ?? 0) + ')'">
                      <rect [attr.x]="-w(b) / 2" [attr.y]="-d(b) / 2" [attr.width]="w(b)" [attr.height]="d(b)" fill="#e0622a" [attr.fill-opacity]="isSel('building', b.id) ? 0.75 : 0.5" [attr.stroke]="isSel('building', b.id) ? '#16243d' : '#fff'" [attr.stroke-width]="px(2)" (pointerdown)="grabBuilding($event, b)" style="cursor:move" />
                      <line x1="0" [attr.y1]="-d(b) / 2" x2="0" [attr.y2]="-d(b) / 2 - px(26)" stroke="#16243d" [attr.stroke-width]="px(1.5)" />
                      <circle cx="0" [attr.cy]="-d(b) / 2 - px(26)" [attr.r]="px(7)" fill="#fff" stroke="#16243d" [attr.stroke-width]="px(2)" (pointerdown)="grabRotate($event, b)" style="cursor:grab"><title>Girar (Shift = 15°)</title></circle>
                      <text x="0" y="0" text-anchor="middle" dominant-baseline="middle" [attr.font-size]="px(13)" font-weight="800" fill="#fff" style="pointer-events:none">{{ b.name }}</text>
                    </g>
                  }
                }
                @for (a of amenities(); track a.key) {
                  @if (a.position) {
                    <g [attr.transform]="'translate(' + toPx(a.position.x, a.position.z).join(' ') + ')'" (pointerdown)="grabAmenity($event, a)" style="cursor:move">
                      <circle r="0" [attr.r]="px(11)" [attr.fill]="isSel('amenity', a.key) ? '#16243d' : '#e0622a'" stroke="#fff" [attr.stroke-width]="px(2)"><title>{{ a.name }}</title></circle>
                      <text text-anchor="middle" dominant-baseline="central" [attr.font-size]="px(11)" font-weight="800" fill="#fff" style="pointer-events:none">{{ a.marker ?? '•' }}</text>
                    </g>
                  }
                }
                @if (editingPoints(); as e) {
                  @for (p of e.points; track $index) {
                    <circle [attr.cx]="mid(e.points, $index)[0]" [attr.cy]="mid(e.points, $index)[1]" [attr.r]="px(4)" fill="#fff" fill-opacity="0.8" stroke="#2478f4" [attr.stroke-width]="px(1.5)" (pointerdown)="grabMid($event, e.target, e.key, $index)" style="cursor:copy"><title>Arraste para inserir um vértice</title></circle>
                  }
                  @for (p of e.points; track $index) {
                    <circle [attr.cx]="p[0]" [attr.cy]="p[1]" [attr.r]="px(6)" fill="#2478f4" stroke="#fff" [attr.stroke-width]="px(2)" (pointerdown)="grabVertex($event, e.target, e.key, $index)" style="cursor:pointer"><title>Arraste para mover · Alt+clique remove</title></circle>
                  }
                }
                <g [attr.transform]="'translate(' + l.origin.join(' ') + ')'" style="pointer-events:none">
                  <circle [attr.r]="px(9)" fill="none" stroke="#c0392b" [attr.stroke-width]="px(2)" /><line [attr.x1]="-px(14)" y1="0" [attr.x2]="px(14)" y2="0" stroke="#c0392b" [attr.stroke-width]="px(2)" /><line x1="0" [attr.y1]="-px(14)" x2="0" [attr.y2]="px(14)" stroke="#c0392b" [attr.stroke-width]="px(2)" />
                </g>
                @if (draft().length) {
                  <polyline [attr.points]="pts(draft()) + (hover() ? ' ' + hover()!.join(',') : '')" fill="none" stroke="#16243d" [attr.stroke-width]="px(2)" [attr.stroke-dasharray]="px(6) + ' ' + px(4)" style="pointer-events:none" />
                  @for (p of draft(); track $index) { <circle [attr.cx]="p[0]" [attr.cy]="p[1]" [attr.r]="px($index === 0 ? 7 : 4)" [attr.fill]="$index === 0 ? '#22a565' : '#16243d'" style="pointer-events:none" /> }
                }
              </svg>
              <div class="compass" [style.transform]="'rotate(' + (-l.azimuth) + 'deg)'" title="Norte em relação à imagem">▲<br>N</div>
              <div class="hint">{{ hint() }}</div>
            </div>
          </div>

          <div class="card shadow side-panel"><div class="pad">
            <div class="tabs">
              @for (t of tabList; track t[0]) { <button [class.on]="tab() === t[0]" (click)="tab.set(t[0])">{{ t[1] }}</button> }
            </div>

            @if (tab() === 'item') {
              @switch (selected()?.type) {
                @case ('building') { @if (selBuilding(); as b) {
                  <h3>{{ b.name }}</h3><p class="small">Posição no terreno em metros a partir do ponto de referência (cruz vermelha). Arraste na imagem para mover e use a alça para girar.</p>
                  <div class="row3">
                    <div class="field"><label>X (m)</label><input class="input" type="number" step="0.5" [value]="b.position?.x ?? 0" (change)="placeBuilding(b.id, { x: +v($event) })"></div>
                    <div class="field"><label>Z (m)</label><input class="input" type="number" step="0.5" [value]="b.position?.z ?? 0" (change)="placeBuilding(b.id, { z: +v($event) })"></div>
                    <div class="field"><label>Rotação (°)</label><input class="input" type="number" step="0.5" [value]="b.position?.rotation ?? 0" (change)="placeBuilding(b.id, { rotation: +v($event) })"></div>
                  </div>
                  <div class="row2">
                    <div class="field"><label>Largura (m)</label><input class="input" type="number" min="2" step="0.5" [value]="b.model3d?.width ?? 32" (change)="sizeBuilding(b.id, { width: +v($event) })"></div>
                    <div class="field"><label>Profundidade (m)</label><input class="input" type="number" min="2" step="0.5" [value]="b.model3d?.depth ?? 16" (change)="sizeBuilding(b.id, { depth: +v($event) })"></div>
                  </div>
                } }
                @case ('amenity') { @if (selAmenity(); as a) {
                  <h3>Área comum</h3>
                  <div class="field"><label>Nome</label><input class="input" maxlength="120" [value]="a.name" (change)="editAmenity(a.key, { name: v($event) })"></div>
                  <div class="row3">
                    <div class="field"><label>Marcador</label><input class="input" type="number" min="0" [value]="a.marker ?? ''" (change)="editAmenity(a.key, { marker: v($event) === '' ? null : +v($event) })"></div>
                    <div class="field"><label>X (m)</label><input class="input" type="number" step="0.5" [value]="a.position?.x ?? ''" (change)="editAmenity(a.key, { position: { x: +v($event), z: a.position?.z ?? 0 } })"></div>
                    <div class="field"><label>Z (m)</label><input class="input" type="number" step="0.5" [value]="a.position?.z ?? ''" (change)="editAmenity(a.key, { position: { x: a.position?.x ?? 0, z: +v($event) } })"></div>
                  </div>
                  <button class="btn" (click)="editAmenity(a.key, { position: null }); select(null)">Tirar do mapa</button>
                } }
                @case ('lot') { @if (selLot(); as lot) {
                  <h3>Lote</h3>
                  <div class="field"><label>Identificação</label><input class="input" maxlength="120" [value]="lot.name" (change)="editLot(lot.key, { name: v($event) })"></div>
                  <p class="small">Área desenhada ≈ <b>{{ drawnArea(lot.points) | number }}</b> m² · {{ lot.points.length }} vértices</p>
                  <div class="field"><label>Unidade vinculada</label>
                    <select class="input" [value]="lot.unitId ?? ''" (change)="editLot(lot.key, { unitId: v($event) || null })">
                      <option value="">Sem vínculo</option>
                      @for (g of unitGroups(); track g.building.id) { <optgroup [label]="g.building.name">@for (u of g.units; track u.id) { <option [value]="u.id" [disabled]="linkedElsewhere(u.id, lot.key)">{{ u.number }} · {{ statusLabel(u.status) }}</option> }</optgroup> }
                    </select>
                  </div>
                  @if (unitOf(lot); as u) {
                    <div class="row2">
                      <div class="field"><label>Status</label><select class="input" [value]="u.status" (change)="changeStatus(u, v($event))">@for (s of statuses; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }</select></div>
                      <div class="field"><label>Área (m²)</label><input class="input" type="number" min="0" step="0.01" [value]="u.privateArea ?? ''" (change)="changeArea(u, +v($event))"></div>
                    </div>
                  } @else {
                    <div class="card" style="padding:12px;margin-bottom:12px;background:#f7f9fd">
                      <b style="font-size:12px">Criar unidade para este lote</b>
                      <div class="row2" style="margin-top:8px">
                        <div class="field"><label>Quadra</label><select class="input" [value]="quadraId()" (change)="quadraId.set(v($event))"><option value="">Nova quadra…</option>@for (q of quadras(); track q.id) { <option [value]="q.id">{{ q.name }}</option> }</select></div>
                        @if (!quadraId()) { <div class="field"><label>Nome da quadra</label><input class="input" placeholder="Quadra A" [value]="newQuadra()" (input)="newQuadra.set(v($event))"></div> }
                      </div>
                      <button class="btn soft" [disabled]="busy()" (click)="createUnit(lot)">Criar lote {{ lot.name }} ({{ drawnArea(lot.points) | number }} m²)</button>
                    </div>
                  }
                  <div class="controls"><button class="btn" (click)="removeLot(lot.key)">Excluir lote</button><span class="small">Alt+clique num vértice remove o vértice.</span></div>
                } }
                @case ('outline') {
                  <h3>Contorno do terreno</h3><p class="small">Arraste os vértices; use os pontos intermediários para inserir vértices. O contorno recorta a arte no visualizador 3D.</p>
                  <button class="btn" (click)="setTool('outline')">Redesenhar contorno</button>
                }
                @default {
                  <p class="small">Selecione uma torre, um marcador ou um lote na imagem, ou use as ferramentas acima.</p>
                  <h3 style="margin-top:16px">Torres</h3>
                  <div class="list">@for (b of towers(); track b.id) { <button (click)="focusBuilding(b)"><span>{{ b.name }}</span><small>{{ b.position ? 'posicionada' : 'sem posição: clique para posicionar' }}</small></button> } @empty { <p class="small" style="padding:10px">Nenhuma torre cadastrada.</p> }</div>
                  <h3 style="margin-top:16px">Áreas comuns</h3>
                  <div class="list">@for (a of amenities(); track a.key) { <button (click)="focusAmenity(a)"><span>{{ a.marker ?? '—' }} · {{ a.name }}</span><small>{{ a.position ? 'no mapa' : 'clique para posicionar' }}</small></button> }</div>
                  <div class="row2" style="margin-top:10px"><input class="input" placeholder="Nova área comum" [value]="newAmenity()" (input)="newAmenity.set(v($event))"><button class="btn soft" [disabled]="!newAmenity().trim()" (click)="addAmenity()">＋ Adicionar</button></div>
                }
              }
            }

            @if (tab() === 'lots') {
              <h3>Lotes ({{ lots().length }})</h3>
              <p class="small">{{ linkedCount() }} vinculados a unidades. Use a ferramenta <b>Desenhar lote</b> para criar novos.</p>
              <div class="list" style="max-height:420px">
                @for (lot of lots(); track lot.key) {
                  <button [class.on]="isSel('lot', lot.key)" (click)="select({ type: 'lot', key: lot.key }); tab.set('item')"><span><i class="dot" [style.background]="lotColor(lot)"></i>{{ lot.name }}</span><small>{{ unitOf(lot) ? statusLabel(unitOf(lot)!.status) : 'sem vínculo' }}</small></button>
                } @empty { <p class="small" style="padding:10px">Nenhum lote desenhado.</p> }
              </div>
              <div class="field" style="margin-top:12px"><label>Vincular por nome</label>
                <select class="input" [value]="quadraId()" (change)="quadraId.set(v($event))"><option value="">Todas as quadras</option>@for (q of quadras(); track q.id) { <option [value]="q.id">{{ q.name }}</option> }</select>
              </div>
              <button class="btn soft" (click)="autoLink()">Vincular lotes sem unidade pelo número</button>
            }

            @if (tab() === 'calib') {
              <h3>Calibração</h3>
              <p class="small">A cruz vermelha é o ponto da imagem que corresponde à latitude/longitude do empreendimento. Torres e marcadores mantêm o lugar na arte quando a escala ou a referência mudam.</p>
              <div class="row2">
                <div class="field"><label>Metros por pixel</label><input class="input" type="number" step="0.001" min="0.001" [value]="l.metersPerPixel" (change)="recalibrate({ metersPerPixel: +v($event) })"></div>
                <div class="field"><label>Azimute do topo (°)</label><input class="input" type="number" step="0.5" [value]="l.azimuth" (change)="recalibrate({ azimuth: +v($event) })"></div>
                <div class="field"><label>Referência X (px)</label><input class="input" type="number" [value]="l.origin[0]" (change)="recalibrate({ origin: [+v($event), l.origin[1]] })"></div>
                <div class="field"><label>Referência Y (px)</label><input class="input" type="number" [value]="l.origin[1]" (change)="recalibrate({ origin: [l.origin[0], +v($event)] })"></div>
                <div class="field"><label>Latitude</label><input class="input" type="number" step="0.000001" [value]="lat() ?? ''" (change)="lat.set(v($event) === '' ? null : +v($event)); dirty.set(true)"></div>
                <div class="field"><label>Longitude</label><input class="input" type="number" step="0.000001" [value]="lng() ?? ''" (change)="lng.set(v($event) === '' ? null : +v($event)); dirty.set(true)"></div>
              </div>
              <p class="small">Terreno de {{ (l.imageWidth * l.metersPerPixel) | number: '1.0-0' }} × {{ (l.imageHeight * l.metersPerPixel) | number: '1.0-0' }} m na imagem. Alterar latitude/longitude recarrega o entorno do OpenStreetMap na próxima visita.</p>
              <div class="card" style="padding:12px;background:#f7f9fd;margin-bottom:12px">
                <b style="font-size:12px">Escala por medida conhecida</b>
                <p class="small">Use a ferramenta <b>Medir</b> e clique nas duas pontas de uma cota conhecida (ex.: testada do lote).</p>
                @if (measure().length === 2) {
                  <p class="small">Distância na imagem: {{ measurePx() | number: '1.0-1' }} px ≈ {{ measurePx() * l.metersPerPixel | number: '1.0-2' }} m</p>
                  <div class="row2"><input class="input" type="number" min="0" step="0.01" placeholder="Distância real (m)" [value]="realDistance()" (input)="realDistance.set(v($event))"><button class="btn soft" [disabled]="!(+realDistance() > 0)" (click)="applyMeasure()">Aplicar escala</button></div>
                }
              </div>
              <div class="field"><label>Imagem da implantação</label>
                <select class="input" [value]="l.siteImageAssetId ?? ''" (change)="chooseImage(v($event))">@for (a of data()!.assets; track a.id) { <option [value]="a.id">{{ a.originalName }}</option> }</select>
              </div>
            }

            @if (tab() === 'glb') {
              <h3>Modelo GLB</h3>
              <p class="small">Vincule os nós (malhas) do modelo importado às unidades. No visualizador público, o GLB ativo substitui as torres paramétricas e as malhas vinculadas recebem a cor do status.</p>
              @if (!data()!.models.length) { <p class="small"><b>Nenhum GLB importado.</b> Envie em Estúdio 3D.</p> }
              @else {
                <div class="field"><label>Versão</label><select class="input" [value]="modelId()" (change)="loadModel(v($event))"><option value="">Selecione…</option>@for (m of data()!.models; track m.id) { <option [value]="m.id">v{{ m.version }} · {{ m.label ?? m.originalName }}{{ m.active ? ' (ativo)' : '' }}</option> }</select></div>
                @if (modelId()) {
                  <p class="small">{{ nodes().length }} nós nomeados · {{ linkCount() }} vinculados</p>
                  <input class="input" placeholder="Filtrar nós" [value]="nodeFilter()" (input)="nodeFilter.set(v($event))" style="margin-bottom:8px">
                  <div class="list" style="max-height:260px">
                    @for (n of filteredNodes(); track n.name) {
                      <button [class.on]="node() === n.name" (click)="node.set(n.name)"><span>{{ n.name }}</span><small>{{ nodeUnitLabel(n.name) }}</small></button>
                    }
                  </div>
                  @if (node(); as n) {
                    <div class="field" style="margin-top:10px"><label>Unidade de {{ n }}</label>
                      <select class="input" [value]="links()[n] ?? ''" (change)="linkNode(n, v($event))"><option value="">Sem vínculo</option>
                        @for (g of unitGroups(); track g.building.id) { <optgroup [label]="g.building.name">@for (u of g.units; track u.id) { <option [value]="u.id">{{ u.number }}</option> }</optgroup> }
                      </select>
                    </div>
                  }
                  <div class="controls" style="margin-top:10px">
                    <button class="btn soft" (click)="autoLinkNodes()">Sugerir pelo número no nome</button>
                    <button class="btn blue" [disabled]="busy()" (click)="saveLinks()">Salvar vínculos</button>
                  </div>
                }
              }
            }
          </div></div>
        </div>
      }
    </div>`,
  imports: [],
})
export class ImplantationEditorPage implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly ctx = inject(DevelopmentContext);
  readonly id = input.required<string>();
  readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');
  readonly v = val; readonly statuses = unitStatuses; readonly viewerUrl = VIEWER_URL;
  readonly toolList: [Tool, string, string][] = [['select', '↖ Selecionar', 'Selecionar e arrastar'], ['lot', '▱ Desenhar lote', 'Clique nos vértices; clique no primeiro ponto, duplo clique ou Enter fecha'], ['outline', '⬠ Contorno do terreno', 'Redesenha o contorno do lote'], ['origin', '⌖ Referência', 'Clique no ponto da latitude/longitude'], ['measure', '↔ Medir', 'Clique em duas pontas de uma cota conhecida']];
  readonly tabList: [string, string][] = [['item', 'Seleção'], ['lots', 'Lotes'], ['calib', 'Calibração'], ['glb', 'Modelo GLB']];

  readonly data = signal<EditorData | null>(null);
  readonly layout = signal<Layout | null>(null);
  readonly lat = signal<number | null>(null); readonly lng = signal<number | null>(null);
  readonly buildings = signal<EBuilding[]>([]);
  readonly amenities = signal<EAmenity[]>([]);
  readonly lots = signal<ELot[]>([]);
  readonly units = signal<EUnit[]>([]);
  readonly imageUrl = signal<string | null>(null);
  readonly box = signal<Box>({ x: 0, y: 0, w: 1000, h: 1000 });
  readonly tool = signal<Tool>('select');
  readonly tab = signal('item');
  readonly selected = signal<Selection>(null);
  readonly draft = signal<Point[]>([]);
  readonly hover = signal<Point | null>(null);
  readonly measure = signal<Point[]>([]);
  readonly realDistance = signal('');
  readonly quadraId = signal(''); readonly newQuadra = signal(''); readonly newAmenity = signal('');
  readonly dirty = signal(false); readonly busy = signal(false);
  readonly error = signal<string | null>(null); readonly message = signal<string | null>(null);
  // GLB
  readonly modelId = signal(''); readonly nodes = signal<{ name: string }[]>([]); readonly links = signal<Record<string, string>>({});
  readonly node = signal<string | null>(null); readonly nodeFilter = signal('');
  private drag: Drag | null = null;

  readonly towers = computed(() => this.buildings().filter((b) => b.model3d?.kind !== QUADRA));
  readonly quadras = computed(() => this.buildings().filter((b) => b.model3d?.kind === QUADRA));
  readonly unitsById = computed(() => new Map(this.units().map((u) => [u.id, u])));
  readonly unitGroups = computed(() => this.buildings().map((building) => ({ building, units: this.units().filter((u) => u.buildingId === building.id) })).filter((g) => g.units.length));
  readonly selBuilding = computed(() => { const s = this.selected(); return s?.type === 'building' ? this.buildings().find((b) => b.id === s.key) ?? null : null; });
  readonly selAmenity = computed(() => { const s = this.selected(); return s?.type === 'amenity' ? this.amenities().find((a) => a.key === s.key) ?? null : null; });
  readonly selLot = computed(() => { const s = this.selected(); return s?.type === 'lot' ? this.lots().find((l) => l.key === s.key) ?? null : null; });
  readonly linkedCount = computed(() => this.lots().filter((l) => l.unitId).length);
  readonly linkCount = computed(() => Object.keys(this.links()).length);
  readonly filteredNodes = computed(() => { const f = this.nodeFilter().toLowerCase(); return this.nodes().filter((n) => !f || n.name.toLowerCase().includes(f)).slice(0, 400); });
  readonly measurePx = computed(() => { const [a, b] = this.measure(); return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0; });
  /** Pontos editáveis (lote selecionado ou contorno do terreno). */
  readonly editingPoints = computed(() => {
    const s = this.selected(); if (this.tool() !== 'select' || !s) return null;
    if (s.type === 'outline') return this.layout()?.lot?.length ? { target: 'outline' as const, key: '', points: this.layout()!.lot! } : null;
    if (s.type === 'lot') { const lot = this.selLot(); return lot ? { target: 'lot' as const, key: lot.key, points: lot.points } : null; }
    return null;
  });
  readonly hint = computed(() => ({
    select: 'Arraste torres, marcadores e lotes. Roda do mouse aproxima; arraste o fundo para mover a vista.',
    lot: this.draft().length ? `${this.draft().length} vértices. Clique no primeiro ponto, duplo clique ou Enter para fechar; Esc cancela.` : 'Clique para marcar o primeiro vértice do lote.',
    outline: this.draft().length ? `${this.draft().length} vértices do contorno. Enter ou duplo clique fecha.` : 'Clique para marcar o primeiro vértice do contorno do terreno.',
    origin: 'Clique no ponto da imagem que corresponde à latitude/longitude do empreendimento.',
    measure: this.measure().length === 1 ? 'Clique na segunda ponta da medida.' : 'Clique na primeira ponta de uma medida conhecida.',
  })[this.tool()]);

  ngOnInit() { this.ctx.select(this.id()); void this.load(); }
  ngOnDestroy() { const url = this.imageUrl(); if (url) URL.revokeObjectURL(url); }

  async load() {
    try {
      const d = await this.api.get<EditorData>(`/developments/${this.id()}/implantation`);
      this.data.set(d);
      this.layout.set(d.layout?.siteImageAssetId ? d.layout : null);
      this.lat.set(d.development.latitude); this.lng.set(d.development.longitude);
      this.buildings.set(d.buildings); this.units.set(d.units);
      this.amenities.set(d.amenities.map((a) => ({ ...a, key: a.id ?? key() })));
      this.lots.set(d.lots.map((l) => ({ ...l, key: key() })));
      this.dirty.set(false);
      if (d.layout?.siteImageAssetId) { await this.loadImage(d.layout.siteImageAssetId); this.fit(); }
    } catch (error) { this.error.set(errorMessage(error)); }
  }

  /** Busca um arquivo privado com o token da sessão (o <img> não envia o cabeçalho de autenticação). */
  private async file(assetId: string) {
    const response = await fetch(`${API_URL}/developments/${this.id()}/assets/${assetId}/file`, { headers: { authorization: `Bearer ${this.api.token()}` } });
    if (!response.ok) throw new Error('Não foi possível carregar o arquivo');
    return response.blob();
  }

  private async loadImage(assetId: string) {
    const old = this.imageUrl(); if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(await this.file(assetId));
    this.imageUrl.set(url);
    return new Promise<{ w: number; h: number }>((resolve, reject) => { const img = new Image(); img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = reject; img.src = url; });
  }

  async chooseImage(assetId: string) {
    if (!assetId) return;
    try {
      const { w, h } = await this.loadImage(assetId);
      const current = this.layout();
      this.layout.set(current ? { ...current, siteImageAssetId: assetId, imageWidth: w, imageHeight: h } : { siteImageAssetId: assetId, imageWidth: w, imageHeight: h, metersPerPixel: 0.2, origin: [Math.round(w / 2), Math.round(h / 2)], azimuth: 0, lot: [] });
      this.dirty.set(true); this.fit();
    } catch (error) { this.error.set(errorMessage(error)); }
  }

  // Conversões entre pixels da implantação e metros no terreno.
  toPx(x: number, z: number): Point { const l = this.layout()!; return [x / l.metersPerPixel + l.origin[0], z / l.metersPerPixel + l.origin[1]]; }
  toM([px, py]: Point, l = this.layout()!): Point { return [r2((px - l.origin[0]) * l.metersPerPixel), r2((py - l.origin[1]) * l.metersPerPixel)]; }
  w(b: EBuilding) { return (b.model3d?.width ?? 32) / this.layout()!.metersPerPixel; }
  d(b: EBuilding) { return (b.model3d?.depth ?? 16) / this.layout()!.metersPerPixel; }
  /** Tamanho em pixels de imagem equivalente a n pixels de tela (traços e alças com espessura constante). */
  px(n: number) { const el = this.svg()?.nativeElement; return n * this.box().w / (el?.clientWidth || 1000); }
  pts(points: Point[]) { return points.map((p) => p.join(',')).join(' '); }
  centroid(points: Point[]): Point { return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]; }
  mid(points: Point[], i: number): Point { const a = points[i]; const b = points[(i + 1) % points.length]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
  drawnArea(points: Point[]) { const mpp = this.layout()?.metersPerPixel ?? 0; let s = 0; points.forEach((p, i) => { const q = points[(i + 1) % points.length]; s += p[0] * q[1] - q[0] * p[1]; }); return Math.round(Math.abs(s / 2) * mpp * mpp * 100) / 100; }
  isSel(type: string, k: string) { const s = this.selected(); return !!s && s.type === type && 'key' in s && s.key === k; }
  unitOf(lot: ELot) { return lot.unitId ? this.unitsById().get(lot.unitId) ?? null : null; }
  lotColor(lot: ELot) { const u = this.unitOf(lot); return u ? statusFill[u.status] : '#9aa7b8'; }
  statusLabel(s: UnitStatus) { return unitStatus[s].label; }
  linkedElsewhere(unitId: string, lotKey: string) { return this.lots().some((l) => l.unitId === unitId && l.key !== lotKey); }

  select(selection: Selection) { this.selected.set(selection); if (selection) this.tab.set('item'); }
  setTool(tool: Tool) { this.tool.set(tool); this.draft.set([]); this.hover.set(null); if (tool === 'measure') this.measure.set([]); if (tool !== 'select') this.selected.set(null); }

  // Vista: zoom pela roda e enquadramento.
  fit() {
    const l = this.layout(); const el = this.svg()?.nativeElement; if (!l) return;
    const aspect = el && el.clientHeight ? el.clientWidth / el.clientHeight : 1.4;
    const w = Math.max(l.imageWidth, l.imageHeight * aspect) * 1.04; const h = w / aspect;
    this.box.set({ x: (l.imageWidth - w) / 2, y: (l.imageHeight - h) / 2, w, h });
  }
  zoom(factor: number, at?: Point) {
    const b = this.box(); const c = at ?? [b.x + b.w / 2, b.y + b.h / 2];
    this.box.set({ x: c[0] - (c[0] - b.x) * factor, y: c[1] - (c[1] - b.y) * factor, w: b.w * factor, h: b.h * factor });
  }
  wheel(event: WheelEvent) { event.preventDefault(); this.zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15, this.point(event)); }

  private point(event: MouseEvent): Point {
    const svg = this.svg()!.nativeElement; const m = svg.getScreenCTM()!.inverse();
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(m);
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  }
  private capture(event: PointerEvent) { this.svg()?.nativeElement.setPointerCapture(event.pointerId); event.stopPropagation(); }

  // Ponteiro: fundo (desenho, referência, medida ou pan) e alças dos objetos.
  down(event: PointerEvent) {
    const p = this.point(event);
    if (event.button === 2 || event.button === 1) { this.drag = { kind: 'pan', start: [event.clientX, event.clientY], box: this.box() }; this.capture(event); return; }
    const tool = this.tool();
    if (tool === 'lot' || tool === 'outline') {
      const draft = this.draft();
      if (draft.length >= 3 && Math.hypot(p[0] - draft[0][0], p[1] - draft[0][1]) < this.px(12)) { this.finishDraft(); return; }
      if (event.detail < 2) this.draft.set([...draft, p]);
      return;
    }
    if (tool === 'origin') { this.recalibrate({ origin: [Math.round(p[0]), Math.round(p[1])] }); this.setTool('select'); this.message.set('Ponto de referência atualizado. Confira a latitude/longitude em Calibração.'); return; }
    if (tool === 'measure') { const m = this.measure(); this.measure.set(m.length >= 2 ? [p] : [...m, p]); if (m.length === 1) this.tab.set('calib'); return; }
    this.selected.set(null);
    this.drag = { kind: 'pan', start: [event.clientX, event.clientY], box: this.box() }; this.capture(event);
  }

  move(event: PointerEvent) {
    const drag = this.drag;
    if (!drag) { if (this.draft().length) this.hover.set(this.point(event)); return; }
    if (drag.kind === 'pan') {
      const el = this.svg()!.nativeElement; const k = drag.box.w / el.clientWidth;
      this.box.set({ ...drag.box, x: drag.box.x - (event.clientX - drag.start[0]) * k, y: drag.box.y - (event.clientY - drag.start[1]) * k });
      return;
    }
    const p = this.point(event); this.dirty.set(true);
    if (drag.kind === 'building' || drag.kind === 'amenity') {
      const [x, z] = this.toM([drag.at[0] + p[0] - drag.start[0], drag.at[1] + p[1] - drag.start[1]]);
      if (drag.kind === 'building') this.placeBuilding(drag.key, { x, z }); else this.editAmenity(drag.key, { position: { x, z } });
    } else if (drag.kind === 'rotate') {
      const b = this.buildings().find((x) => x.id === drag.key)!; const c = this.toPx(b.position!.x, b.position!.z);
      let angle = (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI + 90;
      angle = event.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle * 2) / 2;
      this.placeBuilding(drag.key, { rotation: ((angle % 360) + 360) % 360 });
    } else if (drag.kind === 'vertex') {
      this.setPoints(drag.target, drag.key, (points) => points.map((q, i) => (i === drag.index ? p : q)));
    } else if (drag.kind === 'lot') {
      const dx = p[0] - drag.start[0]; const dy = p[1] - drag.start[1];
      this.editLot(drag.key, { points: drag.points.map(([x, y]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10] as Point) });
    }
  }

  up(event: PointerEvent) { this.drag = null; this.svg()?.nativeElement.releasePointerCapture?.(event.pointerId); }

  pick(event: PointerEvent, selection: Selection) { if (this.tool() !== 'select') return; this.capture(event); this.select(selection); }
  grabBuilding(event: PointerEvent, b: EBuilding) { if (this.tool() !== 'select') return; this.capture(event); this.select({ type: 'building', key: b.id }); this.drag = { kind: 'building', key: b.id, start: this.point(event), at: this.toPx(b.position!.x, b.position!.z) }; }
  grabRotate(event: PointerEvent, b: EBuilding) { if (this.tool() !== 'select') return; this.capture(event); this.select({ type: 'building', key: b.id }); this.drag = { kind: 'rotate', key: b.id }; }
  grabAmenity(event: PointerEvent, a: EAmenity) { if (this.tool() !== 'select') return; this.capture(event); this.select({ type: 'amenity', key: a.key }); this.drag = { kind: 'amenity', key: a.key, start: this.point(event), at: this.toPx(a.position!.x, a.position!.z) }; }
  grabLot(event: PointerEvent, lot: ELot) { if (this.tool() !== 'select') return; this.capture(event); this.select({ type: 'lot', key: lot.key }); this.drag = { kind: 'lot', key: lot.key, start: this.point(event), points: lot.points }; }
  grabVertex(event: PointerEvent, target: 'lot' | 'outline', k: string, index: number) {
    this.capture(event);
    if (event.altKey) { this.setPoints(target, k, (points) => (points.length > 3 ? points.filter((_, i) => i !== index) : points)); this.dirty.set(true); return; }
    this.drag = { kind: 'vertex', target, key: k, index };
  }
  grabMid(event: PointerEvent, target: 'lot' | 'outline', k: string, index: number) {
    this.capture(event);
    this.setPoints(target, k, (points) => [...points.slice(0, index + 1), this.mid(points, index), ...points.slice(index + 1)]);
    this.drag = { kind: 'vertex', target, key: k, index: index + 1 }; this.dirty.set(true);
  }
  private setPoints(target: 'lot' | 'outline', k: string, change: (points: Point[]) => Point[]) {
    if (target === 'outline') this.layout.update((l) => ({ ...l!, lot: change(l!.lot ?? []) }));
    else this.lots.update((lots) => lots.map((l) => (l.key === k ? { ...l, points: change(l.points) } : l)));
  }

  finishDraft() {
    const draft = this.draft(); if (draft.length < 3) return;
    if (this.tool() === 'outline') { this.layout.update((l) => ({ ...l!, lot: draft.map(([x, y]) => [Math.round(x), Math.round(y)] as Point) })); this.setTool('select'); this.select({ type: 'outline' }); }
    else {
      const used = new Set(this.lots().map((l) => l.name)); let n = this.lots().length + 1; while (used.has(String(n))) n++;
      const lot: ELot = { key: key(), name: String(n), points: draft, unitId: null };
      this.lots.update((lots) => [...lots, lot]);
      this.draft.set([]); this.hover.set(null);
      this.selected.set({ type: 'lot', key: lot.key }); this.tab.set('item');
    }
    this.dirty.set(true);
  }

  @HostListener('document:keydown', ['$event'])
  key(event: KeyboardEvent) {
    if ((event.target as HTMLElement).closest('input, select, textarea')) return;
    if (event.key === 'Escape') { if (this.draft().length) this.draft.set([]); else { this.setTool('select'); this.selected.set(null); } }
    if (event.key === 'Enter') this.finishDraft();
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selLot()) { event.preventDefault(); this.removeLot(this.selLot()!.key); }
  }

  // Edição dos objetos.
  placeBuilding(id: string, change: Partial<{ x: number; z: number; rotation: number }>) {
    this.buildings.update((list) => list.map((b) => (b.id === id ? { ...b, position: { x: 0, z: 0, rotation: 0, ...b.position, ...change } } : b))); this.dirty.set(true);
  }
  sizeBuilding(id: string, change: { width?: number; depth?: number }) {
    this.buildings.update((list) => list.map((b) => (b.id === id ? { ...b, model3d: { ...b.model3d, ...change } } : b))); this.dirty.set(true);
  }
  editAmenity(k: string, change: Partial<EAmenity>) { this.amenities.update((list) => list.map((a) => (a.key === k ? { ...a, ...change } : a))); this.dirty.set(true); }
  editLot(k: string, change: Partial<ELot>) { this.lots.update((list) => list.map((l) => (l.key === k ? { ...l, ...change } : l))); this.dirty.set(true); }
  removeLot(k: string) { this.lots.update((list) => list.filter((l) => l.key !== k)); this.selected.set(null); this.dirty.set(true); }
  focusBuilding(b: EBuilding) { if (!b.position) this.placeBuilding(b.id, this.centerM()); this.select({ type: 'building', key: b.id }); }
  focusAmenity(a: EAmenity) { if (!a.position) { const c = this.centerM(); this.editAmenity(a.key, { position: c }); } this.select({ type: 'amenity', key: a.key }); }
  addAmenity() {
    const marker = Math.max(0, ...this.amenities().map((a) => a.marker ?? 0)) + 1;
    const a: EAmenity = { key: key(), name: this.newAmenity().trim(), marker, position: this.centerM() };
    this.amenities.update((list) => [...list, a]); this.newAmenity.set(''); this.select({ type: 'amenity', key: a.key }); this.dirty.set(true);
  }
  private centerM() { const b = this.box(); const [x, z] = this.toM([b.x + b.w / 2, b.y + b.h / 2]); return { x, z }; }

  /** Muda escala/referência/azimute preservando o lugar de torres e marcadores na arte. */
  recalibrate(change: Partial<Layout>) {
    const before = this.layout()!; const next = { ...before, ...change };
    if (!(next.metersPerPixel > 0)) return;
    const keep = (x: number, z: number) => this.toM([x / before.metersPerPixel + before.origin[0], z / before.metersPerPixel + before.origin[1]], next);
    this.buildings.update((list) => list.map((b) => (b.position ? { ...b, position: { ...b.position, ...(([x, z]) => ({ x, z }))(keep(b.position.x, b.position.z)) } } : b)));
    this.amenities.update((list) => list.map((a) => (a.position ? { ...a, position: (([x, z]) => ({ x, z }))(keep(a.position.x, a.position.z)) } : a)));
    this.layout.set(next); this.dirty.set(true);
  }
  applyMeasure() { const meters = +this.realDistance(); if (meters > 0 && this.measurePx() > 0) { this.recalibrate({ metersPerPixel: Math.round((meters / this.measurePx()) * 100000) / 100000 }); this.measure.set([]); this.realDistance.set(''); this.setTool('select'); } }

  // Unidades dos lotes (operações imediatas, com histórico no servidor).
  private async run(task: () => Promise<string>) {
    this.busy.set(true); this.error.set(null); this.message.set(null);
    try { this.message.set(await task()); } catch (error) { this.error.set(errorMessage(error)); } finally { this.busy.set(false); }
  }

  createUnit(lot: ELot) {
    void this.run(async () => {
      let quadraId = this.quadraId();
      if (!quadraId) {
        const name = this.newQuadra().trim() || `Quadra ${String.fromCharCode(65 + this.quadras().length)}`;
        const code = `Q-${name.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '').toUpperCase().slice(0, 30) || this.quadras().length + 1}`;
        const created = await this.api.post<EBuilding>(`/developments/${this.id()}/buildings`, { name, code, sortOrder: 100 + this.quadras().length, model3d: { kind: QUADRA } });
        this.buildings.update((list) => [...list, { ...created, _count: { units: 0 } }]); this.quadraId.set(created.id); this.newQuadra.set(''); quadraId = created.id;
      }
      const area = this.drawnArea(lot.points);
      const unit = await this.api.post<EUnit>(`/buildings/${quadraId}/units`, { number: lot.name.slice(0, 20), privateArea: area, totalArea: area });
      this.units.update((list) => [...list, { ...unit, privateArea: area, totalArea: area, floor: null }]);
      this.editLot(lot.key, { unitId: unit.id });
      return `Lote ${unit.number} criado e vinculado. Salve a implantação para gravar o desenho.`;
    });
  }

  changeStatus(u: EUnit, status: string) {
    void this.run(async () => {
      await this.api.put(`/units/${u.id}/status`, { status, reason: 'Editor de implantação' });
      this.units.update((list) => list.map((x) => (x.id === u.id ? { ...x, status: status as UnitStatus } : x)));
      return `Status do lote ${u.number} atualizado.`;
    });
  }
  changeArea(u: EUnit, area: number) {
    void this.run(async () => {
      await this.api.patch(`/units/${u.id}`, { privateArea: area, totalArea: area });
      this.units.update((list) => list.map((x) => (x.id === u.id ? { ...x, privateArea: area, totalArea: area } : x)));
      return `Área do lote ${u.number} atualizada.`;
    });
  }

  /** Liga lotes sem vínculo à unidade de mesmo número (na quadra escolhida ou em qualquer quadra). */
  autoLink() {
    const used = new Set(this.lots().map((l) => l.unitId).filter(Boolean));
    const pool = this.units().filter((u) => !used.has(u.id) && (!this.quadraId() || u.buildingId === this.quadraId()));
    let n = 0;
    this.lots.update((list) => list.map((lot) => {
      if (lot.unitId) return lot;
      const u = pool.find((x) => !used.has(x.id) && x.number.toLowerCase() === lot.name.trim().toLowerCase());
      if (!u) return lot;
      used.add(u.id); n++; return { ...lot, unitId: u.id };
    }));
    if (n) this.dirty.set(true);
    this.message.set(n ? `${n} lotes vinculados. Salve a implantação para gravar.` : 'Nenhum lote sem vínculo com número correspondente.');
  }

  save() {
    const l = this.layout(); if (!l) return;
    void this.run(async () => {
      const d = await this.api.put<EditorData>(`/developments/${this.id()}/implantation`, {
        layout: l, latitude: this.lat(), longitude: this.lng(),
        buildings: this.towers().filter((b) => b.position).map((b) => ({ id: b.id, position: b.position, width: b.model3d?.width, depth: b.model3d?.depth })),
        amenities: this.amenities().map((a) => ({ id: a.id, name: a.name, marker: a.marker, position: a.position })),
        lots: this.lots().map((lot) => ({ id: lot.id, name: lot.name, points: lot.points, unitId: lot.unitId })),
      });
      const selected = this.selected(); const selectedLot = selected?.type === 'lot' ? this.lots().findIndex((x) => x.key === selected.key) : -1;
      this.data.set(d); this.layout.set(d.layout); this.buildings.set(d.buildings); this.units.set(d.units);
      this.amenities.set(d.amenities.map((a) => ({ ...a, key: a.id! })));
      this.lots.set(d.lots.map((x) => ({ ...x, key: key() })));
      this.selected.set(selectedLot >= 0 && this.lots()[selectedLot] ? { type: 'lot', key: this.lots()[selectedLot].key } : selected?.type === 'lot' ? null : selected);
      this.dirty.set(false);
      return 'Implantação salva.';
    });
  }

  // Modelo GLB: nós x unidades.
  async loadModel(versionId: string) {
    this.modelId.set(versionId); this.nodes.set([]); this.links.set({}); this.node.set(null);
    if (!versionId) return;
    const model = this.data()!.models.find((m) => m.id === versionId)!;
    try {
      const [buffer, saved] = await Promise.all([this.file(model.assetId).then((b) => b.arrayBuffer()), this.api.get<{ links: { node: string; unitId: string }[] }>(`/developments/${this.id()}/models/${versionId}/links`)]);
      this.nodes.set(glbNodes(buffer));
      this.links.set(Object.fromEntries(saved.links.map((l) => [l.node, l.unitId])));
    } catch (error) { this.error.set(errorMessage(error)); }
  }
  nodeUnitLabel(name: string) { const u = this.unitsById().get(this.links()[name]); return u ? `${this.buildings().find((b) => b.id === u.buildingId)?.name ?? ''} · ${u.number}` : '—'; }
  linkNode(name: string, unitId: string) { this.links.update((links) => { const next = { ...links }; if (unitId) next[name] = unitId; else delete next[name]; return next; }); }
  /** Sugere vínculos quando o nome do nó traz o número da unidade (ex.: "T1_Apto_101" → torre T1, unidade 101). */
  autoLinkNodes() {
    const links = { ...this.links() }; let n = 0;
    for (const node of this.nodes()) {
      if (links[node.name]) continue;
      const tokens = node.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const candidates = this.units().filter((u) => tokens.includes(u.number.toLowerCase()));
      const building = (u: EUnit) => this.buildings().find((b) => b.id === u.buildingId);
      const match = candidates.length === 1 ? candidates[0] : candidates.find((u) => tokens.includes(building(u)?.code.toLowerCase() ?? '\0'));
      if (match && !Object.values(links).includes(match.id)) { links[node.name] = match.id; n++; }
    }
    this.links.set(links); this.message.set(n ? `${n} vínculos sugeridos. Confira e salve.` : 'Nenhum nó com número de unidade reconhecível.');
  }
  saveLinks() {
    void this.run(async () => {
      const r = await this.api.put<{ links: { node: string; unitId: string }[] }>(`/developments/${this.id()}/models/${this.modelId()}/links`, { links: Object.entries(this.links()).map(([node, unitId]) => ({ node, unitId })) });
      return `${r.links.length} vínculos do modelo salvos.`;
    });
  }
}
