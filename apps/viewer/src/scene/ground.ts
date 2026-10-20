import { computeNormals, type Geo } from './geometry';
import type { Point } from '../types';
import { stallLength, traceStalls, type Stall } from './parking';

/**
 * Chão modelado a partir da arte da implantação, para qualquer empreendimento:
 * 1. cada pixel do lote é classificado (asfalto, grama, calçada, faixa pintada ou "outro");
 * 2. a classificação é suavizada (tira ruído do JPEG, sombras e copas de árvores);
 * 3. o chão é redesenhado em alta resolução com texturas próprias (asfalto, grama, piso),
 *    mantendo a arte original só no que não foi reconhecido (quadra, piscina, deck…);
 * 4. calçadas, canteiros e gramados viram volumes acima do asfalto, com meio-fio vertical.
 */

export const enum Ground { Outside = 0, Asphalt = 1, Grass = 2, Paving = 3, Other = 4, Warm = 5 }

/** Cota do asfalto e altura do meio-fio (metros). */
export const asphaltLevel = 0.18;
export const curbHeight = 0.15;

export interface GroundMap {
  /** Recorte da arte (caixa do lote) em pixels: origem e tamanho. */
  x0: number; y0: number; w: number; h: number;
  classes: Uint8Array;
  /** Faixas pintadas sobre o asfalto: 0 nenhuma, 1 amarela, 2 branca. */
  marks: Uint8Array;
  /** 1 onde fica a torre e a calçada em volta dela (não recebe vaga). */
  plaza?: Uint8Array;
}

function hsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max / 255 };
}

function classify(r: number, g: number, b: number): Ground {
  const { h, s, v } = hsv(r, g, b);
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  if (h >= 45 && h <= 165 && s > 0.28 && v > 0.12) return Ground.Grass;
  if (h >= 10 && h < 45 && s > 0.45 && v > 0.55) return Ground.Warm;
  if (s < 0.16 && lum >= 45 && lum < 140) return Ground.Asphalt;
  if (s < 0.32 && lum >= 140) return Ground.Paving;
  return Ground.Other;
}

/** Filtro de moda (classe mais frequente numa janela size×size) com tabelas de soma por classe. */
function modeFilter(classes: Uint8Array, w: number, h: number, size: number, kinds: number[]) {
  const half = size >> 1;
  const tables = kinds.map((k) => {
    const t = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += classes[y * w + x] === k ? 1 : 0; t[(y + 1) * (w + 1) + x + 1] = t[y * (w + 1) + x + 1] + row; }
    }
    return t;
  });
  const out = new Uint8Array(classes);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (classes[i] === Ground.Outside) continue;
    const xa = Math.max(0, x - half), xb = Math.min(w, x + half + 1), ya = Math.max(0, y - half), yb = Math.min(h, y + half + 1);
    let best = classes[i]; let bestCount = -1;
    kinds.forEach((k, n) => {
      const t = tables[n];
      const count = t[yb * (w + 1) + xb] - t[ya * (w + 1) + xb] - t[yb * (w + 1) + xa] + t[ya * (w + 1) + xa];
      if (count > bestCount) { bestCount = count; best = k; }
    });
    out[i] = best;
  }
  return out;
}

/** Manchas menores que minPixels assumem a classe vizinha predominante (contornos limpos, sem ilhas soltas). */
function removeSpecks(classes: Uint8Array, w: number, h: number, minPixels: (kind: number) => number, maxIsland: (kind: number) => number = () => 0) {
  const seen = new Uint8Array(w * h); const stack: number[] = []; const pixels: number[] = [];
  for (let start = 0; start < w * h; start++) {
    const kind = classes[start];
    if (seen[start] || kind === Ground.Outside) continue;
    stack.push(start); seen[start] = 1; pixels.length = 0;
    const votes = [0, 0, 0, 0, 0];
    while (stack.length) {
      const i = stack.pop()!; pixels.push(i); const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h) continue;
        const c = classes[j];
        if (c === kind) { if (!seen[j]) { seen[j] = 1; stack.push(j); } } else if (c !== Ground.Outside) votes[c]++;
      }
    }
    const best = votes.indexOf(Math.max(...votes));
    const border = votes.reduce((a, b) => a + b, 0);
    // Ilha média quase toda cercada por uma só classe (ex.: mancha de piso no meio do asfalto) também some.
    const island = pixels.length < maxIsland(kind) && border > 0 && votes[best] / border > 0.8;
    if (pixels.length >= minPixels(kind) && !island) continue;
    if (votes[best] > 0) for (const i of pixels) classes[i] = best;
  }
}

