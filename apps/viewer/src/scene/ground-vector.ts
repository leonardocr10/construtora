import earcut from 'earcut';
import { computeNormals, type Geo } from './geometry';
import { Ground, asphaltLevel, curbHeight, type GroundMap } from './ground';
import type { Point } from '../types';

/**
 * Chão do lote em contornos vetoriais, sem os degraus de pixel da malha anterior:
 * 1. cada classe vira um campo 0–1 levemente desfocado (3 × 3);
 * 2. o contorno em 0,5 é traçado com marching squares (posição interpolada, abaixo de 1 pixel);
 * 3. os laços são simplificados (Douglas–Peucker) e os cantos levemente arredondados;
 * 4. contornos externos e furos são aninhados pela contenção e triangulados com earcut.
 *
 * Camadas: o asfalto é o polígono do lote (feito fora daqui). Por cima, à altura do meio-fio, vem todo o chão
 * elevado em piso; a grama e o "outro" (arte: quadra, piscina, deque) ficam 1 e 2 cm acima, dentro dele, então
 * não sobram frestas entre classes vizinhas. As faces do meio-fio seguem o contorno do chão elevado.
 * Coordenadas devolvidas no referencial do terreno (metros); UV em metros (x, −z).
 */
export interface VectorGround { raised: Geo; grass: Geo | null; other: Geo | null; curbs: Geo }

export function buildVectorGround(map: GroundMap, toSite: (p: Point) => Point): VectorGround {
  const { w, h, classes } = map;
  const level = asphaltLevel + curbHeight;
  const field = (on: (c: number) => boolean) => {
    const W = w + 2, H = h + 2; const f = new Float32Array(W * H);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = classes[y * w + x];
      if (c === Ground.Outside) {
        // Fora do lote: copia o vizinho de dentro (1 pixel), para o contorno não recuar da divisa do lote.
        let v = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && classes[ny * w + nx] !== Ground.Outside && on(classes[ny * w + nx])) v = 1; }
        f[(y + 1) * W + x + 1] = v;
      } else f[(y + 1) * W + x + 1] = on(c) ? 1 : 0;
    }
    return blur(f, W, H);
  };
  const raised = (c: number) => c === Ground.Grass || c === Ground.Paving || c === Ground.Other;
  const toGeo = (loops: Point[][], y: number) => partsToGeo(nest(loops), y, (p) => toSite([p[0] + map.x0, p[1] + map.y0]));

  const raisedLoops = contours(field(raised), w + 2, h + 2);
  const grassLoops = contours(field((c) => c === Ground.Grass), w + 2, h + 2);
  const otherLoops = contours(field((c) => c === Ground.Other), w + 2, h + 2);

  // Meio-fio: faixa vertical do asfalto ao chão elevado ao longo de cada contorno elevado.
  const curbs = curbFaces(raisedLoops.map((loop) => loop.map((p) => toSite([p[0] + map.x0, p[1] + map.y0]))));
  return {
    raised: toGeo(raisedLoops, level) ?? { positions: [], indices: [], uvs: [] },
    grass: toGeo(grassLoops, level + 0.01),
    other: toGeo(otherLoops, level + 0.02),
    curbs,
  };
}

/** Contornos externos com furos (em qualquer referencial: `toSite` leva ao terreno) triangulados à cota `y`. */
export function partsToGeo(parts: { outer: Point[]; holes: Point[][] }[], y: number, toSite: (p: Point) => Point): Geo | null {
  const positions: number[] = []; const indices: number[] = []; const uvs: number[] = [];
  for (const { outer, holes } of parts) {
    const ring = [outer, ...holes].map((loop) => loop.map(toSite));
    const flat: number[] = []; const holeIndex: number[] = [];
    for (const loop of ring) { if (flat.length) holeIndex.push(flat.length / 2); for (const [x, z] of loop) flat.push(x, z); }
    const tri = earcut(flat, holeIndex);
    const base = positions.length / 3;
    for (let i = 0; i < flat.length; i += 2) { positions.push(flat[i], y, flat[i + 1]); uvs.push(flat[i], -flat[i + 1]); }
    // Frente para cima: (c − b) × (a − b) com y positivo.
    for (let i = 0; i < tri.length; i += 3) {
      const [a, b, c] = [tri[i], tri[i + 1], tri[i + 2]];
      const ax = flat[a * 2], az = flat[a * 2 + 1], bx = flat[b * 2], bz = flat[b * 2 + 1], cx = flat[c * 2], cz = flat[c * 2 + 1];
      const up = (cz - bz) * (ax - bx) - (cx - bx) * (az - bz) >= 0;
      indices.push(...(up ? [a + base, b + base, c + base] : [a + base, c + base, b + base]));
    }
  }
  return positions.length ? computeNormals({ positions, indices, uvs }) : null;
}

