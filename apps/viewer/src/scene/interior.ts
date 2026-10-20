import {
  ArcRotateCamera, Color4, DefaultRenderingPipeline, DirectionalLight, DynamicTexture, HemisphericLight, ImageProcessingConfiguration,
  PointLight, Scene, ShadowGenerator, Texture, TransformNode, UniversalCamera, Vector3, type AbstractEngine, type PBRMaterial,
} from './babylon';
import { createEngine } from './engine';
import { box as boxGeo, compose, cylinder as cylinderGeo, icosahedron, merge, meshFrom, pbr, polygon, rgb, shadows, transform, translate, type Geo, type MaterialOptions } from './geometry';
import { skyEnvironment } from './world';
import type { PlanLayout, Point, RoomKind } from '../types';

/**
 * Planta 3D mobiliada gerada da planta vetorizada: paredes com vãos de portas e janelas, piso por
 * cômodo e mobiliário ilustrativo posicionado automaticamente encostado nas paredes livres.
 * Dois modos: maquete (vista de cima, sem teto) e passeio em primeira pessoa.
 */

type Room = PlanLayout['rooms'][number];
interface Box2 { x0: number; y0: number; x1: number; y1: number; tallOnly?: boolean }
interface Placement { box: Box2; center: Point; normal: Point; side: Side | null; u: number }
type Side = { axis: 'x' | 'y'; fixed: number; from: number; to: number; normal: Point };

const eye = 1.6;
const inset = 0.08;
const deg = (d: number) => (d * Math.PI) / 180;
const roomLabel: Record<RoomKind, string> = { living: 'Sala', kitchen: 'Cozinha', bedroom: 'Quarto', suite: 'Suíte', bathroom: 'Banheiro', balcony: 'Varanda', service: 'Área de serviço', hall: 'Circulação', garden: 'Garden' };

// ——— materiais (criados por cena; a paleta é só a receita) ———
type Recipe = MaterialOptions & { tex?: () => HTMLCanvasElement; tile?: number };
const m = (color: string, roughness = 0.8, extra: Recipe = {}): Recipe => ({ color, roughness, ...extra });
function canvas(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d')!, size); return c;
}
const wood = (base: string) => () => canvas(512, (g, s) => {
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
});
const tiles = (base: string, grout: string) => () => canvas(256, (g, s) => {
  g.fillStyle = grout; g.fillRect(0, 0, s, s);
  const n = 2; const t = s / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = base; g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(i * t + 2, j * t + 2, t - 4, (t - 4) / 2); }
});

const palette = {
  wall: m('#f1ece4', 0.92), skirting: m('#e2dbcf', 0.5), lamp: m('#ffffff', 0.4, { emissive: '#fff1d6', emissiveIntensity: 1.2 }), cap: m('#3d3a44', 0.9), ceiling: m('#fbfaf8', 0.95, { doubleSided: true }),
  glass: m('#cfe6f2', 0.05, { alpha: 0.35, depthWrite: false }),
  frame: m('#2f2f35', 0.5, { metalness: 0.4 }), door: m('#d9c3a3', 0.7), sill: m('#e9e6e1', 0.6),
  fabric: m('#8f9aa8', 0.95), fabricDark: m('#59606d', 0.95), cushion: m('#d9b98a', 0.95), linen: m('#f2eee7', 0.95), blanket: m('#5d7f8f', 0.95),
  woodDark: m('#6b4a32', 0.7), woodLight: m('#c9a57a', 0.7), white: m('#f7f7f5', 0.4), black: m('#1e1e22', 0.4), steel: m('#c9ccd0', 0.3, { metalness: 0.7 }),
  porcelain: m('#ffffff', 0.2), mirror: m('#d7e3ea', 0.05, { metalness: 0.9 }), counterTop: m('#3b3a3f', 0.35), rug: m('#c8b9a6', 1), plant: m('#4f8a4b', 0.9), pot: m('#b9643f', 0.8), soil: m('#4a3626', 1),
};
type Paint = keyof typeof palette;
const floorFor: Record<RoomKind, Recipe> = {
  living: m('#ffffff', 0.6, { tex: wood('#b98b5e'), tile: 1.6 }), bedroom: m('#ffffff', 0.6, { tex: wood('#c49a6c'), tile: 1.6 }), suite: m('#ffffff', 0.6, { tex: wood('#c49a6c'), tile: 1.6 }),
  hall: m('#ffffff', 0.6, { tex: wood('#b98b5e'), tile: 1.6 }), kitchen: m('#ffffff', 0.4, { tex: tiles('#e7e3dc', '#c9c3b8'), tile: 0.9 }),
  bathroom: m('#ffffff', 0.35, { tex: tiles('#dfe3e4', '#b8bfc2'), tile: 0.6 }), service: m('#ffffff', 0.4, { tex: tiles('#e7e3dc', '#c9c3b8'), tile: 0.6 }),
  balcony: m('#ffffff', 0.6, { tex: tiles('#c9b8a3', '#9e8e7a'), tile: 0.6 }), garden: m('#6fa35a', 1),
};

/**
 * Modelo montado por peças (caixas, cilindros…) já transformadas, agrupadas por material;
 * vira uma malha por material quando é colocado na cena.
 */
