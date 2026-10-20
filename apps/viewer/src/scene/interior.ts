import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { PlanLayout, Point, RoomKind } from '../types';

/**
 * Planta 3D mobiliada gerada da planta vetorizada: paredes com vãos de portas e janelas, piso por
 * cômodo e mobiliário ilustrativo posicionado automaticamente encostado nas paredes livres.
 * Dois modos: maquete (vista de cima, sem teto) e passeio em primeira pessoa.
 */

type Room = PlanLayout['rooms'][number];
interface Box2 { x0: number; y0: number; x1: number; y1: number; tallOnly?: boolean }
type Side = { axis: 'x' | 'y'; fixed: number; from: number; to: number; normal: Point };

const eye = 1.6;
const inset = 0.08;
const roomLabel: Record<RoomKind, string> = { living: 'Sala', kitchen: 'Cozinha', bedroom: 'Quarto', suite: 'Suíte', bathroom: 'Banheiro', balcony: 'Varanda', service: 'Área de serviço', hall: 'Circulação', garden: 'Garden' };

// ——— materiais ———
const mat = (color: string, roughness = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, metersPerTile: number) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(1 / metersPerTile, 1 / metersPerTile); texture.anisotropy = 8;
  return texture;
}
function wood(base: string) {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    const rows = 8; const h = s / rows;
    for (let r = 0; r < rows; r++) {
      const shift = (r % 3) * s / 3;
      for (let k = 0; k < 2; k++) {
        const x = (shift + k * s / 2) % s;
        const tone = 0.88 + ((r * 7 + k * 3) % 5) * 0.035;
        g.fillStyle = `rgba(${tone > 1 ? 255 : 0},${tone > 1 ? 240 : 0},0,${Math.abs(1 - tone) * 0.9})`;
        g.fillRect(x, r * h, s / 2, h);
        g.fillStyle = 'rgba(60,35,15,0.35)'; g.fillRect(x, r * h, 2, h);
      }
      g.fillStyle = 'rgba(60,35,15,0.35)'; g.fillRect(0, r * h, s, 2);
      for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(90,55,25,0.08)'; g.beginPath(); const y = r * h + Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(s / 3, y + 4, s * 2 / 3, y - 4, s, y); g.stroke(); }
    }
  }, 1.6);
}
function tiles(base: string, grout: string, metersPerTile: number) {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = grout; g.fillRect(0, 0, s, s);
    const n = 2; const t = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = base; g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(i * t + 2, j * t + 2, t - 4, (t - 4) / 2); }
  }, metersPerTile);
}

const palette = {
  wall: mat('#f4f1ec', 0.92), cap: mat('#3d3a44', 0.9), ceiling: mat('#fbfaf8', 0.95, { side: THREE.DoubleSide }),
  glass: new THREE.MeshPhysicalMaterial({ color: '#cfe6f2', roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.35, metalness: 0 }),
  frame: mat('#2f2f35', 0.5, { metalness: 0.4 }), door: mat('#d9c3a3', 0.7), sill: mat('#e9e6e1', 0.6),
  fabric: mat('#8f9aa8', 0.95), fabricDark: mat('#59606d', 0.95), cushion: mat('#d9b98a', 0.95), linen: mat('#f2eee7', 0.95), blanket: mat('#5d7f8f', 0.95),
  woodDark: mat('#6b4a32', 0.7), woodLight: mat('#c9a57a', 0.7), white: mat('#f7f7f5', 0.4), black: mat('#1e1e22', 0.4), steel: mat('#c9ccd0', 0.3, { metalness: 0.7 }),
  porcelain: mat('#ffffff', 0.2), mirror: mat('#d7e3ea', 0.05, { metalness: 0.9 }), counterTop: mat('#3b3a3f', 0.35), rug: mat('#c8b9a6', 1), plant: mat('#4f8a4b', 0.9), pot: mat('#b9643f', 0.8), soil: mat('#4a3626', 1),
};
const floorFor: Record<RoomKind, () => THREE.Material> = {
  living: () => mat('#ffffff', 0.6, { map: wood('#b98b5e') }), bedroom: () => mat('#ffffff', 0.6, { map: wood('#c49a6c') }), suite: () => mat('#ffffff', 0.6, { map: wood('#c49a6c') }),
  hall: () => mat('#ffffff', 0.6, { map: wood('#b98b5e') }), kitchen: () => mat('#ffffff', 0.4, { map: tiles('#e7e3dc', '#c9c3b8', 0.9) }),
  bathroom: () => mat('#ffffff', 0.35, { map: tiles('#dfe3e4', '#b8bfc2', 0.6) }), service: () => mat('#ffffff', 0.4, { map: tiles('#e7e3dc', '#c9c3b8', 0.6) }),
  balcony: () => mat('#ffffff', 0.6, { map: tiles('#c9b8a3', '#9e8e7a', 0.6) }), garden: () => mat('#6fa35a', 1),
};

