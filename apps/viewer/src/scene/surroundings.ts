import { Texture, TransformNode, Vector3, DynamicTexture, type Color3, type Matrix, type Scene } from './babylon';
import type { Point, Surroundings } from '../types';
import { asphaltTile, grassTile, pavingTile } from './ground';
import { crownGeometry } from './trees';
import { box, compose, cone, instanced, merge, meshFrom, pbr, plane, polygon, prism, rgb, rotateX, rotateY, shadows, type Geo } from './geometry';

const roadWidth: Record<string, number> = {
  motorway: 22, trunk: 20, primary: 16, secondary: 13, tertiary: 11, unclassified: 8, residential: 8, living_street: 6,
  service: 4.5, motorway_link: 9, trunk_link: 9, primary_link: 9, secondary_link: 8, tertiary_link: 8,
};
const labeledRoads = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const maxRoadLabels = 8;
const houseRoads = new Set(['residential', 'living_street', 'unclassified', 'tertiary']);

/** Faixa plana ao longo de uma polilinha (ruas), voltada para cima; UV em metros. */
function ribbon(points: Point[], width: number, y: number): Geo {
  const positions: number[] = []; const indices: number[] = []; const uvs: number[] = []; const normals: number[] = [];
  const half = width / 2;
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(i - 1, 0)]; const next = points[Math.min(i + 1, points.length - 1)];
    let dx = next[0] - prev[0]; let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const l = [points[i][0] - dz * half, points[i][1] + dx * half]; const r = [points[i][0] + dz * half, points[i][1] - dx * half];
    positions.push(l[0], y, l[1], r[0], y, r[1]); uvs.push(l[0], l[1], r[0], r[1]); normals.push(0, 1, 0, 0, 1, 0);
    // UV em coordenadas de mundo (metros): a textura continua sem emenda nos cruzamentos.
    if (i > 0) { const a = (i - 1) * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  return { positions, indices, uvs, normals };
}

/** Textura repetida a cada `meters` metros (UV da faixa em metros). */
function tiled(scene: Scene, name: string, canvas: HTMLCanvasElement, meters: number) {
  const texture = new DynamicTexture(name, canvas, scene, true);
  texture.update(true);
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = texture.vScale = 1 / meters; texture.anisotropicFilteringLevel = 8;
  return texture;
}

function insidePolygon([x, z]: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]; const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Índice espacial simples de segmentos de rua para evitar casas sobre as vias. */
class SegmentGrid {
  private readonly cells = new Map<string, [Point, Point, number][]>();
  constructor(private readonly size = 40) {}
  private key(x: number, z: number) { return `${Math.floor(x / this.size)}:${Math.floor(z / this.size)}`; }
  add(a: Point, b: Point, halfWidth: number) {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (this.size / 2)) + 1;
    const keys = new Set<string>();
    for (let s = 0; s <= steps; s++) { const t = s / steps; keys.add(this.key(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)); }
    for (const k of keys) { if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k)!.push([a, b, halfWidth]); }
  }
  near([x, z]: Point, clearance: number) {
    const cx = Math.floor(x / this.size); const cz = Math.floor(z / this.size);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const [a, b, half] of this.cells.get(`${cx + i}:${cz + j}`) ?? []) {
        const dx = b[0] - a[0]; const dz = b[1] - a[1]; const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
        if (Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz)) < half + clearance) return true;
      }
    }
    return false;
  }
}

