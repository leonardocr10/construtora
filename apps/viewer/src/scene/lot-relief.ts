import { TransformNode, type Color3, type Matrix, type Scene } from './babylon';
import { box, compose, cylinder, extrude, getHsl, hsl, instanced, pbr, rgb, rotateX, shadows, srgb, translate, type Geo } from './geometry';
import type { Point } from '../types';

/** Altura da superfície do lote (asfalto) e do que fica acima dela (calçadas, gramados): o degrau é o meio-fio. */
export const lotBase = 0.18;

/** Aproxima a cor desenhada para uma cor de carro real (branco, prata, grafite, preto, vermelho, azul). */
function carColor(drawn: [number, number, number] | null) {
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
function fleetColor(seed: number) {
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
function asphaltAt(data: Uint8ClampedArray, k: number) {
  const r = data[k]; const g = data[k + 1]; const b = data[k + 2];
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  return Math.max(r, g, b) - Math.min(r, g, b) < 22 && lum > 78 && lum < 140;
}

/**
 * Calçada bege/cinza clara e grama: não são carro. Sem isso, carros encostados numa faixa de calçada
 * ou num canteiro se fundem com ela numa mancha grande demais e são descartados.
 */
function groundAt(data: Uint8ClampedArray, k: number) {
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
function profile(points: [number, number][], width: number, bevel = 0.06): Geo {
  // Afasta cada vértice do centro do perfil pelo tamanho do chanfro, como o bevelSize da extrusão do Three.
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length; const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const grown = points.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / d) * bevel, y + ((y - cy) / d) * bevel] as [number, number]; });
  return translate(extrude(grown, width), 0, 0, -width / 2);
}

/**
 * Carros 3D instanciados com perfil de hatch/sedã: carroceria na cor detectada na arte, vidros escuros,
 * teto na cor do carro, rodas com calota, faróis e lanternas. Comprimento 4,3 m e largura 1,8 m.
 */
export function buildCars(scene: Scene, parent: TransformNode, cars: { x: number; z: number; angle: number; color: Color3 }[]) {
  const group = new TransformNode('cars', scene); group.parent = parent;
  if (!cars.length) return group;
  const W = 1.78;
  const lower = profile([[-2.15, 0.28], [2.12, 0.28], [2.18, 0.5], [2.08, 0.72], [1.2, 0.86], [-1.75, 0.92], [-2.12, 0.86], [-2.18, 0.5]], W);
  const glassShape = profile([[1.18, 0.84], [0.42, 1.36], [-1.05, 1.38], [-1.72, 0.9]], W * 0.9, 0.04);
  const roofShape = profile([[0.36, 1.37], [0.4, 1.42], [-1.02, 1.44], [-1.06, 1.38]], W * 0.86, 0.03);
  const wheel = rotateX(cylinder(0.33, 0.33, 0.24, 14), Math.PI / 2);
  const hub = rotateX(cylinder(0.19, 0.19, 0.26, 10), Math.PI / 2);
  const light = box(0.06, 0.12, 0.38);
  const paint = pbr(scene, 'car-paint', { color: 0xffffff, roughness: 0.3, metalness: 0.45 });
  const lists = { body: [] as Matrix[], wheels: [] as Matrix[], head: [] as Matrix[], tail: [] as Matrix[] };
  for (const c of cars) {
    const car = compose(c.x, lotBase, c.z, 0, -c.angle, 0);
    const place = (list: Matrix[], x: number, y: number, z: number) => list.push(compose(x, y, z).multiply(car));
    place(lists.body, 0, 0, 0);
    for (const fx of [-1.38, 1.38]) for (const fz of [-0.8, 0.8]) place(lists.wheels, fx, 0.33, fz);
    place(lists.head, 2.15, 0.6, -0.58); place(lists.head, 2.15, 0.6, 0.58);
    place(lists.tail, -2.16, 0.68, -0.6); place(lists.tail, -2.16, 0.68, 0.6);
  }
  const colors = cars.map((c) => c.color);
  shadows(instanced('car-body', lower, scene, paint, lists.body, group, colors), true, true);
  shadows(instanced('car-roof', roofShape, scene, paint, lists.body, group, colors), true, false);
  shadows(instanced('car-glass', glassShape, scene, pbr(scene, 'car-glass', { color: 0x1c252e, roughness: 0.08, metalness: 0.6 }), lists.body, group), true, false);
  shadows(instanced('car-wheels', wheel, scene, pbr(scene, 'car-wheel', { color: 0x18181a, roughness: 0.85 }), lists.wheels, group), true, false);
  shadows(instanced('car-hubs', hub, scene, pbr(scene, 'car-hub', { color: 0xb9bcc0, roughness: 0.35, metalness: 0.7 }), lists.wheels, group), false, false);
  shadows(instanced('car-head', light, scene, pbr(scene, 'car-head', { color: 0xf4f1e4, emissive: 0x3a382e, roughness: 0.2 }), lists.head, group), false, false);
  shadows(instanced('car-tail', light, scene, pbr(scene, 'car-tail', { color: 0xa3141b, emissive: 0x2a0204, roughness: 0.3 }), lists.tail, group), false, false);
  return group;
}
