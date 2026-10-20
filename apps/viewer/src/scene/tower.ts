import * as THREE from 'three';
import type { Building, TowerModel, Unit, UnitSlot, UnitStatus } from '../types';

export const statusColor: Record<UnitStatus, number> = { AVAILABLE: 0x22a565, RESERVED: 0xf2a33a, SOLD: 0x9a95a6, BLOCKED: 0x6b6f78, UNAVAILABLE: 0x6b6f78 };
const defaultSlots: UnitSlot[] = Array.from({ length: 8 }, (_, i) => ({ final: String(i + 1).padStart(2, '0'), side: i < 4 ? 'back' : 'front', column: i % 4 }));

export interface TowerObject {
  building: Building; group: THREE.Group; top: THREE.Vector3; center: THREE.Vector3; height: number;
  unitMeshes: Map<string, THREE.Mesh>; floorBands: THREE.Mesh[];
  pickables: THREE.Object3D[];
  setFloorHighlight(floor: number | null): void;
  setUnitsVisible(visible: boolean, floor?: number | null): void;
  setSelectedUnit(unitId: string | null): void;
  /** 0 = dia, 1 = pôr do sol: intensidade das janelas acesas. */
  setDusk(t: number): void;
  /** Realce alaranjado enquanto o mouse está sobre a torre. */
  setHover(on: boolean): void;
}

/**
 * Torre paramétrica: corpo com janelas por pavimento, núcleo de circulação e varandas na cor de destaque,
 * e um volume clicável por apartamento (posição definida pelo final em model3d.unitSlots).
 */