/** Preenche os pixels marcados com a classe que os cerca: igual à esquerda e à direita, ou acima e abaixo, ou a mais próxima. */
function inpaint(classes: Uint8Array, w: number, h: number, hole: (i: number) => boolean) {
  const holes: number[] = []; const isHole = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (hole(i)) { isHole[i] = 1; holes.push(i); }
  const scan = (i: number, dx: number, dy: number): [number, number] => {
    let x = i % w, y = (i - x) / w;
    for (let d = 1; d < 80; d++) {
      x += dx; y += dy; if (x < 0 || y < 0 || x >= w || y >= h) break;
      const j = y * w + x; if (!isHole[j] && classes[j] !== Ground.Outside) return [classes[j], d];
    }
    return [Ground.Asphalt, 999];
  };
  const out = new Uint8Array(classes);
  for (const i of holes) {
    const [l, dl] = scan(i, -1, 0); const [r, dr] = scan(i, 1, 0); const [u, du] = scan(i, 0, -1); const [d, dd] = scan(i, 0, 1);
    if (l === r && u === d) out[i] = dl + dr <= du + dd ? l : u;
    else if (l === r) out[i] = l;
    else if (u === d) out[i] = u;
    else out[i] = [[l, dl], [r, dr], [u, du], [d, dd]].sort((a, b) => a[1] - b[1])[0][0];
  }
  classes.set(out);
}

/**
 * Endireita as divisas asfalto × áreas elevadas: voto majoritário numa janela 1D horizontal e depois vertical.
 * Implantações são desenhadas alinhadas aos eixos da imagem, então as bordas ficam retas como na arte.
 */
function straightenEdges(classes: Uint8Array, w: number, h: number, size: number) {
  const half = Math.max(2, size >> 1);
  const pass = (horizontal: boolean) => {
    const lines = horizontal ? h : w; const length = horizontal ? w : h;
    const at = (line: number, k: number) => (horizontal ? line * w + k : k * w + line);
    const prefix = new Int32Array(length + 1); const next = new Uint8Array(classes);
    for (let line = 0; line < lines; line++) {
      for (let k = 0; k < length; k++) { const c = classes[at(line, k)]; prefix[k + 1] = prefix[k] + (c === Ground.Asphalt ? 1 : c === Ground.Outside ? 0 : -1); }
      for (let k = 0; k < length; k++) {
        const i = at(line, k); const c = classes[i];
        if (c === Ground.Outside) continue;
        const vote = prefix[Math.min(length, k + half + 1)] - prefix[Math.max(0, k - half)];
        if (vote > half * 0.6 && c !== Ground.Asphalt) next[i] = Ground.Asphalt;
        else if (vote < -half * 0.6 && c === Ground.Asphalt) next[i] = neighborRaised(classes, w, h, i);
      }
    }
    classes.set(next);
  };
  pass(true); pass(false);
}

/** Classe elevada mais próxima (grama, piso ou outro) para um pixel que deixa de ser asfalto. */
function neighborRaised(classes: Uint8Array, w: number, h: number, i: number) {
  const x = i % w; const y = (i - x) / w;
  for (let r = 1; r < 12; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
    const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const c = classes[ny * w + nx]; if (c === Ground.Grass || c === Ground.Paving || c === Ground.Other) return c;
  }
  return Ground.Paving;
}

/** Componentes de piso estreitos (largura média < maxWidth) e quase todos cercados de asfalto viram asfalto. */
function absorbNarrowPaving(classes: Uint8Array, w: number, h: number, maxWidth: number, maxPixels: number) {
  const seen = new Uint8Array(w * h); const stack: number[] = []; const pixels: number[] = [];
  for (let start = 0; start < w * h; start++) {
    const kind = classes[start];
    if (seen[start] || (kind !== Ground.Paving && kind !== Ground.Other)) continue;
    stack.push(start); seen[start] = 1; pixels.length = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0, asphalt = 0, border = 0;
    while (stack.length) {
      const i = stack.pop()!; pixels.push(i); const x = i % w; const y = (i - x) / w;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h) continue;
        if (classes[j] === kind) { if (!seen[j]) { seen[j] = 1; stack.push(j); } }
        else if (classes[j] !== Ground.Outside) { border++; if (classes[j] === Ground.Asphalt) asphalt++; }
      }
    }
    const length = Math.max(maxX - minX + 1, maxY - minY + 1); const ratio = asphalt / Math.max(1, border);
    // Estreita e encostada no asfalto, ou mancha média quase toda cercada por asfalto.
    const narrow = pixels.length <= maxPixels && pixels.length / length < maxWidth && ratio > 0.5;
    const enclosed = pixels.length <= maxPixels / 2 && ratio > 0.65;
    if (narrow || enclosed) for (const i of pixels) classes[i] = Ground.Asphalt;
  }
}

