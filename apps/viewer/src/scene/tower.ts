import { Color3, LoadAssetContainerAsync, Mesh, TransformNode, Vector3, type Matrix, type PBRMaterial, type Scene } from './babylon';
import type { Library } from './library';
import { box as boxGeo, compose, instanced, meshFrom, offsetLightness, pbr, rgb, shadows, translate } from './geometry';
import type { Building, TowerModel, UnitSlot, UnitStatus } from '../types';

export const statusColor: Record<UnitStatus, number> = { AVAILABLE: 0x22a565, RESERVED: 0xf2a33a, SOLD: 0x9a95a6, BLOCKED: 0x6b6f78, UNAVAILABLE: 0x6b6f78 };
export const defaultSlots: UnitSlot[] = Array.from({ length: 8 }, (_, i) => ({ final: String(i + 1).padStart(2, '0'), side: i < 4 ? 'back' : 'front', column: i % 4 }));
const selectedColor = 0xe0622a;

export interface TowerObject {
  building: Building; group: TransformNode; top: Vector3; center: Vector3; height: number;
  unitMeshes: Map<string, Mesh>; floorBands: Mesh[];
  pickables: Mesh[];
  setFloorHighlight(floor: number | null): void;
  setUnitsVisible(visible: boolean, floor?: number | null): void;
  setSelectedUnit(unitId: string | null): void;
  /** 0 = dia, 1 = pôr do sol: intensidade das janelas acesas. */
  setDusk(t: number): void;
  /** Realce alaranjado enquanto o mouse está sobre a torre. */
  setHover(on: boolean): void;
  /** Ponto (mundo) no topo do volume de um apartamento, para o rótulo com o número. */
  unitTop(unitId: string): Vector3 | null;
  /** Resolve quando o modelo GLB da torre (se houver) terminou de carregar. */
  loaded: Promise<void>;
}

/**
 * Torre paramétrica: corpo com janelas por pavimento, núcleo de circulação e varandas na cor de destaque,
 * e um volume clicável por apartamento (posição definida pelo final em model3d.unitSlots).
 */
