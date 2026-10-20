/** Geometria do editor do chão: máscara → contorno, simplificação, endireitamento e utilidades de polígono. */
export type Point = [number, number];

export const polygonArea = (loop: Point[]) => Math.abs(loop.reduce((s, [x1, y1], i) => { const [x2, y2] = loop[(i + 1) % loop.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2);

export function pointInPolygon([x, y]: Point, poly: Point[]) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r; }
  return r;
}

/** Distância do ponto ao segmento ab e o parâmetro t (0–1) da projeção. */
export function segmentDistance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) {
  const dx = bx - ax, dy = by - ay; const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { distance: Math.hypot(px - ax - t * dx, py - ay - t * dy), t };
}

/**
 * Contorno externo da região da máscara que contém `seed` (ou da maior, se o clique caiu fora), em pixels:
 * percorre as arestas entre pixel dentro e fora, sempre com o dentro à direita.
 */
export function maskToLoop(mask: Uint8Array, w: number, h: number, seed?: Point): Point[] | null {
  // Componentes conexas (4 vizinhos).
  const label = new Int32Array(w * h); const sizes = [0]; const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    const id = sizes.length; let size = 0; stack.push(start); label[start] = id;
    while (stack.length) {
      const i = stack.pop()!; size++; const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && mask[j] && !label[j]) { label[j] = id; stack.push(j); }
    }
    sizes.push(size);
  }
  if (sizes.length < 2) return null;
  let target = sizes.indexOf(Math.max(...sizes.slice(1)));
  if (seed) { const sx = Math.round(seed[0]), sy = Math.round(seed[1]); if (sx >= 0 && sy >= 0 && sx < w && sy < h && label[sy * w + sx]) target = label[sy * w + sx]; }
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === target;
  // Arestas orientadas entre cantos de pixel; cada canto pode ter até duas saídas (encontro diagonal).
  const W = w + 1; const out = new Map<number, number[]>();
  const add = (ax: number, ay: number, bx: number, by: number) => { const a = ay * W + ax; (out.get(a) ?? out.set(a, []).get(a)!).push(by * W + bx); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on(x, y)) continue;
    if (!on(x, y - 1)) add(x, y, x + 1, y);
    if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!on(x - 1, y)) add(x, y + 1, x, y);
  }
  // Laços: o externo é o de maior área.
  let best: Point[] | null = null; let bestArea = 0;
  while (out.size) {
    const first = out.keys().next().value as number; const loop: Point[] = []; let cur = first; let prev = -1;
    for (let guard = 0; guard < 4 * w * h; guard++) {
      const list = out.get(cur); if (!list?.length) break;
      // No encontro diagonal, vira à direita (mantém o pixel dentro à direita sem cruzar).
      let k = 0;
      if (list.length > 1 && prev >= 0) {
        const px = prev % W, py = (prev - px) / W, cx = cur % W, cy = (cur - cx) / W; const dx = cx - px, dy = cy - py;
        k = list.findIndex((n) => { const nx = n % W - cx, ny = (n - (n % W)) / W - cy; return nx === -dy && ny === dx; });
        if (k < 0) k = 0;
      }
      const next = list.splice(k, 1)[0]; if (!list.length) out.delete(cur);
      loop.push([cur % W, (cur - (cur % W)) / W]); prev = cur; cur = next;
      if (cur === first) break;
    }
    const area = polygonArea(loop);
    if (area > bestArea) { bestArea = area; best = loop; }
  }
  return best;
}

/** Douglas–Peucker num laço fechado. */
export function simplifyLoop(loop: Point[], eps: number): Point[] {
  if (loop.length < 4) return loop;
  const dp = (pts: Point[]): Point[] => {
    if (pts.length < 3) return pts;
    let best = 0, index = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = segmentDistance(pts[i], pts[0], pts[pts.length - 1]).distance; if (d > best) { best = d; index = i; } }
    if (best <= eps) return [pts[0], pts[pts.length - 1]];
    return [...dp(pts.slice(0, index + 1)).slice(0, -1), ...dp(pts.slice(index))];
  };
  let far = 0, fd = 0; for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > fd) { fd = d; far = i; } }
  const out = [...dp(loop.slice(0, far + 1)).slice(0, -1), ...dp([...loop.slice(far), loop[0]]).slice(0, -1)];
  return out.length >= 3 ? out : loop;
}

