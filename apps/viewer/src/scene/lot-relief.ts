import { TransformNode, type Color3, type Matrix, type Scene } from './babylon';
import { box, compose, computeNormals, cylinder, extrude, getHsl, hsl, instanced, merge, pbr, rgb, rotateX, shadows, srgb, translate, type Geo } from './geometry';
import type { Point } from '../types';

/** Altura da superfície do lote (asfalto) e do que fica acima dela (calçadas, gramados): o degrau é o meio-fio. */
export const lotBase = 0.18;

/** Aproxima a cor desenhada para uma cor de carro real (branco, prata, grafite, preto, vermelho, azul). */
export function carColor(drawn: [number, number, number] | null) {
  if (!drawn) return fleetColor(Math.random() * 1000);
  const [r, g, b] = drawn; const lum = 0.3 * r + 0.59 * g + 0.11 * b; const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, Math.max(r, g, b));
  if (sat > 0.28) {
    const hue = getHsl(srgb(r, g, b)).h;
    // Laranja/amarelo costuma ser a faixa da vaga pintada, não o carro: usa a frota comum.
    if (hue > 0.04 && hue < 0.2) return fleetColor(r * 7 + g * 13 + b * 17);
    return hsl(hue, 0.62, 0.36);
  }
  if (lum > 175) return rgb(0xf1f1ee);
  if (lum > 125) return rgb(0xb6b9bd);
  return fleetColor(r * 7 + g * 13 + b * 17);
}

/** Frota realista para carros que a arte desenha escuros (sombra): maioria branco/prata, como nas ruas. */
export function fleetColor(seed: number) {
  const fleet: [number, number][] = [[0xf1f1ee, 0.3], [0xb6b9bd, 0.2], [0x1d1e22, 0.18], [0x55595f, 0.14], [0x9e2a2b, 0.09], [0x2b4a7a, 0.09]];
  let t = (Math.sin(seed * 12.9898) * 43758.5453) % 1; t = t < 0 ? t + 1 : t;
  for (const [hex, weight] of fleet) { if (t < weight) return rgb(hex); t -= weight; }
  return rgb(fleet[0][0]);
}

export interface DetectedCar { x: number; y: number; angle: number; color: Color3 }

