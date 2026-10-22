import './styles.css';
import { api } from './api';
import { Vector3, type AbstractMesh } from './scene/babylon';
import { World } from './scene/world';
import { Library } from './scene/library';
import { buildSite, type SiteResult } from './scene/site';
import { buildSurroundings } from './scene/surroundings';
import { InteriorViewer } from './scene/interior';
import { bindTowerHover } from './scene/hover';
import { defaultSlots, type TowerObject } from './scene/tower';
import { qualityLevels, qualityOrder, type QualityLevel } from './scene/quality';
import type { Development, FloorPlan, Point, Unit, UnitStatus } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const statusLabel: Record<UnitStatus, string> = { AVAILABLE: 'Disponível', RESERVED: 'Reservada', SOLD: 'Vendida', BLOCKED: 'Bloqueada', UNAVAILABLE: 'Indisponível' };
const floorName = (n: number) => (n === 0 ? 'Térreo' : `${n}º andar`);
const area = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m²`);
const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const slug = new URLSearchParams(location.search).get('empreendimento') ?? (location.pathname.split('/').filter(Boolean)[0] || 'union-vista');

interface State { tower: TowerObject | null; floor: number | null; unit: Unit | null; amenities: boolean }
const state: State = { tower: null, floor: null, unit: null, amenities: false };
let dev: Development; let site: SiteResult; let world: World;
const towerLabels = new Map<string, HTMLButtonElement>();
const amenityLabels: HTMLElement[] = [];
let floorLabel: { element: HTMLElement; remove: () => void } | null = null;
/** Rótulos com o número de cada apartamento do andar escolhido. */
let unitLabels: { unitId: string; element: HTMLElement; remove: () => void }[] = [];
let touring = false;
let hover: { clear: () => void } | null = null;

const available = (units: Unit[]) => units.filter((u) => u.status === 'AVAILABLE').length;
const planOf = (unit: Unit): FloorPlan | undefined => dev.floorPlans.find((p) => p.id === unit.floorPlanId);
/** Centro (mundo) do conjunto do empreendimento, na altura pedida. */
const siteCenter = (y: number) => { const { min, max } = site.group.getHierarchyBoundingVectors(); return new Vector3((min.x + max.x) / 2, y, (min.z + max.z) / 2); };

async function start() {
  try {
    dev = await api.development(slug);
  } catch (error) {
    $('loading-text').textContent = error instanceof Error ? error.message : 'Empreendimento indisponível';
    return;
  }
  document.title = `${dev.name} · explorar em 3D`;
  if (dev.theme?.primaryColor) document.documentElement.style.setProperty('--accent', dev.theme.primaryColor);
  if (dev.theme?.secondaryColor) document.documentElement.style.setProperty('--dark', dev.theme.secondaryColor);

  world = await World.create($('stage'), $('labels'));
  // Biblioteca do Blender (céu HDR, texturas PBR, vegetação e carros); sem ela, a cena usa a geometria gerada aqui.
  const library = await Library.load(world.scene);
  if (library) world.useLibrary(library);
  const siteImage = dev.viewer.layout?.siteImageAssetId ? api.assetUrl(dev.viewer.layout.siteImageAssetId) : null;
  const towerModels = new Map(dev.buildings.filter((b) => b.model3d?.glb?.assetId).map((b) => [b.id, api.assetUrl(b.model3d!.glb!.assetId)] as const));
  site = buildSite(world.scene, dev, siteImage, library, towerModels);
  world.onDusk((t) => { for (const tower of site.towers) tower.setDusk(t); });
  // A câmera não entra nas torres: a aproximação para na fachada (na janela).
  for (const tower of site.towers) world.addObstacle(tower.group, () => tower.solids());
  world.onInteract(() => { touring = false; });

  renderChrome();
  createLabels();
  bindPicking();
  hover = bindTowerHover(world, site.towers, () => state.tower);
  bindCompass();
  const inspect: { world: World; site: SiteResult; readyAt?: number } = { world, site };
  // Inspeção no navegador: no desenvolvimento e, em produção, com ?medir (scripts/bench/viewer-bench.mjs).
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('medir')) Object.assign(window, { __vista: inspect });
  overview(0.01);

  $('loading-text').textContent = 'Carregando o entorno real (OpenStreetMap)';
  const renderer = world.webgpu ? 'WebGPU' : 'WebGL2';
  try {
    const surroundings = await api.surroundings(slug);
    const result = buildSurroundings(world.scene, surroundings, site.lotWorld, qualityLevels[world.quality].trees);
    // Entorno é estático: matrizes congeladas (menos trabalho por quadro).
    for (const mesh of result.group.getChildMeshes()) mesh.freezeWorldMatrix();
    const own = new Set(site.roadAnchors.map((r) => r.name.split(',')[0].toLowerCase()));
    for (const road of result.roadLabels) {
      if ([...own].some((name) => road.name.toLowerCase().includes(name.replace('av. ', 'avenida ')))) continue;
      const element = document.createElement('div'); element.className = 'label road major'; element.textContent = road.name;
      world.addLabel(element, road.position, { maxDistance: 1400 });
    }
    $('sources').innerHTML = `Entorno real <em>OSM</em>${result.illustrativeHouses ? ' <em class="dashed">casas ilustrativas</em>' : ''} <em title="Motor de renderização">${renderer}</em>`;
  } catch {
    $('sources').innerHTML = `Entorno indisponível no momento <em>${renderer}</em>`;
  }
  await site.ready;
  // Marca de tempo para as medições de carregamento (scripts/bench/viewer-bench.mjs).
  inspect.readyAt = performance.now();
  $('loading').style.opacity = '0';
  setTimeout(() => $('loading').remove(), 500);
  if (dev.viewer.lighting?.mode === 'sunset') setMode('sunset');
}

function renderChrome() {
  $('brand').innerHTML = `<span class="logo">${esc(dev.name)}</span><span class="place">${esc(dev.address?.split(' - ')[1] ?? dev.address ?? '')}<small>${esc(dev.city ?? '')}${dev.state ? ` · ${esc(dev.state)}` : ''}</small></span>`;
  $('actions').innerHTML = `
    <div class="card group"><button class="btn on" data-mode="day">☀ Dia</button><button class="btn" data-mode="sunset">◒ Pôr do sol</button></div>
    ${dev.amenities.length ? '<button class="btn card accent" id="btn-amenities">⌖ Lazer</button>' : ''}
    <button class="btn card" id="btn-tour">▷ Tour guiado</button>
    <button class="btn card" id="btn-about">ⓘ Sobre o empreendimento</button>`;
  $('actions').querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as 'day' | 'sunset')));
  document.getElementById('btn-amenities')?.addEventListener('click', () => toggleAmenities());
  $('btn-tour').addEventListener('click', () => void tour());
  $('btn-about').addEventListener('click', () => about());
  renderTowerBar();
  renderViews();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') back(); });
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
}

/** Vistas predefinidas a partir da orientação da implantação (frente = lado de baixo da arte). */
function renderViews() {
  const views: [string, string, () => void][] = [
    ['◱', 'Aérea', () => void overview()],
    ['▭', 'Frente', () => presetView(0, 72)],
    ['▯', 'Lateral', () => presetView(90, 72)],
    ['▢', 'Fundos', () => presetView(180, 72)],
    ['⊡', 'Topo', () => presetView(0, 2, 420)],
    // Trajetos cinematográficos (spline suave, velocidade de cruzeiro); arrastar ou rolar interrompe.
    ['◎', 'Voo 360°', () => void cinematic('orbit')],
    ['➚', 'Chegada', () => void cinematic('arrival')],
    ['⤳', 'Sobrevoo', () => void cinematic('flyover')],
  ];
  const el = $('views');
  el.classList.toggle('collapsed', viewsCollapsed);
  el.innerHTML = `<button id="views-toggle" title="Mostrar ou recolher as vistas">${viewsCollapsed ? '▸' : '▾'}<span class="t">Vistas</span></button>${views.map(([icon, label], i) => `<button data-i="${i}" title="Vista ${label.toLowerCase()}">${icon}<span class="t">${label}</span></button>`).join('')}<hr>
    <button id="numbers" title="Mostrar ou ocultar os números do lazer">①<span class="t">${numbersVisible ? 'Ocultar números' : 'Mostrar números'}</span></button>
    <button id="fullscreen" title="Tela cheia">⛶<span class="t">Tela cheia</span></button>
    <label class="quality" title="Qualidade gráfica (sombras, oclusão, antisserrilhado e resolução)">◆<span class="t">Qualidade</span>
      <select id="quality">${qualityOrder.map((q) => `<option value="${q}" ${q === world.quality ? 'selected' : ''}>${qualityLevels[q].label}</option>`).join('')}</select></label>`;
  el.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => b.addEventListener('click', () => { touring = false; back(true); views[Number(b.dataset.i)][2](); }));
  $('views-toggle').addEventListener('click', () => {
    viewsCollapsed = !viewsCollapsed; el.classList.toggle('collapsed', viewsCollapsed);
    $('views-toggle').firstChild!.textContent = viewsCollapsed ? '▸' : '▾';
    try { localStorage.setItem('vistahub.views', viewsCollapsed ? 'closed' : 'open'); } catch { /* sem armazenamento */ }
  });
  $('numbers').addEventListener('click', () => setNumbers(!numbersVisible));
  $('fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => { $('fullscreen').innerHTML = document.fullscreenElement ? '⤢<span class="t">Sair da tela cheia</span>' : '⛶<span class="t">Tela cheia</span>'; });
  const select = $<HTMLSelectElement>('quality');
  select.addEventListener('change', () => world.setQuality(select.value as QualityLevel));
  world.onQualityChange((level) => { select.value = level; });
}

// Recolhido por padrão (a maquete ocupa a tela); abre só se o visitante deixou aberto da última vez.
let viewsCollapsed = (() => { try { return localStorage.getItem('vistahub.views') !== 'open'; } catch { return true; } })();

/** Bússola: a agulha aponta para o norte real (-z no mapa) conforme a câmera gira; clique alinha o norte para cima. */
function bindCompass() {
  const needle = document.getElementById('compass-needle'); if (!needle) return;
  world.onTick(() => {
    const dir = world.target.subtract(world.cameraPosition);
    const heading = Math.atan2(dir.x, -dir.z); // 0 = olhando para o norte
    needle.style.transform = `rotate(${(-heading * 180) / Math.PI}deg)`;
  });
  $('compass').addEventListener('click', () => {
    touring = false;
    const target = world.target.clone(); const offset = world.cameraPosition.subtract(target);
    const flat = Math.hypot(offset.x, offset.z);
    void world.flyTo(target.add(new Vector3(0, offset.y, flat)), target, 1.2);
  });
}

/** Números dos marcadores de lazer na maquete: o visitante escolhe mostrar ou ocultar (lembrado neste navegador). */
let numbersVisible = (() => { try { return localStorage.getItem('vistahub.numbers') !== 'off'; } catch { return true; } })();
function setNumbers(visible: boolean) {
  numbersVisible = visible;
  try { localStorage.setItem('vistahub.numbers', visible ? 'on' : 'off'); } catch { /* sem armazenamento */ }
  for (const label of amenityLabels) label.classList.toggle('hidden-num', !visible);
  const button = document.getElementById('numbers');
  if (button) { button.classList.toggle('off', !visible); button.querySelector('.t')!.textContent = visible ? 'Ocultar números' : 'Mostrar números'; }
}

/** Ponto a distance m do centro do conjunto, na direção offsetDeg a partir da frente da implantação, na altura y. */
function around(offsetDeg: number, distance: number, y: number) {
  const bearing = (dev.viewer.layout?.azimuth ?? 0) + 180 + offsetDeg;
  const az = ((180 - bearing) * Math.PI) / 180; const c = siteCenter(0);
  return new Vector3(c.x + Math.sin(az) * distance, y, c.z + Math.cos(az) * distance);
}

/**
 * Câmeras cinematográficas: volta completa em volta do conjunto, chegada rasante pela frente subindo até a
 * vista aérea, e sobrevoo dos fundos para a frente passando por cima das torres.
 */
async function cinematic(kind: 'orbit' | 'arrival' | 'flyover') {
  touring = false; back(true);
  const center = siteCenter(14);
  if (kind === 'orbit') {
    const keys = Array.from({ length: 13 }, (_, i) => ({ position: around(i * 30 - 20, 230 + 30 * Math.sin(i * 0.9), 95 + 25 * Math.cos(i * 0.7)), target: center }));
    await world.flyPath(keys, 28);
  } else if (kind === 'arrival') {
    await world.flyPath([
      { position: around(-8, 430, 15), target: siteCenter(18) },
      { position: around(-3, 260, 16), target: siteCenter(20) },
      { position: around(4, 150, 38), target: siteCenter(16) },
      { position: around(14, 210, 120), target: siteCenter(8) },
    ], 15);
  } else {
    await world.flyPath([
      { position: around(180, 280, 150), target: center },
      { position: around(170, 90, 115), target: around(0, 40, 10) },
      { position: around(10, 60, 95), target: around(0, 200, 0) },
      { position: around(25, 260, 70), target: center },
    ], 16);
  }
}

function presetView(offsetDeg: number, polar: number, distance = 300) {
  // Direção "frente" no mapa: para onde aponta a parte de baixo da implantação (azimute + 180°).
  const bearing = (dev.viewer.layout?.azimuth ?? 0) + 180 + offsetDeg;
  void world.frame3(siteCenter(15), distance, polar, 180 - bearing);
}

function setMode(mode: 'day' | 'sunset') {
  world.setMode(mode);
  $('actions').querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
}

function renderTowerBar() {
  $('tower-bar').innerHTML = site.towers.map((t) => `<button data-id="${t.building.id}" class="${state.tower === t ? 'on' : ''}"><b>${esc(t.building.name)}</b><small>${available(t.building.units)} disponíveis</small></button>`).join('');
  $('tower-bar').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => selectTower(site.towers.find((t) => t.building.id === b.dataset.id)!)));
}

function createLabels() {
  site.towers.forEach((tower, index) => {
    const label = document.createElement('button');
    label.className = 'label tower';
    label.innerHTML = `<span class="num">${index + 1}</span>${esc(tower.building.name)}`;
    label.addEventListener('click', () => selectTower(tower));
    world.addLabel(label, tower.top);
    towerLabels.set(tower.building.id, label);
  });
  for (const amenity of dev.amenities) {
    const anchor = site.amenityAnchors.get(amenity.id); if (!anchor || amenity.marker == null) continue;
    const label = document.createElement('button');
    label.className = 'label amenity num'; label.title = amenity.name; label.textContent = String(amenity.marker);
    label.addEventListener('click', () => showAmenity(amenity.id));
    world.addLabel(label, anchor, { maxDistance: 900 });
    amenityLabels.push(label);
    if (!numbersVisible) label.classList.add('hidden-num');
  }
  for (const road of site.roadAnchors) {
    const element = document.createElement('div'); element.className = 'label road'; element.textContent = road.name;
    world.addLabel(element, road.position, { maxDistance: 700 });
  }
}

function bindPicking() {
  let down: { x: number; y: number } | null = null;
  const canvas = world.canvas;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) return;
    // Com a torre aberta e os apartamentos à mostra, a caixa da torre sai da frente para os volumes serem clicáveis.
    const targets = new Set<AbstractMesh>(site.towers.flatMap((t) => t.pickables.filter((m, i) => (i === 0 ? !(t === state.tower && unitsShown(t)) : m.isEnabled()))));
    const hit = world.pick(e, (mesh) => targets.has(mesh));
    if (!hit?.hit || !hit.pickedMesh) return;
    const { unitId, buildingId } = hit.pickedMesh.metadata as { unitId?: string; buildingId: string };
    const tower = site.towers.find((t) => t.building.id === buildingId)!;
    if (unitId && state.tower === tower) { const unit = tower.building.units.find((u) => u.id === unitId)!; selectFloor(unit.floor ?? 0, false); selectUnit(unit); }
    else if (state.tower !== tower) selectTower(tower);
  });
}
const unitsShown = (tower: TowerObject) => [...tower.unitMeshes.values()].some((m) => m.isEnabled());

function overview(duration = 1.8) {
  const camera = dev.viewer.camera ?? {};
  return world.frame3(siteCenter(10), camera.distance ?? 320, camera.polar ?? 58, camera.azimuth ?? 35, duration);
}

function selectTower(tower: TowerObject) {
  hover?.clear();
  if (state.tower && state.tower !== tower) { state.tower.setUnitsVisible(false); state.tower.setFloorHighlight(null); state.tower.setHover(false); }
  tower.setHover(true); // a torre escolhida fica marcada
  tower.setSelectedUnit(null);
  state.tower = tower; state.floor = null; state.unit = null;
  clearUnitLabels();
  hideAmenities();
  towerLabels.forEach((label, id) => label.classList.toggle('on', id === tower.building.id));
  renderTowerBar();
  $('hint').classList.add('hidden');
  $('unit-panel').classList.add('hidden'); $('mirror-panel').classList.add('hidden');
  const b = tower.building; const plans = [...new Set(b.units.map((u) => u.floorPlanId))].map((id) => dev.floorPlans.find((p) => p.id === id)).filter(Boolean) as FloorPlan[];
  const typical = plans.filter((p) => !/garden/i.test(p.name));
  const areas = [...new Set(typical.map((p) => p.area).filter((a) => a != null))].sort((x, y) => x! - y!);
  const floors = b.floorCount ?? b.floors.length;
  const panel = $('tower-panel');
  panel.innerHTML = `<button class="close" aria-label="Fechar">×</button>
    <div class="eyebrow">Torre selecionada</div><h2>${esc(b.name)}</h2>
    <div class="facts">
      <div><small>Pavimentos</small><b>${floors}</b><br><small>térreo + ${floors - 1} andares</small></div>
      <div><small>Por andar</small><b>${b.unitsPerFloor ?? '—'} apartamentos</b></div>
      <div><small>Elevadores</small><b>${b.model3d?.elevators ?? '—'}</b></div>
      <div><small>Tipologia</small><b>${areas.map((a) => a!.toLocaleString('pt-BR')).join(' e ')} m²</b><br><small>${typical[0]?.bedrooms ?? ''} quartos${typical[0]?.suites ? `, ${typical[0].suites} suíte` : ''}</small></div>
    </div>
    <div class="avail"><b>${available(b.units)}</b> de ${b.units.length} disponíveis</div>
    <button class="btn primary" id="see-units">Ver apartamentos</button>`;
  panel.classList.remove('hidden');
  panel.querySelector('.close')!.addEventListener('click', () => back(true));
  panel.querySelector('#see-units')!.addEventListener('click', () => openMirror());
  renderCrumbs();
  void world.frame3(tower.center, tower.height * 2.4 + 60, 62);
}

function openMirror() {
  const tower = state.tower!;
  // Recolhe as vistas ao lado dos paineis comerciais, sem mudar a preferencia salva do visitante.
  viewsCollapsed=true;$('views').classList.add('collapsed');$('views-toggle').firstChild!.textContent='▸';
  $('tower-panel').classList.add('hidden');
  tower.setUnitsVisible(true, state.floor);
  renderMirror();
  $('mirror-panel').classList.remove('hidden');
  renderCrumbs();
}

function renderMirror() {
  const b = state.tower!.building;
  const finals = [...new Set(b.units.map((u) => u.final ?? ''))].sort();
  const floors = [...new Set(b.units.map((u) => u.floor ?? 0))].sort((x, y) => y - x);
  const byKey = new Map(b.units.map((u) => [`${u.floor}|${u.final}`, u] as const));
  $('mirror-panel').innerHTML = `<h3>${esc(b.name)}</h3><div class="eyebrow">${state.unit ? 'Troque de andar ou de apartamento' : 'Escolha um andar ou um apartamento'}</div>
    <div class="avail" style="margin:10px 0 0"><b>${available(b.units)}</b> de ${b.units.length} disponíveis</div>
    <div class="mirror" style="--cols:${finals.length}">
      ${floors.map((f) => `<div class="row ${state.floor === f ? 'on' : ''}" data-floor="${f}"><span>${f === 0 ? 'Térreo' : `${f}º`}</span>${finals.map((fin) => { const u = byKey.get(`${f}|${fin}`); return u ? `<button class="cell ${u.status} ${state.unit?.id === u.id ? 'sel' : ''}" data-unit="${u.id}" title="Apto ${esc(u.number)} · ${statusLabel[u.status]}"></button>` : '<span></span>'; }).join('')}</div>`).join('')}
      <div class="row finals"><span></span>${finals.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
    </div>
    <div class="legend"><span><i style="background:var(--available)"></i>Disponível</span><span><i style="background:var(--reserved)"></i>Reservada</span><span><i style="background:var(--sold)"></i>Vendida</span></div>`;
  $('mirror-panel').querySelectorAll<HTMLElement>('.row[data-floor]').forEach((row) => {
    const floor = Number(row.dataset.floor);
    row.addEventListener('mouseenter', () => { if (state.floor == null) previewFloor(floor); });
    row.addEventListener('mouseleave', () => { if (state.floor == null) previewFloor(null); });
    row.querySelector('span')!.addEventListener('click', () => selectFloor(floor));
  });
  $('mirror-panel').querySelectorAll<HTMLButtonElement>('.cell').forEach((cell) => cell.addEventListener('click', (e) => {
    e.stopPropagation();
    const unit = state.tower!.building.units.find((u) => u.id === cell.dataset.unit)!;
    selectFloor(unit.floor ?? 0, false); selectUnit(unit);
  }));
  $('mirror-panel').querySelector('.row.on')?.scrollIntoView({ block: 'nearest' });
}

function previewFloor(floor: number | null) {
  const tower = state.tower!; tower.setFloorHighlight(floor);
  floorLabel?.remove(); floorLabel = null;
  if (floor == null) return;
  const units = tower.building.units.filter((u) => u.floor === floor);
  const element = document.createElement('div'); element.className = 'label floor';
  element.innerHTML = `${floorName(floor)}<small>${available(units)} disponíveis</small>`;
  const h = tower.building.floorHeight ?? 2.9;
  const position = Vector3.TransformCoordinates(new Vector3((tower.building.model3d?.width ?? 30) / 2 + 2, floor * h + h, 0), tower.group.getWorldMatrix());
  floorLabel = { element, remove: world.addLabel(element, position) };
}

function clearUnitLabels() {
  for (const label of unitLabels) label.remove(); unitLabels = [];
  towerLabels.forEach((label) => label.classList.remove('hidden'));
}

/** Número de cada apartamento flutuando sobre o seu volume, na cor do status (o escolhido em destaque). */
function renderUnitLabels() {
  clearUnitLabels();
  const tower = state.tower; if (!tower || state.floor == null) return;
  // O nome da torre ficaria em cima dos números do andar cortado.
  towerLabels.get(tower.building.id)?.classList.add('hidden');
  for (const unit of tower.building.units.filter((u) => u.floor === state.floor)) {
    const position = tower.unitTop(unit.id); if (!position) continue;
    const element = document.createElement('button');
    element.className = `label unit ${unit.status}${state.unit?.id === unit.id ? ' on' : ''}`;
    element.textContent = unit.number; element.title = `Apto ${unit.number} · ${statusLabel[unit.status]}`;
    element.addEventListener('click', () => selectUnit(unit));
    unitLabels.push({ unitId: unit.id, element, remove: world.addLabel(element, position) });
  }
}

function selectFloor(floor: number, fly = true) {
  const tower = state.tower!;
  const changed = state.floor !== floor;
  if(changed){state.unit=null;tower.setSelectedUnit(null);$('unit-panel').classList.add('hidden');}
  state.floor = floor; previewFloor(null); tower.setFloorHighlight(null);
  tower.setUnitsVisible(true, floor);
  renderMirror(); renderCrumbs();
  if (changed || !unitLabels.length) renderUnitLabels();
  if (fly) {
    const h = tower.building.floorHeight ?? 2.9;
    const target = Vector3.TransformCoordinates(new Vector3(0, floor * h, 0), tower.group.getWorldMatrix());
    void world.frame3(target, 110, 50);
  }
}

/** Área das varandas da planta (cômodos do tipo varanda na planta vetorizada), quando cadastrada. */
function balconyArea(plan: FloorPlan | undefined) {
  const rooms = plan?.layout?.rooms.filter((r) => r.kind === 'balcony') ?? [];
  if (!rooms.length) return null;
  const polygonArea = (pts: Point[]) => Math.abs(pts.reduce((s, [x1, y1], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x1 * y2 - x2 * y1; }, 0)) / 2;
  return rooms.reduce((sum, r) => sum + polygonArea(r.points), 0);
}

/**
 * Posição do apartamento na torre: planta de cobertura (lâminas e núcleo, a partir do model3d) com os
 * apartamentos do andar e o escolhido em laranja, seta do norte real e a pilha de pavimentos ao lado.
 */
function positionHtml(tower: TowerObject, unit: Unit) {
  const b = tower.building; const model = b.model3d ?? { width: 32, depth: 16 };
  const slots = model.unitSlots?.length ? model.unitSlots : defaultSlots;
  const columns = Math.max(...slots.map((s) => s.column)) + 1;
  const W = model.width, D = model.depth; const coreW = Math.min(4.2, W * 0.12);
  const scale = 150 / Math.max(W, D * 1.6); const w = W * scale, d = D * scale; const pad = 14;
  const X = (x: number) => pad + (x + W / 2) * scale; const Z = (z: number) => pad + (z + D / 2) * scale;
  const floorUnits = new Map(b.units.filter((u) => u.floor === unit.floor).map((u) => [u.final ?? '', u] as const));
  const colW = (W-coreW) / columns;
  let facingArrow='';
  const cells = slots.map((slot) => {
    const u = floorUnits.get(slot.final); const x0 = -W / 2 + colW * slot.column+(slot.column>=columns/2?coreW:0); const z0 = slot.side === 'front' ? -D / 2 : 0;
    const selected = u?.id === unit.id;
    if(selected){const x=X(x0+colW/2),z=Z(slot.side==='front'?-D/2:D/2),direction=slot.side==='front'?-1:1;facingArrow=`<path d="M${x} ${z+direction*3} v${direction*20}" stroke="#cc743f" stroke-width="2"/><path d="M${x} ${z+direction*27} l-4 ${-direction*8} h8 Z" fill="#cc743f"/>`;}
    return `<rect x="${X(x0) + 1}" y="${Z(z0) + 1}" width="${colW * scale - 2}" height="${(D / 2) * scale - 2}" fill="${selected ? '#d27c47' : '#fff'}" stroke="${selected?'#c16a37':'#aaa8b0'}" stroke-width=".8"><title>${esc(u?.number ?? slot.final)}</title></rect>`;
  }).join('');
  // Norte no referencial da torre: desfaz o giro do terreno (azimute) e o da torre.
  const turn = (((dev.viewer.layout?.azimuth ?? 0) + (b.position?.rotation ?? 0)) * Math.PI) / 180;
  const plan = `<svg viewBox="0 0 235 150" width="235" height="150" class="tower-plan" aria-label="Posição do apartamento ${esc(unit.number)}; seta laranja indica a fachada; norte para cima">
    <g transform="translate(98 78) rotate(${turn*180/Math.PI}) translate(${-pad-w/2} ${-pad-d/2})">
    <rect x="${X(-W/2)}" y="${Z(-D/2)}" width="${w}" height="${d}" fill="#ece7e0"/>
    ${cells}
    <rect x="${X(-coreW/2)}" y="${Z(-D*.31)}" width="${coreW*scale}" height="${D*.62*scale}" fill="#e3d9cb"/>
    ${facingArrow}</g>
    <g transform="translate(215 25)"><path d="M0 -9 L4 4 L0 1 L-4 4 Z" fill="#292334"/><text y="16" text-anchor="middle" font-size="9" font-weight="700" fill="#292334">N</text></g></svg>`;
  const floors = b.floorCount ?? b.floors.length;
  const stack = Array.from({ length: floors }, (_, i) => floors - 1 - i).map((f) => `<i class="${f === unit.floor ? 'on' : ''}" title="${floorName(f)}"></i>`).join('');
  return `<div class="position"><div><small>Posição na torre</small>${plan}</div><div class="stack" aria-label="${floorName(unit.floor ?? 0)} de ${floors} pavimentos">${stack}<small>${unit.floor === 0 ? 'Térreo' : `${unit.floor}º`}</small></div></div>`;
}

function selectUnit(unit: Unit) {
  state.unit = unit;
  const tower = state.tower!;
  tower.setSelectedUnit(unit.id);
  renderMirror(); renderCrumbs();
  for (const label of unitLabels) label.element.classList.toggle('on', label.unitId === unit.id);
  const plan = planOf(unit);
  const balcony = balconyArea(plan);
  const showPrice = dev.viewer.layout?.showPrices === true && unit.price != null;
  const panel = $('unit-panel');
  panel.innerHTML = `<div class="unit-body"><button class="back">‹ ${floorName(unit.floor ?? 0)}</button>
    <div class="eyebrow">Apartamento</div>
    <div style="display:flex;justify-content:space-between;align-items:center"><h2 class="unit-number">${esc(unit.number)}</h2><span class="tag ${unit.status}">${statusLabel[unit.status]}</span></div>
    <div class="eyebrow">${esc(tower.building.name)}, ${floorName(unit.floor ?? 0)}, final ${esc(unit.final)}</div>
    <div class="facts">
      <div><small>Área privativa</small><b>${area(unit.privateArea)}</b></div>
      <div><small>Planta</small><b>${esc(plan?.name ?? '—')}</b></div>
      <div><small>Quartos</small><b>${plan?.bedrooms ?? '—'}${plan?.suites ? `, sendo ${plan.suites} suíte${plan.suites > 1 ? 's' : ''}` : ''}</b></div>
      <div><small>Banheiros</small><b>${plan?.bathrooms ?? '—'}</b></div>
      ${plan?.parkingSpaces ? `<div><small>Vagas</small><b>${plan.parkingSpaces}</b></div>` : ''}
      ${balcony ? `<div><small>Varanda</small><b>${area(balcony)}</b></div>` : ''}
      ${unit.totalArea && unit.totalArea !== unit.privateArea ? `<div><small>Área total (com garden)</small><b>${area(unit.totalArea)}</b></div>` : ''}
    </div>
    ${showPrice ? `<div class="avail">Valor<br><b style="color:var(--ink);font-size:24px">${money(unit.price!)}</b></div>` : ''}
    ${positionHtml(tower, unit)}
    <button class="btn ghost interest" id="interest">${unit.status === 'AVAILABLE' ? '♡ Tenho interesse neste apartamento' : '♡ Quero saber de unidades parecidas'}</button></div>
    <div class="unit-footer">
      <button class="big primary" id="see-3d" ${plan?.layout ? '' : 'disabled title="Planta 3D ainda não cadastrada"'}><span>⬚</span>Ver por dentro</button>
      <button class="big" id="see-plan" ${plan ? '' : 'disabled'}><span>▦</span>Ver planta</button>
      <button class="big" id="see-view"><span>◉</span>Ver vista</button>
    </div>`;
  panel.classList.remove('hidden');
  panel.querySelector('.back')!.addEventListener('click', () => back());
  panel.querySelector('#see-plan')!.addEventListener('click', () => plan && showPlan(plan, unit));
  panel.querySelector('#see-view')!.addEventListener('click', () => viewFromUnit(unit));
  panel.querySelector('#see-3d')!.addEventListener('click', () => plan && openInterior(plan, unit));
  panel.querySelector('#interest')!.addEventListener('click', () => leadForm(unit));
  const mesh = tower.unitMeshes.get(unit.id)!;
  void world.frame3(mesh.getAbsolutePosition().clone(), window.innerWidth<=760?95:78, 52);
}

/** Câmera na altura e no lado do apartamento, olhando para fora: a vista aproximada da janela. */
function viewFromUnit(unit: Unit) {
  const tower = state.tower!; const mesh = tower.unitMeshes.get(unit.id)!;
  const inside = mesh.getAbsolutePosition().clone();
  const outward = Vector3.TransformNormal(new Vector3(0, 0, Math.sign(mesh.position.z) || 1), tower.group.getWorldMatrix()).normalize();
  const eye = inside.add(outward.scale((tower.building.model3d?.depth ?? 16) / 4 + 1.5)); eye.y = inside.y + 0.4;
  const look = eye.add(outward.scale(80)); look.y = inside.y - 4;
  void world.flyTo(eye, look, 1.8);
}

function renderCrumbs() {
  document.body.classList.toggle('has-unit',state.unit!=null);
  for(const tower of site.towers)tower.setContextMuted(state.unit!=null&&tower!==state.tower);
  const items: [string, () => void][] = [['Visão geral', () => back(true)]];
  if (state.tower) items.push([state.tower.building.name, () => { state.unit = null; state.floor = null; state.tower!.setUnitsVisible(false); $('unit-panel').classList.add('hidden'); selectTower(state.tower!); }]);
  if (state.tower && state.floor != null) items.push([floorName(state.floor), () => { state.unit = null; state.tower!.setSelectedUnit(null); $('unit-panel').classList.add('hidden'); selectFloor(state.floor!); renderUnitLabels(); }]);
  if (state.unit) items.push([`Apto ${state.unit.number}`, () => selectUnit(state.unit!)]);
  const crumbs = $('crumbs');
  crumbs.classList.toggle('hidden', items.length < 2);
  crumbs.innerHTML = items.map(([label], i) => `${i ? '<span>/</span>' : ''}<button data-i="${i}">${esc(label)}</button>`).join('');
  crumbs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => items[Number(b.dataset.i)][1]()));
}

function back(all = false) {
  if (!$('modal').classList.contains('hidden')) { closeModal(); return; }
  if (!all && state.unit) { state.unit = null; state.tower!.setSelectedUnit(null); $('unit-panel').classList.add('hidden'); renderMirror(); renderCrumbs(); renderUnitLabels(); return; }
  if (!all && state.floor != null) { state.floor = null; clearUnitLabels(); state.tower!.setUnitsVisible(true, null); renderMirror(); renderCrumbs(); void world.frame3(state.tower!.center, state.tower!.height * 2.4 + 60, 62); return; }
  if (!all && state.tower && !$('mirror-panel').classList.contains('hidden')) { state.tower.setUnitsVisible(false); selectTower(state.tower); return; }
  if (state.tower) { state.tower.setSelectedUnit(null); state.tower.setUnitsVisible(false); state.tower.setFloorHighlight(null); state.tower.setHover(false); }
  state.tower = null; state.floor = null; state.unit = null;
  floorLabel?.remove(); floorLabel = null;
  clearUnitLabels();
  towerLabels.forEach((l) => l.classList.remove('on'));
  for (const id of ['tower-panel', 'mirror-panel', 'unit-panel', 'amenities-panel']) $(id).classList.add('hidden');
  $('hint').classList.remove('hidden');
  renderTowerBar(); renderCrumbs();
  void overview();
}

function toggleAmenities() {
  if (state.amenities) { hideAmenities(); return; }
  back(true);
  state.amenities = true;
  document.getElementById('btn-amenities')?.classList.add('on');
  const panel = $('amenities-panel');
  panel.innerHTML = `<button class="close">×</button><h3>Lazer</h3><div class="eyebrow">${dev.amenities.length} áreas comuns</div>
    <ul class="amenity-list">${dev.amenities.map((a) => `<li><button data-id="${a.id}"><span class="num">${a.marker ?? ''}</span>${esc(a.name)}</button></li>`).join('')}</ul>`;
  panel.classList.remove('hidden'); $('hint').classList.add('hidden');
  panel.querySelector('.close')!.addEventListener('click', () => hideAmenities());
  panel.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => b.addEventListener('click', () => showAmenity(b.dataset.id!)));
  void world.frame3(siteCenter(0), 200, 30);
}
function hideAmenities() {
  state.amenities = false;
  document.getElementById('btn-amenities')?.classList.remove('on');
  $('amenities-panel').classList.add('hidden');
}

function showAmenity(id: string) {
  const amenity = dev.amenities.find((a) => a.id === id)!; const anchor = site.amenityAnchors.get(id);
  if (anchor) void world.frame3(anchor, 70, 52);
  const media = amenity.mediaAssetIds[0];
  openModal(`${media ? `<div class="media"><img src="${api.assetUrl(media)}" alt=""></div>` : ''}
    <div class="side"><div class="eyebrow">Área comum ${amenity.marker ?? ''}</div><h3>${esc(amenity.name)}</h3>
    ${amenity.description ? `<p>${esc(amenity.description)}</p>` : ''}<p class="note">Áreas comuns entregues mobiliadas e decoradas. Imagens meramente ilustrativas.</p></div>`, !media);
}

function showPlan(plan: FloorPlan, unit?: Unit) {
  const [summary, ...rooms] = (plan.description ?? '').split('\n');
  const parsed = rooms.map((r) => r.split(': ')).filter((r) => r.length === 2);
  const image = plan.imageAssetIds[0];
  openModal(`${image ? `<div class="media"><img src="${api.assetUrl(image)}" alt="${esc(plan.name)}"></div>` : ''}
    <div class="side">${unit ? `<div class="eyebrow">Apartamento ${esc(unit.number)}</div>` : ''}<h3>${esc(plan.name)}</h3>
    <div class="eyebrow">${esc(summary)}</div>
    <div class="avail" style="margin-top:14px">Área privativa<br><b style="color:var(--ink);font-size:22px">${area(unit?.privateArea ?? plan.area)}</b></div>
    ${parsed.length ? `<h4 style="margin:18px 0 0">Cômodos e cotas</h4><ul class="rooms">${parsed.map(([name, dims]) => `<li><span>${esc(name)}</span><span>${esc(dims)}</span></li>`).join('')}</ul>` : ''}
    ${plan.layout ? '<button class="btn primary" id="plan-3d" style="margin-top:8px">⬚ Ver em 3D mobiliada</button>' : ''}
    <p class="note">Metragens aproximadas; as oficiais constam no Registro de Incorporação. Mobiliário meramente ilustrativo.</p></div>`, !image);
  document.getElementById('plan-3d')?.addEventListener('click', () => { closeModal(); openInterior(plan, unit); });
}

/** Planta 3D mobiliada em tela cheia (maquete e passeio em primeira pessoa); a maquete pausa enquanto isso. */
let interior: InteriorViewer | null = null;
function openInterior(plan: FloorPlan, unit?: Unit) {
  if (!plan.layout || interior) return;
  const subtitle = [unit ? `Apartamento ${unit.number}` : null, area(unit?.privateArea ?? plan.area), plan.bedrooms ? `${plan.bedrooms} quartos` : null].filter(Boolean).join(' · ');
  world.paused = true;
  interior = new InteriorViewer(plan.layout, { title: plan.name, subtitle, onClose: () => { interior = null; world.paused = false; } });
}

function about() {
  const notes = dev.viewer.layout?.notes ?? [];
  openModal(`<div class="side"><div class="eyebrow">${esc(dev.address ?? '')} · ${esc(dev.city ?? '')}</div><h3>${esc(dev.name)}</h3>
    <p>${esc(dev.description ?? '')}</p>
    <div class="facts"><div><small>Torres</small><b>${dev.buildings.length}</b></div><div><small>Apartamentos</small><b>${dev.buildings.reduce((n, b) => n + b.units.length, 0)}</b></div>
    <div><small>Disponíveis</small><b>${dev.buildings.reduce((n, b) => n + available(b.units), 0)}</b></div><div><small>Plantas</small><b>${dev.floorPlans.length}</b></div></div>
    <div class="gallery">${dev.gallery.filter((g) => g.kind !== 'IMPLANTATION').map((g) => `<img src="${api.assetUrl(g.id)}" alt="${esc(g.metadata?.title ?? '')}" title="${esc(g.metadata?.title ?? '')}" loading="lazy" data-id="${g.id}">`).join('')}</div>
    <h4 style="margin:22px 0 0">Fale com a equipe de vendas</h4>${leadFormHtml()}
    ${notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}</div>`, true);
  $('modal-box').querySelectorAll<HTMLImageElement>('.gallery img').forEach((img) => img.addEventListener('click', () => window.open(img.src, '_blank')));
  bindLeadForm();
}

function leadFormHtml() {
  return `<form class="form" id="lead-form">
    <input name="name" placeholder="Nome" required maxlength="160"><input name="phone" placeholder="Telefone / WhatsApp" required maxlength="40">
    <input name="email" type="email" placeholder="E-mail (opcional)"><textarea name="message" rows="3" placeholder="Mensagem (opcional)"></textarea>
    <label class="check"><input type="checkbox" name="consent" required> Autorizo o contato da equipe de vendas sobre este empreendimento.</label>
    <button class="btn primary" type="submit">Enviar</button><div id="lead-status"></div></form>`;
}
function bindLeadForm(unit?: Unit) {
  const form = document.getElementById('lead-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form); const status = $('lead-status');
    try {
      await api.lead(slug, { name: String(data.get('name')), phone: String(data.get('phone')), email: String(data.get('email') || '') || undefined, message: String(data.get('message') || '') || undefined, unitId: unit?.id, consent: data.get('consent') === 'on' });
      form.innerHTML = '<p class="ok">Recebemos seu contato. A equipe de vendas vai falar com você em breve.</p>';
    } catch (error) { status.innerHTML = `<p class="err">${esc(error instanceof Error ? error.message : 'Não foi possível enviar')}</p>`; }
  });
}
function leadForm(unit: Unit) {
  openModal(`<div class="side"><div class="eyebrow">${esc(state.tower?.building.name)} · Apartamento ${esc(unit.number)}</div><h3>Tenho interesse</h3>${leadFormHtml()}</div>`, true);
  bindLeadForm(unit);
}

function openModal(html: string, single: boolean) {
  const box = $('modal-box');
  box.className = `modal-box${single ? ' single' : ''}`;
  box.innerHTML = `<button class="x" aria-label="Fechar">×</button>${html}`;
  box.querySelector('.x')!.addEventListener('click', closeModal);
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); $('modal-box').innerHTML = ''; }

/** Tour guiado: visão geral, cada torre, o lazer e de volta, com legenda. */
async function tour() {
  if (touring) return;
  touring = true; back(true);
  const caption = $('caption'); caption.classList.remove('hidden');
  const say = (title: string, text: string) => { caption.innerHTML = `<b>${esc(title)}</b>${esc(text)}`; };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    say(dev.name, `${dev.buildings.length} torres · ${dev.address ?? ''}`);
    await overview(); await wait(1500);
    for (const tower of site.towers) {
      if (!touring) return;
      say(tower.building.name, `${tower.building.floorCount ?? ''} pavimentos · ${available(tower.building.units)} apartamentos disponíveis`);
      await world.frame3(tower.center, tower.height * 2 + 40, 64); await wait(1800);
    }
    if (dev.amenities.length) {
      say('Lazer', dev.amenities.map((a) => a.name).slice(0, 6).join(' · ') + (dev.amenities.length > 6 ? '…' : ''));
      await world.frame3(siteCenter(0), 170, 35); await wait(2600);
    }
    say('Escolha seu apartamento', 'Clique numa torre para ver a disponibilidade por andar.');
    await overview(); await wait(2200);
  } finally { touring = false; caption.classList.add('hidden'); }
}
function updateInset() {
  if (!world) return;
  const visible = (id: string) => !$(id).classList.contains('hidden');
  const right = (visible('unit-panel') ? $('unit-panel').offsetWidth + 16 : 0) + (visible('mirror-panel') ? $('mirror-panel').offsetWidth + 16 : 0);
  const left = visible('tower-panel') ? $('tower-panel').offsetWidth + 16 : visible('amenities-panel') ? $('amenities-panel').offsetWidth + 16 : 0;
  world.setInset(right - left);
}
const panelObserver = new MutationObserver(updateInset);
for (const id of ['tower-panel', 'mirror-panel', 'unit-panel', 'amenities-panel']) panelObserver.observe($(id), { attributes: true, attributeFilter: ['class'] });
window.addEventListener('resize',updateInset);

void start();
