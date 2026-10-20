import './styles.css';
import * as THREE from 'three';
import { api } from './api';
import { World } from './scene/world';
import { buildSite, type SiteResult } from './scene/site';
import { buildSurroundings } from './scene/surroundings';
import type { TowerObject } from './scene/tower';
import type { Development, FloorPlan, Unit, UnitStatus } from './types';

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
let touring = false;

const available = (units: Unit[]) => units.filter((u) => u.status === 'AVAILABLE').length;
const planOf = (unit: Unit): FloorPlan | undefined => dev.floorPlans.find((p) => p.id === unit.floorPlanId);

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

  world = new World($('stage'), $('labels'));
  const siteImage = dev.viewer.layout?.siteImageAssetId ? api.assetUrl(dev.viewer.layout.siteImageAssetId) : null;
  site = buildSite(dev, siteImage);
  world.scene.add(site.group);
  world.onDusk((t) => { for (const tower of site.towers) tower.setDusk(t); });

  renderChrome();
  createLabels();
  bindPicking();
  overview(0.01);

  $('loading-text').textContent = 'Carregando o entorno real (OpenStreetMap)';
  try {
    const surroundings = await api.surroundings(slug);
    const result = buildSurroundings(surroundings, site.lotWorld);
    world.scene.add(result.group);
    const own = new Set(site.roadAnchors.map((r) => r.name.split(',')[0].toLowerCase()));
    for (const road of result.roadLabels) {
      if ([...own].some((name) => road.name.toLowerCase().includes(name.replace('av. ', 'avenida ')))) continue;
      const element = document.createElement('div'); element.className = 'label road major'; element.textContent = road.name;
      world.addLabel(element, road.position, { maxDistance: 1400 });
    }
    $('sources').innerHTML = `Entorno real <em>OSM</em>${result.illustrativeHouses ? ' <em class="dashed">casas ilustrativas</em>' : ''}`;
  } catch {
    $('sources').innerHTML = 'Entorno indisponível no momento';
  }
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
  ];
  const el = $('views');
  el.innerHTML = `${views.map(([icon, label], i) => `<button data-i="${i}" title="Vista ${label.toLowerCase()}">${icon}<span class="t">${label}</span></button>`).join('')}<hr>
    <button id="fullscreen" title="Tela cheia">⛶<span class="t">Tela cheia</span></button>`;
  el.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => b.addEventListener('click', () => { touring = false; back(true); views[Number(b.dataset.i)][2](); }));
  $('fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => { $('fullscreen').innerHTML = document.fullscreenElement ? '⤢<span class="t">Sair da tela cheia</span>' : '⛶<span class="t">Tela cheia</span>'; });
}

function presetView(offsetDeg: number, polar: number, distance = 300) {
  // Direção "frente" no mapa: para onde aponta a parte de baixo da implantação (azimute + 180°).
  const bearing = (dev.viewer.layout?.azimuth ?? 0) + 180 + offsetDeg;
  const center = new THREE.Box3().setFromObject(site.group).getCenter(new THREE.Vector3()).setY(15);
  void world.frame3(center, distance, polar, 180 - bearing);
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
  }
  for (const road of site.roadAnchors) {
    const element = document.createElement('div'); element.className = 'label road'; element.textContent = road.name;
    world.addLabel(element, road.position, { maxDistance: 700 });
  }
}

function bindPicking() {
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  const canvas = world.renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, world.camera);
    const targets = site.towers.flatMap((t) => t.pickables.filter((o) => o.visible || !o.userData.unitId));
    const hit = raycaster.intersectObjects(targets, false).find((h) => h.object.userData.unitId ? h.object.visible : true);
    if (!hit) return;
    const { unitId, buildingId } = hit.object.userData as { unitId?: string; buildingId: string };
    const tower = site.towers.find((t) => t.building.id === buildingId)!;
    if (unitId && state.tower === tower) { const unit = tower.building.units.find((u) => u.id === unitId)!; selectFloor(unit.floor ?? 0, false); selectUnit(unit); }
    else if (state.tower !== tower) selectTower(tower);
  });
}