class Model {
  readonly parts: { paint: Paint; geo: Geo; cast: boolean }[] = [];
  add(paint: Paint, geo: Geo, cast = true) { this.parts.push({ paint, geo, cast }); return this; }
  /** Inclui outro modelo com posição e giro (y). */
  include(other: Model, x = 0, y = 0, z = 0, rotY = 0) {
    const matrix = compose(x, y, z, 0, rotY, 0);
    for (const p of other.parts) this.parts.push({ ...p, geo: transform(p.geo, matrix) });
    return this;
  }
}
function box(w: number, h: number, d: number, paint: Paint, x = 0, y = 0, z = 0, cast = true) { return new Model().add(paint, translate(boxGeo(w, h, d), x, y + h / 2, z), cast); }
function cylinder(r: number, h: number, paint: Paint, x = 0, y = 0, z = 0, top = r) { return new Model().add(paint, translate(cylinderGeo(top, r, h, 20), x, y + h / 2, z)); }
const group = (...children: Model[]) => { const g = new Model(); for (const c of children) g.include(c); return g; };

// ——— mobiliário (origem no centro da base; costas em -z, frente em +z) ———
const furniture = {
  bed(w: number, d: number) {
    const g = group(box(w, 0.3, d, 'woodLight'), box(w - 0.06, 0.22, d - 0.1, 'linen', 0, 0.3, 0.03), box(w + 0.1, 1.05, 0.08, 'woodDark', 0, 0, -d / 2 + 0.04), box(w - 0.04, 0.06, d * 0.58, 'blanket', 0, 0.52, d * 0.2));
    const pillows = w > 1.2 ? [-w / 4, w / 4] : [0];
    for (const x of pillows) g.include(box(Math.min(0.6, w / pillows.length - 0.1), 0.12, 0.35, 'white', x, 0.52, -d / 2 + 0.3));
    return g;
  },
  nightstand: () => group(box(0.45, 0.5, 0.4, 'woodDark'), cylinder(0.09, 0.03, 'black', 0, 0.5, 0), cylinder(0.02, 0.25, 'steel', 0, 0.53, 0), cylinder(0.12, 0.16, 'linen', 0, 0.75, 0, 0.08)),
  wardrobe(w: number) {
    const g = group(box(w, 2.1, 0.6, 'white'));
    const doors = Math.max(2, Math.round(w / 0.5));
    for (let i = 1; i < doors; i++) g.include(box(0.01, 2.0, 0.01, 'frame', -w / 2 + (w / doors) * i, 0.05, 0.3));
    for (let i = 0; i < doors; i++) g.include(box(0.02, 0.3, 0.02, 'steel', -w / 2 + (w / doors) * (i + 0.5) + (i % 2 ? -0.08 : 0.08), 0.95, 0.31));
    return g;
  },
  sofa(w: number) {
    const d = 0.88;
    const g = group(box(w, 0.42, d, 'fabric'), box(w, 0.42, 0.2, 'fabric', 0, 0.42, -d / 2 + 0.1), box(0.16, 0.24, d, 'fabric', -w / 2 + 0.08, 0.42), box(0.16, 0.24, d, 'fabric', w / 2 - 0.08, 0.42));
    const seats = Math.max(2, Math.round((w - 0.32) / 0.7));
    const sw = (w - 0.34) / seats;
    for (let i = 0; i < seats; i++) g.include(box(sw - 0.03, 0.12, d - 0.26, 'fabricDark', -w / 2 + 0.17 + sw * (i + 0.5), 0.42, 0.08));
    g.include(box(0.4, 0.35, 0.12, 'cushion', -w / 2 + 0.45, 0.5, -d / 2 + 0.28)).include(box(0.4, 0.35, 0.12, 'cushion', w / 2 - 0.45, 0.5, -d / 2 + 0.28));
    return g;
  },
  tv(w: number, panel = false) {
    const g = group(box(w, 0.45, 0.4, 'woodDark'), box(Math.min(1.25, w - 0.2), 0.72, 0.05, 'black', 0, 0.75, -0.08), box(0.3, 0.03, 0.2, 'black', 0, 0.45, -0.05));
    // Sem parede atrás (sala integrada): painel ripado solto, como nas plantas humanizadas.
    if (panel) for (let x = -w / 2 + 0.03; x < w / 2; x += 0.07) g.include(box(0.045, 2.1, 0.04, 'woodLight', x, 0, -0.22));
    return g;
  },
  coffeeTable: () => group(box(0.9, 0.04, 0.5, 'woodLight', 0, 0.36), ...[[-0.4, -0.2], [0.4, -0.2], [-0.4, 0.2], [0.4, 0.2]].map(([x, z]) => box(0.04, 0.36, 0.04, 'black', x, 0, z))),
  rug: (w: number, d: number) => box(w, 0.01, d, 'rug', 0, 0, 0, false),
  dining(w: number, d: number) {
    const g = group(box(w, 0.04, d, 'woodLight', 0, 0.72), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => box(0.05, 0.72, 0.05, 'woodDark', sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08))));
    const chair = () => group(box(0.44, 0.45, 0.44, 'fabricDark'), box(0.44, 0.45, 0.06, 'fabricDark', 0, 0.45, -0.19));
    const seats = w > 1.3 ? [-w / 4, w / 4] : [0];
    for (const x of seats) { g.include(chair(), x, 0, -d / 2 - 0.15, 0).include(chair(), x, 0, d / 2 + 0.15, Math.PI); }
    return g;
  },
  counter(w: number) {
    const g = group(box(w, 0.86, 0.6, 'white'), box(w, 0.04, 0.62, 'counterTop', 0, 0.86, 0.01));
    if (w >= 1.2) g.include(box(0.5, 0.02, 0.4, 'steel', -w / 2 + 0.45, 0.89, 0.02)).include(cylinder(0.015, 0.3, 'steel', -w / 2 + 0.45, 0.9, -0.22));
    if (w >= 1.8) { g.include(box(0.58, 0.015, 0.5, 'black', w / 2 - 0.5, 0.9, 0.02)); for (const [x, z] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) g.include(cylinder(0.07, 0.01, 'steel', w / 2 - 0.5 + x, 0.915, 0.02 + z)); }
    return g;
  },
  upper: (w: number) => box(w, 0.7, 0.35, 'white', 0, 1.5),
  fridge: () => group(box(0.7, 1.85, 0.68, 'steel'), box(0.02, 0.5, 0.03, 'black', 0.3, 1.1, 0.35), box(0.02, 0.4, 0.03, 'black', 0.3, 0.4, 0.35), box(0.7, 0.01, 0.01, 'black', 0, 1.0, 0.345)),
  toilet: () => group(box(0.38, 0.4, 0.2, 'porcelain', 0, 0, -0.22), cylinder(0.19, 0.4, 'porcelain', 0, 0, 0.08, 0.2), box(0.38, 0.4, 0.17, 'porcelain', 0, 0.4, -0.25)),
  vanity: (w = 0.8) => group(box(w, 0.8, 0.46, 'woodDark'), box(w + 0.02, 0.05, 0.48, 'porcelain', 0, 0.8), cylinder(0.17, 0.02, 'steel', 0, 0.84, 0.03), cylinder(0.012, 0.22, 'steel', 0, 0.85, -0.17), box(w - 0.1, 0.8, 0.02, 'mirror', 0, 1.15, -0.22)),
  shower() {
    // Cano na parede do fundo até o chuveiro (nada flutua quando a maquete corta as paredes).
    const g = group(box(0.9, 0.05, 0.9, 'porcelain', 0, 0, 0, false), box(0.9, 1.95, 0.01, 'glass', 0, 0.05, 0.45, false), box(0.01, 1.95, 0.9, 'glass', 0.45, 0.05, 0, false),
      box(0.03, 0.03, 0.3, 'steel', 0, 1.95, -0.28, false), cylinder(0.015, 1.98, 'steel', 0, 0, -0.43), cylinder(0.1, 0.02, 'steel', 0, 1.94, -0.14), box(0.12, 0.04, 0.03, 'steel', 0.2, 1.05, -0.43, false));
    for (const p of g.parts) p.cast = false;
    return g;
  },
  washer: () => group(box(0.6, 0.85, 0.6, 'white'), cylinder(0.2, 0.02, 'black', 0, 0.45, 0.3)),
  tank: () => group(box(0.55, 0.85, 0.5, 'white'), box(0.45, 0.05, 0.35, 'steel', 0, 0.83, 0.03)),
  chair: () => group(box(0.5, 0.42, 0.5, 'woodLight'), box(0.5, 0.42, 0.06, 'woodLight', 0, 0.42, -0.22)),
  sideTable: () => group(cylinder(0.25, 0.03, 'white', 0, 0.6, 0), cylinder(0.03, 0.6, 'black')),
  plant(scale = 1) {
    const foliage = transform(icosahedron(0.32 * scale, 1), compose(0, 0.75 * scale, 0, 0, 0, 0, 1, 1.3, 1));
    return group(cylinder(0.17 * scale, 0.42 * scale, 'pot', 0, 0, 0, 0.2 * scale), cylinder(0.18 * scale, 0.02, 'soil', 0, 0.41 * scale, 0)).add('plant', foliage);
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
  constructor(private readonly room: Room, private readonly obstacles: Box2[], private readonly out: (model: Model, at: Point, rotY: number) => void, private readonly walls: { a: Point; b: Point }[]) {
    const xs = room.points.map((p) => p[0]); const ys = room.points.map((p) => p[1]);
    this.minX = Math.min(...xs) + inset; this.maxX = Math.max(...xs) - inset; this.minY = Math.min(...ys) + inset; this.maxY = Math.max(...ys) - inset;
  }
  get width() { return this.maxX - this.minX; }
  get depth() { return this.maxY - this.minY; }
  get area() { return polygonArea(this.room.points); }

  /** Lados do cômodo a partir das arestas do polígono (funciona em salas em L), com a normal para dentro. */
  sides(): Side[] {
    const pts = this.room.points; const out: Side[] = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const horizontal = Math.abs(a[1] - b[1]) < 0.02; const vertical = Math.abs(a[0] - b[0]) < 0.02;
      if (!horizontal && !vertical) return;
      const axis = horizontal ? 'x' : 'y'; const k = horizontal ? 0 : 1;
      const from = Math.min(a[k], b[k]) + inset; const to = Math.max(a[k], b[k]) - inset;
      if (to - from < 0.4) return;
      const mid = (from + to) / 2; const line = horizontal ? a[1] : a[0];
      const probe = (sign: number): Point => (horizontal ? [mid, line + sign * 0.15] : [line + sign * 0.15, mid]);
      const sign = inside(probe(1), pts) ? 1 : -1;
      out.push({ axis, fixed: line + sign * inset, from, to, normal: horizontal ? [0, sign] : [sign, 0] });
    });
    return out.sort((p, q) => (q.to - q.from) - (p.to - p.from));
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

  /** Há parede de verdade atrás do trecho [u - w/2, u + w/2] do lado? (Em salas integradas o contorno do cômodo pode ser aberto.) */
  private backed(side: Side, u: number, w: number) {
    const k = side.axis === 'x' ? 0 : 1; const fixedAxis = 1 - k;
    const spans = this.walls
      .filter((wall) => Math.abs(wall.a[fixedAxis] - wall.b[fixedAxis]) < 0.05 && Math.abs(wall.a[fixedAxis] - side.fixed) < inset + 0.2)
      .map((wall) => [Math.min(wall.a[k], wall.b[k]) - 0.1, Math.max(wall.a[k], wall.b[k]) + 0.1] as const)
      .sort((p, q) => p[0] - q[0]);
    let reach = u - w / 2;
    for (const [s0, s1] of spans) { if (s0 > reach + 0.01) break; reach = Math.max(reach, s1); }
    return reach >= u + w / 2 - 0.01;
  }

  /** Encosta o móvel numa parede; prefer: 'center' | 'start' | 'end' ou uma coordenada ao longo da parede. */
  wall(model: Model, w: number, d: number, opts: { tall?: boolean; prefer?: 'center' | 'start' | 'end' | number; sides?: Side[]; loose?: boolean } = {}) {
    for (const side of opts.sides ?? this.sides()) {
      if (side.to - side.from < w) continue;
      const lo = side.from + w / 2; const hi = side.to - w / 2;
      const target = typeof opts.prefer === 'number' ? opts.prefer : opts.prefer === 'start' ? lo : opts.prefer === 'end' ? hi : (lo + hi) / 2;
      let best: number | null = null;
      for (let u = lo; u <= hi + 1e-6; u += 0.05) {
        if (this.free(this.footprint(side, u, w, d), !!opts.tall) && (opts.loose || this.backed(side, u, w)) && (best == null || Math.abs(u - target) < Math.abs(best - target))) best = u;
      }
      if (best == null) continue;
      return this.put(model, this.footprint(side, best, w, d), side.normal, side, best);
    }
    return null;
  }

  /** Móvel solto (mesa, tapete): posição livre mais próxima do ponto preferido. */
  /** margin: folga em volta; [largura, profundidade] quando difere (mesa: cadeiras só nos lados compridos). */
  center(model: Model, w: number, d: number, near: Point, facing: Point = [0, 1], margin: number | [number, number] = 0, turnable = false): Placement | null {
    if (turnable) return this.center(model, w, d, near, [0, 1], margin) ?? this.center(model, w, d, near, [1, 0], margin);
    let best: { b: Box2; score: number } | null = null;
    const swap = Math.abs(facing[0]) > 0.5;
    const fw = swap ? d : w; const fd = swap ? w : d;
    const [mw, md] = typeof margin === 'number' ? [margin, margin] : margin;
    const [mx, my] = swap ? [md, mw] : [mw, md];
    for (let x = this.minX + fw / 2; x <= this.maxX - fw / 2 + 1e-6; x += 0.1) for (let y = this.minY + fd / 2; y <= this.maxY - fd / 2 + 1e-6; y += 0.1) {
      const b = { x0: x - fw / 2 - mx, x1: x + fw / 2 + mx, y0: y - fd / 2 - my, y1: y + fd / 2 + my };
      if (!this.free(b, false)) continue;
      const score = Math.hypot(x - near[0], y - near[1]);
      if (!best || score < best.score) best = { b, score };
    }
    if (!best) return null;
    this.placed.push(best.b);
    const b = { x0: best.b.x0 + mx, x1: best.b.x1 - mx, y0: best.b.y0 + my, y1: best.b.y1 - my };
    return this.put(model, b, facing, null, 0, 0, false);
  }

  private put(model: Model, b: Box2, normal: Point, side: Side | null, u: number, margin = 0, track = true): Placement {
    if (track) this.placed.push({ x0: b.x0 - margin, x1: b.x1 + margin, y0: b.y0 - margin, y1: b.y1 + margin });
    const c: Point = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    this.out(model, c, Math.atan2(normal[0], normal[1]));
    return { box: b, center: c, normal, side, u };
  }
  /** Lado em frente (normal contrária) que mais se sobrepõe ao trecho do móvel em u. */
  opposite(side: Side, u: number): Side {
    const facing = this.sides().filter((o) => o.axis === side.axis && o.normal[0] === -side.normal[0] && o.normal[1] === -side.normal[1]);
    const gap = (o: Side) => (u < o.from ? o.from - u : u > o.to ? u - o.to : 0);
    return facing.sort((p, q) => gap(p) - gap(q) || Math.abs(p.fixed - side.fixed) - Math.abs(q.fixed - side.fixed))[0] ?? side;
  }
}

