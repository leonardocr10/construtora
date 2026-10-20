import * as THREE from 'three';
import type { Building, TowerModel, Unit, UnitSlot, UnitStatus } from '../types';

export const statusColor: Record<UnitStatus, number> = { AVAILABLE: 0x22a565, RESERVED: 0xf2a33a, SOLD: 0x9a95a6, BLOCKED: 0x6b6f78, UNAVAILABLE: 0x6b6f78 };
const defaultSlots: UnitSlot[] = Array.from({ length: 8 }, (_, i) => ({ final: String(i + 1).padStart(2, '0'), side: i < 4 ? 'back' : 'front', column: i % 4 }));

/**
 * Textura de fachada (um pavimento, repetida na vertical): reboco com leve variação, faixa da laje,
 * janelas com caixilho, montante central, vidro com reflexo do céu e sombra do peitoril.
 * As proporções das janelas casam com litTexture (janelas acesas ao entardecer).
 */
function facadeTexture(base: string, columns: number) {
  const W = 512; const H = 128; const k = H / 64;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const cell = W / columns;
  // Painéis em dois tons alternados por apartamento, como nas fachadas de vendas.
  const alt = new THREE.Color(base).offsetHSL(0.03, 0.06, -0.11).getStyle();
  for (let c = 0; c < columns; c++) { ctx.fillStyle = c % 2 ? alt : base; ctx.fillRect(c * cell, 0, cell, H); }
  for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.025})`; ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  // Junta entre painéis e laje entre pavimentos.
  ctx.fillStyle = 'rgba(0,0,0,0.10)'; for (let c = 1; c < columns; c++) ctx.fillRect(c * cell - 1, 0, 2, H);
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(0, H - 7, W, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(0, H - 3, W, 3);
  const drawWindow = (wx: number, wy: number, ww: number, wh: number, mullion: boolean) => {
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(wx - 2, wy - 2, ww + 6, wh + 6); // sombra do recuo
    ctx.fillStyle = '#4f565e'; ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6); // caixilho
    const glass = ctx.createLinearGradient(0, wy, 0, wy + wh);
    glass.addColorStop(0, '#5f7687'); glass.addColorStop(0.35, '#2e3c48'); glass.addColorStop(1, '#151c23');
    ctx.fillStyle = glass; ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(wx, wy + wh * 0.5); ctx.lineTo(wx + ww * 0.4, wy); ctx.lineTo(wx + ww * 0.55, wy); ctx.lineTo(wx, wy + wh * 0.8); ctx.fill();
    if (mullion) { ctx.fillStyle = '#4f565e'; ctx.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); ctx.fillRect(wx, wy + wh * 0.3, ww, 2); }
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(wx - 4, wy + wh + 3, ww + 8, 3); // peitoril
  };
  for (let c = 0; c < columns; c++) {
    for (const [x, w] of [[0.16, 0.22], [0.58, 0.26]] as const) drawWindow(c * cell + x * cell, 20 * k, w * cell, 26 * k, true);
    drawWindow(c * cell + 0.45 * cell, 21 * k, 0.07 * cell, 8 * k, false); // janela do banheiro
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Janelas acesas ao entardecer: mapa emissivo da altura inteira, sorteando quais janelas têm luz. */
function litTexture(columns: number, floors: number, seed: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64 * floors;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  let state = seed;
  const random = () => { state = (state * 16807) % 2147483647; return state / 2147483647; };
  const cell = 256 / columns;
  for (let f = 0; f < floors; f++) {
    const y = (floors - 1 - f) * 64;
    for (let col = 0; col < columns; col++) {
      for (const [x, w] of [[0.16, 0.22], [0.58, 0.26]] as const) {
        if (random() > 0.42) continue;
        ctx.fillStyle = random() < 0.7 ? '#ffc76b' : '#ffe3a8';
        ctx.fillRect(col * cell + x * cell, y + 20, w * cell, 26);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface TowerObject {
  building: Building; group: THREE.Group; top: THREE.Vector3; center: THREE.Vector3; height: number;
  unitMeshes: Map<string, THREE.Mesh>; floorBands: THREE.Mesh[];
  pickables: THREE.Object3D[];
  setFloorHighlight(floor: number | null): void;
  setUnitsVisible(visible: boolean, floor?: number | null): void;
  setSelectedUnit(unitId: string | null): void;
  /** 0 = dia, 1 = pôr do sol: intensidade das janelas acesas. */
  setDusk(t: number): void;
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
  const coreW = Math.min(4.2, W * 0.12);
  const wingW = (W - coreW) / 2;
  const side = facadeTexture(colors.facade, columns / 2); side.repeat.set(1, floors);
  const end = facadeTexture(colors.facade, 2); end.repeat.set(1, floors);
  const plain = new THREE.MeshStandardMaterial({ color: colors.roof, roughness: 0.95 });
  const seed = [...building.id].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 2147483647, 7) || 7;
  const litSide = litTexture(columns / 2, floors, seed); const litEnd = litTexture(2, floors, seed + 13);
  const facade = (map: THREE.Texture, lit: THREE.Texture) => new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0, emissive: 0xffffff, emissiveMap: lit, emissiveIntensity: 0 });
  const nightMaterials: THREE.MeshStandardMaterial[] = [];
  const wingMaterials = [facade(end, litEnd), facade(end, litEnd), plain, plain, facade(side, litSide), facade(side, litSide)];
  nightMaterials.push(...(wingMaterials.filter((m) => m !== plain) as THREE.MeshStandardMaterial[]));
  for (const dir of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(wingW, H, D), wingMaterials);
    wing.position.set(dir * (coreW / 2 + wingW / 2), H / 2, 0);
    wing.castShadow = wing.receiveShadow = true;
    group.add(wing);
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(wingW + 0.3, 1.1, D + 0.3), plain);
    parapet.position.set(wing.position.x, H + 0.55, 0); parapet.castShadow = true;
    group.add(parapet);
  }
  const accent = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.75 });
  const core = new THREE.Mesh(new THREE.BoxGeometry(coreW, H + 3.2, D * 0.62), accent);
  core.position.set(0, (H + 3.2) / 2, 0); core.castShadow = true;
  group.add(core);

  // Varandas gourmet: lajes na cor de destaque nas extremidades de cada pavimento.
  const balconies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), accent, floors * 4);
  const dummy = new THREE.Object3D(); let b = 0;
  for (let f = 1; f < floors; f++) {
    for (const dir of [-1, 1]) for (const zDir of [-1, 1]) {
      dummy.position.set(dir * (W / 2 - 3.2), f * h + 0.15, zDir * (D / 2 + 0.7)); dummy.scale.set(5.2, 0.3, 1.4); dummy.updateMatrix();
      balconies.setMatrixAt(b++, dummy.matrix);
    }
  }
  balconies.count = b; balconies.castShadow = true;
  group.add(balconies);
  // Guarda-corpo de vidro das varandas.
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0xbfd6e2, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.1, depthWrite: false });
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), railMaterial, floors * 4);
  let r = 0;
  for (let f = 1; f < floors; f++) {
    for (const dir of [-1, 1]) for (const zDir of [-1, 1]) {
      dummy.position.set(dir * (W / 2 - 3.2), f * h + 0.85, zDir * (D / 2 + 1.38)); dummy.scale.set(5.2, 1.1, 0.06); dummy.updateMatrix();
      rails.setMatrixAt(r++, dummy.matrix);
    }
  }
  rails.count = r;
  group.add(rails);
  // Relevo da fachada: frisos de laje em volta das lâminas, pilastras entre apartamentos e platibanda.
  const trim = new THREE.MeshStandardMaterial({ color: new THREE.Color(colors.facade).offsetHSL(0, 0, 0.04), roughness: 0.85 });
  const pilasterMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colors.facade).offsetHSL(0.02, 0.03, -0.12), roughness: 0.9 });
  const cellsPerWing = Math.max(1, columns / 2);
  const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), trim, floors * 8);
  const pilasters = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), pilasterMaterial, (cellsPerWing + 1) * 4 + 8);
  let s = 0; let p = 0;
  const box = (mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
  };
  for (const dir of [-1, 1]) {
    const cx = dir * (coreW / 2 + wingW / 2);
    for (let f = 1; f <= floors; f++) {
      const y = f * h - 0.08;
      box(slabs, s++, cx, y, D / 2 + 0.07, wingW + 0.28, 0.2, 0.14); box(slabs, s++, cx, y, -D / 2 - 0.07, wingW + 0.28, 0.2, 0.14);
      box(slabs, s++, cx - dir * (wingW / 2 + 0.07), y, 0, 0.14, 0.2, D + 0.28); box(slabs, s++, cx + dir * (wingW / 2 + 0.07), y, 0, 0.14, 0.2, D + 0.28);
    }
    for (let j = 0; j <= cellsPerWing; j++) {
      const x = cx - wingW / 2 + (wingW / cellsPerWing) * j;
      for (const zDir of [-1, 1]) box(pilasters, p++, x, H / 2, zDir * (D / 2 + 0.06), 0.32, H, 0.16);
    }
    for (const xEnd of [-1, 1]) box(pilasters, p++, cx + xEnd * (wingW / 2 + 0.05), H / 2, 0, 0.14, H, D * 0.3);
  }
  slabs.count = s; pilasters.count = p;
  slabs.castShadow = pilasters.castShadow = true; slabs.receiveShadow = pilasters.receiveShadow = true;
  group.add(slabs, pilasters);
  // Núcleo de circulação: aberturas da escada por pavimento, com guarda-corpo, nas duas faces.
  const voids = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: new THREE.Color(colors.accent).multiplyScalar(0.35), roughness: 1 }), floors * 2);
  const coreRails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6, metalness: 0.4 }), floors * 4);
  let v = 0; let cr = 0;
  for (let f = 0; f < floors; f++) for (const zDir of [-1, 1]) {
    const z = zDir * (D * 0.31 + 0.01);
    box(voids, v++, 0, f * h + h * 0.62, z, coreW * 0.7, h * 0.5, 0.04);
    box(coreRails, cr++, 0, f * h + h * 0.45, z + zDir * 0.05, coreW * 0.74, 0.05, 0.05);
    box(coreRails, cr++, 0, f * h + h * 0.62, z + zDir * 0.05, coreW * 0.74, 0.04, 0.04);
  }
  voids.count = v; coreRails.count = cr;
  group.add(voids, coreRails);
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
  const cutSide = side.clone(); const cutEnd = end.clone();
  const cutMaterials = [new THREE.MeshStandardMaterial({ map: cutEnd, roughness: 0.82 }), new THREE.MeshStandardMaterial({ map: cutEnd, roughness: 0.82 }), plain, plain, new THREE.MeshStandardMaterial({ map: cutSide, roughness: 0.82 }), new THREE.MeshStandardMaterial({ map: cutSide, roughness: 0.82 })];
  const cutBody = new THREE.Group(); cutBody.visible = false;
  for (const dir of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(wingW, 1, D).translate(0, 0.5, 0), cutMaterials);
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
        cutSide.repeat.set(1, floor!); cutEnd.repeat.set(1, floor!);
      }
      this.setSelectedUnit(selected);
    },
    setDusk(t) { for (const material of nightMaterials) material.emissiveIntensity = t * 1.15; },
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