function overview(duration = 1.8) {
  const camera = dev.viewer.camera ?? {};
  const center = new THREE.Box3().setFromObject(site.group).getCenter(new THREE.Vector3()).setY(10);
  world.controls.target.copy(center);
  return world.frame3(center, camera.distance ?? 320, camera.polar ?? 58, camera.azimuth ?? 35, duration);
}

function selectTower(tower: TowerObject) {
  if (state.tower && state.tower !== tower) { state.tower.setUnitsVisible(false); state.tower.setFloorHighlight(null); }
  state.tower = tower; state.floor = null; state.unit = null;
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
}

function previewFloor(floor: number | null) {
  const tower = state.tower!; tower.setFloorHighlight(floor);
  floorLabel?.remove(); floorLabel = null;
  if (floor == null) return;
  const units = tower.building.units.filter((u) => u.floor === floor);
  const element = document.createElement('div'); element.className = 'label floor';
  element.innerHTML = `${floorName(floor)}<small>${available(units)} disponíveis</small>`;
  const h = tower.building.floorHeight ?? 2.9;
  const position = new THREE.Vector3((tower.building.model3d?.width ?? 30) / 2 + 2, floor * h + h, 0).applyMatrix4(tower.group.matrixWorld);
  floorLabel = { element, remove: world.addLabel(element, position) };
}

function selectFloor(floor: number, fly = true) {
  const tower = state.tower!;
  state.floor = floor; previewFloor(null); tower.setFloorHighlight(null);
  tower.setUnitsVisible(true, floor);
  renderMirror(); renderCrumbs();
  if (fly) {
    const h = tower.building.floorHeight ?? 2.9;
    const target = new THREE.Vector3(0, floor * h, 0).applyMatrix4(tower.group.matrixWorld);
    void world.frame3(target, 110, 50);
  }
}

function selectUnit(unit: Unit) {
  state.unit = unit;
  const tower = state.tower!;
  tower.setSelectedUnit(unit.id);
  renderMirror(); renderCrumbs();
  const plan = planOf(unit);
  const panel = $('unit-panel');
  panel.innerHTML = `<button class="back">‹ ${floorName(unit.floor ?? 0)}</button>
    <div class="eyebrow">Apartamento</div>
    <div style="display:flex;justify-content:space-between;align-items:center"><h2 class="unit-number">${esc(unit.number)}</h2><span class="tag ${unit.status}">${statusLabel[unit.status]}</span></div>
    <div class="eyebrow">${esc(tower.building.name)}, ${floorName(unit.floor ?? 0)}, final ${esc(unit.final)}</div>
    <div class="facts">
      <div><small>Área privativa</small><b>${area(unit.privateArea)}</b></div>
      <div><small>Planta</small><b>${esc(plan?.name ?? '—')}</b></div>
      <div><small>Quartos</small><b>${plan?.bedrooms ?? '—'}${plan?.suites ? `, sendo ${plan.suites} suíte` : ''}</b></div>
      <div><small>Banheiros</small><b>${plan?.bathrooms ?? '—'}</b></div>
      ${unit.totalArea && unit.totalArea !== unit.privateArea ? `<div><small>Área total (com garden)</small><b>${area(unit.totalArea)}</b></div>` : ''}
      ${plan?.parkingSpaces ? `<div><small>Vagas</small><b>${plan.parkingSpaces}</b></div>` : ''}
    </div>
    ${unit.price != null ? `<div class="avail">Valor<br><b style="color:var(--ink);font-size:24px">${money(unit.price)}</b></div>` : ''}
    <div class="unit-actions">
      <button class="btn" id="see-plan" ${plan ? '' : 'disabled'}>▦ Ver planta</button>
      <button class="btn" id="see-view">◉ Ver vista</button>
      <button class="btn primary" id="interest" style="grid-column:1/-1">${unit.status === 'AVAILABLE' ? 'Tenho interesse neste apartamento' : 'Quero saber de unidades parecidas'}</button>
    </div>`;
  panel.classList.remove('hidden');
  panel.querySelector('.back')!.addEventListener('click', () => back());
  panel.querySelector('#see-plan')!.addEventListener('click', () => plan && showPlan(plan, unit));
  panel.querySelector('#see-view')!.addEventListener('click', () => viewFromUnit(unit));
  panel.querySelector('#interest')!.addEventListener('click', () => leadForm(unit));
  const mesh = tower.unitMeshes.get(unit.id)!;
  const target = mesh.getWorldPosition(new THREE.Vector3());
  void world.frame3(target, 95, 52);
}