/** Mesa de jantar com cadeiras: tenta a de 4 lugares e, sem espaço, a de 2. */
function dining(f: Furnisher, near: Point) {
  return f.center(furniture.dining(1.2, 0.8), 1.2, 0.8, near, [0, 1], [0.15, 0.5], true) ?? f.center(furniture.dining(0.8, 0.75), 0.8, 0.75, near, [0, 1], [0.1, 0.45], true);
}

function furnish(f: Furnisher, kind: RoomKind, home: { dining: boolean }) {
  const area = f.area;
  switch (kind) {
    case 'suite':
    case 'bedroom': {
      const double = kind === 'suite' || area >= 8.5;
      const bw = double ? (kind === 'suite' && area > 11 ? 1.6 : 1.4) : 0.9; const bd = double ? 1.95 : 1.9;
      const bed = f.wall(furniture.bed(bw, bd), bw, bd, { prefer: 'center' });
      if (bed?.side) for (const s of double ? [-1, 1] : [1]) f.wall(furniture.nightstand(), 0.45, 0.4, { prefer: bed.u + s * (bw / 2 + 0.25), sides: [bed.side] });
      f.wall(furniture.wardrobe(area > 10 ? 1.8 : 1.4), area > 10 ? 1.8 : 1.4, 0.6, { tall: true, prefer: 'end' }) ?? f.wall(furniture.wardrobe(1), 1, 0.6, { tall: true });
      if (area > 11) f.wall(furniture.plant(0.9), 0.4, 0.4, { prefer: 'start', loose: true });
      break;
    }
    case 'living': {
      const sofaW = Math.min(2.2, Math.max(1.5, f.width * 0.55, f.depth * 0.55));
      const sofa = f.wall(furniture.sofa(sofaW), sofaW, 0.88, { prefer: 'center' }) ?? f.wall(furniture.sofa(1.5), 1.5, 0.88);
      if (sofa?.side) {
        const opp = f.opposite(sofa.side, sofa.u);
        f.wall(furniture.tv(1.6), 1.6, 0.4, { prefer: sofa.u, sides: [opp] }) ?? f.wall(furniture.tv(1.2), 1.2, 0.4, { prefer: sofa.u, sides: [opp] })
          ?? f.wall(furniture.tv(1.4, true), 1.4, 0.48, { prefer: sofa.u, sides: [opp], loose: true, tall: true });
        const front: Point = [sofa.center[0] + sofa.normal[0] * 1.0, sofa.center[1] + sofa.normal[1] * 1.0];
        f.center(furniture.rug(Math.min(2, sofaW), 1.4), Math.min(2, sofaW), 1.4, front, sofa.normal);
        f.placed.pop(); // o tapete fica sob a mesa de centro
        f.center(furniture.coffeeTable(), 0.9, 0.5, front, sofa.normal, 0.25);
      }
      if (area > 11 && !home.dining) {
        const far: Point = sofa ? [sofa.center[0] + sofa.normal[0] * 8, sofa.center[1] + sofa.normal[1] * 8] : centroid([[f.minX, f.minY], [f.maxX, f.maxY]]);
        home.dining = !!dining(f, far);
      }
      f.wall(furniture.plant(), 0.4, 0.4, { prefer: 'start', loose: true });
      break;
    }
    case 'kitchen': {
      const cw = Math.min(2.6, Math.max(1.2, Math.max(f.width, f.depth) - 0.9));
      const counter = f.wall(furniture.counter(cw), cw, 0.6, { prefer: 'start' }) ?? f.wall(furniture.counter(1.2), 1.2, 0.6);
      if (counter?.side) f.wall(furniture.fridge(), 0.7, 0.68, { tall: true, prefer: 'end', sides: [counter.side] }) ?? f.wall(furniture.fridge(), 0.7, 0.68, { tall: true });
      else f.wall(furniture.fridge(), 0.7, 0.68, { tall: true });
      if (area > 8 && !home.dining) home.dining = !!dining(f, [(f.minX + f.maxX) / 2, (f.minY + f.maxY) / 2]);
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
      f.wall(furniture.plant(), 0.4, 0.4, { prefer: 'end', loose: true });
      break;
    }
    case 'garden': for (const prefer of ['start', 'end'] as const) f.wall(furniture.plant(1.4), 0.6, 0.6, { prefer, loose: true }); break;
    case 'hall': break;
  }
}