/** Faces verticais do meio-fio, do asfalto ao chão elevado, ao longo de cada laço (já no referencial do terreno). */
export function curbFaces(loops: Point[][]): Geo {
  const level = asphaltLevel + curbHeight;
  const curbs: Geo = { positions: [], indices: [], uvs: [] };
  for (const loop of loops) {
    let along = 0;
    for (let i = 0; i < loop.length; i++) {
      const [ax, az] = loop[i]; const [bx, bz] = loop[(i + 1) % loop.length];
      const len = Math.hypot(bx - ax, bz - az); const base = curbs.positions.length / 3;
      curbs.positions.push(ax, asphaltLevel, az, bx, asphaltLevel, bz, bx, level, bz, ax, level, az);
      curbs.uvs.push(along, 0, along + len, 0, along + len, curbHeight, along, curbHeight);
      curbs.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      along += len;
    }
  }
  return computeNormals(curbs);
}

/** Desfoque 3 × 3 (duas passadas separáveis). */
function blur(f: Float32Array, W: number, H: number) {
  const a = new Float32Array(W * H); const b = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; a[i] = (f[i] * 2 + (x > 0 ? f[i - 1] : f[i]) + (x < W - 1 ? f[i + 1] : f[i])) / 4; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; b[i] = (a[i] * 2 + (y > 0 ? a[i - W] : a[i]) + (y < H - 1 ? a[i + W] : a[i])) / 4; }
  return b;
}

/**
 * Marching squares no nível 0,5. Os vértices do campo são centros de pixel deslocados por 1 (borda acolchoada);
 * os pontos devolvidos estão em pixels do recorte (0,5 = centro do primeiro pixel). Laços já simplificados.
 */