function insidePolygon([x, y]: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Asfalto da arte: cinza de baixa saturação e luminância média (as faixas pintadas ficam de fora). */
export function asphaltAt(data: Uint8ClampedArray, k: number) {
  const r = data[k]; const g = data[k + 1]; const b = data[k + 2];
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  return Math.max(r, g, b) - Math.min(r, g, b) < 22 && lum > 78 && lum < 140;
}

/**
 * Calçada bege/cinza clara e grama: não são carro. Sem isso, carros encostados numa faixa de calçada
 * ou num canteiro se fundem com ela numa mancha grande demais e são descartados.
 */
export function groundAt(data: Uint8ClampedArray, k: number) {
  const r = data[k]; const g = data[k + 1]; const b = data[k + 2];
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const sat = max ? (max - min) / max : 0;
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  if (g > r * 1.04 && g > b * 1.15 && sat > 0.25) return true; // grama
  return lum > 165 && lum < 205 && sat > 0.04 && sat < 0.2 && r >= b; // piso bege
}

/**
 * Encontra os carros desenhados na implantação: manchas compactas e alongadas cercadas de asfalto.
 * Cada carro encontrado é apagado da arte (pintado com o asfalto ao redor) para virar um volume 3D.
 */
/** `erased` (opcional, tamanho da arte) recebe 1 nos pixels de carro/sombra apagados, para o chão reconstruí-los. */
export function detectCars(canvas: HTMLCanvasElement, lot: Point[], metersPerPixel: number, erased?: Uint8Array): DetectedCar[] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const xs = lot.map((p) => p[0]); const ys = lot.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))); const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.min(canvas.width, Math.ceil(Math.max(...xs))) - x0; const h = Math.min(canvas.height, Math.ceil(Math.max(...ys))) - y0;
  const image = ctx.getImageData(x0, y0, w, h); const data = image.data;
  const m2 = metersPerPixel * metersPerPixel;
  // Uma fileira de até ~16 vagas (2,5 × 6 m cada) ainda é analisada.
  const maxPixels = Math.round(240 / m2);
  // 1 = não asfalto dentro do lote (candidato), 0 = asfalto ou fora do lote.
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 4;
    if (!asphaltAt(data, k) && !groundAt(data, k) && insidePolygon([x + x0, y + y0], lot)) mask[y * w + x] = 1;
  }
  const seen = new Uint8Array(w * h); const cars: DetectedCar[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.push(start); seen[start] = 1;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, cr = 0, cg = 0, cb = 0, lit = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    const pixels: number[] = [];
    while (stack.length) {
      const i = stack.pop()!; const x = i % w; const y = (i - x) / w;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; pixels.push(i);
      // Pixels muito escuros são a sombra desenhada do carro: ficam fora da cor média.
      const pr = data[i * 4]; const pg = data[i * 4 + 1]; const pb = data[i * 4 + 2];
      if (0.3 * pr + 0.59 * pg + 0.11 * pb > 58) { cr += pr; cg += pg; cb += pb; lit++; }
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (n > maxPixels) continue; // grande demais para ser carro ou fileira: só termina de marcar
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= mask.length || seen[j] || !mask[j]) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    const area = n * m2;
    if (n > maxPixels || area < 1.2) continue;
    const mx = sx / n; const my = sy / n;
    const cxx = sxx / n - mx * mx; const cyy = syy / n - my * my; const cxy = sxy / n - mx * my;
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const root = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
    const long = Math.sqrt(12 * Math.max((cxx + cyy) / 2 + root, 0)) * metersPerPixel;
    const short = Math.sqrt(12 * Math.max((cxx + cyy) / 2 - root, 0)) * metersPerPixel;
    const single = area <= 14 && long >= 1.8 && long <= 6.8 && short >= 0.8 && short <= 3.2 && long / short >= 1.25;
    // Fileira: carros lado a lado (com sombras) fundidos numa mancha estreita da largura de um carro.
    const row = !single && short >= 3.2 && short <= 6.8 && long >= 4.5 && long / short >= 1.5;
    if (!single && !row) continue;
    // Precisa estar cercado de asfalto (vagas e pistas), não colado em calçadas ou gramados.
    let ring = 0, asphalt = 0;
    for (let x = minX - 3; x <= maxX + 3; x++) for (const y of [minY - 3, maxY + 3]) { if (x < 0 || y < 0 || x >= w || y >= h) continue; ring++; if (asphaltAt(data, (y * w + x) * 4)) asphalt++; }
    for (let y = minY - 3; y <= maxY + 3; y++) for (const x of [minX - 3, maxX + 3]) { if (x < 0 || y < 0 || x >= w || y >= h) continue; ring++; if (asphaltAt(data, (y * w + x) * 4)) asphalt++; }
    if (!ring || asphalt / ring < (row ? 0.3 : 0.4)) continue;
    const colorAt = (seedX: number, seedY: number, r: number, g: number, b: number, litCount: number, total: number) => (litCount > total * 0.25 ? carColor([r / litCount, g / litCount, b / litCount]) : fleetColor(seedX * 31 + seedY * 17));
    if (single) cars.push({ x: mx + x0, y: my + y0, angle, color: colorAt(mx, my, cr, cg, cb, lit, n) });
    else {
      // Divide a fileira em vagas de 2,5 m ao longo do eixo longo; cada vaga ocupada vira um carro de frente para o eixo curto.
      const ux = Math.cos(angle); const uy = Math.sin(angle); const pitch = 2.5 / metersPerPixel;
      const half = (long / metersPerPixel) / 2; const slots = Math.max(1, Math.round((half * 2) / pitch));
      const start = -(slots * pitch) / 2;
      const bins = Array.from({ length: slots }, () => ({ n: 0, r: 0, g: 0, b: 0, lit: 0 }));
      for (const i of pixels) {
        const x = i % w; const y = (i - x) / w;
        const t = (x - mx) * ux + (y - my) * uy; const k = Math.floor((t - start) / pitch);
        if (k < 0 || k >= slots) continue;
        const bin = bins[k]; bin.n++;
        const pr = data[i * 4]; const pg = data[i * 4 + 1]; const pb = data[i * 4 + 2];
        if (0.3 * pr + 0.59 * pg + 0.11 * pb > 58) { bin.r += pr; bin.g += pg; bin.b += pb; bin.lit++; }
      }
      const full = (pitch * short) / metersPerPixel;
      bins.forEach((bin, k) => {
        if (bin.n < full * 0.35) return; // vaga vazia
        const t = start + (k + 0.5) * pitch;
        const cx = mx + ux * t; const cy = my + uy * t;
        cars.push({ x: cx + x0, y: cy + y0, angle: angle + Math.PI / 2, color: colorAt(cx, cy, bin.r, bin.g, bin.b, bin.lit, bin.n) });
      });
    }
    // Apaga a mancha (carros e sombras) pixel a pixel com a cor média do asfalto em volta.
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let x = minX - 3; x <= maxX + 3; x++) for (const y of [minY - 4, maxY + 4]) { if (x < 0 || y < 0 || x >= w || y >= h) continue; const k = (y * w + x) * 4; if (!asphaltAt(data, k)) continue; ar += data[k]; ag += data[k + 1]; ab += data[k + 2]; an++; }
    if (an) {
      ctx.fillStyle = `rgb(${Math.round(ar / an)},${Math.round(ag / an)},${Math.round(ab / an)})`;
      for (const i of pixels) { const x = i % w; const y = (i - x) / w; ctx.fillRect(x + x0 - 1, y + y0 - 1, 3, 3); if (erased) erased[(y + y0) * canvas.width + x + x0] = 1; }
    }
  }
  return cars;
}

