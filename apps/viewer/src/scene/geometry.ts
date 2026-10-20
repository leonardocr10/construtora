import earcut from 'earcut';
import { Color3, Matrix, Mesh, PBRMaterial, Quaternion, Vector3, VertexData, type BaseTexture, type Scene, type TransformNode } from './babylon';
import type { Point } from '../types';

/**
 * Geometria em arrays simples, independente do motor: triângulos no sentido anti-horário vistos de fora,
 * metros, y para cima (mesma convenção do restante do visualizador, com a cena em mão direita).
 * Aqui ficam as primitivas (caixa, cilindro, cone, icosaedro, polígonos, extrusões, tubos), as cores
 * em espaço linear, o material PBR padrão e a criação de malhas e instâncias finas.
 */
export interface Geo { positions: number[]; indices: number[]; uvs: number[]; normals?: number[]; colors?: number[] }

// ——— cores (sRGB da arte/CSS → linear, que é o que o PBR espera) ———

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
/** Cor sRGB (0–255) em espaço linear. */
export const srgb = (r: number, g: number, b: number) => new Color3(toLinear(r / 255), toLinear(g / 255), toLinear(b / 255));
/** Cor CSS (#rrggbb, número 0xrrggbb ou rgb(r,g,b)) em espaço linear. */
export function rgb(value: string | number | Color3): Color3 {
  if (value instanceof Color3) return value.clone();
  if (typeof value === 'number') return srgb((value >> 16) & 255, (value >> 8) & 255, value & 255);
  const css = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(value);
  if (css) return srgb(Number(css[1]), Number(css[2]), Number(css[3]));
  return rgb(parseInt(value.replace('#', ''), 16));
}
/** Cor linear → componentes sRGB 0–255 (para pintar canvas). */
export const toSrgbBytes = (c: Color3) => [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255)) as [number, number, number];
/** HSL em sRGB (como Color.setHSL(..., SRGBColorSpace) do Three) devolvido em linear. */
export function hsl(h: number, s: number, l: number) {
  const hue = (t: number) => { t = ((t % 1) + 1) % 1; const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * 6 * (2 / 3 - t) : p; };
  return s === 0 ? new Color3(toLinear(l), toLinear(l), toLinear(l)) : new Color3(toLinear(hue(h + 1 / 3)), toLinear(hue(h)), toLinear(hue(h - 1 / 3)));
}
/** Matiz, saturação e luminosidade de uma cor (no espaço em que ela está). */
export function getHsl(c: Color3) {
  const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b); const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min; const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === c.r ? (c.g - c.b) / d + (c.g < c.b ? 6 : 0) : max === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
  return { h: h / 6, s, l };
}
/** Mesma cor com a luminosidade deslocada (HSL no espaço linear, como offsetHSL do Three). */
export function offsetLightness(c: Color3, delta: number) {
  const { h, s, l } = getHsl(c); const t = Math.min(1, Math.max(0, l + delta));
  const hue = (x: number) => { x = ((x % 1) + 1) % 1; const q = t < 0.5 ? t * (1 + s) : t + s - t * s; const p = 2 * t - q; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * 6 * (2 / 3 - x) : p; };
  return s === 0 ? new Color3(t, t, t) : new Color3(hue(h + 1 / 3), hue(h), hue(h - 1 / 3));
}

// ——— material ———

