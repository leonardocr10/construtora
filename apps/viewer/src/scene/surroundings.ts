import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Point, Surroundings } from '../types';
import { asphaltTile, pavingTile } from './ground';

const roadWidth: Record<string, number> = {
  motorway: 22, trunk: 20, primary: 16, secondary: 13, tertiary: 11, unclassified: 8, residential: 8, living_street: 6,
  service: 4.5, motorway_link: 9, trunk_link: 9, primary_link: 9, secondary_link: 8, tertiary_link: 8,
};
const houseRoads = new Set(['residential', 'living_street', 'unclassified', 'tertiary']);

/** Faixa plana ao longo de uma polilinha (ruas). */
function ribbon(points: Point[], width: number, y: number) {
  const positions: number[] = []; const indices: number[] = [];
  const half = width / 2;
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(i - 1, 0)]; const next = points[Math.min(i + 1, points.length - 1)];
    let dx = next[0] - prev[0]; let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    positions.push(points[i][0] - dz * half, y, points[i][1] + dx * half, points[i][0] + dz * half, y, points[i][1] - dx * half);
    if (i > 0) { const a = (i - 1) * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // UV em coordenadas de mundo (metros): a textura continua sem emenda nos cruzamentos.
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(positions.flatMap((v, i) => (i % 3 === 1 ? [] : [v])), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Textura repetida a cada `meters` metros (UV da faixa em metros). */
function tiled(canvas: HTMLCanvasElement, meters: number) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / meters, 1 / meters); texture.anisotropy = 8;
  return texture;
}

/** Polígono plano no chão (áreas verdes, água, lote). */
export function flatPolygon(points: Point[], y: number) {
  const ring = points.length > 2 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1] ? points.slice(0, -1) : points;
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(contour.flatMap((v) => [v.x, y, v.y]), 3));
  geometry.setIndex(triangles.flat().reverse());
  geometry.computeVertexNormals();
  return geometry;
}

