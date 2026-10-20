import * as THREE from 'three';
import type { Point } from '../types';

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
function removeSpecks(classes: Uint8Array, w: number, h: number, minPixels: (kind: number) => number) {
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
    if (pixels.length >= minPixels(kind)) continue;
    const best = votes.indexOf(Math.max(...votes));
    if (votes[best] > 0) for (const i of pixels) classes[i] = best;
  }
}

export function classifyGround(canvas: HTMLCanvasElement, lot: Point[], metersPerPixel: number): GroundMap {
  const xs = lot.map((p) => p[0]); const ys = lot.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))); const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.min(canvas.width, Math.ceil(Math.max(...xs))) - x0; const h = Math.min(canvas.height, Math.ceil(Math.max(...ys))) - y0;
  const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, w, h).data;

  // Máscara do lote rasterizada no próprio canvas.
  const maskCanvas = document.createElement('canvas'); maskCanvas.width = w; maskCanvas.height = h;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
  mctx.beginPath(); lot.forEach(([x, y], i) => (i ? mctx.lineTo(x - x0, y - y0) : mctx.moveTo(x - x0, y - y0))); mctx.closePath(); mctx.fill();
  const inside = mctx.getImageData(0, 0, w, h).data;

  const raw = new Uint8Array(w * h); const lum = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (inside[i * 4 + 3] < 128) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    raw[i] = classify(r, g, b); lum[i] = 0.3 * r + 0.59 * g + 0.11 * b;
  }
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
  removeSpecks(classes, w, h, minPixels);
  classes = modeFilter(classes, w, h, Math.max(5, Math.round(1.4 / metersPerPixel) | 1), kinds.slice(0, 4));
  removeSpecks(classes, w, h, minPixels);

  // Faixas pintadas: traços claros ou amarelos que a suavização absorveu no asfalto.
  const marks = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (classes[i] !== Ground.Asphalt) continue;
    if (raw[i] === Ground.Warm) marks[i] = 1;
    else if (raw[i] === Ground.Paving && lum[i] > 165) marks[i] = 2;
  }
  return { x0, y0, w, h, classes, marks };
}

let seed = 1;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** Ladrilho de textura procedural (repetido no chão). */
function tile(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  paint(canvas.getContext('2d')!, size);
  return canvas;
}