/** Áreas de piso com densidade de faixas laranja/amarelas (demarcação de vagas) viram asfalto. */
function absorbParkingPads(classes: Uint8Array, art: Uint8Array, w: number, h: number, minPixels: number) {
  const seen = new Uint8Array(w * h); const stack: number[] = []; const pixels: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || classes[start] !== Ground.Paving) continue;
    stack.push(start); seen[start] = 1; pixels.length = 0;
    let warm = 0, asphaltBorder = 0, border = 0;
    while (stack.length) {
      const i = stack.pop()!; pixels.push(i); if (art[i] === Ground.Warm) warm++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h) continue;
        if (classes[j] === Ground.Paving) { if (!seen[j]) { seen[j] = 1; stack.push(j); } }
        else if (classes[j] !== Ground.Outside) { border++; if (classes[j] === Ground.Asphalt) asphaltBorder++; }
      }
    }
    // Faixa de vaga é traço fino (pouco laranja na área); areia, deque ou quadra laranja ocupam boa parte e são lazer.
    const warmShare = warm / pixels.length;
    if (pixels.length >= minPixels && warmShare > 0.03 && warmShare < 0.18 && asphaltBorder / Math.max(1, border) > 0.35) for (const i of pixels) classes[i] = Ground.Asphalt;
  }
}

/** Projeção de uma torre na arte: centro em pixels, largura e profundidade em metros, ângulo da largura. */
export interface Footprint { x: number; y: number; width: number; depth: number; angle: number }

/**
 * Faixa pintada é traço fino (até ~35 cm de largura média e ao menos 0,8 m de comprimento): manchas claras largas
 * que sobraram no asfalto (calçada absorvida, rótulo da arte) não viram tinta.
 */
function keepThinMarks(marks: Uint8Array, w: number, h: number, metersPerPixel: number) {
  const seen = new Uint8Array(w * h); const stack: number[] = []; const pixels: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!marks[start] || seen[start]) continue;
    stack.push(start); seen[start] = 1; pixels.length = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    while (stack.length) {
      const i = stack.pop()!; pixels.push(i); const x = i % w; const y = (i - x) / w;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && marks[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    const span = Math.hypot(maxX - minX + 1, maxY - minY + 1) * metersPerPixel;
    const width = (pixels.length * metersPerPixel * metersPerPixel) / span;
    if (width > 0.35 || span < 0.8) for (const i of pixels) marks[i] = 0;
  }
}