export interface MaterialOptions {
  color?: string | number | Color3; roughness?: number; metalness?: number;
  emissive?: string | number | Color3; emissiveIntensity?: number;
  alpha?: number; depthWrite?: boolean; doubleSided?: boolean; map?: BaseTexture | null; unlit?: boolean;
  /** Luzes simultâneas por material (padrão 4; a planta 3D usa mais por causa das luminárias). */
  maxLights?: number;
}
/** Material PBR metálico/rugosidade com valores na mesma escala do MeshStandardMaterial. */
export function pbr(scene: Scene, name: string, o: MaterialOptions = {}) {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = rgb(o.color ?? 0xffffff);
  m.metallic = o.metalness ?? 0;
  m.roughness = o.roughness ?? 1;
  if (o.map) m.albedoTexture = o.map;
  if (o.emissive != null) { m.emissiveColor = rgb(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
  if (o.alpha != null && o.alpha < 1) { m.alpha = o.alpha; m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; }
  if (o.depthWrite === false) m.disableDepthWrite = true;
  if (o.doubleSided) { m.backFaceCulling = false; m.twoSidedLighting = true; }
  if (o.unlit) m.unlit = true;
  m.maxSimultaneousLights = o.maxLights ?? 4;
  return m;
}

// ——— transformações ———

/** Quaternion de ângulos de Euler na ordem XYZ (a do Object3D do Three). */
export function quatXYZ(x: number, y: number, z: number) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return new Quaternion(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
}
/** Matriz de posição, rotação XYZ e escala. */
export const compose = (px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  Matrix.Compose(new Vector3(sx, sy, sz), quatXYZ(rx, ry, rz), new Vector3(px, py, pz));
/** Aplica rotação XYZ a um nó (Babylon usa YXZ em `rotation`; aqui o quaternion garante a ordem do Three). */
export function setRotationXYZ(node: TransformNode, x: number, y: number, z: number) { node.rotationQuaternion = quatXYZ(x, y, z); }

export function transform(geo: Geo, m: Matrix): Geo {
  const p = geo.positions.slice(); const v = new Vector3();
  for (let i = 0; i < p.length; i += 3) { Vector3.TransformCoordinatesFromFloatsToRef(p[i], p[i + 1], p[i + 2], m, v); p[i] = v.x; p[i + 1] = v.y; p[i + 2] = v.z; }
  let normals: number[] | undefined;
  if (geo.normals) {
    const nm = m.clone(); nm.setTranslationFromFloats(0, 0, 0); nm.invert().transposeToRef(nm);
    normals = geo.normals.slice();
    for (let i = 0; i < normals.length; i += 3) { Vector3.TransformNormalFromFloatsToRef(normals[i], normals[i + 1], normals[i + 2], nm, v); v.normalize(); normals[i] = v.x; normals[i + 1] = v.y; normals[i + 2] = v.z; }
  }
  // Escala negativa espelha a malha: inverte a ordem dos triângulos para manter as faces para fora.
  const indices = m.determinant() < 0 ? flipIndices(geo.indices) : geo.indices.slice();
  return { ...geo, positions: p, normals, indices };
}
const flipIndices = (indices: number[]) => { const out = indices.slice(); for (let i = 0; i < out.length; i += 3) [out[i + 1], out[i + 2]] = [out[i + 2], out[i + 1]]; return out; };
export const translate = (g: Geo, x: number, y: number, z: number) => transform(g, Matrix.Translation(x, y, z));
export const rotateX = (g: Geo, a: number) => transform(g, Matrix.RotationX(a));
export const rotateY = (g: Geo, a: number) => transform(g, Matrix.RotationY(a));
export const rotateZ = (g: Geo, a: number) => transform(g, Matrix.RotationZ(a));

/** Normais por vértice como computeVertexNormals do Three: (c − b) × (a − b), somadas nos vértices compartilhados. */
export function computeNormals(geo: Geo) {
  const p = geo.positions; const n = new Array<number>(p.length).fill(0); const idx = geo.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const cbx = p[c] - p[b], cby = p[c + 1] - p[b + 1], cbz = p[c + 2] - p[b + 2];
    const abx = p[a] - p[b], aby = p[a + 1] - p[b + 1], abz = p[a + 2] - p[b + 2];
    const nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  geo.normals = n;
  return geo;
}

/** Cada triângulo com vértices próprios (normais facetadas, como toNonIndexed + computeVertexNormals). */
export function nonIndexed(geo: Geo): Geo {
  const out: Geo = { positions: [], indices: [], uvs: [], colors: geo.colors ? [] : undefined, normals: geo.normals ? [] : undefined };
  geo.indices.forEach((i, k) => {
    out.positions.push(geo.positions[i * 3], geo.positions[i * 3 + 1], geo.positions[i * 3 + 2]);
    out.uvs.push(geo.uvs[i * 2] ?? 0, geo.uvs[i * 2 + 1] ?? 0);
    geo.colors && out.colors!.push(geo.colors[i * 4], geo.colors[i * 4 + 1], geo.colors[i * 4 + 2], geo.colors[i * 4 + 3]);
    geo.normals && out.normals!.push(geo.normals[i * 3], geo.normals[i * 3 + 1], geo.normals[i * 3 + 2]);
    out.indices.push(k);
  });
  return out;
}

export function merge(list: Geo[]): Geo {
  const out: Geo = { positions: [], indices: [], uvs: [], normals: [] };
  const colored = list.some((g) => g.colors);
  if (colored) out.colors = [];
  for (const g of list) {
    const base = out.positions.length / 3; const count = g.positions.length / 3;
    if (!g.normals) computeNormals(g);
    for (const v of g.positions) out.positions.push(v);
    for (const v of g.normals!) out.normals!.push(v);
    for (let i = 0; i < count * 2; i++) out.uvs.push(g.uvs[i] ?? 0);
    if (colored) for (let i = 0; i < count * 4; i++) out.colors!.push(g.colors ? g.colors[i] : 1);
    for (const i of g.indices) out.indices.push(i + base);
  }
  return out;
}

// ——— primitivas (mesmas dimensões e orientação das do Three) ———

type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
/** Caixa centrada na origem; `faces` escolhe só algumas faces (ex.: laterais e tampas com materiais diferentes). */
export function box(w: number, h: number, d: number, faces: Face[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz']): Geo {
  const geo: Geo = { positions: [], indices: [], uvs: [], normals: [] };
  const spec: Record<Face, [number[], number[], number[], number, number, number]> = {
    // normal, eixo u, eixo v (u × v = normal), meia largura em u, em v, distância ao centro
    px: [[1, 0, 0], [0, 0, -1], [0, 1, 0], d / 2, h / 2, w / 2], nx: [[-1, 0, 0], [0, 0, 1], [0, 1, 0], d / 2, h / 2, w / 2],
    py: [[0, 1, 0], [1, 0, 0], [0, 0, -1], w / 2, d / 2, h / 2], ny: [[0, -1, 0], [1, 0, 0], [0, 0, 1], w / 2, d / 2, h / 2],
    pz: [[0, 0, 1], [1, 0, 0], [0, 1, 0], w / 2, h / 2, d / 2], nz: [[0, 0, -1], [-1, 0, 0], [0, 1, 0], w / 2, h / 2, d / 2],
  };
  for (const face of faces) {
    const [n, u, v, hu, hv, dist] = spec[face]; const base = geo.positions.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) geo.positions.push(n[k] * dist + u[k] * hu * su + v[k] * hv * sv);
      geo.normals!.push(...n); geo.uvs.push((su + 1) / 2, (sv + 1) / 2);
    }
    geo.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return geo;
}

/** Cilindro (ou tronco de cone) centrado na origem, eixo y, como CylinderGeometry. */
export function cylinder(radiusTop: number, radiusBottom: number, height: number, segments = 16, openEnded = false): Geo {
  const geo: Geo = { positions: [], indices: [], uvs: [], normals: [] };
  const slope = (radiusBottom - radiusTop) / height;
  for (let row = 0; row <= 1; row++) {
    const r = row ? radiusBottom : radiusTop; const y = row ? -height / 2 : height / 2;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2; const sin = Math.sin(t), cos = Math.cos(t);
      geo.positions.push(r * sin, y, r * cos);
      const l = Math.hypot(sin, slope, cos); geo.normals!.push(sin / l, slope / l, cos / l);
      geo.uvs.push(i / segments, 1 - row);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i, b = segments + 1 + i, c = segments + 2 + i, d = i + 1;
    geo.indices.push(a, b, d, b, c, d);
  }
  if (!openEnded) for (const top of [true, false]) {
    const r = top ? radiusTop : radiusBottom; if (r <= 0) continue;
    const y = top ? height / 2 : -height / 2; const sign = top ? 1 : -1;
    const center = geo.positions.length / 3;
    geo.positions.push(0, y, 0); geo.normals!.push(0, sign, 0); geo.uvs.push(0.5, 0.5);
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      geo.positions.push(r * Math.sin(t), y, r * Math.cos(t)); geo.normals!.push(0, sign, 0); geo.uvs.push(Math.sin(t) * 0.5 + 0.5, Math.cos(t) * 0.5 + 0.5);
    }
    for (let i = 0; i < segments; i++) {
      const a = center + 1 + i, b = center + 2 + i;
      if (top) geo.indices.push(a, b, center); else geo.indices.push(b, a, center);
    }
  }
  return geo;
}
export const cone = (radius: number, height: number, segments = 16) => cylinder(0, radius, height, segments);

/** Icosaedro subdividido (detail como no Three); normais suaves (radiais). Triângulos com vértices próprios. */
export function icosahedron(radius: number, detail = 0): Geo {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const geo: Geo = { positions: [], indices: [], uvs: [], normals: [] };
  const push = (p: number[]) => { const l = Math.hypot(p[0], p[1], p[2]); geo.positions.push((p[0] / l) * radius, (p[1] / l) * radius, (p[2] / l) * radius); geo.normals!.push(p[0] / l, p[1] / l, p[2] / l); geo.uvs.push(0, 0); geo.indices.push(geo.indices.length); };
  const n = detail + 1;
  for (const [ia, ib, ic] of f) {
    const a = v[ia], b = v[ib], c = v[ic];
    const at = (i: number, j: number) => { const u = i / n, w = j / n; return [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * u + (c[k] - a[k]) * w); };
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      push(at(i, j)); push(at(i + 1, j)); push(at(i, j + 1));
      if (j < n - i - 1) { push(at(i + 1, j)); push(at(i + 1, j + 1)); push(at(i, j + 1)); }
    }
  }
  return geo;
}

/** Plano no XY voltado para +z, centrado (como PlaneGeometry). */
export function plane(w: number, h: number): Geo { return box(w, h, 0, ['pz']); }

/** Disco no XY voltado para +z (como CircleGeometry). */
export function circle(radius: number, segments = 32): Geo {
  const geo: Geo = { positions: [0, 0, 0], indices: [], uvs: [0.5, 0.5], normals: [0, 0, 1] };
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    geo.positions.push(radius * Math.cos(t), radius * Math.sin(t), 0); geo.normals!.push(0, 0, 1); geo.uvs.push(Math.cos(t) / 2 + 0.5, Math.sin(t) / 2 + 0.5);
    if (i) geo.indices.push(i, i + 1, 0);
  }
  return geo;
}