function seeded(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

export interface SurroundingsResult { group: TransformNode; illustrativeHouses: number; roadLabels: { name: string; position: Vector3 }[] }

/**
 * Entorno real a partir do OpenStreetMap: ruas, áreas verdes, água e edificações mapeadas.
 * Onde o OSM não tem casas, gera casas ilustrativas ao longo das ruas residenciais.
 */
export function buildSurroundings(scene: Scene, data: Surroundings, exclusion: Point[]): SurroundingsResult {
  const group = new TransformNode('surroundings', scene);
  const random = seeded(42);
  const flat = (name: string, geo: Geo, material: ReturnType<typeof pbr>) => shadows(meshFrom(name, geo, scene, material, group), false);

  const disc = Array.from({ length: 64 }, (_, i) => { const t = (i / 64) * Math.PI * 2; return [Math.cos(t) * data.radius * 2.6, Math.sin(t) * data.radius * 2.6] as Point; });
  flat('city-ground', polygon(disc, -0.05), pbr(scene, 'city-ground', { color: 0xcfd1b1, roughness: 1 }));

  const greens = data.green.filter((g) => g.points.length > 3).map((g) => polygon(g.points, 0.02));
  if (greens.length) flat('greens', merge(greens), pbr(scene, 'greens', { map: tiled(scene, 'grass', grassTile(512), 8), roughness: 1, doubleSided: true }));
  const water = data.water.filter((g) => g.points.length > 3).map((g) => polygon(g.points, 0.05));
  if (water.length) flat('water', merge(water), pbr(scene, 'water', { color: 0x5b9bc7, roughness: 0.15, metalness: 0.1, doubleSided: true }));

  const grid = new SegmentGrid();
  const asphalt: Geo[] = []; const curbs: Geo[] = [];
  const roadLabels: SurroundingsResult['roadLabels'] = [];
  const named = new Map<string, { points: Point[]; length: number; total: number }>();
  for (const road of data.roads) {
    const width = roadWidth[road.kind]; if (!width || road.points.length < 2) continue;
    curbs.push(ribbon(road.points, width + 2.2, 0.06));
    asphalt.push(ribbon(road.points, width, 0.1));
    for (let i = 1; i < road.points.length; i++) grid.add(road.points[i - 1], road.points[i], width / 2);
    // Só as vias principais recebem nome na tela; ruas de bairro ficariam amontoadas.
    if (road.name && labeledRoads.has(road.kind)) {
      let length = 0; for (let i = 1; i < road.points.length; i++) length += Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][1] - road.points[i - 1][1]);
      const current = named.get(road.name);
      if (!current) named.set(road.name, { points: road.points, length, total: length });
      else { current.total += length; if (length > current.length) Object.assign(current, { points: road.points, length }); }
    }
  }
  if (curbs.length) flat('sidewalks', merge(curbs), pbr(scene, 'sidewalks', { map: tiled(scene, 'paving', pavingTile(256, 64), 4), roughness: 0.95, doubleSided: true }));
  if (asphalt.length) flat('roads', merge(asphalt), pbr(scene, 'roads', { map: tiled(scene, 'asphalt', asphaltTile(512), 10), roughness: 0.9, doubleSided: true }));
  // Faixas tracejadas no eixo das vias principais.
  const dashes: Matrix[] = [];
  for (const road of data.roads) {
    if ((roadWidth[road.kind] ?? 0) < 11) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]; const b = road.points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (let d = 2; d < len - 2; d += 9) {
        const t = d / len;
        dashes.push(compose(a[0] + (b[0] - a[0]) * t, 0.13, a[1] + (b[1] - a[1]) * t, 0, -angle, 0, 3, 1, 0.25));
      }
    }
  }
  if (dashes.length) instanced('road-dashes', rotateX(plane(1, 1), -Math.PI / 2), scene, pbr(scene, 'dashes', { color: 0xf2f0e6, unlit: true }), dashes, group);
  // As mais extensas primeiro, no máximo maxRoadLabels, e nunca duas muito próximas.
  const ranked = [...named].filter(([, r]) => r.total >= 150).sort((a, b) => b[1].total - a[1].total);
  for (const [name, { points }] of ranked) {
    if (roadLabels.length >= maxRoadLabels) break;
    const mid = points[Math.floor(points.length / 2)];
    const position = new Vector3(mid[0], 2, mid[1]);
    if (Math.hypot(mid[0], mid[1]) > data.radius * 0.9 || roadLabels.some((l) => Vector3.Distance(l.position, position) < 120)) continue;
    roadLabels.push({ name, position });
  }

  const mapped = data.buildings.filter((b) => b.points.length > 3).map((b) => prism(b.points, 0, Math.max(3, Math.min(b.height, 60))));
  const occupied: Point[] = data.buildings.map((b) => b.points[0]);
  if (mapped.length) shadows(meshFrom('osm-buildings', merge(mapped), scene, pbr(scene, 'osm-buildings', { color: 0xe4e2dc, roughness: 0.95 }), group), true);

  // Casas ilustrativas: lotes de 10 m ao longo das ruas residenciais, dos dois lados.
  const houses: Matrix[] = []; const roofs: Matrix[] = [];
  for (const road of data.roads) {
    if (!houseRoads.has(road.kind)) continue;
    const half = (roadWidth[road.kind] ?? 8) / 2;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]; const b = road.points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 14) continue;
      const dx = (b[0] - a[0]) / len; const dz = (b[1] - a[1]) / len;
      for (let d = 7; d < len - 7; d += 10.5) {
        for (const side of [1, -1]) {
          if (random() < 0.18) continue;
          const offset = half + 9;
          const p: Point = [a[0] + dx * d - dz * offset * side, a[1] + dz * d + dx * offset * side];
          if (Math.hypot(p[0], p[1]) > data.radius) continue;
          if (insidePolygon(p, exclusion) || grid.near(p, 5.5) || occupied.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < 12)) continue;
          const w = 7 + random() * 2.5; const depth = 9 + random() * 4; const h = 3.2 + (random() < 0.15 ? 3 : 0);
          const yaw = Math.atan2(dx, dz);
          houses.push(compose(p[0], h / 2, p[1], 0, yaw, 0, w, h, depth));
          roofs.push(compose(p[0], h + 0.6, p[1], 0, yaw, 0, w + 0.6, 1.2, depth + 0.6));
        }
      }
    }
  }
  if (houses.length) {
    const walls = [0xf1ece2, 0xe8e2d4, 0xdfe3e2, 0xf3eadb, 0xe6ddd0, 0xd9d4ca]; const tiles = [0xc9643f, 0xb85a3a, 0xd27a52, 0xa95238, 0x8f8a84];
    const wallColors: Color3[] = houses.map(() => rgb(walls[Math.floor(random() * walls.length)]));
    const roofColors: Color3[] = roofs.map(() => rgb(tiles[Math.floor(random() * tiles.length)]));
    shadows(instanced('houses', box(1, 1, 1), scene, pbr(scene, 'houses', { color: 0xffffff, roughness: 0.95 }), houses, group, wallColors), true);
    shadows(instanced('house-roofs', rotateY(cone(0.72, 1, 4), Math.PI / 4), scene, pbr(scene, 'house-roofs', { color: 0xffffff, roughness: 0.9 }), roofs, group, roofColors), true);
  }

  // Árvores nas áreas verdes.
  const trees: Matrix[] = [];
  for (const area of data.green) {
    if (area.points.length < 4) continue;
    const xs = area.points.map((p) => p[0]); const zs = area.points.map((p) => p[1]);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const count = Math.min(400, Math.floor(((maxX - minX) * (maxZ - minZ)) / 600));
    for (let i = 0; i < count; i++) {
      const p: Point = [minX + random() * (maxX - minX), minZ + random() * (maxZ - minZ)];
      if (!insidePolygon(p, area.points) || insidePolygon(p, exclusion)) continue;
      const s = 3 + random() * 3;
      trees.push(compose(p[0], s, p[1], 0, 0, 0, s, s * 1.1, s));
    }
  }
  if (trees.length) shadows(instanced('osm-trees', crownGeometry(), scene, pbr(scene, 'osm-trees', { color: 0x5b9a45, roughness: 0.9 }), trees, group), true);
  return { group, illustrativeHouses: houses.length, roadLabels };
}