/** Direção dominante (0–90°, radianos) das arestas, ponderada pelo comprimento. */
export function dominantAngle(loops: Point[][]) {
  let sx = 0, sy = 0;
  for (const loop of loops) for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length]; const len = Math.hypot(bx - ax, by - ay);
    const a = Math.atan2(by - ay, bx - ax) * 4; sx += Math.cos(a) * len; sy += Math.sin(a) * len; // período de 90°
  }
  return Math.atan2(sy, sx) / 4;
}

/**
 * Endireita o contorno: arestas a até `tolerance` de `angle` (ou perpendicular) ficam exatamente nessa direção, as
 * vizinhas de mesma direção se fundem e cada vértice vira o cruzamento das retas das arestas vizinhas.
 * Diagonais de verdade (calçada em ângulo, curva) ficam como estão.
 */
export function straighten(loop: Point[], angle: number, tolerance = (14 * Math.PI) / 180, minEdge = 0): Point[] {
  if (loop.length < 4) return loop;
  type Line = { p: Point; dir: number; snapped: boolean; len: number };
  let lines: Line[] = loop.map((a, i) => {
    const b = loop[(i + 1) % loop.length]; const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const quarter = Math.PI / 2; const k = Math.round((dir - angle) / quarter); const snap = angle + k * quarter;
    const snapped = Math.abs(dir - snap) < tolerance;
    return { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dir: snapped ? snap : dir, snapped, len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  // Funde arestas seguidas com a mesma direção (ponto médio ponderado pelo comprimento).
  const same = (a: Line, b: Line) => a.snapped && b.snapped && Math.abs(Math.sin(a.dir - b.dir)) < 1e-6 && Math.cos(a.dir - b.dir) > 0;
  for (let changed = true; changed && lines.length > 3;) {
    changed = false;
    for (let i = 0; i < lines.length && lines.length > 3; i++) {
      const a = lines[i], b = lines[(i + 1) % lines.length];
      if (!same(a, b)) continue;
      const len = a.len + b.len;
      lines[i] = { p: [(a.p[0] * a.len + b.p[0] * b.len) / len, (a.p[1] * a.len + b.p[1] * b.len) / len], dir: a.dir, snapped: true, len };
      lines.splice((i + 1) % lines.length, 1); changed = true;
    }
  }
  // Arestas curtíssimas entre duas retas paralelas viram degrau: some, e as vizinhas se ligam.
  if (minEdge > 0) lines = lines.filter((l, i) => !(l.len < minEdge && lines.length > 4 && same(lines[(i - 1 + lines.length) % lines.length], lines[(i + 1) % lines.length])));
  const out: Point[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[(i - 1 + lines.length) % lines.length], b = lines[i];
    const ax = Math.cos(a.dir), ay = Math.sin(a.dir), bx = Math.cos(b.dir), by = Math.sin(b.dir);
    const den = ax * by - ay * bx;
    // Vértice original (início da aresta b) como reserva quando as retas são quase paralelas.
    const fallback: Point = [b.p[0] - bx * b.len / 2, b.p[1] - by * b.len / 2];
    if (Math.abs(den) < 0.05) { out.push(fallback); continue; }
    const t = ((b.p[0] - a.p[0]) * by - (b.p[1] - a.p[1]) * bx) / den;
    const q: Point = [a.p[0] + ax * t, a.p[1] + ay * t];
    out.push(Math.hypot(q[0] - fallback[0], q[1] - fallback[1]) > Math.max(a.len, b.len) ? fallback : q);
  }
  return out.length >= 3 ? out : loop;
}

/** Leva cada vértice ao vértice vizinho mais próximo (de outro polígono ou do lote) a até `radius`. */
export function snapToVertices(loop: Point[], others: Point[], radius: number): Point[] {
  return loop.map((p) => {
    let best: Point = p, bd = radius;
    for (const q of others) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } }
    return [best[0], best[1]] as Point;
  });
}