/** Câmera na altura e no lado do apartamento, olhando para fora: a vista aproximada da janela. */
function viewFromUnit(unit: Unit) {
  const tower = state.tower!; const mesh = tower.unitMeshes.get(unit.id)!;
  const inside = mesh.getWorldPosition(new THREE.Vector3());
  const outward = new THREE.Vector3(0, 0, Math.sign(mesh.position.z) || 1).applyQuaternion(tower.group.quaternion);
  const eye = inside.clone().add(outward.clone().multiplyScalar((tower.building.model3d?.depth ?? 16) / 4 + 1.5)).setY(inside.y + 0.4);
  void world.flyTo(eye, eye.clone().add(outward.multiplyScalar(80)).setY(inside.y - 4), 1.8);
}

function renderCrumbs() {
  const items: [string, () => void][] = [['Visão geral', () => back(true)]];
  if (state.tower) items.push([state.tower.building.name, () => { state.unit = null; state.floor = null; state.tower!.setUnitsVisible(false); $('unit-panel').classList.add('hidden'); selectTower(state.tower!); }]);
  if (state.tower && state.floor != null) items.push([floorName(state.floor), () => { state.unit = null; state.tower!.setSelectedUnit(null); $('unit-panel').classList.add('hidden'); selectFloor(state.floor!); }]);
  if (state.unit) items.push([`Apto ${state.unit.number}`, () => selectUnit(state.unit!)]);
  const crumbs = $('crumbs');
  crumbs.classList.toggle('hidden', items.length < 2);
  crumbs.innerHTML = items.map(([label], i) => `${i ? '<span>/</span>' : ''}<button data-i="${i}">${esc(label)}</button>`).join('');
  crumbs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => items[Number(b.dataset.i)][1]()));
}

function back(all = false) {
  if (!$('modal').classList.contains('hidden')) { closeModal(); return; }
  if (!all && state.unit) { state.unit = null; state.tower!.setSelectedUnit(null); $('unit-panel').classList.add('hidden'); renderMirror(); renderCrumbs(); return; }
  if (!all && state.floor != null) { state.floor = null; state.tower!.setUnitsVisible(true, null); renderMirror(); renderCrumbs(); void world.frame3(state.tower!.center, state.tower!.height * 2.4 + 60, 62); return; }
  if (!all && state.tower && !$('mirror-panel').classList.contains('hidden')) { state.tower.setUnitsVisible(false); selectTower(state.tower); return; }
  if (state.tower) { state.tower.setUnitsVisible(false); state.tower.setFloorHighlight(null); }
  state.tower = null; state.floor = null; state.unit = null;
  floorLabel?.remove(); floorLabel = null;
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
  const center = new THREE.Box3().setFromObject(site.group).getCenter(new THREE.Vector3()).setY(0);
  void world.frame3(center, 200, 30);
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
    <p class="note">Metragens aproximadas; as oficiais constam no Registro de Incorporação. Mobiliário meramente ilustrativo.</p></div>`, !image);
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
      const center = new THREE.Box3().setFromObject(site.group).getCenter(new THREE.Vector3()).setY(0);
      await world.frame3(center, 170, 35); await wait(2600);
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

void start().then(() => world?.controls.addEventListener('start', () => { touring = false; }));