export function classifyGround(canvas: HTMLCanvasElement, lot: Point[], metersPerPixel: number, stalls: Stall[] = [], erased?: Uint8Array, footprints: Footprint[] = []): GroundMap {
  const xs = lot.map((p) => p[0]); const ys = lot.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))); const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.min(canvas.width, Math.ceil(Math.max(...xs))) - x0; const h = Math.min(canvas.height, Math.ceil(Math.max(...ys))) - y0;
  const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, w, h).data;

  // Máscara do lote rasterizada no próprio canvas.
  const maskCanvas = document.createElement('canvas'); maskCanvas.width = w; maskCanvas.height = h;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
  mctx.beginPath(); lot.forEach(([x, y], i) => (i ? mctx.lineTo(x - x0, y - y0) : mctx.moveTo(x - x0, y - y0))); mctx.closePath(); mctx.fill();
  const inside = mctx.getImageData(0, 0, w, h).data;
  // Vagas (fileiras de carros) são sempre asfalto, com uma pequena folga em volta.
  mctx.clearRect(0, 0, w, h); mctx.fillStyle = '#000';
  // Só a área sob o carro (4,4 × 1,9 m); o resto da vaga segue o que a arte mostra.
  traceStalls(mctx, stalls, metersPerPixel, x0, y0, 1, -0.3);
  const stallMask = mctx.getImageData(0, 0, w, h).data;
  const forced = (i: number) => stallMask[i * 4 + 3] > 127 && inside[i * 4 + 3] >= 128;

  const raw = new Uint8Array(w * h); const lum = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (inside[i * 4 + 3] < 128) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    raw[i] = classify(r, g, b); lum[i] = 0.3 * r + 0.59 * g + 0.11 * b;
  }
  // Pixels de carro e sombra apagados: reconstruídos pela continuação dos lados (calçada segue calçada).
  if (erased) inpaint(raw, w, h, (i) => erased[(Math.floor(i / w) + y0) * canvas.width + (i % w) + x0] === 1 && inside[i * 4 + 3] >= 128);
  const art = new Uint8Array(raw);
  // Torres: a projeção do prédio e a calçada clara em volta (medida na arte, lado a lado) são piso elevado.
  // Sem isso o telhado cinza da arte puxa a calçada para o asfalto e ela vira "faixa pintada" branca.
  const plaza = new Uint8Array(w * h);
  if (footprints.length) {
    const m = 1 / metersPerPixel;
    const artAt = (x: number, y: number) => { const gx = Math.round(x) - x0, gy = Math.round(y) - y0; return gx < 0 || gy < 0 || gx >= w || gy >= h ? Ground.Outside : art[gy * w + gx]; };
    // Claro e neutro: calçada. O bege quente do fundo das vagas encerra a calçada.
    const light = (k: number, x: number, y: number) => {
      if (k !== Ground.Paving && k !== Ground.Other && k !== Ground.Warm) return false;
      const gx = Math.round(x) - x0, gy = Math.round(y) - y0; const i = (gy * w + gx) * 4;
      return !(k === Ground.Paving && data[i] - data[i + 2] >= 18);
    };
    mctx.clearRect(0, 0, w, h); mctx.fillStyle = '#000';
    for (const f of footprints) {
      const ux = Math.cos(f.angle), uy = Math.sin(f.angle), vx = -uy, vy = ux;
      const hw = f.width / 2, hd = f.depth / 2;
      // Margem de calçada por lado (+u, −u, +v, −v): até onde a arte continua clara, no máximo 6 m.
      const margins = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([su, sv]) => {
        const nx = su * ux + sv * vx, ny = su * uy + sv * vy; const tx = su ? vx : ux, ty = su ? vy : uy;
        const along = su ? hd : hw; const out = su ? hw : hd; const found: number[] = [];
        for (let a = -along + 0.5; a <= along - 0.5; a += 1) {
          const at = (d: number) => { const x = f.x + (nx * (out + d) + tx * a) * m, y = f.y + (ny * (out + d) + ty * a) * m; return light(artAt(x, y), x, y); };
          let d = 0; while (d < 2 && !at(d)) d += 0.16; // telhado da arte maior que o modelo
          while (d < 4.5 && at(d)) d += 0.16;
          found.push(d);
        }
        found.sort((p, q) => p - q);
        return Math.max(0.6, Math.min(4.5, found[found.length >> 1] ?? 0.6));
      });
      mctx.save(); mctx.translate(f.x - x0, f.y - y0); mctx.rotate(f.angle);
      mctx.fillRect((-hw - margins[1]) * m, (-hd - margins[3]) * m, (2 * hw + margins[0] + margins[1]) * m, (2 * hd + margins[2] + margins[3]) * m);
      mctx.restore();
    }
    const pm = mctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) if (pm[i * 4 + 3] > 127 && inside[i * 4 + 3] >= 128) { plaza[i] = 1; raw[i] = Ground.Paving; }
  }
  // Nas vagas, carro e sombra ("outro") viram asfalto; calçada e canteiro desenhados na arte ficam.
  const isStall = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (forced(i) && (raw[i] === Ground.Other || raw[i] === Ground.Asphalt)) { raw[i] = Ground.Asphalt; isStall[i] = 1; }
  const kinds = [Ground.Asphalt, Ground.Grass, Ground.Paving, Ground.Other, Ground.Warm];
  let classes = modeFilter(raw, w, h, 7, kinds);
  // Laranja/amarelo em área grande é piso (vagas, deck); em traço fino é faixa pintada.
  for (let i = 0; i < classes.length; i++) if (classes[i] === Ground.Warm) classes[i] = Ground.Paving;
  classes = modeFilter(classes, w, h, 5, kinds.slice(0, 4));

  // Sombras e copas de árvores ("outro" escuro) assumem a classe vizinha predominante.
  for (let pass = 0; pass < 12; pass++) {
    let changed = 0; const next = new Uint8Array(classes);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (classes[i] !== Ground.Other || lum[i] > 95) continue;
      const votes = [0, 0, 0, 0];
      for (const j of [i - 1, i + 1, i - w, i + w, i - w - 1, i - w + 1, i + w - 1, i + w + 1]) { const c = classes[j]; if (c >= 1 && c <= 3) votes[c]++; }
      const best = votes.indexOf(Math.max(...votes));
      if (votes[best] >= 2) { next[i] = best; changed++; }
    }
    classes = next;
    if (!changed) break;
  }

  // Grama pequena (canteiro) fica; piso e "outro" pequenos no meio do asfalto são resto de carro ou sombra.
  const m2 = metersPerPixel * metersPerPixel;
  const minPixels = (kind: number) => Math.round((kind === Ground.Grass ? 4 : kind === Ground.Asphalt ? 8 : 24) / m2);
  // Piso com faixas pintadas dentro (vagas vazias desenhadas na arte) é estacionamento: vira asfalto.
  absorbParkingPads(classes, art, w, h, Math.round(15 / m2));
  // Ilhas: piso no meio do asfalto (resto de carro) e "asfalto" no meio da grama (copa escura de árvore).
  const maxIsland = (kind: number) => (kind === Ground.Paving || kind === Ground.Other ? Math.round(80 / m2) : kind === Ground.Asphalt ? Math.round(120 / m2) : 0);
  removeSpecks(classes, w, h, minPixels, maxIsland);
  classes = modeFilter(classes, w, h, Math.max(5, Math.round(1.4 / metersPerPixel) | 1), kinds.slice(0, 4));
  for (let i = 0; i < w * h; i++) if (isStall[i]) classes[i] = Ground.Asphalt; else if (plaza[i]) classes[i] = Ground.Paving;
  straightenEdges(classes, w, h, Math.round(2.2 / metersPerPixel));
  for (let i = 0; i < w * h; i++) if (isStall[i]) classes[i] = Ground.Asphalt;
  removeSpecks(classes, w, h, minPixels, maxIsland);

  // Canteiros/faixas estreitas de piso no meio do estacionamento viram asfalto quando as vagas já vêm
  // prontas; sem elas (vagas planejadas depois), a faixa atrás das vagas é o meio-fio e fica.
  if (stalls.length) absorbNarrowPaving(classes, w, h, 5 / metersPerPixel, Math.round(600 / m2));
  for (let i = 0; i < w * h; i++) if (isStall[i]) classes[i] = Ground.Asphalt; else if (plaza[i]) classes[i] = Ground.Paving;

  // Faixas pintadas: traços claros ou amarelos que a suavização absorveu no asfalto.
  const marks = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (classes[i] !== Ground.Asphalt || isStall[i]) continue; // nas vagas a demarcação é redesenhada
    if (art[i] === Ground.Warm) marks[i] = 1;
    else if (art[i] === Ground.Paving && lum[i] > 165) marks[i] = 2;
  }
  keepThinMarks(marks, w, h, metersPerPixel);
  return { x0, y0, w, h, classes, marks, plaza };
}