function extruded(points: Point[], height: number) {
  const ring = points.slice(0, -1);
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
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

export interface SurroundingsResult { group: THREE.Group; illustrativeHouses: number; roadLabels: { name: string; position: THREE.Vector3 }[] }

/**
 * Entorno real a partir do OpenStreetMap: ruas, áreas verdes, água e edificações mapeadas.
 * Onde o OSM não tem casas, gera casas ilustrativas ao longo das ruas residenciais.
 */
export function buildSurroundings(data: Surroundings, exclusion: Point[]): SurroundingsResult {
  const group = new THREE.Group();
  const random = seeded(42);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(data.radius * 2.6, 64).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xcfd1b1 }));
  ground.receiveShadow = true; ground.position.y = -0.05;
  group.add(ground);

  const greens = data.green.filter((g) => g.points.length > 3).map((g) => flatPolygon(g.points, 0.02));
  if (greens.length) { const mesh = new THREE.Mesh(mergeGeometries(greens), new THREE.MeshLambertMaterial({ color: 0x86a95f, side: THREE.DoubleSide })); mesh.receiveShadow = true; group.add(mesh); }
  const water = data.water.filter((g) => g.points.length > 3).map((g) => flatPolygon(g.points, 0.05));
  if (water.length) group.add(new THREE.Mesh(mergeGeometries(water), new THREE.MeshPhongMaterial({ color: 0x5b9bc7, shininess: 80, side: THREE.DoubleSide })));

  const grid = new SegmentGrid();
  const asphalt: THREE.BufferGeometry[] = []; const curbs: THREE.BufferGeometry[] = [];
  const roadLabels: SurroundingsResult['roadLabels'] = [];
  const named = new Map<string, { points: Point[]; length: number }>();
  for (const road of data.roads) {
    const width = roadWidth[road.kind]; if (!width || road.points.length < 2) continue;
    curbs.push(ribbon(road.points, width + 2.2, 0.06));
    asphalt.push(ribbon(road.points, width, 0.1));
    for (let i = 1; i < road.points.length; i++) grid.add(road.points[i - 1], road.points[i], width / 2);
    if (road.name && width >= 8) {
      let length = 0; for (let i = 1; i < road.points.length; i++) length += Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][1] - road.points[i - 1][1]);
      if (length > (named.get(road.name)?.length ?? 0)) named.set(road.name, { points: road.points, length });
    }
  }
  if (curbs.length) { const mesh = new THREE.Mesh(mergeGeometries(curbs), new THREE.MeshLambertMaterial({ map: tiled(pavingTile(256, 64), 4), side: THREE.DoubleSide })); mesh.receiveShadow = true; group.add(mesh); }
  if (asphalt.length) { const mesh = new THREE.Mesh(mergeGeometries(asphalt), new THREE.MeshLambertMaterial({ map: tiled(asphaltTile(512), 10), side: THREE.DoubleSide })); mesh.receiveShadow = true; group.add(mesh); }
  // Faixas tracejadas no eixo das vias principais.
  const dashes: THREE.Matrix4[] = []; const dash = new THREE.Object3D();
  for (const road of data.roads) {
    if ((roadWidth[road.kind] ?? 0) < 11) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]; const b = road.points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (let d = 2; d < len - 2; d += 9) {
        const t = d / len;
        dash.position.set(a[0] + (b[0] - a[0]) * t, 0.13, a[1] + (b[1] - a[1]) * t); dash.rotation.set(0, -angle, 0); dash.scale.set(3, 1, 0.25); dash.updateMatrix();
        dashes.push(dash.matrix.clone());
      }
    }
  }
  if (dashes.length) {
    const marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2f0e6 }), dashes.length);
    dashes.forEach((m, i) => marks.setMatrixAt(i, m));
    group.add(marks);
  }
  for (const [name, { points }] of named) {
    const mid = points[Math.floor(points.length / 2)];
    if (Math.hypot(mid[0], mid[1]) < data.radius * 0.9) roadLabels.push({ name, position: new THREE.Vector3(mid[0], 2, mid[1]) });
  }

  const mapped = data.buildings.filter((b) => b.points.length > 3).map((b) => extruded(b.points, Math.max(3, Math.min(b.height, 60))));
  const occupied: Point[] = data.buildings.map((b) => b.points[0]);
  if (mapped.length) { const mesh = new THREE.Mesh(mergeGeometries(mapped), new THREE.MeshLambertMaterial({ color: 0xe4e2dc })); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }

  // Casas ilustrativas: lotes de 10 m ao longo das ruas residenciais, dos dois lados.
  const houses: THREE.Matrix4[] = []; const roofs: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
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
          dummy.position.set(p[0], h / 2, p[1]); dummy.rotation.set(0, Math.atan2(dx, dz), 0); dummy.scale.set(w, h, depth); dummy.updateMatrix();
          houses.push(dummy.matrix.clone());
          dummy.position.y = h + 0.6; dummy.scale.set(w + 0.6, 1.2, depth + 0.6); dummy.updateMatrix();
          roofs.push(dummy.matrix.clone());
        }
      }
    }
  }
  if (houses.length) {
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), houses.length);
    const roof = new THREE.InstancedMesh(new THREE.ConeGeometry(0.72, 1, 4).rotateY(Math.PI / 4), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), roofs.length);
    const walls = [0xf1ece2, 0xe8e2d4, 0xdfe3e2, 0xf3eadb, 0xe6ddd0, 0xd9d4ca]; const tiles = [0xc9643f, 0xb85a3a, 0xd27a52, 0xa95238, 0x8f8a84];
    const color = new THREE.Color();
    houses.forEach((m, i) => { body.setMatrixAt(i, m); body.setColorAt(i, color.setHex(walls[Math.floor(random() * walls.length)])); });
    roofs.forEach((m, i) => { roof.setMatrixAt(i, m); roof.setColorAt(i, color.setHex(tiles[Math.floor(random() * tiles.length)])); });
    body.castShadow = roof.castShadow = true; body.receiveShadow = true;
    group.add(body, roof);
  }

  // Árvores nas áreas verdes.
  const trees: THREE.Matrix4[] = [];
  for (const area of data.green) {
    if (area.points.length < 4) continue;
    const xs = area.points.map((p) => p[0]); const zs = area.points.map((p) => p[1]);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const count = Math.min(400, Math.floor(((maxX - minX) * (maxZ - minZ)) / 600));
    for (let i = 0; i < count; i++) {
      const p: Point = [minX + random() * (maxX - minX), minZ + random() * (maxZ - minZ)];
      if (!insidePolygon(p, area.points) || insidePolygon(p, exclusion)) continue;
      const s = 3 + random() * 3;
      dummy.position.set(p[0], s, p[1]); dummy.rotation.set(0, 0, 0); dummy.scale.set(s, s * 1.1, s); dummy.updateMatrix();
      trees.push(dummy.matrix.clone());
    }
  }
  if (trees.length) {
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x4f8a3a, flatShading: true }), trees.length);
    trees.forEach((m, i) => crowns.setMatrixAt(i, m));
    crowns.castShadow = true;
    group.add(crowns);
  }
  return { group, illustrativeHouses: houses.length, roadLabels };
}
