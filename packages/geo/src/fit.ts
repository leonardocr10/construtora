/**
 * Ajuste de transformações 2D por mínimos quadrados entre pares de pontos (origem → destino).
 * - Similaridade (Helmert, 4 parâmetros): escala, rotação e translação. É o modelo esperado para
 *   uma implantação desenhada em escala: preserva ângulos e proporções.
 * - Afim (6 parâmetros): usada só como diagnóstico; se ela explica os pontos muito melhor que a
 *   similaridade, a arte está distorcida (escalas diferentes em x/y ou cisalhamento).
 */

export type Vec2 = [number, number];
export interface Pair { from: Vec2; to: Vec2 }

export interface Similarity { scale: number; rotation: number; tx: number; ty: number }
export interface Affine { a: number; b: number; c: number; d: number; tx: number; ty: number }

export function applySimilarity(t: Similarity, [x, y]: Vec2): Vec2 {
  const c = Math.cos(t.rotation) * t.scale, s = Math.sin(t.rotation) * t.scale;
  return [c * x - s * y + t.tx, s * x + c * y + t.ty];
}

export function applyAffine(t: Affine, [x, y]: Vec2): Vec2 {
  return [t.a * x + t.b * y + t.tx, t.c * x + t.d * y + t.ty];
}

function centroid(points: Vec2[]): Vec2 {
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
}

/** Similaridade de mínimos quadrados (solução fechada de Umeyama, sem reflexão). Exige 2 pontos distintos. */
export function fitSimilarity(pairs: Pair[]): Similarity {
  if (pairs.length < 2) throw new RangeError('São necessários pelo menos 2 pontos de controle');
  const cf = centroid(pairs.map((p) => p.from)); const ct = centroid(pairs.map((p) => p.to));
  let sxx = 0, sxy = 0, norm = 0;
  for (const { from, to } of pairs) {
    const fx = from[0] - cf[0], fy = from[1] - cf[1], tx = to[0] - ct[0], ty = to[1] - ct[1];
    sxx += fx * tx + fy * ty; // parte "cosseno"
    sxy += fx * ty - fy * tx; // parte "seno"
    norm += fx * fx + fy * fy;
  }
  if (norm < 1e-12) throw new RangeError('Pontos de controle coincidentes');
  const rotation = Math.atan2(sxy, sxx);
  const scale = Math.hypot(sxx, sxy) / norm;
  const c = Math.cos(rotation) * scale, s = Math.sin(rotation) * scale;
  return { scale, rotation, tx: ct[0] - (c * cf[0] - s * cf[1]), ty: ct[1] - (s * cf[0] + c * cf[1]) };
}

/** Afim de mínimos quadrados (equações normais 3×3 por eixo). Exige 3 pontos não colineares. */
export function fitAffine(pairs: Pair[]): Affine {
  if (pairs.length < 3) throw new RangeError('São necessários pelo menos 3 pontos para o ajuste afim');
  const cf = centroid(pairs.map((p) => p.from)); const ct = centroid(pairs.map((p) => p.to));
  let xx = 0, xy = 0, yy = 0, xu = 0, yu = 0, xv = 0, yv = 0;
  for (const { from, to } of pairs) {
    const x = from[0] - cf[0], y = from[1] - cf[1], u = to[0] - ct[0], v = to[1] - ct[1];
    xx += x * x; xy += x * y; yy += y * y; xu += x * u; yu += y * u; xv += x * v; yv += y * v;
  }
  const det = xx * yy - xy * xy;
  if (Math.abs(det) < 1e-9 * Math.max(1, xx * yy)) throw new RangeError('Pontos de controle colineares');
  const a = (xu * yy - yu * xy) / det, b = (yu * xx - xu * xy) / det;
  const c = (xv * yy - yv * xy) / det, d = (yv * xx - xv * xy) / det;
  return { a, b, c, d, tx: ct[0] - (a * cf[0] + b * cf[1]), ty: ct[1] - (c * cf[0] + d * cf[1]) };
}

/** Quão perto da colinearidade estão os pontos: razão entre o menor e o maior desvio principal (0 = em linha). */
export function spread(points: Vec2[]) {
  const [cx, cy] = centroid(points);
  let xx = 0, xy = 0, yy = 0;
  for (const [x, y] of points) { xx += (x - cx) ** 2; xy += (x - cx) * (y - cy); yy += (y - cy) ** 2; }
  const tr = xx + yy; const root = Math.sqrt(Math.max(0, ((xx - yy) / 2) ** 2 + xy * xy));
  const max = tr / 2 + root, min = tr / 2 - root;
  return max > 0 ? Math.sqrt(Math.max(0, min) / max) : 0;
}