const asphaltTile = (size: number) => tile(size, (ctx, s) => {
  ctx.fillStyle = '#5b5d64'; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < s * s * 0.06; i++) { const l = 50 + rand() * 40; ctx.fillStyle = `rgba(${l},${l},${l + 6},${0.25 + rand() * 0.35})`; ctx.fillRect(rand() * s, rand() * s, 1.4, 1.4); }
  for (let i = 0; i < 6; i++) { // manchas suaves de desgaste
    const g = ctx.createRadialGradient(rand() * s, rand() * s, 0, rand() * s, rand() * s, s * (0.15 + rand() * 0.25));
    g.addColorStop(0, `rgba(0,0,0,${0.05 + rand() * 0.05})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }
});

const grassTile = (size: number) => tile(size, (ctx, s) => {
  ctx.fillStyle = '#6f9a45'; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 10; i++) {
    const g = ctx.createRadialGradient(rand() * s, rand() * s, 0, rand() * s, rand() * s, s * (0.2 + rand() * 0.3));
    g.addColorStop(0, rand() < 0.5 ? 'rgba(140,175,80,0.35)' : 'rgba(60,100,40,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }
  for (let i = 0; i < s * s * 0.12; i++) { ctx.fillStyle = rand() < 0.5 ? 'rgba(150,190,90,0.45)' : 'rgba(55,95,40,0.45)'; ctx.fillRect(rand() * s, rand() * s, 1, 2 + rand() * 2); }
});

/** Piso de concreto com juntas (placas de jointMeters). */
const pavingTile = (size: number, pxPerMeter: number) => tile(size, (ctx, s) => {
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
export function paintGround(art: HTMLCanvasElement, map: GroundMap, metersPerPixel: number, stalls: { x: number; y: number; angle: number }[] = []) {
  const scale = Math.max(1, Math.min(4, Math.floor(4096 / Math.max(map.w, map.h))));
  const W = map.w * scale; const H = map.h * scale;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(art, map.x0, map.y0, map.w, map.h, 0, 0, W, H);

  const pxPerMeter = scale / metersPerPixel;
  seed = 7;
  const tileSize = (meters: number) => Math.min(1024, Math.max(64, 2 ** Math.round(Math.log2(meters * pxPerMeter))));
  const patterns: [Ground | 'mark1' | 'mark2', string | CanvasPattern][] = [
    [Ground.Asphalt, ctx.createPattern(asphaltTile(tileSize(6)), 'repeat')!],
    [Ground.Grass, ctx.createPattern(grassTile(tileSize(4)), 'repeat')!],
    [Ground.Paving, ctx.createPattern(pavingTile(tileSize(4), pxPerMeter), 'repeat')!],
    ['mark1', '#f1b52e'], ['mark2', '#f4f4f0'],
  ];
  const mask = document.createElement('canvas'); mask.width = map.w; mask.height = map.h;
  const mctx = mask.getContext('2d')!;
  const layer = document.createElement('canvas'); layer.width = W; layer.height = H;
  const lctx = layer.getContext('2d')!;
  for (const [kind, fill] of patterns) {
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
  // Demarcação das vagas onde há carro estacionado: duas linhas nas laterais de cada vaga (2,5 × 5 m).
  ctx.strokeStyle = '#f0d27c'; ctx.lineWidth = 0.12 * pxPerMeter; ctx.lineCap = 'butt';
  for (const stall of stalls) {
    const cx = (stall.x - map.x0) * scale; const cy = (stall.y - map.y0) * scale;
    const ux = Math.cos(stall.angle); const uy = Math.sin(stall.angle); const half = 2.5 * pxPerMeter; const side = 1.3 * pxPerMeter;
    ctx.beginPath();
    for (const k of [-1, 1]) { ctx.moveTo(cx - ux * half - uy * side * k, cy - uy * half + ux * side * k); ctx.lineTo(cx + ux * half - uy * side * k, cy + uy * half + ux * side * k); }
    ctx.stroke();
  }
  return { canvas: out, scale };
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
  const quad = (ax: number, ay: number, bx: number, by: number, y: number) => {
    const corners: [number, number][] = [[ax, ay], [ax, by], [bx, ay], [bx, ay], [ax, by], [bx, by]];
    for (const [px, py] of corners) { vertex(px, py, y, top); topUv.push(uvScale.u(px + x0), uvScale.v(py + y0)); }
  };
  // Topo: fusão gulosa de trechos iguais por linha e depois de linhas idênticas consecutivas.
  let previous: string | null = null; let runs: [number, number, number][] = []; let startRow = 0;
  const flush = (endRow: number) => { for (const [a, b, c] of runs) quad(a, startRow, b, endRow, level(c)); };
  for (let y = 0; y < h; y++) {
    const row: [number, number, number][] = [];
    let x = 0;
    while (x < w) {
      const c = classes[y * w + x]; let e = x + 1;
      while (e < w && level(classes[y * w + e]) === level(c) && (classes[y * w + e] === Ground.Outside) === (c === Ground.Outside)) e++;
      if (c !== Ground.Outside) row.push([x, e, c]);
      x = e;
    }
    const key = row.map(([a, b, c]) => `${a},${b},${level(c)}`).join('|');
    if (key !== previous) { if (previous !== null) flush(y); runs = row; startRow = y; previous = key; }
  }
  if (previous !== null) flush(h);

  // Meio-fio: faces verticais onde a cota muda (inclusive na borda do lote, até o chão da cidade).
  const wall = (ax: number, ay: number, bx: number, by: number, lo: number, hi: number) => {
    for (const [px, py, y] of [[ax, ay, lo], [bx, by, lo], [ax, ay, hi], [ax, ay, hi], [bx, by, lo], [bx, by, hi]] as const) vertex(px, py, y, side);
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

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...top, ...side], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([...topUv, ...new Array((side.length / 3) * 2).fill(0)], 2));
  geometry.addGroup(0, top.length / 3, 0);
  geometry.addGroup(top.length / 3, side.length / 3, 1);
  geometry.computeVertexNormals();
  return geometry;
}