let seed = 1;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** Ladrilho de textura procedural (repetido no chão). */
function tile(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  paint(canvas.getContext('2d')!, size);
  return canvas;
}

export const asphaltTile = (size: number) => tile(size, (ctx, s) => {
  ctx.fillStyle = '#5b5d64'; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < s * s * 0.06; i++) { const l = 50 + rand() * 40; ctx.fillStyle = `rgba(${l},${l},${l + 6},${0.25 + rand() * 0.35})`; ctx.fillRect(rand() * s, rand() * s, 1.4, 1.4); }
  for (let i = 0; i < 6; i++) { // manchas suaves de desgaste
    const g = ctx.createRadialGradient(rand() * s, rand() * s, 0, rand() * s, rand() * s, s * (0.15 + rand() * 0.25));
    g.addColorStop(0, `rgba(0,0,0,${0.05 + rand() * 0.05})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }
});

/** Grama sem emenda: manchas suaves de tom (repetidas nas bordas) e milhares de folhas curtas em vários verdes. */
export const grassTile = (size: number) => tile(size, (ctx, s) => {
  ctx.fillStyle = '#73a047'; ctx.fillRect(0, 0, s, s);
  const wrapped = (draw: (ox: number, oy: number) => void) => { for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) draw(ox, oy); };
  for (let i = 0; i < 14; i++) {
    const x = rand() * s, y = rand() * s, r = s * (0.12 + rand() * 0.25);
    const color = rand() < 0.5 ? 'rgba(150,186,86,0.28)' : 'rgba(64,104,42,0.22)';
    wrapped((ox, oy) => { const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); });
  }
  const blades = ['#8dbb57', '#5f8c3a', '#9cc865', '#4f7a31', '#7fae4d'];
  ctx.lineWidth = Math.max(1, s / 256); ctx.lineCap = 'round';
  for (let i = 0; i < s * s * 0.05; i++) {
    const x = rand() * s, y = rand() * s, len = s * (0.006 + rand() * 0.01), a = -Math.PI / 2 + (rand() - 0.5) * 1.2;
    ctx.strokeStyle = blades[Math.floor(rand() * blades.length)]; ctx.globalAlpha = 0.55 + rand() * 0.4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  ctx.globalAlpha = 1;
});

/** Piso de concreto com juntas (placas de jointMeters). */
export const pavingTile = (size: number, pxPerMeter: number) => tile(size, (ctx, s) => {
  ctx.fillStyle = '#d9d5cc'; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < s * s * 0.05; i++) { const l = 190 + rand() * 50; ctx.fillStyle = `rgba(${l},${l - 4},${l - 10},0.5)`; ctx.fillRect(rand() * s, rand() * s, 1.3, 1.3); }
  const joint = Math.max(4, Math.round(pxPerMeter * 1));
  ctx.strokeStyle = 'rgba(120,112,100,0.35)'; ctx.lineWidth = Math.max(1, pxPerMeter * 0.03);
  for (let p = 0; p <= s; p += joint) { ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke(); }
});

/**
 * Redesenha o chão do lote em alta resolução: texturas próprias nas áreas reconhecidas,
 * a arte original (ampliada) no restante, faixas pintadas nítidas por cima.
 * Retorna o canvas e a escala (pixels do canvas por pixel da arte).
 */
export function paintGround(art: HTMLCanvasElement, map: GroundMap, metersPerPixel: number, stalls: Stall[] = [], marksOnly = false) {
  const scale = Math.max(1, Math.min(4, Math.floor(4096 / Math.max(map.w, map.h))));
  const W = map.w * scale; const H = map.h * scale;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  // marksOnly: só as faixas pintadas e as linhas das vagas, em fundo transparente (camada sobre o asfalto com textura PBR).
  if (!marksOnly) ctx.drawImage(art, map.x0, map.y0, map.w, map.h, 0, 0, W, H);

  const pxPerMeter = scale / metersPerPixel;
  seed = 7;
  const tileSize = (meters: number) => Math.min(1024, Math.max(64, 2 ** Math.round(Math.log2(meters * pxPerMeter))));
  const patterns: [Ground | 'mark1' | 'mark2', string | CanvasPattern][] = [
    [Ground.Asphalt, ctx.createPattern(asphaltTile(tileSize(6)), 'repeat')!],
    [Ground.Grass, ctx.createPattern(grassTile(tileSize(6)), 'repeat')!],
    [Ground.Paving, ctx.createPattern(pavingTile(tileSize(4), pxPerMeter), 'repeat')!],
    ['mark1', '#f1b52e'], ['mark2', '#f4f4f0'],
  ];
  const mask = document.createElement('canvas'); mask.width = map.w; mask.height = map.h;
  const mctx = mask.getContext('2d')!;
  const layer = document.createElement('canvas'); layer.width = W; layer.height = H;
  const lctx = layer.getContext('2d')!;
  for (const [kind, fill] of patterns) {
    if (marksOnly && kind !== 'mark1' && kind !== 'mark2') continue;
    const image = mctx.createImageData(map.w, map.h);
    let any = false;
    for (let i = 0; i < map.classes.length; i++) {
      const on = kind === 'mark1' ? map.marks[i] === 1 : kind === 'mark2' ? map.marks[i] === 2 : map.classes[i] === kind;
      if (on) { image.data[i * 4 + 3] = 255; any = true; }
    }
    if (!any) continue;
    mctx.putImageData(image, 0, 0);
    lctx.globalCompositeOperation = 'source-over'; lctx.clearRect(0, 0, W, H);
    lctx.imageSmoothingEnabled = true; lctx.imageSmoothingQuality = 'high';
    lctx.drawImage(mask, 0, 0, W, H);
    lctx.globalCompositeOperation = 'source-in';
    lctx.fillStyle = fill; lctx.fillRect(0, 0, W, H);
    ctx.drawImage(layer, 0, 0);
  }
  // Demarcação das vagas: linhas nas divisas de cada vaga da fileira (2,5 × 5 m), só sobre o asfalto.
  if (stalls.length) {
    lctx.globalCompositeOperation = 'source-over'; lctx.clearRect(0, 0, W, H);
    lctx.strokeStyle = '#f2ead2'; lctx.lineWidth = 0.1 * pxPerMeter; lctx.lineCap = 'butt';
    lctx.beginPath();
    for (const stall of stalls) {
      const cx = (stall.x - map.x0) * scale; const cy = (stall.y - map.y0) * scale;
      const ux = Math.cos(stall.angle); const uy = Math.sin(stall.angle); const side = (stall.width / 2) * pxPerMeter;
      // Linhas laterais da vaga, do meio-fio até 0,3 m antes do corredor.
      const back = (stallLength / 2) * pxPerMeter; const front = (stallLength / 2 - 0.3) * pxPerMeter; const dir = stall.curb || 1;
      for (const k of [-1, 1]) {
        lctx.moveTo(cx + ux * back * dir - uy * side * k, cy + uy * back * dir + ux * side * k);
        lctx.lineTo(cx - ux * front * dir - uy * side * k, cy - uy * front * dir + ux * side * k);
      }
    }
    lctx.stroke();
    const image = mctx.createImageData(map.w, map.h);
    for (let i = 0; i < map.classes.length; i++) if (map.classes[i] === Ground.Asphalt) image.data[i * 4 + 3] = 255;
    mctx.putImageData(image, 0, 0);
    lctx.globalCompositeOperation = 'destination-in';
    lctx.drawImage(mask, 0, 0, W, H);
    ctx.drawImage(layer, 0, 0);
  }
  return { canvas: out, scale };
}

/**
 * Depois de planejadas as vagas: cada vaga vira asfalto inteiro (sem restos de carro ou sombra da arte)
 * e manchas de piso pequenas, compactas e cercadas de asfalto somem. Faixas longas (canteiro entre
 * fileiras, calçada) ficam.
 */
export function settleStalls(map: GroundMap, stalls: Stall[], metersPerPixel: number) {
  const { w, h, classes, marks } = map;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  traceStalls(ctx, stalls, metersPerPixel, map.x0, map.y0, 1, 0.05);
  const mask = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) if (mask[i * 4 + 3] > 127 && classes[i] !== Ground.Outside) { classes[i] = Ground.Asphalt; marks[i] = 0; }
  const m2 = metersPerPixel * metersPerPixel; const m = 1 / metersPerPixel;
  const seen = new Uint8Array(w * h); const stack: number[] = []; const pixels: number[] = [];
  for (let start = 0; start < w * h; start++) {
    const kind = classes[start];
    if (seen[start] || (kind !== Ground.Paving && kind !== Ground.Other)) continue;
    stack.push(start); seen[start] = 1; pixels.length = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0, asphalt = 0, border = 0;
    while (stack.length) {
      const i = stack.pop()!; pixels.push(i); const x = i % w; const y = (i - x) / w;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h) continue;
        if (classes[j] === kind) { if (!seen[j]) { seen[j] = 1; stack.push(j); } }
        else if (classes[j] !== Ground.Outside) { border++; if (classes[j] === Ground.Asphalt) asphalt++; }
      }
    }
    const area = pixels.length * m2; const span = Math.max(maxX - minX + 1, maxY - minY + 1) / m; const ratio = asphalt / Math.max(1, border);
    if (area < 6 && ratio > 0.5 || area < 45 && span < 7 && ratio > 0.7) for (const i of pixels) classes[i] = Ground.Asphalt;
  }

  const fixed = (i: number) => mask[i * 4 + 3] > 127 || map.plaza?.[i] === 1;
  // Copa e sombra de árvore desenhadas sobre o gramado saem como "asfalto" (cinza-escuro de pouca saturação):
  // mancha de asfalto sem vaga, cercada sobretudo de grama ou piso, volta a ser a classe em volta.
  seen.fill(0);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || classes[start] !== Ground.Asphalt) continue;
    stack.push(start); seen[start] = 1; pixels.length = 0;
    let stall = false; const votes = [0, 0, 0, 0, 0];
    while (stack.length) {
      const i = stack.pop()!; pixels.push(i); if (fixed(i)) stall = true; const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h) continue;
        if (classes[j] === Ground.Asphalt) { if (!seen[j]) { seen[j] = 1; stack.push(j); } }
        else if (classes[j] !== Ground.Outside) votes[classes[j]]++;
      }
    }
    const border = votes[Ground.Grass] + votes[Ground.Paving] + votes[Ground.Other];
    if (stall || !border || pixels.length * m2 > 500) continue;
    const best = votes[Ground.Grass] >= votes[Ground.Paving] && votes[Ground.Grass] >= votes[Ground.Other] ? Ground.Grass : votes[Ground.Paving] >= votes[Ground.Other] ? Ground.Paving : Ground.Other;
    // Ilha de verdade (a borda inteira é chão elevado); rua do lote encosta em asfalto e fica.
    if (votes[Ground.Asphalt] === 0) for (const i of pixels) classes[i] = best;
  }

  // Abertura morfológica do asfalto (~0,9 m): pontas estreitas que entram no gramado (sombra de copa encostada no
  // estacionamento) viram a classe elevada vizinha. Corredores e vagas têm mais de 2 m e ficam.
  const open = Math.max(1, Math.round(0.9 / metersPerPixel));
  const isAsphalt = (i: number) => classes[i] === Ground.Asphalt || fixed(i);
  const run = (src: Uint8Array, horizontal: boolean, keep: (count: number, size: number) => boolean) => {
    const out = new Uint8Array(w * h);
    for (let line = 0; line < (horizontal ? h : w); line++) {
      const length = horizontal ? w : h; const at = (k: number) => (horizontal ? line * w + k : k * w + line);
      let count = 0;
      for (let k = -open; k < length; k++) {
        if (k + open < length) count += src[at(k + open)];
        if (k - open - 1 >= 0) count -= src[at(k - open - 1)];
        if (k >= 0) { const size = Math.min(length - 1, k + open) - Math.max(0, k - open) + 1; out[at(k)] = keep(count, size) ? 1 : 0; }
      }
    }
    return out;
  };
  const base = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) base[i] = isAsphalt(i) ? 1 : 0;
  const eroded = run(run(base, true, (c, s) => c === s), false, (c, s) => c === s);
  const opened = run(run(eroded, true, (c) => c > 0), false, (c) => c > 0);
  for (let i = 0; i < w * h; i++) {
    if (!base[i] || opened[i] || fixed(i)) continue;
    const x = i % w; const y = (i - x) / w; let raised = Ground.Grass;
    search: for (let r = 1; r < 16; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = classes[ny * w + nx]; if (k === Ground.Grass || k === Ground.Paving || k === Ground.Other) { raised = k; break search; }
    }
    classes[i] = raised;
  }

  // Bordas mais limpas: voto de maioria numa janela de ~0,8 m, duas vezes, sem mexer nas vagas nem na calçada das torres.
  const radius = Math.max(1, Math.round(0.4 / metersPerPixel));
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(classes);
    for (let y = radius; y < h - radius; y++) for (let x = radius; x < w - radius; x++) {
      const i = y * w + x; const c = classes[i];
      if (c === Ground.Outside || fixed(i)) continue;
      const votes = [0, 0, 0, 0, 0];
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) votes[classes[i + dy * w + dx]]++;
      if (votes[Ground.Outside]) continue; // não mexe na divisa do lote
      let best = c;
      for (const k of [Ground.Asphalt, Ground.Grass, Ground.Paving, Ground.Other]) if (votes[k] > votes[best]) best = k;
      next[i] = best;
    }
    classes.set(next);
  }
}
/** Superfície elevada (calçada, canteiro, gramado, deck): tudo que não é asfalto. */
const raised = (c: number) => c === Ground.Grass || c === Ground.Paving || c === Ground.Other;

/**
 * Malha do chão em degraus: asfalto na cota base e áreas elevadas um meio-fio acima,
 * com faces verticais (grupo 1) nas divisas. Linhas iguais são fundidas em retângulos.
 */
export function buildGroundMesh(map: GroundMap, toSite: (p: Point) => Point, uvScale: { u: (px: number) => number; v: (py: number) => number }) {
  const { w, h, x0, y0, classes } = map;
  const top: number[] = []; const topUv: number[] = []; const side: number[] = [];
  const level = (c: number) => (raised(c) ? asphaltLevel + curbHeight : asphaltLevel);
  const vertex = (px: number, py: number, y: number, list: number[]) => { const [x, z] = toSite([px + x0, py + y0]); list.push(x, y, z); };
  // Também por classe (asfalto, grama, piso, outro), com UV em metros para as texturas PBR repetidas;
  // a classe "outro" mantém a UV da arte (quadra, piscina, deque desenhados).
  const perClass = new Map<number, { p: number[]; uv: number[] }>();
  const quad = (ax: number, ay: number, bx: number, by: number, y: number, c: number) => {
    const corners: [number, number][] = [[ax, ay], [ax, by], [bx, ay], [bx, ay], [ax, by], [bx, by]];
    let list = perClass.get(c); if (!list) perClass.set(c, (list = { p: [], uv: [] }));
    for (const [px, py] of corners) {
      vertex(px, py, y, top); topUv.push(uvScale.u(px + x0), uvScale.v(py + y0));
      const [sx, sz] = toSite([px + x0, py + y0]); list.p.push(sx, y, sz);
      if (c === Ground.Other) list.uv.push(uvScale.u(px + x0), uvScale.v(py + y0)); else list.uv.push(sx, -sz);
    }
  };
  // Topo: fusão gulosa de trechos iguais por linha e depois de linhas idênticas consecutivas.
  let previous: string | null = null; let runs: [number, number, number][] = []; let startRow = 0;
  const flush = (endRow: number) => { for (const [a, b, c] of runs) quad(a, startRow, b, endRow, level(c), c); };
  for (let y = 0; y < h; y++) {
    const row: [number, number, number][] = [];
    let x = 0;
    while (x < w) {
      const c = classes[y * w + x]; let e = x + 1;
      while (e < w && classes[y * w + e] === c) e++;
      if (c !== Ground.Outside) row.push([x, e, c]);
      x = e;
    }
    const key = row.map(([a, b, c]) => `${a},${b},${c}`).join('|');
    if (key !== previous) { if (previous !== null) flush(y); runs = row; startRow = y; previous = key; }
  }
  if (previous !== null) flush(h);

  // Meio-fio: faces verticais onde a cota muda (inclusive na borda do lote, até o chão da cidade).
  const sideUv: number[] = [];
  const wall = (ax: number, ay: number, bx: number, by: number, lo: number, hi: number) => {
    const [x1, z1] = toSite([ax + x0, ay + y0]); const [x2, z2] = toSite([bx + x0, by + y0]);
    const length = Math.hypot(x2 - x1, z2 - z1); const along = (x1 + z1) * 0.5; // continuidade aproximada entre trechos
    for (const [px, py, y] of [[ax, ay, lo], [bx, by, lo], [ax, ay, hi], [ax, ay, hi], [bx, by, lo], [bx, by, hi]] as const) {
      vertex(px, py, y, side);
      sideUv.push(along + (px === bx && py === by ? length : 0), y);
    }
  };
  const levelAt = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h || classes[y * w + x] === Ground.Outside ? 0 : level(classes[y * w + x]));
  for (let y = 0; y <= h; y++) { // divisas horizontais (entre a linha y-1 e y)
    let x = 0;
    while (x < w) {
      const a = levelAt(x, y - 1); const b = levelAt(x, y);
      if (a === b) { x++; continue; }
      let e = x + 1;
      while (e < w && levelAt(e, y - 1) === a && levelAt(e, y) === b) e++;
      wall(x, y, e, y, Math.min(a, b), Math.max(a, b));
      x = e;
    }
  }
  for (let x = 0; x <= w; x++) { // divisas verticais (entre a coluna x-1 e x)
    let y = 0;
    while (y < h) {
      const a = levelAt(x - 1, y); const b = levelAt(x, y);
      if (a === b) { y++; continue; }
      let e = y + 1;
      while (e < h && levelAt(x - 1, e) === a && levelAt(x, e) === b) e++;
      wall(x, y, x, e, Math.min(a, b), Math.max(a, b));
      y = e;
    }
  }

  // Duas malhas: topo (textura do chão) e faces verticais do meio-fio (concreto).
  const sequence = (n: number) => Array.from({ length: n }, (_, i) => i);
  const topGeo: Geo = computeNormals({ positions: top, indices: sequence(top.length / 3), uvs: topUv });
  const sideGeo: Geo = computeNormals({ positions: side, indices: sequence(side.length / 3), uvs: sideUv });
  const tops = new Map<number, Geo>();
  for (const [c, list] of perClass) tops.set(c, computeNormals({ positions: list.p, indices: sequence(list.p.length / 3), uvs: list.uv }));
  return { top: topGeo, side: sideGeo, tops };
}