function box(w: number, h: number, d: number, material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y + h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function cylinder(r: number, h: number, material: THREE.Material, x = 0, y = 0, z = 0, top = r) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, r, h, 20), material);
  mesh.position.set(x, y + h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
const group = (...children: THREE.Object3D[]) => { const g = new THREE.Group(); g.add(...children); return g; };

// ——— mobiliário (origem no centro da base; costas em -z, frente em +z) ———
const furniture = {
  bed(w: number, d: number) {
    const g = group(box(w, 0.3, d, palette.woodLight), box(w - 0.06, 0.22, d - 0.1, palette.linen, 0, 0.3, 0.03), box(w + 0.1, 1.05, 0.08, palette.woodDark, 0, 0, -d / 2 + 0.04), box(w - 0.04, 0.06, d * 0.58, palette.blanket, 0, 0.52, d * 0.2));
    const pillows = w > 1.2 ? [-w / 4, w / 4] : [0];
    for (const x of pillows) g.add(box(Math.min(0.6, w / pillows.length - 0.1), 0.12, 0.35, palette.white, x, 0.52, -d / 2 + 0.3));
    return g;
  },
  nightstand: () => group(box(0.45, 0.5, 0.4, palette.woodDark), cylinder(0.09, 0.03, palette.black, 0, 0.5, 0), cylinder(0.02, 0.25, palette.steel, 0, 0.53, 0), cylinder(0.12, 0.16, palette.linen, 0, 0.75, 0, 0.08)),
  wardrobe(w: number) {
    const g = group(box(w, 2.1, 0.6, palette.white));
    const doors = Math.max(2, Math.round(w / 0.5));
    for (let i = 1; i < doors; i++) g.add(box(0.01, 2.0, 0.01, palette.frame, -w / 2 + (w / doors) * i, 0.05, 0.3));
    for (let i = 0; i < doors; i++) g.add(box(0.02, 0.3, 0.02, palette.steel, -w / 2 + (w / doors) * (i + 0.5) + (i % 2 ? -0.08 : 0.08), 0.95, 0.31));
    return g;
  },
  sofa(w: number) {
    const d = 0.88;
    const g = group(box(w, 0.42, d, palette.fabric), box(w, 0.42, 0.2, palette.fabric, 0, 0.42, -d / 2 + 0.1), box(0.16, 0.24, d, palette.fabric, -w / 2 + 0.08, 0.42), box(0.16, 0.24, d, palette.fabric, w / 2 - 0.08, 0.42));
    const seats = Math.max(2, Math.round((w - 0.32) / 0.7));
    const sw = (w - 0.34) / seats;
    for (let i = 0; i < seats; i++) g.add(box(sw - 0.03, 0.12, d - 0.26, palette.fabricDark, -w / 2 + 0.17 + sw * (i + 0.5), 0.42, 0.08));
    g.add(box(0.4, 0.35, 0.12, palette.cushion, -w / 2 + 0.45, 0.5, -d / 2 + 0.28), box(0.4, 0.35, 0.12, palette.cushion, w / 2 - 0.45, 0.5, -d / 2 + 0.28));
    return g;
  },
  tv: (w: number) => group(box(w, 0.45, 0.4, palette.woodDark), box(Math.min(1.25, w - 0.2), 0.72, 0.05, palette.black, 0, 0.75, -0.08), box(0.3, 0.03, 0.2, palette.black, 0, 0.45, -0.05)),
  coffeeTable: () => group(box(0.9, 0.04, 0.5, palette.woodLight, 0, 0.36), ...[[-0.4, -0.2], [0.4, -0.2], [-0.4, 0.2], [0.4, 0.2]].map(([x, z]) => box(0.04, 0.36, 0.04, palette.black, x, 0, z))),
  rug: (w: number, d: number) => { const m = box(w, 0.01, d, palette.rug); m.castShadow = false; return group(m); },
  dining(w: number, d: number) {
    const g = group(box(w, 0.04, d, palette.woodLight, 0, 0.72), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => box(0.05, 0.72, 0.05, palette.woodDark, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08))));
    const chair = (x: number, z: number, rot: number) => { const c = group(box(0.44, 0.45, 0.44, palette.fabricDark), box(0.44, 0.45, 0.06, palette.fabricDark, 0, 0.45, -0.19)); c.position.set(x, 0, z); c.rotation.y = rot; return c; };
    const seats = w > 1.3 ? [-w / 4, w / 4] : [0];
    for (const x of seats) { g.add(chair(x, -d / 2 - 0.15, 0), chair(x, d / 2 + 0.15, Math.PI)); }
    return g;
  },
  counter(w: number) {
    const g = group(box(w, 0.86, 0.6, palette.white), box(w, 0.04, 0.62, palette.counterTop, 0, 0.86, 0.01));
    if (w >= 1.2) { g.add(box(0.5, 0.02, 0.4, palette.steel, -w / 2 + 0.45, 0.89, 0.02)); g.add(cylinder(0.015, 0.3, palette.steel, -w / 2 + 0.45, 0.9, -0.22)); }
    if (w >= 1.8) { g.add(box(0.58, 0.015, 0.5, palette.black, w / 2 - 0.5, 0.9, 0.02)); for (const [x, z] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) g.add(cylinder(0.07, 0.01, palette.steel, w / 2 - 0.5 + x, 0.915, 0.02 + z)); }
    return g;
  },
  upper: (w: number) => { const m = box(w, 0.7, 0.35, palette.white); m.position.y += 1.5; return group(m); },
  fridge: () => group(box(0.7, 1.85, 0.68, palette.steel), box(0.02, 0.5, 0.03, palette.black, 0.3, 1.1, 0.35), box(0.02, 0.4, 0.03, palette.black, 0.3, 0.4, 0.35), box(0.7, 0.01, 0.01, palette.black, 0, 1.0, 0.345)),
  toilet: () => group(box(0.38, 0.4, 0.2, palette.porcelain, 0, 0, -0.22), cylinder(0.19, 0.4, palette.porcelain, 0, 0, 0.08, 0.2), box(0.38, 0.4, 0.17, palette.porcelain, 0, 0.4, -0.25)),
  vanity: (w = 0.8) => group(box(w, 0.8, 0.46, palette.woodDark), box(w + 0.02, 0.05, 0.48, palette.porcelain, 0, 0.8), cylinder(0.17, 0.02, palette.steel, 0, 0.84, 0.03), cylinder(0.012, 0.22, palette.steel, 0, 0.85, -0.17), box(w - 0.1, 0.8, 0.02, palette.mirror, 0, 1.15, -0.22)),
  shower() {
    const g = group(box(0.9, 0.05, 0.9, palette.porcelain), box(0.9, 1.95, 0.01, palette.glass, 0, 0.05, 0.45), box(0.01, 1.95, 0.9, palette.glass, 0.45, 0.05, 0), cylinder(0.1, 0.02, palette.steel, 0, 2.0, -0.3));
    for (const m of g.children) m.castShadow = false;
    return g;
  },
  washer: () => group(box(0.6, 0.85, 0.6, palette.white), cylinder(0.2, 0.02, palette.black, 0, 0.45, 0.3)),
  tank: () => group(box(0.55, 0.85, 0.5, palette.white), box(0.45, 0.05, 0.35, palette.steel, 0, 0.83, 0.03)),
  chair: () => group(box(0.5, 0.42, 0.5, palette.woodLight), box(0.5, 0.42, 0.06, palette.woodLight, 0, 0.42, -0.22)),
  sideTable: () => group(cylinder(0.25, 0.03, palette.white, 0, 0.6, 0), cylinder(0.03, 0.6, palette.black)),
  plant(scale = 1) {
    const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 * scale, 1), palette.plant);
    foliage.position.y = 0.75 * scale; foliage.scale.y = 1.3; foliage.castShadow = true;
    return group(cylinder(0.17 * scale, 0.42 * scale, palette.pot, 0, 0, 0, 0.2 * scale), cylinder(0.18 * scale, 0.02, palette.soil, 0, 0.41 * scale, 0), foliage);
  },
};