const signedArea = (ring: Point[]) => ring.reduce((s, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2;
/** Tira o ponto final repetido de anéis fechados. */
export const openRing = (points: Point[]) => (points.length > 2 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1] ? points.slice(0, -1) : points);

/** Polígono plano no chão (x, z) na altura y, voltado para cima; UV em metros (ou em `uv` por vértice). */
export function polygon(points: Point[], y: number, uv?: (p: Point, i: number) => Point): Geo {
  const ring = openRing(points);
  const tri = earcut(ring.flat());
  const geo: Geo = { positions: ring.flatMap(([x, z]) => [x, y, z]), indices: [], uvs: ring.flatMap((p, i) => (uv ? uv(p, i) : p)), normals: ring.flatMap(() => [0, 1, 0]) };
  // Cada triângulo voltado para cima: componente y de (c − b) × (a − b) positiva.
  for (let i = 0; i < tri.length; i += 3) {
    const [a, b, c] = [ring[tri[i]], ring[tri[i + 1]], ring[tri[i + 2]]];
    const up = (c[1] - b[1]) * (a[0] - b[0]) - (c[0] - b[0]) * (a[1] - b[1]) >= 0;
    geo.indices.push(...(up ? [tri[i], tri[i + 1], tri[i + 2]] : [tri[i], tri[i + 2], tri[i + 1]]));
  }
  return geo;
}

/** Prisma vertical: paredes do anel (x, z) entre y0 e y1 e tampa superior (e inferior, opcional). Faces facetadas. */
export function prism(points: Point[], y0: number, y1: number, bottom = false): Geo {
  const ring = openRing(points);
  const ccw = signedArea(ring) < 0; // anti-horário visto de cima
  const walls: Geo = { positions: [], indices: [], uvs: [] };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]; const base = walls.positions.length / 3;
    walls.positions.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    walls.uvs.push(0, y0, len, y0, len, y1, 0, y1);
    walls.indices.push(...(ccw ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
  }
  computeNormals(walls);
  const parts = [walls, polygon(ring, y1)];
  if (bottom) { const b = polygon(ring, y0); b.indices = flipIndices(b.indices); b.normals = b.normals!.map((v, i) => (i % 3 === 1 ? -v : v)); parts.push(b); }
  return merge(parts);
}

/** Extrusão de um perfil no plano XY ao longo de +z (0 → depth), como ExtrudeGeometry sem chanfro. */
export function extrude(shape: [number, number][], depth: number): Geo {
  const ring = openRing(shape as Point[]);
  const ccw = signedArea(ring) > 0; // anti-horário no plano XY visto de +z
  const tri = earcut(ring.flat());
  const geo: Geo = { positions: [], indices: [], uvs: [] };
  const push = (x: number, y: number, z: number) => { geo.positions.push(x, y, z); geo.uvs.push(x, y); geo.indices.push(geo.indices.length); };
  for (let i = 0; i < tri.length; i += 3) {
    const [a, b, c] = [ring[tri[i]], ring[tri[i + 1]], ring[tri[i + 2]]];
    // Tampa da frente anti-horária vista de +z.
    const front = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0 ? [a, b, c] : [a, c, b];
    for (const p of front) push(p[0], p[1], depth);
    for (const p of [front[0], front[2], front[1]]) push(p[0], p[1], 0);
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const [p, q] = ccw ? [a, b] : [b, a];
    push(p[0], p[1], 0); push(q[0], q[1], 0); push(q[0], q[1], depth);
    push(p[0], p[1], 0); push(q[0], q[1], depth); push(p[0], p[1], depth);
  }
  return computeNormals(geo);
}

/** Tubo ao longo de uma linha de pontos (curvas suaves em um plano), como TubeGeometry. */
export function tube(path: [number, number, number][], radius: number, radialSegments = 6): Geo {
  const geo: Geo = { positions: [], indices: [], uvs: [], normals: [] };
  path.forEach((p, i) => {
    const prev = path[Math.max(0, i - 1)], next = path[Math.min(path.length - 1, i + 1)];
    const t = new Vector3(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]).normalize();
    const ref = Math.abs(t.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    const n = Vector3.Cross(t, ref).normalize(); const b = Vector3.Cross(t, n).normalize();
    for (let k = 0; k <= radialSegments; k++) {
      const a = (k / radialSegments) * Math.PI * 2; const dir = n.scale(Math.cos(a)).add(b.scale(Math.sin(a)));
      geo.positions.push(p[0] + dir.x * radius, p[1] + dir.y * radius, p[2] + dir.z * radius); geo.normals!.push(dir.x, dir.y, dir.z);
      geo.uvs.push(i / (path.length - 1), k / radialSegments);
    }
  });
  const row = radialSegments + 1;
  for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < radialSegments; k++) {
    const a = i * row + k, b = (i + 1) * row + k, c = (i + 1) * row + k + 1, d = i * row + k + 1;
    geo.indices.push(a, d, b, b, d, c);
  }
  // Confere a orientação pelo primeiro triângulo: a normal calculada deve apontar para fora.
  const test = computeNormals({ ...geo, normals: undefined, indices: geo.indices.slice(0, 3) }).normals!;
  const i0 = geo.indices[0] * 3;
  if (test[i0] * geo.normals![i0] + test[i0 + 1] * geo.normals![i0 + 1] + test[i0 + 2] * geo.normals![i0 + 2] < 0) geo.indices = flipIndices(geo.indices);
  return geo;
}