export function buildTower(scene: Scene, building: Building, parent: TransformNode, glbUrl: string | null = null, library: Library | null = null): TowerObject {
  const model: TowerModel = building.model3d ?? { width: 32, depth: 16 };
  const floors = building.floorCount ?? (Math.max(...building.units.map((u) => u.floor ?? 0), 0) + 1);
  const h = building.floorHeight ?? 2.9;
  const W = model.width; const D = model.depth; const H = floors * h;
  const colors = { facade: '#e6ebe8', accent: '#e0622a', roof: '#d8dbd6', base: '#c9ccc6', ...model.colors };
  const slots = model.unitSlots?.length ? model.unitSlots : defaultSlots;
  const columns = Math.max(...slots.map((s) => s.column)) + 1;
  const id = building.id;

  const group = new TransformNode(building.name, scene);
  group.parent = parent;
  const pos = building.position ?? { x: 0, z: 0 };
  group.position.set(pos.x, 0, pos.z);
  group.rotation.y = -((pos.rotation ?? 0) * Math.PI) / 180;

  // Corpo: duas lâminas separadas pelo núcleo central (como no material de vendas).
  // Fachada toda em geometria (sem textura pintada): painéis por apartamento, janelas com caixilho,
  // vidro e peitoril, frisos de laje e patamares da escada no núcleo. Fica nítida de perto.
  const coreW = Math.min(4.2, W * 0.12);
  const wingW = (W - coreW) / 2;
  const facadeColor = rgb(colors.facade);
  const wall = pbr(scene, `${id}-wall`, { color: facadeColor, roughness: 0.88 });
  const plain = pbr(scene, `${id}-plain`, { color: colors.roof, roughness: 0.95 });
  const panelMaterial = pbr(scene, `${id}-panel`, { color: 0xffffff, roughness: 0.85 });
  const trim = pbr(scene, `${id}-trim`, { color: offsetLightness(facadeColor, 0.05), roughness: 0.8 });
  const frameMaterial = pbr(scene, `${id}-frame`, { color: 0x5a6168, roughness: 0.5, metalness: 0.2 });
  const glassMaterial = pbr(scene, `${id}-glass`, { color: 0x3a4b59, roughness: 0.18, metalness: 0.25 });
  const litMaterial = pbr(scene, `${id}-lit`, { color: 0x3a4b59, roughness: 0.18, metalness: 0.25, emissive: 0xffc56a, emissiveIntensity: 0 });
  const accent = pbr(scene, `${id}-accent`, { color: colors.accent, roughness: 0.75 });
  const railMaterial = pbr(scene, `${id}-rail`, { color: 0x2b2f33, roughness: 0.5, metalness: 0.5 });
  const body: Mesh[] = [];
  const add = (mesh: Mesh, cast: boolean) => { shadows(mesh, cast); body.push(mesh); return mesh; };

  const sides = boxGeo(1, 1, 1, ['px', 'nx', 'pz', 'nz']); const caps = boxGeo(1, 1, 1, ['py', 'ny']);
  for (const dir of [-1, 1]) {
    const x = dir * (coreW / 2 + wingW / 2);
    for (const [geo, material] of [[sides, wall], [caps, plain]] as const) {
      const wing = add(meshFrom(`${id}-wing`, geo, scene, material, group), true);
      wing.position.set(x, H / 2, 0); wing.scaling.set(wingW, H, D);
    }
    const parapet = add(meshFrom(`${id}-parapet`, boxGeo(wingW + 0.3, 1.1, D + 0.3), scene, trim, group), true);
    parapet.position.set(x, H + 0.55, 0);
  }
  const core = add(meshFrom(`${id}-core`, boxGeo(coreW, H + 3.2, D * 0.62), scene, accent, group), true);
  core.position.set(0, (H + 3.2) / 2, 0);

  // Peças instanciadas: cada lista vira uma malha de caixas unitárias com instâncias finas.
  const lists = { panels: [] as Matrix[], frames: [] as Matrix[], glass: [] as Matrix[], lit: [] as Matrix[], sills: [] as Matrix[], slabs: [] as Matrix[], landings: [] as Matrix[], rails: [] as Matrix[], voids: [] as Matrix[] };
  const panelColors: Color3[] = [];
  /** Caixa numa face: (u, y) no plano da face, `out` metros para fora; normal no eixo x (nx) ou z (nz). */
  const onFace = (list: Matrix[], fx: number, fz: number, nx: number, nz: number, u: number, y: number, out: number, sw: number, sh: number, sd: number) => {
    list.push(compose(fx + (nz ? u : 0) + nx * out, y, fz + (nx ? u : 0) + nz * out, 0, nx ? Math.PI / 2 : 0, 0, sw, sh, sd));
  };
  const box = (list: Matrix[], x: number, y: number, z: number, sx: number, sy: number, sz: number) => { list.push(compose(x, y, z, 0, 0, 0, sx, sy, sz)); };
  let seed = [...building.id].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 2147483647, 7) || 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // Segundo tom dos painéis: puxado para um verde-acinzentado, como nas fachadas de vendas.
  const alt = Color3.Lerp(facadeColor, rgb(0x9cb8b0), 0.38);
  const cellsPerWing = Math.max(1, columns / 2);
  /** Uma face da lâmina: painéis alternados por apartamento e, por pavimento, duas janelas e a do banheiro. */
  const face = (fx: number, fz: number, nx: number, nz: number, length: number, cells: number) => {
    const cw = length / cells;
    for (let c = 0; c < cells; c++) {
      const u = -length / 2 + cw * (c + 0.5);
      onFace(lists.panels, fx, fz, nx, nz, u, H / 2, 0.03, cw - 0.08, H, 0.06);
      panelColors.push(c % 2 ? alt : facadeColor);
      const big = Math.min(1.4, cw * 0.27);
      for (let f = 0; f < floors; f++) {
        const base = f * h;
        for (const k of [0.27, 0.73]) {
          const wu = u - cw / 2 + cw * k; const wy = base + 0.95 + 0.7;
          onFace(lists.frames, fx, fz, nx, nz, wu, wy, 0.08, big + 0.14, 1.54, 0.08);
          onFace(random() < 0.42 ? lists.lit : lists.glass, fx, fz, nx, nz, wu, wy, 0.12, big, 1.4, 0.02);
          onFace(lists.frames, fx, fz, nx, nz, wu, wy, 0.13, 0.05, 1.4, 0.03); // montante
          onFace(lists.sills, fx, fz, nx, nz, wu, base + 0.92, 0.14, big + 0.26, 0.06, 0.16);
        }
        onFace(lists.frames, fx, fz, nx, nz, u, base + 1.95, 0.08, 0.52, 0.52, 0.08); // janela do banheiro
        onFace(lists.glass, fx, fz, nx, nz, u, base + 1.95, 0.12, 0.42, 0.42, 0.02);
      }
    }
  };
  for (const dir of [-1, 1]) {
    const cx = dir * (coreW / 2 + wingW / 2);
    face(cx, D / 2, 0, 1, wingW, cellsPerWing);
    face(cx, -D / 2, 0, -1, wingW, cellsPerWing);
    face(cx + dir * (wingW / 2), 0, dir, 0, D, 2);
    // Frisos de laje em volta da lâmina, a cada pavimento.
    for (let f = 1; f <= floors; f++) {
      const y = f * h - 0.08;
      box(lists.slabs, cx, y, D / 2 + 0.1, wingW + 0.34, 0.2, 0.2); box(lists.slabs, cx, y, -D / 2 - 0.1, wingW + 0.34, 0.2, 0.2);
      box(lists.slabs, cx + dir * (wingW / 2 + 0.1), y, 0, 0.2, 0.2, D + 0.34);
    }
  }
  // Núcleo: patamar da escada por pavimento, com guarda-corpo de montantes, nas duas faces.
  const posts = Math.max(3, Math.round(coreW / 0.9));
  for (let f = 1; f < floors; f++) for (const zDir of [-1, 1]) {
    const z = zDir * (D * 0.31); const y = f * h;
    box(lists.voids, 0, y + h * 0.5, z + zDir * 0.01, coreW * 0.82, h * 0.72, 0.02);
    box(lists.landings, 0, y + 0.08, z + zDir * 0.55, coreW + 0.3, 0.16, 1.1);
    box(lists.rails, 0, y + 1.05, z + zDir * 1.08, coreW + 0.3, 0.05, 0.05);
    box(lists.rails, 0, y + 0.6, z + zDir * 1.08, coreW + 0.3, 0.03, 0.03);
    for (let k = 0; k <= posts; k++) box(lists.rails, -coreW / 2 - 0.15 + ((coreW + 0.3) / posts) * k, y + 0.6, z + zDir * 1.08, 0.04, 0.9, 0.04);
  }
  const unitBox = boxGeo(1, 1, 1);
  const many = (name: string, list: Matrix[], material: PBRMaterial, cast = true, tint?: Color3[]) => (list.length ? add(instanced(`${id}-${name}`, unitBox, scene, material, list, group, tint), cast) : null);
  many('panels', lists.panels, panelMaterial, true, panelColors);
  many('frames', lists.frames, frameMaterial, false); many('glass', lists.glass, glassMaterial, false); many('lit', lists.lit, litMaterial, false);
  many('sills', lists.sills, trim, false); many('slabs', lists.slabs, trim); many('landings', lists.landings, accent); many('rails', lists.rails, railMaterial, false);
  many('voids', lists.voids, pbr(scene, `${id}-void`, { color: rgb(colors.accent).scale(0.3), roughness: 1 }), false);
  // Casa de máquinas sobre a cobertura.
  const machine = add(meshFrom(`${id}-machine`, boxGeo(Math.min(7, W * 0.2), 2.4, D * 0.36), scene, plain, group), true);
  machine.position.set(-(coreW / 2 + wingW / 2), H + 2.3, 0);
  const base = shadows(meshFrom(`${id}-base`, boxGeo(W + 4, 0.4, D + 4), scene, pbr(scene, `${id}-base`, { color: colors.base, roughness: 1 }), group), false);
  base.position.y = 0.2;

  // Volumes por apartamento (ocultos até a seleção por andar) e faixas de pavimento.
  // Um material por cor/opacidade, compartilhado entre as unidades.
  const unitMaterials = new Map<string, PBRMaterial>();
  const unitMaterial = (color: number, alpha: number) => {
    const key = `${color}|${alpha}`;
    if (!unitMaterials.has(key)) unitMaterials.set(key, pbr(scene, `${id}-unit-${key}`, { color, roughness: 0.7, alpha, depthWrite: alpha >= 1 }));
    return unitMaterials.get(key)!;
  };
  const unitMeshes = new Map<string, Mesh>();
  const unitFloor = new Map<string, number>();
  const colW = W / columns;
  const unitGeometry = boxGeo(colW - 0.5, h - 0.25, D / 2 - 0.4);
  const byFloorFinal = new Map(building.units.map((u) => [`${u.floor}|${u.final}`, u] as const));
  for (let f = 0; f < floors; f++) {
    for (const slot of slots) {
      const unit = byFloorFinal.get(`${f}|${slot.final}`); if (!unit) continue;
      const mesh = meshFrom(`${id}-unit-${unit.number}`, unitGeometry, scene, unitMaterial(statusColor[unit.status], 0.82), group);
      mesh.position.set(-W / 2 + colW * (slot.column + 0.5), f * h + h / 2, (slot.side === 'front' ? -1 : 1) * (D / 4));
      mesh.scaling.setAll(1.04);
      mesh.setEnabled(false);
      mesh.metadata = { unitId: unit.id, buildingId: building.id, floor: f };
      unitMeshes.set(unit.id, mesh); unitFloor.set(unit.id, f);
    }
  }
  const bandMaterial = pbr(scene, `${id}-band`, { color: 0xf2a33a, alpha: 0.32, depthWrite: false, unlit: true });
  const bandGeometry = boxGeo(W + 1.2, h * 0.92, D + 1.2);
  const floorBands = Array.from({ length: floors }, (_, f) => {
    const band = meshFrom(`${id}-band-${f}`, bandGeometry, scene, bandMaterial, group);
    band.position.y = f * h + h / 2; band.setEnabled(false); band.isPickable = false;
    return band;
  });

  // Corpo recortado: mostra só os pavimentos abaixo do andar selecionado.
  const cutBody = new TransformNode(`${id}-cut`, scene); cutBody.parent = group; cutBody.setEnabled(false);
  const cutParts: Mesh[] = [];
  for (const dir of [-1, 1]) for (const [geo, material] of [[sides, wall], [caps, plain]] as const) {
    const wing = shadows(meshFrom(`${id}-cut-wing`, translate(geo, 0, 0.5, 0), scene, material, cutBody), true);
    wing.position.x = dir * (coreW / 2 + wingW / 2); wing.scaling.set(wingW, 1, D);
    cutParts.push(wing);
  }
  const cutCore = shadows(meshFrom(`${id}-cut-core`, translate(boxGeo(coreW, 1, D * 0.62), 0, 0.5, 0), scene, accent, cutBody), true);
  cutParts.push(cutCore);

  // Caixa de clique da torre inteira (invisível, só para seleção).
  const hit = meshFrom(`${id}-hit`, boxGeo(W + 2, H + 4, D + 3), scene, null, group);
  hit.position.y = (H + 4) / 2; hit.isVisible = false; hit.metadata = { buildingId: building.id };

  group.computeWorldMatrix(true);
  const world = group.getWorldMatrix();
  const center = Vector3.TransformCoordinates(new Vector3(0, H / 2, 0), world);
  const top = Vector3.TransformCoordinates(new Vector3(0, H + 6, 0), world);
  let selected: string | null = null; let unitsFloor: number | null | undefined; let dusk = 0;
  // Materiais do corpo que recebem o realce de hover (cor original guardada para voltar).
  const hoverTint = rgb(0xff8a3d);
  const tintable = new Map<PBRMaterial, Color3>();
  for (const material of [wall, plain, panelMaterial, trim, accent]) tintable.set(material, material.albedoColor.clone());
  const litMaterials: PBRMaterial[] = [litMaterial];

  // Modelo detalhado do Blender (scripts/blender/build_tower.py): substitui o corpo paramétrico. Os volumes por
  // apartamento, as faixas de pavimento, a torre recortada e a caixa de clique continuam os daqui.
  const loaded = glbUrl ? (async () => {
    const container = await LoadAssetContainerAsync(glbUrl, scene, { pluginExtension: '.glb' });
    container.addAllToScene();
    for (const node of container.transformNodes) if (/-units$/.test(node.name)) node.dispose(false, true);
    const root = container.rootNodes[0]; if (!root) return;
    root.parent = group;
    const visual = root.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && !m.isDisposed() && m.getTotalVertices() > 0);
    for (const mesh of visual) {
      shadows(mesh, true); mesh.isPickable = false;
      const material = mesh.material as PBRMaterial | null; if (!material) continue;
      material.maxSimultaneousLights = 4;
      if (material.name === 'VH_GlassLit') { material.emissiveColor = rgb(0xffc56a); material.emissiveIntensity = dusk * 1.6; if (!litMaterials.includes(material)) litMaterials.push(material); }
      if (/^VH_(Tone|Wall|Accent|Trim|Roof)/.test(material.name) && !tintable.has(material)) tintable.set(material, material.albedoColor.clone());
      if (/^VH_Glass/.test(material.name)) material.environmentIntensity = 1.4; // vidro reflete o céu
    }
    for (const mesh of body) mesh.dispose();
    body.length = 0; body.push(...visual);
    const showing = unitsFloor;
    if (showing != null) for (const mesh of body) mesh.setEnabled(false);
  })().catch((error) => console.warn(`Modelo 3D da torre ${building.name} indisponível; usando o paramétrico`, error)) : Promise.resolve();

  return {
    building, group, top, center, height: H, unitMeshes, floorBands, pickables: [hit, ...unitMeshes.values()], loaded,
    setFloorHighlight(floor) { floorBands.forEach((band, i) => band.setEnabled(i === floor)); },
    setUnitsVisible(visible, floor) {
      unitsFloor = visible ? floor : undefined;
      // Com um andar selecionado, recorta a torre acima dele para mostrar os apartamentos (como uma maquete cortada).
      const cut = visible && floor != null;
      for (const [unitId, mesh] of unitMeshes) mesh.setEnabled(visible && (floor == null || unitFloor.get(unitId) === floor));
      for (const mesh of body) mesh.setEnabled(!cut);
      cutBody.setEnabled(cut && floor! > 0);
      if (cut && floor! > 0) for (const part of cutParts) part.scaling.y = floor! * h;
      this.setSelectedUnit(selected);
    },
    setDusk(t) { dusk = t; for (const material of litMaterials) material.emissiveIntensity = t * 1.6; },
    setHover(on) {
      for (const [material, original] of tintable) Color3.LerpToRef(original, hoverTint, on ? 0.38 : 0, material.albedoColor);
    },
    setSelectedUnit(unitId) {
      selected = unitId;
      for (const [uid, mesh] of unitMeshes) {
        const unit = building.units.find((u) => u.id === uid)!;
        const isSelected = uid === unitId;
        mesh.material = isSelected ? unitMaterial(selectedColor, 1) : unitMaterial(statusColor[unit.status], unitsFloor != null ? 0.9 : 0.82);
        mesh.scaling.setAll(isSelected ? 1.1 : 1.04);
      }
    },
    unitTop(unitId) {
      const mesh = unitMeshes.get(unitId); if (!mesh) return null;
      return Vector3.TransformCoordinates(mesh.position.add(new Vector3(0, h / 2 + 0.3, 0)), group.getWorldMatrix());
    },
  };
}