// ——— geometria auxiliar em coordenadas da planta (x, y) ———
const polygonArea = (pts: Point[]) => Math.abs(pts.reduce((s, [x1, y1], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x1 * y2 - x2 * y1; }, 0)) / 2;
/** Centroide de área do polígono (cai dentro da parte maior do cômodo em formas em L). */
function centroid(pts: Point[]): Point {
  let a = 0, cx = 0, cy = 0;
  pts.forEach(([x1, y1], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; const k = x1 * y2 - x2 * y1; a += k; cx += (x1 + x2) * k; cy += (y1 + y2) * k; });
  if (Math.abs(a) < 1e-9) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [cx / (3 * a), cy / (3 * a)];
}
function inside([px, py]: Point, poly: Point[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const overlaps = (a: Box2, b: Box2) => a.x0 < b.x1 - 0.01 && a.x1 > b.x0 + 0.01 && a.y0 < b.y1 - 0.01 && a.y1 > b.y0 + 0.01;

/** Distribui o mobiliário de um cômodo evitando portas, janelas (para móveis altos) e outros móveis. */
class Furnisher {
  readonly placed: Box2[] = [];
  readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number;
  constructor(private readonly room: Room, private readonly obstacles: Box2[], private readonly out: THREE.Group, private readonly toWorld: (p: Point) => THREE.Vector3) {
    const xs = room.points.map((p) => p[0]); const ys = room.points.map((p) => p[1]);
    this.minX = Math.min(...xs) + inset; this.maxX = Math.max(...xs) - inset; this.minY = Math.min(...ys) + inset; this.maxY = Math.max(...ys) - inset;
  }
  get width() { return this.maxX - this.minX; }
  get depth() { return this.maxY - this.minY; }
  get area() { return polygonArea(this.room.points); }

  sides(): Side[] {
    return ([
      { axis: 'x', fixed: this.minY, from: this.minX, to: this.maxX, normal: [0, 1] },
      { axis: 'x', fixed: this.maxY, from: this.minX, to: this.maxX, normal: [0, -1] },
      { axis: 'y', fixed: this.minX, from: this.minY, to: this.maxY, normal: [1, 0] },
      { axis: 'y', fixed: this.maxX, from: this.minY, to: this.maxY, normal: [-1, 0] },
    ] as Side[]).sort((a, b) => (b.to - b.from) - (a.to - a.from));
  }

  private footprint(side: Side, u: number, w: number, d: number): Box2 {
    if (side.axis === 'x') { const y0 = side.normal[1] > 0 ? side.fixed : side.fixed - d; return { x0: u - w / 2, x1: u + w / 2, y0, y1: y0 + d }; }
    const x0 = side.normal[0] > 0 ? side.fixed : side.fixed - d; return { x0, x1: x0 + d, y0: u - w / 2, y1: u + w / 2 };
  }
  private free(b: Box2, tall: boolean) {
    const c: Point = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    if (b.x0 < this.minX - 0.01 || b.x1 > this.maxX + 0.01 || b.y0 < this.minY - 0.01 || b.y1 > this.maxY + 0.01 || !inside(c, this.room.points)) return false;
    return !this.obstacles.some((o) => (tall || !o.tallOnly) && overlaps(b, o)) && !this.placed.some((o) => overlaps(b, o));
  }

  /** Encosta o móvel numa parede; prefer: 'center' | 'start' | 'end' ou uma coordenada ao longo da parede. */
  wall(model: THREE.Object3D, w: number, d: number, opts: { tall?: boolean; prefer?: 'center' | 'start' | 'end' | number; sides?: Side[] } = {}) {
    for (const side of opts.sides ?? this.sides()) {
      if (side.to - side.from < w) continue;
      const lo = side.from + w / 2; const hi = side.to - w / 2;
      const target = typeof opts.prefer === 'number' ? opts.prefer : opts.prefer === 'start' ? lo : opts.prefer === 'end' ? hi : (lo + hi) / 2;
      let best: number | null = null;
      for (let u = lo; u <= hi + 1e-6; u += 0.05) {
        if (this.free(this.footprint(side, u, w, d), !!opts.tall) && (best == null || Math.abs(u - target) < Math.abs(best - target))) best = u;
      }
      if (best == null) continue;
      return this.put(model, this.footprint(side, best, w, d), side.normal, side, best);
    }
    return null;
  }

  /** Móvel solto (mesa, tapete): posição livre mais próxima do ponto preferido. */
  center(model: THREE.Object3D, w: number, d: number, near: Point, facing: Point = [0, 1], margin = 0) {
    let best: { b: Box2; score: number } | null = null;
    const swap = Math.abs(facing[0]) > 0.5;
    const fw = swap ? d : w; const fd = swap ? w : d;
    for (let x = this.minX + fw / 2; x <= this.maxX - fw / 2 + 1e-6; x += 0.1) for (let y = this.minY + fd / 2; y <= this.maxY - fd / 2 + 1e-6; y += 0.1) {
      const b = { x0: x - fw / 2 - margin, x1: x + fw / 2 + margin, y0: y - fd / 2 - margin, y1: y + fd / 2 + margin };
      if (!this.free(b, false)) continue;
      const score = Math.hypot(x - near[0], y - near[1]);
      if (!best || score < best.score) best = { b, score };
    }
    if (!best) return null;
    const b = { x0: best.b.x0 + margin, x1: best.b.x1 - margin, y0: best.b.y0 + margin, y1: best.b.y1 - margin };
    return this.put(model, b, facing, null, 0, margin);
  }

  private put(model: THREE.Object3D, b: Box2, normal: Point, side: Side | null, u: number, margin = 0) {
    this.placed.push({ x0: b.x0 - margin, x1: b.x1 + margin, y0: b.y0 - margin, y1: b.y1 + margin });
    const c: Point = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    model.position.copy(this.toWorld(c));
    model.rotation.y = Math.atan2(normal[0], normal[1]);
    this.out.add(model);
    return { box: b, center: c, normal, side, u };
  }
  opposite(side: Side) { return this.sides().find((s) => s.axis === side.axis && s.fixed !== side.fixed)!; }
}

function furnish(f: Furnisher, kind: RoomKind) {
  const area = f.area;
  switch (kind) {
    case 'suite':
    case 'bedroom': {
      const double = kind === 'suite' || area >= 8.5;
      const bw = double ? (kind === 'suite' && area > 11 ? 1.6 : 1.4) : 0.9; const bd = double ? 1.95 : 1.9;
      const bed = f.wall(furniture.bed(bw, bd), bw, bd, { prefer: 'center' });
      if (bed?.side) for (const s of double ? [-1, 1] : [1]) f.wall(furniture.nightstand(), 0.45, 0.4, { prefer: bed.u + s * (bw / 2 + 0.25), sides: [bed.side] });
      f.wall(furniture.wardrobe(area > 10 ? 1.8 : 1.4), area > 10 ? 1.8 : 1.4, 0.6, { tall: true, prefer: 'end' }) ?? f.wall(furniture.wardrobe(1), 1, 0.6, { tall: true });
      if (area > 11) f.wall(furniture.plant(0.9), 0.4, 0.4, { prefer: 'start' });
      break;
    }
    case 'living': {
      const sofaW = Math.min(2.2, Math.max(1.5, f.width * 0.55, f.depth * 0.55));
      const sofa = f.wall(furniture.sofa(sofaW), sofaW, 0.88, { prefer: 'center' }) ?? f.wall(furniture.sofa(1.5), 1.5, 0.88);
      if (sofa?.side) {
        const opp = f.opposite(sofa.side);
        f.wall(furniture.tv(1.6), 1.6, 0.4, { prefer: sofa.u, sides: [opp] }) ?? f.wall(furniture.tv(1.2), 1.2, 0.4, { sides: [opp] });
        const front: Point = [sofa.center[0] + sofa.normal[0] * 1.0, sofa.center[1] + sofa.normal[1] * 1.0];
        f.center(furniture.rug(Math.min(2, sofaW), 1.4), Math.min(2, sofaW), 1.4, front, sofa.normal);
        f.placed.pop(); // o tapete fica sob a mesa de centro
        f.center(furniture.coffeeTable(), 0.9, 0.5, front, sofa.normal, 0.25);
      }
      if (area > 12) {
        const far: Point = sofa ? [sofa.center[0] + sofa.normal[0] * 8, sofa.center[1] + sofa.normal[1] * 8] : centroid([[f.minX, f.minY], [f.maxX, f.maxY]]);
        f.center(furniture.dining(1.2, 0.8), 1.2, 0.8, far, [0, 1], 0.55);
      }
      f.wall(furniture.plant(), 0.4, 0.4, { prefer: 'start' });
      break;
    }
    case 'kitchen': {
      const cw = Math.min(2.6, Math.max(1.2, Math.max(f.width, f.depth) - 0.9));
      const counter = f.wall(furniture.counter(cw), cw, 0.6, { prefer: 'start' }) ?? f.wall(furniture.counter(1.2), 1.2, 0.6);
      if (counter?.side) f.wall(furniture.fridge(), 0.7, 0.68, { tall: true, prefer: 'end', sides: [counter.side] }) ?? f.wall(furniture.fridge(), 0.7, 0.68, { tall: true });
      else f.wall(furniture.fridge(), 0.7, 0.68, { tall: true });
      if (area > 9) f.center(furniture.dining(0.9, 0.7), 0.9, 0.7, [(f.minX + f.maxX) / 2, (f.minY + f.maxY) / 2], [0, 1], 0.5);
      break;
    }
    case 'bathroom': {
      f.wall(furniture.shower(), 0.9, 0.9, { tall: true, prefer: 'end' }) ?? f.wall(furniture.shower(), 0.9, 0.9, { prefer: 'end' });
      f.wall(furniture.toilet(), 0.42, 0.65, { prefer: 'start' });
      f.wall(furniture.vanity(), 0.8, 0.46, { prefer: 'center' }) ?? f.wall(furniture.vanity(0.6), 0.6, 0.46, { prefer: 'center' });
      break;
    }
    case 'service': f.wall(furniture.washer(), 0.6, 0.6, { prefer: 'start' }); f.wall(furniture.tank(), 0.55, 0.5, { prefer: 'end' }); break;
    case 'balcony': {
      const table = f.center(furniture.sideTable(), 0.5, 0.5, [(f.minX + f.maxX) / 2, (f.minY + f.maxY) / 2], [0, 1], 0.1);
      if (table) for (const dx of [-0.6, 0.6]) {
        const horizontal = f.width >= f.depth;
        const p: Point = horizontal ? [table.center[0] + dx, table.center[1]] : [table.center[0], table.center[1] + dx];
        f.center(furniture.chair(), 0.5, 0.5, p, horizontal ? [-Math.sign(dx), 0] : [0, -Math.sign(dx)]);
      }
      f.wall(furniture.plant(), 0.4, 0.4, { prefer: 'end' });
      break;
    }
    case 'garden': for (const prefer of ['start', 'end'] as const) f.wall(furniture.plant(1.4), 0.6, 0.6, { prefer }); break;
    case 'hall': break;
  }
}

export interface InteriorOptions { title: string; subtitle?: string; onClose?: () => void }

/** Sobreposição em tela cheia com a planta 3D mobiliada. */
export class InteriorViewer {
  private readonly root: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
  private readonly controls: OrbitControls;
  private readonly ceilings: THREE.Object3D[] = [];
  /** Paredes: na maquete ficam rebaixadas (corte a ~1,1 m) para mostrar os ambientes. */
  private readonly wallGroups: THREE.Object3D[] = [];
  private readonly walls: { a: Point; b: Point; t: number; doors: [number, number][] }[] = [];
  private readonly rooms: { room: Room; center: Point; look: Point }[] = [];
  private readonly keys = new Set<string>();
  private readonly offset: Point;
  private readonly size: number;
  private mode: 'model' | 'walk' = 'model';
  private walk = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private glide: { from: THREE.Vector3; to: THREE.Vector3; fromYaw: number; toYaw: number; t: number } | null = null;
  private frame = 0;
  private last = performance.now();
  private readonly onKey = (e: KeyboardEvent) => this.key(e);
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private readonly onResize = () => this.resize();

  constructor(private readonly layout: PlanLayout, private readonly options: InteriorOptions) {
    const pts = [...layout.walls.flatMap((w) => [w.a, w.b]), ...layout.rooms.flatMap((r) => r.points)];
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    this.offset = [(minX + maxX) / 2, (minY + maxY) / 2];
    this.size = Math.max(maxX - minX, maxY - minY, 4);

    this.root = document.createElement('div');
    this.root.className = 'interior';
    this.root.innerHTML = `
      <div class="interior-top">
        <div class="interior-title"><b></b><small></small></div>
        <div class="card group"><button class="btn on" data-mode="model">⬚ Maquete</button><button class="btn" data-mode="walk">◉ Passeio</button></div>
        <button class="interior-x" aria-label="Fechar">×</button>
      </div>
      <div class="interior-rooms card"></div>
      <div class="interior-hint"></div>
      <div class="interior-pad"><button data-k="arrowup">▲</button><button data-k="arrowleft">◀</button><button data-k="arrowdown">▼</button><button data-k="arrowright">▶</button></div>
      <p class="interior-note">Mobiliário e acabamentos meramente ilustrativos. Medidas aproximadas a partir da planta.</p>`;
    (this.root.querySelector('.interior-title b') as HTMLElement).textContent = options.title;
    (this.root.querySelector('.interior-title small') as HTMLElement).textContent = options.subtitle ?? '';
    document.getElementById('app')!.appendChild(this.root);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.root.prepend(this.renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose();
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#e9ece8');

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
    this.controls.minDistance = 2; this.controls.maxDistance = this.size * 3;

    this.build();
    this.bind();
    this.resize();
    this.setMode('model');
    this.loop();
  }

  private toWorld = ([x, y]: Point, h = 0) => new THREE.Vector3(x - this.offset[0], h, y - this.offset[1]);

  private build() {
    const L = this.layout; const H = L.wallHeight;
    const s = this.size;
    const sun = new THREE.DirectionalLight('#fff3e2', 2.2);
    sun.position.set(s * 0.6, s * 1.4, s * 0.8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: s * 4 });
    this.scene.add(sun, new THREE.HemisphereLight('#f5f7fb', '#b8ad9c', 1.1));

    const ground = new THREE.Mesh(new THREE.CircleGeometry(s * 3, 48), mat('#d6d9d2', 1));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    this.scene.add(ground);

    // Pisos e tetos por cômodo
    for (const room of L.rooms) {
      const shape = new THREE.Shape(room.points.map(([x, y]) => new THREE.Vector2(x - this.offset[0], -(y - this.offset[1]))));
      const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorFor[room.kind]());
      floor.rotation.x = -Math.PI / 2; floor.position.y = 0.005; floor.receiveShadow = true;
      this.scene.add(floor);
      if (room.kind !== 'balcony' && room.kind !== 'garden') {
        const ceiling = new THREE.Mesh(new THREE.ShapeGeometry(shape), palette.ceiling);
        ceiling.rotation.x = -Math.PI / 2; ceiling.position.y = H; this.ceilings.push(ceiling); this.scene.add(ceiling);
      }
    }

    // Paredes com vãos
    const obstacles: Box2[] = [];
    const wallMaterials = [palette.wall, palette.wall, palette.cap, palette.wall, palette.wall, palette.wall];
    for (const wall of L.walls) {
      const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]); const t = wall.thickness;
      const ux = (wall.b[0] - wall.a[0]) / len, uy = (wall.b[1] - wall.a[1]) / len;
      const g = new THREE.Group(); g.position.copy(this.toWorld(wall.a)); g.rotation.y = -Math.atan2(uy, ux);
      const piece = (s0: number, s1: number, y0: number, y1: number, material: THREE.Material | THREE.Material[] = wallMaterials, depth = t) => {
        if (s1 - s0 < 0.005 || y1 - y0 < 0.005) return;
        const m = box(s1 - s0, y1 - y0, depth, material, (s0 + s1) / 2, y0, 0); g.add(m);
      };
      const openings = L.openings.filter((o) => o.wallId === wall.id).sort((p, q) => p.offset - q.offset);
      const doors: [number, number][] = [];
      let cursor = -t / 2;
      for (const o of openings) {
        const s0 = Math.max(0, o.offset - o.width / 2), s1 = Math.min(len, o.offset + o.width / 2);
        piece(cursor, s0, 0, H);
        const at = (u: number): Point => [wall.a[0] + ux * u, wall.a[1] + uy * u];
        const [p0, p1] = [at(s0), at(s1)];
        const bx = { x0: Math.min(p0[0], p1[0]), x1: Math.max(p0[0], p1[0]), y0: Math.min(p0[1], p1[1]), y1: Math.max(p0[1], p1[1]) };
        if (o.kind === 'window') {
          const sill = o.sill ?? 1.1; const top = Math.min(H - 0.05, sill + (o.height ?? 1.0));
          piece(s0, s1, 0, sill); piece(s0, s1, top, H);
          piece(s0 - 0.02, s1 + 0.02, sill - 0.03, sill, palette.sill, t + 0.08);
          const glass = box(s1 - s0 - 0.04, top - sill - 0.04, 0.02, palette.glass, (s0 + s1) / 2, sill + 0.02, 0); glass.castShadow = false; g.add(glass);
          g.add(box(0.03, top - sill, 0.05, palette.frame, (s0 + s1) / 2, sill, 0));
          // Janela baixa impede só móveis altos na frente; janela alta (basculante) não impede nada.
          if (sill < 1.4) {
            const [hx, hy] = Math.abs(ux) > 0.5 ? [0.05, 0.45] : [0.45, 0.05];
            obstacles.push({ x0: bx.x0 - hx, x1: bx.x1 + hx, y0: bx.y0 - hy, y1: bx.y1 + hy, tallOnly: true });
          }
        } else {
          const top = Math.min(H - 0.05, o.height ?? (o.kind === 'sliding' ? 2.2 : 2.1));
          piece(s0, s1, top, H);
          doors.push([s0, s1]);
          if (o.kind === 'door') {
            // Folha aberta a ~75°, presa no início do vão.
            const leaf = box(s1 - s0 - 0.02, top - 0.02, 0.035, palette.door, (s1 - s0) / 2, 0, 0);
            const hinge = new THREE.Group(); hinge.position.set(s0 + 0.01, 0, t / 2); hinge.rotation.y = -THREE.MathUtils.degToRad(75); hinge.add(leaf);
            g.add(hinge);
            for (const u of [s0, s1]) g.add(box(0.04, top, t + 0.02, palette.door, u + (u === s0 ? 0.02 : -0.02), 0, 0));
          } else {
            const half = (s1 - s0) / 2;
            for (const [k, z] of [[0, -0.02], [1, 0.02]] as const) {
              const pane = box(half + 0.04, top - 0.04, 0.02, palette.glass, s0 + half * (k + 0.5) + (k ? -0.02 : 0.02), 0.02, z); pane.castShadow = false; g.add(pane);
              g.add(box(0.04, top, 0.04, palette.frame, s0 + half * k + (k ? 0 : 0.02), 0, z));
            }
            g.add(box(s1 - s0, 0.04, t, palette.frame, (s0 + s1) / 2, top - 0.04, 0));
          }
          // Área livre do vão: ao longo da parede, a largura; para os dois lados, o giro da folha.
          const along = (s1 - s0) / 2 + 0.05; const across = o.kind === 'door' ? Math.min(0.75, s1 - s0) : 0.6;
          const c: Point = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
          const [hx, hy] = Math.abs(ux) > 0.5 ? [along, across] : [across, along];
          obstacles.push({ x0: c[0] - hx, x1: c[0] + hx, y0: c[1] - hy, y1: c[1] + hy });
        }
        cursor = s1;
      }
      piece(cursor, len + t / 2, 0, H);
      this.walls.push({ a: wall.a, b: wall.b, t, doors });
      this.wallGroups.push(g);
      this.scene.add(g);
    }

    // Mobiliário
    const furnitureGroup = new THREE.Group(); this.scene.add(furnitureGroup);
    for (const room of L.rooms) {
      const f = new Furnisher(room, obstacles, furnitureGroup, (p) => this.toWorld(p));
      try { furnish(f, room.kind); } catch { /* cômodo irregular: segue sem mobiliário */ }
      const view = this.bestView(room, f);
      this.rooms.push({ room, center: view.pos, look: view.look });
    }

    const list = this.root.querySelector('.interior-rooms')!;
    list.innerHTML = this.rooms.map((r, i) => `<button data-i="${i}">${escapeHtml(r.room.name)}<small>${polygonArea(r.room.points).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m² · ${roomLabel[r.room.kind]}</small></button>`).join('');
    list.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => this.goRoom(Number(b.dataset.i))));
  }

  /**
   * Ponto de vista do passeio em cada cômodo: entre posições livres (longe das paredes e fora dos
   * móveis), escolhe a direção com a maior profundidade de visão até as paredes.
   */
  private bestView(room: Room, f: Furnisher): { pos: Point; look: Point } {
    const segments = this.layout.walls.map((w) => [w.a, w.b] as const);
    const ray = (p: Point, angle: number) => {
      const dx = Math.cos(angle), dy = Math.sin(angle); let best = 12;
      for (const [a, b] of segments) {
        const ex = b[0] - a[0], ey = b[1] - a[1]; const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den; const u = ((a[0] - p[0]) * dy - (a[1] - p[1]) * dx) / den;
        if (t > 0.05 && u >= 0 && u <= 1 && t < best) best = t;
      }
      return best;
    };
    const clearance = (p: Point) => Math.min(...segments.map(([a, b]) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9; const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      const t = Math.max(0, Math.min(len, (p[0] - a[0]) * ux + (p[1] - a[1]) * uy));
      return Math.hypot(p[0] - (a[0] + ux * t), p[1] - (a[1] + uy * t));
    }));
    const fallback = centroid(room.points);
    let best = { score: -1, pos: fallback, angle: 0 };
    for (let x = f.minX; x <= f.maxX; x += 0.2) for (let y = f.minY; y <= f.maxY; y += 0.2) {
      const p: Point = [x, y];
      if (!inside(p, room.points) || clearance(p) < 0.45 || f.placed.some((b) => x > b.x0 - 0.15 && x < b.x1 + 0.15 && y > b.y0 - 0.15 && y < b.y1 + 0.15)) continue;
      for (let k = 0; k < 16; k++) {
        const angle = (k / 16) * Math.PI * 2;
        const score = ray(p, angle) * 2 + ray(p, angle - 0.45) + ray(p, angle + 0.45);
        if (score > best.score) best = { score, pos: p, angle };
      }
    }
    return { pos: best.pos, look: [best.pos[0] + Math.cos(best.angle), best.pos[1] + Math.sin(best.angle)] };
  }

  private bind() {
    this.root.querySelector('.interior-x')!.addEventListener('click', () => this.close());
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode as 'model' | 'walk')));
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    const canvas = this.renderer.domElement;
    let drag: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { if (this.mode === 'walk') { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || this.mode !== 'walk') return;
      this.walk.yaw += (e.clientX - drag.x) * 0.004; this.walk.pitch = THREE.MathUtils.clamp(this.walk.pitch - (e.clientY - drag.y) * 0.003, -0.9, 0.7);
      drag = { x: e.clientX, y: e.clientY }; this.glide = null;
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('wheel', (e) => { if (this.mode === 'walk') { e.preventDefault(); this.step(-Math.sign(e.deltaY) * 0.35, 0); } }, { passive: false });
    this.root.querySelectorAll<HTMLButtonElement>('.interior-pad button').forEach((b) => {
      const k = b.dataset.k!;
      b.addEventListener('pointerdown', () => this.keys.add(k)); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => this.keys.delete(k));
    });
  }

  private key(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this.close(); return; }
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      e.stopPropagation(); e.preventDefault();
      if (this.mode !== 'walk') this.setMode('walk');
      this.keys.add(k);
    }
  }

  setMode(mode: 'model' | 'walk', room?: number) {
    this.mode = mode;
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    this.root.classList.toggle('walking', mode === 'walk');
    for (const c of this.ceilings) c.visible = mode === 'walk';
    for (const g of this.wallGroups) g.scale.y = mode === 'walk' ? 1 : 1.1 / this.layout.wallHeight;
    this.controls.enabled = mode === 'model';
    this.camera.fov = mode === 'walk' ? 70 : 45; this.camera.updateProjectionMatrix();
    (this.root.querySelector('.interior-hint') as HTMLElement).textContent = mode === 'walk'
      ? 'Arraste para olhar · W A S D ou setas para andar · escolha um cômodo abaixo · Esc fecha'
      : 'Arraste para girar · botão direito move · roda aproxima · clique num cômodo para entrar';
    if (mode === 'model') {
      this.glide = null;
      this.controls.target.set(0, 0.6, 0);
      this.camera.position.set(this.size * 0.3, this.size * 1.15, this.size * 0.75);
      this.controls.update();
    } else {
      const living = this.rooms.findIndex((r) => r.room.kind === 'living');
      this.goRoom(room ?? (living >= 0 ? living : 0), true);
    }
  }

  private goRoom(index: number, instant = false) {
    const r = this.rooms[index]; if (!r) return;
    if (this.mode === 'model') { this.setMode('walk', index); return; }
    const to = this.toWorld(r.center, eye);
    const dir = this.toWorld(r.look).sub(this.toWorld(r.center));
    const yaw = Math.atan2(dir.x, -dir.z);
    this.walk.pitch = -0.08;
    if (instant) { this.walk.pos.copy(to); this.walk.yaw = yaw; this.glide = null; return; }
    let target = yaw; while (target - this.walk.yaw > Math.PI) target -= Math.PI * 2; while (target - this.walk.yaw < -Math.PI) target += Math.PI * 2;
    this.glide = { from: this.walk.pos.clone(), to, fromYaw: this.walk.yaw, toYaw: target, t: 0 };
  }

  /** Bloqueia o passeio nas paredes, exceto pelos vãos de portas. */
  private blocked(x: number, z: number) {
    const p: Point = [x + this.offset[0], z + this.offset[1]];
    for (const w of this.walls) {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); const ux = (w.b[0] - w.a[0]) / len, uy = (w.b[1] - w.a[1]) / len;
      const u = (p[0] - w.a[0]) * ux + (p[1] - w.a[1]) * uy;
      if (u < -0.25 || u > len + 0.25) continue;
      const cu = Math.max(0, Math.min(len, u));
      const d = Math.hypot(p[0] - (w.a[0] + ux * cu), p[1] - (w.a[1] + uy * cu));
      if (d > w.t / 2 + 0.22) continue;
      if (w.doors.some(([s0, s1]) => u > s0 + 0.12 && u < s1 - 0.12)) continue;
      return true;
    }
    return false;
  }

  private step(forward: number, strafe: number) {
    const sin = Math.sin(this.walk.yaw), cos = Math.cos(this.walk.yaw);
    const dx = sin * forward + cos * strafe; const dz = -cos * forward + sin * strafe;
    const pos = this.walk.pos;
    if (!this.blocked(pos.x + dx, pos.z)) pos.x += dx;
    if (!this.blocked(pos.x, pos.z + dz)) pos.z += dz;
    this.glide = null;
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now(); const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (this.mode === 'walk') {
      const k = this.keys; const speed = 1.7 * dt;
      const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const turn = (k.has('arrowright') ? 1 : 0) - (k.has('arrowleft') ? 1 : 0);
      const strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
      if (turn) { this.walk.yaw += turn * 1.6 * dt; this.glide = null; }
      if (fwd || strafe) this.step(fwd * speed, strafe * speed);
      if (this.glide) {
        const g = this.glide; g.t = Math.min(1, g.t + dt / 0.9); const e = g.t < 0.5 ? 2 * g.t * g.t : 1 - (-2 * g.t + 2) ** 2 / 2;
        this.walk.pos.lerpVectors(g.from, g.to, e); this.walk.yaw = g.fromYaw + (g.toYaw - g.fromYaw) * e;
        if (g.t >= 1) this.glide = null;
      }
      const { pos, yaw, pitch } = this.walk;
      this.camera.position.copy(pos);
      this.camera.lookAt(pos.x + Math.sin(yaw) * Math.cos(pitch), pos.y + Math.sin(pitch), pos.z - Math.cos(yaw) * Math.cos(pitch));
    } else this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  close() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (Object.values(palette).includes(m)) continue; (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); }
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.root.remove();
    this.options.onClose?.();
  }
}

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