export interface InteriorOptions { title: string; subtitle?: string; onClose?: () => void }

/** Sobreposição em tela cheia com a planta 3D mobiliada (motor próprio, liberado ao fechar). */
export class InteriorViewer {
  private readonly root: HTMLElement;
  private engine: AbstractEngine | null = null;
  private scene!: Scene;
  private orbit!: ArcRotateCamera;
  private walker!: UniversalCamera;
  private sun!: DirectionalLight;
  private hemi!: HemisphericLight;
  private materials = new Map<string, PBRMaterial>();
  private readonly ceilings: TransformNode[] = [];
  private readonly lamps: (TransformNode | PointLight)[] = [];
  /** Paredes: na maquete ficam rebaixadas (corte a ~1,1 m) para mostrar os ambientes. */
  private readonly wallGroups: TransformNode[] = [];
  private readonly walls: { a: Point; b: Point; t: number; doors: [number, number][] }[] = [];
  private readonly rooms: { room: Room; center: Point; look: Point }[] = [];
  private readonly keys = new Set<string>();
  private readonly offset: Point;
  private readonly size: number;
  private mode: 'model' | 'walk' = 'model';
  private walk = { pos: new Vector3(), yaw: 0, pitch: 0 };
  private glide: { from: Vector3; to: Vector3; fromYaw: number; toYaw: number; t: number } | null = null;
  private last = performance.now();
  private closed = false;
  private readonly onKey = (e: KeyboardEvent) => this.key(e);
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private readonly onResize = () => this.engine?.resize();