export function buildTower(building: Building): TowerObject {
  const model: TowerModel = building.model3d ?? { width: 32, depth: 16 };
  const floors = building.floorCount ?? (Math.max(...building.units.map((u) => u.floor ?? 0), 0) + 1);
  const h = building.floorHeight ?? 2.9;
  const W = model.width; const D = model.depth; const H = floors * h;
  const colors = { facade: '#e6ebe8', accent: '#e0622a', roof: '#d8dbd6', base: '#c9ccc6', ...model.colors };
  const slots = model.unitSlots?.length ? model.unitSlots : defaultSlots;
  const columns = Math.max(...slots.map((s) => s.column)) + 1;

  const group = new THREE.Group();
  group.name = building.name;
  const pos = building.position ?? { x: 0, z: 0 };
  group.position.set(pos.x, 0, pos.z);
  group.rotation.y = -THREE.MathUtils.degToRad(pos.rotation ?? 0);

  // Corpo: duas lâminas separadas pelo núcleo central (como no material de vendas).
  // Fachada toda em geometria (sem textura pintada): painéis por apartamento, janelas com caixilho,
  // vidro e peitoril, frisos de laje e patamares da escada no núcleo. Fica nítida de perto.
  const coreW = Math.min(4.2, W * 0.12);
  const wingW = (W - coreW) / 2;
  const facadeColor = new THREE.Color(colors.facade);
  const wall = new THREE.MeshStandardMaterial({ color: facadeColor, roughness: 0.88 });
  const plain = new THREE.MeshStandardMaterial({ color: colors.roof, roughness: 0.95 });
  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const trim = new THREE.MeshStandardMaterial({ color: facadeColor.clone().offsetHSL(0, 0, 0.05), roughness: 0.8 });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x5a6168, roughness: 0.5, metalness: 0.2 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4b59, roughness: 0.18, metalness: 0.25 });
  const litMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4b59, roughness: 0.18, metalness: 0.25, emissive: 0xffc56a, emissiveIntensity: 0 });
  const accent = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.75 });
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.5 });
  const nightMaterials = [litMaterial];
  for (const dir of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(wingW, H, D), [wall, wall, plain, plain, wall, wall]);
    wing.position.set(dir * (coreW / 2 + wingW / 2), H / 2, 0);
    wing.castShadow = wing.receiveShadow = true;
    group.add(wing);
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(wingW + 0.3, 1.1, D + 0.3), trim);
    parapet.position.set(wing.position.x, H + 0.55, 0); parapet.castShadow = true;
    group.add(parapet);
  }
  const core = new THREE.Mesh(new THREE.BoxGeometry(coreW, H + 3.2, D * 0.62), accent);
  core.position.set(0, (H + 3.2) / 2, 0); core.castShadow = true;
  group.add(core);

  // Peças instanciadas: cada lista vira um InstancedMesh de caixas unitárias.
  const dummy = new THREE.Object3D();
  const lists = { panels: [] as THREE.Matrix4[], frames: [] as THREE.Matrix4[], glass: [] as THREE.Matrix4[], lit: [] as THREE.Matrix4[], sills: [] as THREE.Matrix4[], slabs: [] as THREE.Matrix4[], landings: [] as THREE.Matrix4[], rails: [] as THREE.Matrix4[], voids: [] as THREE.Matrix4[] };
  const panelColors: THREE.Color[] = [];
  /** Caixa numa face: (u, y) no plano da face, `out` metros para fora; normal no eixo x (nx) ou z (nz). */
  const onFace = (list: THREE.Matrix4[], fx: number, fz: number, nx: number, nz: number, u: number, y: number, out: number, sw: number, sh: number, sd: number) => {
    dummy.position.set(fx + (nz ? u : 0) + nx * out, y, fz + (nx ? u : 0) + nz * out);
    dummy.rotation.set(0, nx ? Math.PI / 2 : 0, 0); dummy.scale.set(sw, sh, sd); dummy.updateMatrix();
    list.push(dummy.matrix.clone());
  };
  const box = (list: THREE.Matrix4[], x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); list.push(dummy.matrix.clone());
  };
  let seed = [...building.id].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 2147483647, 7) || 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // Segundo tom dos painéis: puxado para um verde-acinzentado, como nas fachadas de vendas.
  const alt = facadeColor.clone().lerp(new THREE.Color(0x9cb8b0), 0.38);
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
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const instanced = (list: THREE.Matrix4[], material: THREE.Material, shadow = true) => {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(unitBox, material, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const panels = instanced(lists.panels, panelMaterial)!;
  panelColors.forEach((color, i) => panels.setColorAt(i, color));
  instanced(lists.frames, frameMaterial, false); instanced(lists.glass, glassMaterial, false); instanced(lists.lit, litMaterial, false);
  instanced(lists.sills, trim, false); instanced(lists.slabs, trim); instanced(lists.landings, accent); instanced(lists.rails, railMaterial, false);
  instanced(lists.voids, new THREE.MeshStandardMaterial({ color: new THREE.Color(colors.accent).multiplyScalar(0.3), roughness: 1 }), false);
  // Casa de máquinas e caixa d'água sobre a cobertura.
  const machine = new THREE.Mesh(new THREE.BoxGeometry(Math.min(7, W * 0.2), 2.4, D * 0.36), plain);
  machine.position.set(-(coreW / 2 + wingW / 2), H + 2.3, 0); machine.castShadow = true;
  group.add(machine);
  const base = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 0.4, D + 4), new THREE.MeshStandardMaterial({ color: colors.base, roughness: 1 }));
  base.position.y = 0.2; base.receiveShadow = true;
  group.add(base);

  // Volumes por apartamento (invisíveis até a seleção por andar) e faixas de pavimento.
  const unitMeshes = new Map<string, THREE.Mesh>();
  const colW = W / columns;
  const unitGeometry = new THREE.BoxGeometry(colW - 0.5, h - 0.25, D / 2 - 0.4);
  const byFloorFinal = new Map(building.units.map((u) => [`${u.floor}|${u.final}`, u] as const));
  for (let f = 0; f < floors; f++) {
    for (const slot of slots) {
      const unit = byFloorFinal.get(`${f}|${slot.final}`); if (!unit) continue;
      const material = new THREE.MeshLambertMaterial({ color: statusColor[unit.status], transparent: true, opacity: 0.82, depthWrite: false });
      const mesh = new THREE.Mesh(unitGeometry, material);
      mesh.position.set(-W / 2 + colW * (slot.column + 0.5), f * h + h / 2, (slot.side === 'front' ? -1 : 1) * (D / 4));
      mesh.scale.setScalar(1.04);
      mesh.visible = false;
      mesh.userData = { unitId: unit.id, buildingId: building.id, floor: f };
      group.add(mesh);
      unitMeshes.set(unit.id, mesh);
    }
  }
  const bandMaterial = new THREE.MeshBasicMaterial({ color: 0xf2a33a, transparent: true, opacity: 0.32, depthWrite: false });
  const floorBands = Array.from({ length: floors }, (_, f) => {
    const band = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, h * 0.92, D + 1.2), bandMaterial);
    band.position.y = f * h + h / 2; band.visible = false;
    group.add(band);
    return band;
  });

  // Corpo recortado: mostra só os pavimentos abaixo do andar selecionado.
  const cutBody = new THREE.Group(); cutBody.visible = false;
  for (const dir of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(wingW, 1, D).translate(0, 0.5, 0), [wall, wall, plain, plain, wall, wall]);
    wing.position.x = dir * (coreW / 2 + wingW / 2); wing.castShadow = wing.receiveShadow = true;
    cutBody.add(wing);
  }
  const cutCore = new THREE.Mesh(new THREE.BoxGeometry(coreW, 1, D * 0.62).translate(0, 0.5, 0), accent);
  cutBody.add(cutCore);
  group.add(cutBody);

  // Caixa de clique da torre inteira.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(W + 2, H + 4, D + 3), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = (H + 4) / 2; hit.userData = { buildingId: building.id };
  group.add(hit);

  group.updateMatrixWorld(true);
  const center = new THREE.Vector3(0, H / 2, 0).applyMatrix4(group.matrixWorld);
  const top = new THREE.Vector3(0, H + 6, 0).applyMatrix4(group.matrixWorld);
  const wings = group.children.filter((c) => c instanceof THREE.Mesh && c !== hit && c !== base && !unitMeshes.has(c.userData.unitId) && !(floorBands as THREE.Object3D[]).includes(c));
  let selected: string | null = null; let unitsFloor: number | null | undefined;
  // Materiais do corpo que recebem o realce de hover (cor original guardada para voltar).
  const hoverTint = new THREE.Color(0xff8a3d);
  const tintable = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  for (const material of [wall, plain, panelMaterial, trim, accent]) tintable.set(material, material.color.clone());

  return {
    building, group, top, center, height: H, unitMeshes, floorBands, pickables: [hit, ...unitMeshes.values()],
    setFloorHighlight(floor) { floorBands.forEach((band, i) => { band.visible = i === floor; }); },
    setUnitsVisible(visible, floor) {
      unitsFloor = visible ? floor : undefined;
      // Com um andar selecionado, recorta a torre acima dele para mostrar os apartamentos (como uma maquete cortada).
      const cut = visible && floor != null;
      for (const mesh of unitMeshes.values()) mesh.visible = visible && (floor == null || mesh.userData.floor === floor);
      for (const object of wings) object.visible = !cut;
      cutBody.visible = cut && floor! > 0;
      if (cut && floor! > 0) {
        for (const child of cutBody.children) child.scale.y = floor! * h;
      }
      this.setSelectedUnit(selected);
    },
    setDusk(t) { for (const material of nightMaterials) material.emissiveIntensity = t * 1.6; },
    setHover(on) {
      for (const [material, base] of tintable) material.color.copy(base).lerp(hoverTint, on ? 0.38 : 0);
    },
    setSelectedUnit(unitId) {
      selected = unitId;
      for (const [id, mesh] of unitMeshes) {
        const material = mesh.material as THREE.MeshLambertMaterial;
        const unit = building.units.find((u) => u.id === id) as Unit;
        const isSelected = id === unitId;
        material.color.setHex(isSelected ? 0xe0622a : statusColor[unit.status]);
        material.opacity = isSelected ? 1 : unitsFloor != null ? 0.95 : 0.82;
        mesh.scale.setScalar(isSelected ? 1.1 : 1.04);
      }
    },
  };
}