/** Perfil lateral (x ao longo do carro, y altura) extrudado na largura e centrado (o chanfro vira um leve acréscimo no perfil). */
function profile(points: [number, number][], width: number, bevel = 0.04): Geo {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length; const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const grown = points.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / d) * bevel, y + ((y - cy) / d) * bevel] as [number, number]; });
  return translate(extrude(grown, width), 0, 0, -width / 2);
}

/**
 * Dá forma de carro a uma extrusão reta: laterais que se fecham para cima (acima de `from`, até `topScale`
 * da largura em `to`) e cantos arredondados vistos de cima (estreita nos últimos `corner` metros de cada ponta).
 */
function sculpt(geo: Geo, length: number, from: number, to: number, topScale: number, corner = 0.4) {
  const p = geo.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1];
    const up = Math.min(1, Math.max(0, (y - from) / (to - from)));
    const end = Math.max(0, Math.abs(x) - (length / 2 - corner)) / corner;
    p[i + 2] *= (1 - (1 - topScale) * up) * (1 - 0.14 * end * end);
  }
  geo.normals = undefined;
  return computeNormals(geo);
}

interface CarSpec { length: number; width: number; wheelbase: number; wheel: number; belt: number; body: [number, number][]; glass: [number, number][]; roof: [number, number][] }

/** Três carrocerias comuns nas ruas: hatch, sedã e SUV (medidas em metros, frente em +x). */
const specs: CarSpec[] = [
  { length: 4.0, width: 1.74, wheelbase: 2.5, wheel: 0.31, belt: 0.88,
    body: [[-1.98, 0.3], [1.96, 0.3], [2.0, 0.5], [1.94, 0.7], [1.1, 0.86], [-1.84, 0.93], [-1.99, 0.84], [-2.02, 0.52]],
    glass: [[1.08, 0.85], [0.28, 1.36], [-1.5, 1.39], [-1.84, 0.92]],
    roof: [[0.3, 1.35], [-1.52, 1.38], [-1.5, 1.43], [0.28, 1.4]] },
  { length: 4.5, width: 1.78, wheelbase: 2.65, wheel: 0.32, belt: 0.86,
    body: [[-2.22, 0.3], [2.2, 0.3], [2.25, 0.5], [2.17, 0.69], [1.25, 0.84], [-1.52, 0.9], [-2.18, 0.88], [-2.26, 0.56]],
    glass: [[1.22, 0.83], [0.38, 1.38], [-0.92, 1.4], [-1.56, 0.89]],
    roof: [[0.4, 1.37], [-0.94, 1.39], [-0.92, 1.44], [0.38, 1.42]] },
  { length: 4.4, width: 1.84, wheelbase: 2.65, wheel: 0.36, belt: 1.02,
    body: [[-2.18, 0.4], [2.16, 0.4], [2.21, 0.64], [2.12, 0.87], [1.22, 1.0], [-2.02, 1.06], [-2.18, 1.0], [-2.22, 0.68]],
    glass: [[1.2, 0.99], [0.42, 1.58], [-1.86, 1.6], [-2.04, 1.05]],
    roof: [[0.44, 1.57], [-1.9, 1.59], [-1.88, 1.66], [0.42, 1.64]] },
];

export interface CarPlacement { x: number; z: number; angle: number; color: Color3; kind?: number; seed?: number }

/**
 * Carros 3D instanciados: hatch, sedã e SUV com carroceria arredondada na cor detectada na arte
 * (verniz com reflexo), vidros escuros, teto, para-choques e soleiras em plástico escuro, retrovisores,
 * pneus com roda de liga, faróis e lanternas. Uma chamada de desenho por peça e modelo.
 */