  constructor(private readonly layout: PlanLayout, private readonly options: InteriorOptions) {
    const pts = [...layout.walls.flatMap((w) => [w.a, w.b]), ...layout.rooms.flatMap((r) => r.points)];
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    this.offset = [(minX + maxX) / 2, (minY + maxY) / 2];
    this.size = Math.max(maxX - minX, maxY - minY, 4);

    this.root = document.createElement('div');
    this.root.className = 'interior';
    this.root.innerHTML = `
      <div class="interior-stage"></div>
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
    this.root.querySelector('.interior-x')!.addEventListener('click', () => this.close());
    window.addEventListener('keydown', this.onKey, true);
    void this.init();
  }

  private async init() {
    const stage = this.root.querySelector('.interior-stage') as HTMLElement;
    const { engine, canvas } = await createEngine(stage);
    if (this.closed) { engine.dispose(); return; }
    this.engine = engine;
    engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));
    const scene = this.scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.9, 0.92, 0.9, 1);
    scene.skipPointerMovePicking = true;
    scene.environmentTexture = skyEnvironment(scene);
    scene.environmentIntensity = 0.55;

    this.orbit = new ArcRotateCamera('orbit', 0, 1, 10, new Vector3(0, 0.6, 0), scene);
    this.orbit.minZ = 0.05; this.orbit.maxZ = 300; this.orbit.fov = deg(45);
    this.orbit.upperBetaLimit = deg(80); this.orbit.lowerRadiusLimit = 2; this.orbit.upperRadiusLimit = this.size * 3;
    this.orbit.wheelDeltaPercentage = 0.01; this.orbit.inertia = 0.85; this.orbit.panningSensibility = 300;
    this.orbit.attachControl(false, false, 2);
    this.walker = new UniversalCamera('walk', new Vector3(0, eye, 0), scene);
    this.walker.minZ = 0.05; this.walker.maxZ = 300; this.walker.fov = deg(70); this.walker.inputs.clear();
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const pipeline = new DefaultRenderingPipeline('interior', true, scene, [this.orbit, this.walker]);
    pipeline.samples = 4; pipeline.fxaaEnabled = true; pipeline.bloomEnabled = false;
    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipeline.imageProcessing.exposure = 1.05 / 0.6;

    this.build();
    this.bind(canvas);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    this.setMode('model');
    engine.runRenderLoop(() => this.loop());
  }

  private toWorld = ([x, y]: Point, h = 0) => new Vector3(x - this.offset[0], h, y - this.offset[1]);

  private material(key: string, recipe: Recipe) {
    if (!this.materials.has(key)) {
      const { tex, tile, ...options } = recipe;
      let map: DynamicTexture | null = null;
      if (tex) {
        map = new DynamicTexture(`${key}-tex`, tex(), this.scene, true);
        map.update(true); map.wrapU = map.wrapV = Texture.WRAP_ADDRESSMODE;
        map.uScale = map.vScale = 1 / (tile ?? 1); map.anisotropicFilteringLevel = 8;
      }
      this.materials.set(key, pbr(this.scene, key, { ...options, map, maxLights: 14 }));
    }
    return this.materials.get(key)!;
  }

  /** Coloca um modelo na cena: uma malha por material, sob um nó posicionado e girado. */
  private place(model: Model, position: Vector3, rotY = 0, parent?: TransformNode) {
    const node = new TransformNode('model', this.scene);
    if (parent) node.parent = parent;
    node.position.copyFrom(position); node.rotation.y = rotY;
    const byKey = new Map<string, { paint: Paint; cast: boolean; geos: Geo[] }>();
    for (const p of model.parts) {
      const key = `${p.paint}|${p.cast}`;
      if (!byKey.has(key)) byKey.set(key, { paint: p.paint, cast: p.cast, geos: [] });
      byKey.get(key)!.geos.push(p.geo);
    }
    for (const part of byKey.values()) shadows(meshFrom(part.paint, merge(part.geos), this.scene, this.material(part.paint, palette[part.paint]), node), part.cast);
    return node;
  }

  private build() {
    const scene = this.scene;
    const L = this.layout; const H = L.wallHeight;
    const s = this.size;
    this.sun = new DirectionalLight('sun', new Vector3(-0.6, -1.4, -0.8).normalize(), scene);
    this.sun.diffuse = rgb('#fff3e2'); this.sun.intensity = 2.2;
    this.sun.position = new Vector3(s * 0.6, s * 1.4, s * 0.8);
    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    this.hemi.diffuse = rgb('#f5f7fb'); this.hemi.groundColor = rgb('#b8ad9c'); this.hemi.intensity = 1.1 / Math.PI; this.hemi.specular.set(0, 0, 0);
    const shadow = new ShadowGenerator(2048, this.sun);
    shadow.usePercentageCloserFiltering = true; shadow.filteringQuality = ShadowGenerator.QUALITY_HIGH;
    shadow.bias = 0.0008; shadow.normalBias = 0.01;
    scene.onNewMeshAddedObservable.add(() => { dirty = true; });
    let dirty = true;
    scene.onBeforeRenderObservable.add(() => {
      if (!dirty) return; dirty = false;
      shadow.getShadowMap()!.renderList = scene.meshes.filter((mesh) => mesh.metadata?.castShadow === true && mesh.isEnabled());
    });
    this.refreshShadows = () => { dirty = true; };

    const disc = Array.from({ length: 48 }, (_, i) => { const t = (i / 48) * Math.PI * 2; return [Math.cos(t) * s * 3, Math.sin(t) * s * 3] as Point; });
    shadows(meshFrom('ground', polygon(disc, -0.02), scene, this.material('ground', m('#d6d9d2', 1))), false);

    // Pisos e tetos por cômodo
    for (const room of L.rooms) {
      const pts = room.points.map(([x, y]) => [x - this.offset[0], y - this.offset[1]] as Point);
      shadows(meshFrom(`floor-${room.id}`, polygon(pts, 0.005), scene, this.material(`floor-${room.kind}`, floorFor[room.kind])), false);
      if (room.kind !== 'balcony' && room.kind !== 'garden') {
        const ceiling = new TransformNode(`ceiling-${room.id}`, scene);
        shadows(meshFrom(`ceiling-${room.id}`, polygon(pts, H), scene, this.material('ceiling', palette.ceiling), ceiling), true);
        this.ceilings.push(ceiling);
        // Luminária de teto: luz quente que só acende no passeio.
        const [cx, cy] = centroid(room.points);
        const lamp = new PointLight(`lamp-${room.id}`, this.toWorld([cx, cy], H - 0.35), scene);
        lamp.diffuse = rgb('#ffd9a8'); lamp.intensity = room.kind === 'bathroom' || room.kind === 'service' ? 2.2 : 4.5; lamp.specular = rgb('#ffd9a8').scale(0.3);
        const fixture = this.place(new Model().add('lamp', cylinderGeo(0.18, 0.18, 0.03, 24), false), this.toWorld([cx, cy], H - 0.02));
        this.lamps.push(lamp, fixture);
      }
    }

    // Paredes com vãos
    const obstacles: Box2[] = [];
    for (const wall of L.walls) {
      const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]); const t = wall.thickness;
      const ux = (wall.b[0] - wall.a[0]) / len, uy = (wall.b[1] - wall.a[1]) / len;
      const model = new Model();
      /** Trecho de parede (com rodapé no chão e topo escuro, que aparece como "corte" na maquete). */
      const piece = (s0: number, s1: number, y0: number, y1: number, paint: Paint | null = null, depth = t) => {
        if (s1 - s0 < 0.005 || y1 - y0 < 0.005) return;
        const at = (geo: Geo) => translate(geo, (s0 + s1) / 2, y0 + (y1 - y0) / 2, 0);
        if (paint) { model.add(paint, at(boxGeo(s1 - s0, y1 - y0, depth))); return; }
        model.add('wall', at(boxGeo(s1 - s0, y1 - y0, depth, ['px', 'nx', 'ny', 'pz', 'nz'])));
        model.add('cap', at(boxGeo(s1 - s0, y1 - y0, depth, ['py'])));
        if (y0 === 0) model.add('skirting', translate(boxGeo(s1 - s0, 0.08, depth + 0.02), (s0 + s1) / 2, 0.04, 0), false);
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
          piece(s0 - 0.02, s1 + 0.02, sill - 0.03, sill, 'sill', t + 0.08);
          model.include(box(s1 - s0 - 0.04, top - sill - 0.04, 0.02, 'glass', (s0 + s1) / 2, sill + 0.02, 0, false));
          model.include(box(0.03, top - sill, 0.05, 'frame', (s0 + s1) / 2, sill, 0));
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
            const leaf = box(s1 - s0 - 0.02, top - 0.02, 0.035, 'door', (s1 - s0) / 2, 0, 0);
            model.include(leaf, s0 + 0.01, 0, t / 2, -deg(75));
            for (const u of [s0, s1]) model.include(box(0.04, top, t + 0.02, 'door', u + (u === s0 ? 0.02 : -0.02), 0, 0));
          } else {
            const half = (s1 - s0) / 2;
            for (const [k, z] of [[0, -0.02], [1, 0.02]] as const) {
              model.include(box(half + 0.04, top - 0.04, 0.02, 'glass', s0 + half * (k + 0.5) + (k ? -0.02 : 0.02), 0.02, z, false));
              model.include(box(0.04, top, 0.04, 'frame', s0 + half * k + (k ? 0 : 0.02), 0, z));
            }
            model.include(box(s1 - s0, 0.04, t, 'frame', (s0 + s1) / 2, top - 0.04, 0));
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
      this.wallGroups.push(this.place(model, this.toWorld(wall.a), -Math.atan2(uy, ux)));
    }

    // Mobiliário
    const home = { dining: false };
    // Sala antes da cozinha: em plantas integradas a mesa de jantar fica num só lugar.
    const order: RoomKind[] = ['living', 'kitchen'];
    const rooms = [...L.rooms].sort((p, q) => (order.indexOf(p.kind) + 1 || 9) - (order.indexOf(q.kind) + 1 || 9));
    for (const room of rooms) {
      const f = new Furnisher(room, obstacles, (model, at, rotY) => this.place(model, this.toWorld(at), rotY), L.walls);
      try { furnish(f, room.kind, home); } catch { /* cômodo irregular: segue sem mobiliário */ }
      const view = this.bestView(room, f);
      this.rooms.push({ room, center: view.pos, look: view.look });
    }

    const list = this.root.querySelector('.interior-rooms')!;
    list.innerHTML = this.rooms.map((r, i) => `<button data-i="${i}">${escapeHtml(r.room.name)}<small>${polygonArea(r.room.points).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m² · ${roomLabel[r.room.kind]}</small></button>`).join('');
    list.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => this.goRoom(Number(b.dataset.i))));
  }
  private refreshShadows = () => {};

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

  private bind(canvas: HTMLCanvasElement) {
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode as 'model' | 'walk')));
    let drag: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { if (this.mode === 'walk') { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || this.mode !== 'walk') return;
      this.walk.yaw += (e.clientX - drag.x) * 0.004; this.walk.pitch = Math.min(0.7, Math.max(-0.9, this.walk.pitch - (e.clientY - drag.y) * 0.003));
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
      if (!this.engine) return;
      if (this.mode !== 'walk') this.setMode('walk');
      this.keys.add(k);
    }
  }

  setMode(mode: 'model' | 'walk', room?: number) {
    this.mode = mode;
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    this.root.classList.toggle('walking', mode === 'walk');
    if (!this.engine) return;
    const walk = mode === 'walk';
    for (const c of this.ceilings) c.setEnabled(walk);
    for (const l of this.lamps) l.setEnabled(walk);
    // Passeio: sol mais baixo entrando pelas janelas, luz difusa menor e luminárias acesas (mais contraste).
    const s = this.size;
    this.sun.position.set(s * 0.6, walk ? s * 0.55 : s * 1.4, s * 0.8);
    this.sun.direction = this.sun.position.scale(-1).normalize();
    this.sun.intensity = walk ? 3.2 : 2.2;
    this.hemi.intensity = (walk ? 0.45 : 1.1) / Math.PI;
    this.scene.environmentIntensity = walk ? 0.3 : 0.55;
    for (const g of this.wallGroups) g.scaling.y = walk ? 1 : 1.1 / this.layout.wallHeight;
    this.refreshShadows();
    this.scene.activeCamera = walk ? this.walker : this.orbit;
    (this.root.querySelector('.interior-hint') as HTMLElement).textContent = walk
      ? 'Arraste para olhar · W A S D ou setas para andar · escolha um cômodo abaixo · Esc fecha'
      : 'Arraste para girar · botão direito move · roda aproxima · clique num cômodo para entrar';
    if (!walk) {
      this.glide = null;
      this.orbit.setTarget(new Vector3(0, 0.6, 0));
      this.orbit.setPosition(new Vector3(this.size * 0.3, this.size * 1.15, this.size * 0.75));
    } else {
      const living = this.rooms.findIndex((r) => r.room.kind === 'living');
      this.goRoom(room ?? (living >= 0 ? living : 0), true);
    }
  }

  private goRoom(index: number, instant = false) {
    const r = this.rooms[index]; if (!r) return;
    if (this.mode === 'model') { this.setMode('walk', index); return; }
    const to = this.toWorld(r.center, eye);
    const dir = this.toWorld(r.look).subtract(this.toWorld(r.center));
    const yaw = Math.atan2(dir.x, -dir.z);
    this.walk.pitch = -0.08;
    if (instant) { this.walk.pos.copyFrom(to); this.walk.yaw = yaw; this.glide = null; return; }
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

  private loop() {
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
        this.walk.pos = Vector3.Lerp(g.from, g.to, e); this.walk.yaw = g.fromYaw + (g.toYaw - g.fromYaw) * e;
        if (g.t >= 1) this.glide = null;
      }
      const { pos, yaw, pitch } = this.walk;
      this.walker.position.copyFrom(pos);
      this.walker.setTarget(new Vector3(pos.x + Math.sin(yaw) * Math.cos(pitch), pos.y + Math.sin(pitch), pos.z - Math.cos(yaw) * Math.cos(pitch)));
    }
    this.scene.render();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    this.engine?.stopRenderLoop();
    this.scene?.dispose();
    this.engine?.dispose();
    this.root.remove();
    this.options.onClose?.();
  }
}

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