function contours(f: Float32Array, W: number, H: number): Point[][] {
  const iso = 0.5;
  // Pontos sobre arestas: id 2·(y·W + x) para a aresta horizontal (x,y)–(x+1,y) e +1 para a vertical (x,y)–(x,y+1).
  const point = new Map<number, Point>();
  const link = new Map<number, number[]>();
  const edgePoint = (id: number) => {
    let p = point.get(id);
    if (!p) {
      const cell = id >> 1; const x = cell % W; const y = (cell - x) / W;
      const va = f[cell]; const vb = id & 1 ? f[cell + W] : f[cell + 1];
      const t = Math.abs(vb - va) < 1e-6 ? 0.5 : (iso - va) / (vb - va);
      p = id & 1 ? [x - 0.5, y + t - 0.5] : [x + t - 0.5, y - 0.5];
      point.set(id, p);
    }
    return id;
  };
  const connect = (a: number, b: number) => { edgePoint(a); edgePoint(b); (link.get(a) ?? link.set(a, []).get(a)!).push(b); (link.get(b) ?? link.set(b, []).get(b)!).push(a); };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const i = y * W + x;
    const tl = f[i] > iso ? 1 : 0, tr = f[i + 1] > iso ? 1 : 0, br = f[i + W + 1] > iso ? 1 : 0, bl = f[i + W] > iso ? 1 : 0;
    const code = tl * 8 + tr * 4 + br * 2 + bl;
    if (code === 0 || code === 15) continue;
    const top = 2 * i, left = 2 * i + 1, bottom = 2 * (i + W), right = 2 * (i + 1) + 1;
    const center = (f[i] + f[i + 1] + f[i + W] + f[i + W + 1]) / 4 > iso;
    switch (code) {
      case 1: case 14: connect(left, bottom); break;
      case 2: case 13: connect(bottom, right); break;
      case 3: case 12: connect(left, right); break;
      case 4: case 11: connect(top, right); break;
      case 6: case 9: connect(top, bottom); break;
      case 7: case 8: connect(left, top); break;
      case 5: if (center) { connect(left, top); connect(bottom, right); } else { connect(left, bottom); connect(top, right); } break;
      case 10: if (center) { connect(left, bottom); connect(top, right); } else { connect(left, top); connect(bottom, right); } break;
    }
  }
  const visited = new Set<number>(); const loops: Point[][] = [];
  for (const start of link.keys()) {
    if (visited.has(start)) continue;
    const loop: Point[] = []; let prev = -1; let cur = start;
    while (!visited.has(cur)) {
      visited.add(cur); loop.push(point.get(cur)!);
      const next = (link.get(cur) ?? []).find((n) => n !== prev && !visited.has(n)) ?? (link.get(cur) ?? []).find((n) => n !== prev);
      if (next == null) break;
      prev = cur; cur = next;
    }
    if (loop.length < 4) continue;
    const simple = roundCorners(simplify(loop, 0.45), 2);
    if (Math.abs(area(simple)) >= 6) loops.push(simple); // menos de ~0,15 m²: ruído
  }
  return loops;
}

const area = (loop: Point[]) => loop.reduce((s, [x1, y1], i) => { const [x2, y2] = loop[(i + 1) % loop.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2;

/** Douglas–Peucker num laço fechado (divide no ponto mais distante do primeiro). */
function simplify(loop: Point[], eps: number): Point[] {
  const dp = (pts: Point[]): Point[] => {
    if (pts.length < 3) return pts;
    const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]; const dx = bx - ax, dy = by - ay; const len = Math.hypot(dx, dy) || 1;
    let best = 0, index = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len; if (d > best) { best = d; index = i; } }
    if (best <= eps) return [pts[0], pts[pts.length - 1]];
    return [...dp(pts.slice(0, index + 1)).slice(0, -1), ...dp(pts.slice(index))];
  };
  let far = 0, fd = 0; for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = dp(loop.slice(0, far + 1)); const b = dp([...loop.slice(far), loop[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Corta cada canto a no máximo `maxCut` pixels (ou 1/4 da aresta), arredondando sem engolir retas longas. */
function roundCorners(loop: Point[], maxCut: number): Point[] {
  if (loop.length < 3) return loop;
  const out: Point[] = [];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length]; const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const t = Math.min(0.25, maxCut / len);
    out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], [p[0] + (q[0] - p[0]) * (1 - t), p[1] + (q[1] - p[1]) * (1 - t)]);
  }
  return out;
}

/** Aninha os laços pela contenção: profundidade par = contorno externo, ímpar = furo do pai. */
function nest(loops: Point[][]) {
  const items = loops.map((loop) => ({ loop, abs: Math.abs(area(loop)) })).sort((a, b) => b.abs - a.abs);
  const depth: number[] = []; const parent: number[] = [];
  items.forEach((item, i) => {
    let p = -1;
    for (let j = i - 1; j >= 0; j--) if (inside(item.loop[0], items[j].loop)) { p = j; break; }
    parent[i] = p; depth[i] = p < 0 ? 0 : depth[p] + 1;
  });
  const parts = new Map<number, { outer: Point[]; holes: Point[][] }>();
  items.forEach((item, i) => { if (depth[i] % 2 === 0) parts.set(i, { outer: item.loop, holes: [] }); });
  items.forEach((item, i) => { if (depth[i] % 2 === 1) parts.get(parent[i])?.holes.push(item.loop); });
  return [...parts.values()];
}

function inside([x, y]: Point, poly: Point[]) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r; }
  return r;
}