// ——— malhas ———

function vertexData(geo: Geo) {
  if (!geo.normals) computeNormals(geo);
  const data = new VertexData();
  data.positions = geo.positions; data.indices = geo.indices; data.normals = geo.normals!; data.uvs = geo.uvs;
  if (geo.colors) data.colors = geo.colors;
  return data;
}

/** Malha a partir da geometria, com material e pai. */
export function meshFrom(name: string, geo: Geo, scene: Scene, material: PBRMaterial | null, parent?: TransformNode | null) {
  const mesh = new Mesh(name, scene);
  // Frente = triângulos anti-horários (como no Three): Material.CounterClockWiseSideOrientation.
  mesh.sideOrientation = 1;
  vertexData(geo).applyToMesh(mesh);
  mesh.material = material;
  if (parent) mesh.parent = parent;
  return mesh;
}

/**
 * Instâncias finas (uma chamada de desenho para todas): matrizes locais e, opcionalmente, cor por instância
 * (multiplica a cor do material e a dos vértices).
 */
export function instanced(name: string, geo: Geo, scene: Scene, material: PBRMaterial, matrices: Matrix[], parent?: TransformNode | null, colors?: Color3[]) {
  const mesh = meshFrom(name, geo, scene, material, parent);
  const buffer = new Float32Array(matrices.length * 16);
  matrices.forEach((m, i) => m.copyToArray(buffer, i * 16));
  mesh.thinInstanceSetBuffer('matrix', buffer, 16, true);
  if (colors) {
    const c = new Float32Array(colors.length * 4);
    colors.forEach((color, i) => { c[i * 4] = color.r; c[i * 4 + 1] = color.g; c[i * 4 + 2] = color.b; c[i * 4 + 3] = 1; });
    mesh.thinInstanceSetBuffer('color', c, 4, true);
  }
  mesh.thinInstanceRefreshBoundingInfo(false);
  return mesh;
}

/** Marca a malha para projetar e/ou receber sombra (o mundo monta a lista de projetores a cada mudança). */
export function shadows<T extends Mesh>(mesh: T, cast: boolean, receive = true): T {
  mesh.metadata = { ...(mesh.metadata ?? {}), castShadow: cast };
  mesh.receiveShadows = receive;
  return mesh;
}