export function buildCars(scene: Scene, parent: TransformNode, cars: CarPlacement[]) {
  const group = new TransformNode('cars', scene); group.parent = parent;
  if (!cars.length) return group;
  const paint = pbr(scene, 'car-paint', { color: 0xffffff, roughness: 0.38, metalness: 0.25 });
  paint.clearCoat.isEnabled = true; paint.clearCoat.intensity = 0.85; paint.clearCoat.roughness = 0.08;
  const glass = pbr(scene, 'car-glass', { color: 0x141a20, roughness: 0.05, metalness: 0.4 });
  const trim = pbr(scene, 'car-trim', { color: 0x202124, roughness: 0.7 });
  const tire = pbr(scene, 'car-tire', { color: 0x161617, roughness: 0.9 });
  const rim = pbr(scene, 'car-rim', { color: 0xc4c7cb, roughness: 0.3, metalness: 0.85 });
  const head = pbr(scene, 'car-head', { color: 0xeef0f2, emissive: 0x2c2c28, roughness: 0.1, metalness: 0.3 });
  const tail = pbr(scene, 'car-tail', { color: 0x9a1016, emissive: 0x2a0204, roughness: 0.25 });
  const jitter = (seed: number, k: number) => { const t = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return t - Math.floor(t) - 0.5; };

  specs.forEach((spec, kind) => {
    const list = cars.filter((c) => (c.kind ?? 1) === kind);
    if (!list.length) return;
    const { length: L, width: W, wheelbase, wheel: R, belt } = spec;
    const top = spec.glass[1][1];
    const body = sculpt(profile(spec.body, W), L, belt - 0.25, belt + 0.1, 0.94);
    const greenhouse = sculpt(profile(spec.glass, W * 0.9, 0.02), L, belt, top, 0.84, 0.25);
    const roof = sculpt(profile(spec.roof, W * 0.79, 0.02), L, top, top + 0.06, 0.97, 0.2);
    const bumpers = merge([translate(box(0.16, 0.2, W * 0.9), L / 2 - 0.04, 0.38 + (R - 0.31), 0), translate(box(0.16, 0.2, W * 0.9), -L / 2 + 0.04, 0.4 + (R - 0.31), 0)]);
    const skirts = merge([-1, 1].map((s) => translate(box(wheelbase - R * 2.1, 0.1, 0.06), 0, R + 0.02, s * (W / 2 - 0.01))));
    const mirrors = merge([-1, 1].map((s) => translate(box(0.12, 0.1, 0.2), spec.glass[0][0] - 0.12, belt + 0.1, s * (W / 2 + 0.06))));
    const tireGeo = rotateX(cylinder(R, R, 0.22, 18), Math.PI / 2);
    const rimGeo = rotateX(cylinder(R * 0.64, R * 0.64, 0.232, 12), Math.PI / 2);
    const lamp = box(0.05, 0.1, W * 0.26);
    const lists = { body: [] as Matrix[], wheels: [] as Matrix[], head: [] as Matrix[], tail: [] as Matrix[] };
    for (const c of list) {
      const seed = c.seed ?? c.x * 7 + c.z * 13;
      // Ninguém estaciona perfeito: pequenos desvios de posição e ângulo dentro da vaga.
      const car = compose(c.x, lotBase, c.z, 0, -(c.angle + jitter(seed, 1) * 0.05), 0);
      const local = compose(jitter(seed, 2) * 0.3, 0, jitter(seed, 3) * 0.16).multiply(car);
      const place = (target: Matrix[], x: number, y: number, z: number) => target.push(compose(x, y, z).multiply(local));
      place(lists.body, 0, 0, 0);
      for (const fx of [-wheelbase / 2, wheelbase / 2]) for (const fz of [-1, 1]) place(lists.wheels, fx, R, fz * (W / 2 - 0.13));
      for (const fz of [-1, 1]) { place(lists.head, L / 2 - 0.02, 0.66 + (R - 0.31), fz * W * 0.3); place(lists.tail, -L / 2 + 0.02, 0.72 + (R - 0.31), fz * W * 0.32); }
    }
    const colors = list.map((c) => c.color);
    const name = (part: string) => `car-${kind}-${part}`;
    shadows(instanced(name('body'), body, scene, paint, lists.body, group, colors), true, true);
    shadows(instanced(name('roof'), roof, scene, paint, lists.body, group, colors), true, false);
    shadows(instanced(name('mirrors'), mirrors, scene, paint, lists.body, group, colors), false, false);
    shadows(instanced(name('glass'), greenhouse, scene, glass, lists.body, group), true, false);
    shadows(instanced(name('trim'), merge([bumpers, skirts]), scene, trim, lists.body, group), false, false);
    shadows(instanced(name('tires'), tireGeo, scene, tire, lists.wheels, group), true, false);
    shadows(instanced(name('rims'), rimGeo, scene, rim, lists.wheels, group), false, false);
    shadows(instanced(name('head'), lamp, scene, head, lists.head, group), false, false);
    shadows(instanced(name('tail'), lamp, scene, tail, lists.tail, group), false, false);
  });
  return group;
}