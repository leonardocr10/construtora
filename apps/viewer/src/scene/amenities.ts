import { Matrix, TransformNode, Vector3, type Color3, type PBRMaterial, type Scene } from './babylon';
import { box as boxGeo, compose, cone, cylinder, getHsl, merge, meshFrom, pbr, plane, rgb, rotateX, rotateY, shadows, srgb, transform, type Geo, type MaterialOptions } from './geometry';
import type { Amenity, Point } from '../types';

/**
 * Áreas de lazer em 3D para qualquer empreendimento: o tipo vem do nome cadastrado (piscina, quadra,
 * salão, quiosque…) e a posição/tamanho vêm da arte da implantação em volta do marcador numerado
 * (água azul para a piscina, mancha de cor uniforme para quadras e construções). Cada tipo vira um
 * modelo paramétrico simples, na mesma linguagem da maquete.
 */

type Kind = 'pool' | 'court' | 'beach' | 'building' | 'kiosk' | 'playground' | 'deck' | 'bikes' | 'small';

function kindOf(name: string): Kind {
  const n = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Palavras inteiras: "espaço" contém "spa", "deck beach" não é quadra.
  if (/\b(piscina|prainha|spa|ofuro|hidro)\b/.test(n)) return 'pool';
  if (/\b(deck|solarium|lounge|praca|contemplacao)\b/.test(n)) return 'deck';
  if (/\b(beach|areia|volei de praia)\b/.test(n)) return 'beach';
  if (/quadra|campo|society|tenis/.test(n)) return 'court';
  if (/playground|brinquedo|kids|infantil/.test(n)) return 'playground';
  if (/quiosque|grill|churrasq|gourmet|bar\b|pergolado|redario/.test(n)) return 'kiosk';
  if (/bicic|bike/.test(n)) return 'bikes';
  if (/lixeira|lixo|guarita|gas|medidor|portaria|apoio|funcionarios|zelador/.test(n)) return 'small';
  return 'building'; // salão, fitness, portaria, apoio, brinquedoteca, coworking…
}

/** Faixas de tamanho (metros) e raio de busca na arte por tipo. */
const sizes: Record<Kind, { min: [number, number]; max: [number, number]; fallback: [number, number]; radius: number }> = {
  pool: { min: [4, 3], max: [25, 16], fallback: [10, 5], radius: 14 },
  court: { min: [10, 6], max: [36, 22], fallback: [18, 10], radius: 18 },
  beach: { min: [8, 5], max: [24, 14], fallback: [16, 8], radius: 14 },
  building: { min: [4, 4], max: [14, 10], fallback: [9, 7], radius: 8 },
  kiosk: { min: [3, 3], max: [8, 6], fallback: [6, 4.5], radius: 6 },
  playground: { min: [5, 5], max: [16, 14], fallback: [9, 7], radius: 9 },
  deck: { min: [5, 4], max: [18, 14], fallback: [9, 6], radius: 9 },
  bikes: { min: [3, 2], max: [10, 5], fallback: [5, 2.5], radius: 5 },
  small: { min: [2.5, 2.5], max: [7, 6], fallback: [4, 3.5], radius: 4.5 },
};

interface Footprint { x: number; y: number; w: number; h: number; color: Color3 | null; water: Footprint | null }

const isWater = (r: number, g: number, b: number) => b > 120 && b > r * 1.25 && g > r * 1.05 && b - r > 45;

/**
 * Procura na arte, em volta do marcador, a mancha do equipamento: água (piscina) ou região de cor
 * parecida com a do chão sob o marcador. Devolve o retângulo em pixels (eixos da arte).
 */
function findFootprint(data: Uint8ClampedArray, width: number, height: number, [mx, my]: Point, kind: Kind, mpp: number, inLot: (x: number, y: number) => boolean): Footprint {
  const spec = sizes[kind]; const R = Math.round(spec.radius / mpp);
  const x0 = Math.max(0, Math.round(mx) - R), x1 = Math.min(width - 1, Math.round(mx) + R);
  const y0 = Math.max(0, Math.round(my) - R), y1 = Math.min(height - 1, Math.round(my) + R);
  const px = (x: number, y: number) => { const k = (y * width + x) * 4; return [data[k], data[k + 1], data[k + 2]] as const; };
  const grow = (seeds: [number, number][], accept: (x: number, y: number) => boolean) => {
    const seen = new Set<number>(); const stack = seeds.filter(([x, y]) => accept(x, y)).map(([x, y]) => y * width + x);
    stack.forEach((i) => seen.add(i));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
    while (stack.length) {
      const i = stack.pop()!; const x = i % width; const y = (i - x) / width; n++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
        const j = ny * width + nx; if (seen.has(j) || !inLot(nx, ny) || !accept(nx, ny)) continue;
        seen.add(j); stack.push(j);
      }
    }
    return n ? { minX, maxX, minY, maxY, n } : null;
  };
  const clampBox = (box: { minX: number; maxX: number; minY: number; maxY: number }, s = spec): Footprint => {
    let w = (box.maxX - box.minX + 1) * mpp, h = (box.maxY - box.minY + 1) * mpp;
    const long = Math.max(w, h) === w;
    const [minA, minB] = s.min; const [maxA, maxB] = s.max;
    const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    w = clamp(w, long ? minA : minB, long ? maxA : maxB); h = clamp(h, long ? minB : minA, long ? maxB : maxA);
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, w, h, color: null, water: null };
  };

  // Piscina: a mancha de água mais próxima do marcador.
  let water: Footprint | null = null;
  if (kind === 'pool' || kind === 'deck') {
    let best: [number, number] | null = null; let bestD = Infinity;
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
      if (!inLot(x, y)) continue;
      const [r, g, b] = px(x, y); if (!isWater(r, g, b)) continue;
      const d = Math.hypot(x - mx, y - my); if (d < bestD) { bestD = d; best = [x, y]; }
    }
    if (best) {
      const box = grow([best], (x, y) => { const [r, g, b] = px(x, y); return isWater(r, g, b); });
      if (box && box.n * mpp * mpp > 4) water = clampBox(box, sizes.pool);
    }
    if (kind === 'pool' && water) {
      // O deque em volta da piscina ocupa um pouco além da água.
      return { ...water, w: water.w + 3, h: water.h + 3, water };
    }
  }

  // Demais: região de cor parecida com a do chão sob o marcador (o marcador já foi apagado da arte).
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let y = Math.round(my) - 2; y <= Math.round(my) + 2; y++) for (let x = Math.round(mx) - 2; x <= Math.round(mx) + 2; x++) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue; const [r, g, b] = px(x, y); sr += r; sg += g; sb += b; sn++;
  }
  const seed = [sr / sn, sg / sn, sb / sn];
  const tolerance = kind === 'court' || kind === 'beach' ? 34 : 26;
  const box = grow([[Math.round(mx), Math.round(my)]], (x, y) => { const [r, g, b] = px(x, y); return Math.hypot(r - seed[0], g - seed[1], b - seed[2]) < tolerance; });
  const color = srgb(Math.round(seed[0]), Math.round(seed[1]), Math.round(seed[2]));
  const area = box ? box.n * mpp * mpp : 0;
  if (!box || area < spec.min[0] * spec.min[1] * 0.5) {
    return { x: mx, y: my, w: spec.fallback[0], h: spec.fallback[1], color, water };
  }
  return { ...clampBox(box), color, water };
}

// ——— Modelos ———

const materialSpec: Record<string, MaterialOptions> = {
  wall: { color: 0xeeece6 }, roof: { color: 0xdcdad3 }, glass: { color: 0x34505f, roughness: 0.12, metalness: 0.4 }, wood: { color: 0x9a6a43 }, deck: { color: 0xb88a5c },
  white: { color: 0xf4f4f1 }, dark: { color: 0x2f3338, roughness: 0.5, metalness: 0.4 }, water: { color: 0x3fb7d9, roughness: 0.05, metalness: 0.1, alpha: 0.9 },
  coping: { color: 0xe8e2d6 }, sand: { color: 0xe3cc92 }, net: { color: 0xf5f5f5, alpha: 0.55 }, fence: { color: 0x3d6b4a, alpha: 0.28, depthWrite: false },
  rubber: { color: 0xd0563b }, red: { color: 0xd9483b }, yellow: { color: 0xf1b52e }, blue: { color: 0x2e7fd0 }, green: { color: 0x3f8f55 }, umbrella: { color: 0xf2efe6 }, leaf: { color: 0x4f8a3a },
};
type Mat = keyof typeof materialSpec | Color3;

/**
 * Peças de um equipamento: cada caixa/cone/cilindro entra transformado e, no fim, as peças do mesmo
 * material (e com a mesma regra de sombra) viram uma malha só.
 */
class Kit {
  readonly parts = new Map<string, { material: Mat; cast: boolean; geos: Geo[] }>();
  add(material: Mat, geo: Geo, x: number, y: number, z: number, cast = true, rot: [number, number, number] = [0, 0, 0]) {
    const key = `${typeof material === 'string' ? material : material.toHexString()}|${cast}`;
    if (!this.parts.has(key)) this.parts.set(key, { material, cast, geos: [] });
    this.parts.get(key)!.geos.push(transform(geo, compose(x, y, z, ...rot)));
  }
  box(material: Mat, x: number, y: number, z: number, w: number, h: number, d: number, cast = true, rot?: [number, number, number]) {
    this.add(material, boxGeo(w, h, d), x, y + h / 2, z, cast, rot);
  }
}

/** Construção térrea: paredes, faixa de vidro em volta e laje de cobertura com beiral. */
function building(g: Kit, w: number, d: number, height = 3.4) {
  g.box('wall', 0, 0, 0, w, height, d);
  g.box('glass', 0, 0.9, 0, w + 0.04, Math.min(1.6, height * 0.45), d + 0.04, false);
  g.box('roof', 0, height, 0, w + 0.8, 0.28, d + 0.8);
  g.box('white', 0, height + 0.28, 0, w + 0.9, 0.1, d + 0.9);
}

/** Quiosque/gourmet aberto: laje sobre pilares, bancada e mesas. */
function kiosk(g: Kit, w: number, d: number) {
  const h = 3;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box('wood', sx * (w / 2 - 0.2), 0, sz * (d / 2 - 0.2), 0.22, h, 0.22);
  g.box('roof', 0, h, 0, w + 0.6, 0.25, d + 0.6);
  g.box('wall', 0, 0, -d / 2 + 0.5, w * 0.7, 0.95, 0.6); // bancada / churrasqueira
  g.box('dark', -w * 0.25, 0.95, -d / 2 + 0.5, 0.8, 0.6, 0.5);
  const tables = Math.max(1, Math.round(w / 3));
  for (let i = 0; i < tables; i++) {
    const x = -w / 2 + (w / tables) * (i + 0.5);
    g.box('wood', x, 0.72, d * 0.12, 1.2, 0.06, 0.8); g.box('wood', x, 0, d * 0.12, 0.1, 0.72, 0.1, false);
  }
}

function umbrella(g: Kit, x: number, z: number) {
  g.add('dark', cylinder(0.04, 0.04, 2.3, 6), x, 1.15, z, false);
  g.add('umbrella', cone(1.3, 0.5, 10), x, 2.4, z);
}
function lounger(g: Kit, x: number, z: number, rotation: number) {
  g.box('white', x, 0.15, z, 0.65, 0.12, 1.9, false, [0, rotation, 0]);
  // Encosto inclinado na cabeceira (0,85 m para trás no eixo da espreguiçadeira).
  const back = Vector3.TransformCoordinates(new Vector3(0, 0, -0.85), Matrix.RotationY(rotation));
  g.box('white', x + back.x, 0.25, z + back.z, 0.65, 0.5, 0.12, false, [-0.7, rotation, 0]);
}

/** Piscina: borda, água rebaixada, deque de madeira em volta, espreguiçadeiras e guarda-sóis. */
function pool(g: Kit, w: number, d: number, water: { dx: number; dz: number; w: number; d: number } | null) {
  g.box('deck', 0, 0, 0, w, 0.08, d, false);
  const pw = water?.w ?? w - 3; const pd = water?.d ?? d - 3; const px = water?.dx ?? 0; const pz = water?.dz ?? 0;
  const t = 0.35;
  g.box('coping', px, 0, pz - pd / 2 - t / 2, pw + t * 2, 0.16, t); g.box('coping', px, 0, pz + pd / 2 + t / 2, pw + t * 2, 0.16, t);
  g.box('coping', px - pw / 2 - t / 2, 0, pz, t, 0.16, pd); g.box('coping', px + pw / 2 + t / 2, 0, pz, t, 0.16, pd);
  g.add('water', rotateX(plane(pw, pd), -Math.PI / 2), px, 0.1, pz, false);
  const long = w >= d; const count = Math.max(2, Math.floor((long ? w : d) / 3));
  for (let i = 0; i < count; i++) {
    const s = -((long ? w : d) / 2) + ((long ? w : d) / count) * (i + 0.5);
    const edge = (long ? d : w) / 2 - 0.9;
    if (long) lounger(g, s, edge, Math.PI); else lounger(g, edge, s, -Math.PI / 2);
    if (i % 2 === 0) { if (long) umbrella(g, s + 1, edge); else umbrella(g, edge, s + 1); }
  }
}

/** Quadra: piso colorido, linhas, alambrado e traves (poliesportiva) ou rede (beach tennis). */
function court(g: Kit, w: number, d: number, surface: Color3 | null, beach: boolean) {
  const long = w >= d; const L = long ? w : d; const S = long ? d : w;
  const floor: Mat = beach ? 'sand' : surface && getHsl(surface).s > 0.2 ? surface : rgb(0x3f7d64);
  g.box(floor, 0, 0, 0, w, 0.06, d, false);
  const line = (x: number, z: number, lw: number, ld: number) => g.box('white', x, 0.06, z, lw, 0.02, ld, false);
  const iw = w - 1.2, id = d - 1.2;
  line(0, -id / 2, iw, 0.08); line(0, id / 2, iw, 0.08); line(-iw / 2, 0, 0.08, id); line(iw / 2, 0, 0.08, id);
  if (long) line(0, 0, 0.08, id); else line(0, 0, iw, 0.08);
  if (beach) {
    if (long) g.box('net', 0, 1.2, 0, 0.05, 0.9, S * 0.9, false); else g.box('net', 0, 1.2, 0, S * 0.9, 0.9, 0.05, false);
    for (const s of [-1, 1]) g.box('dark', long ? 0 : s * S * 0.46, 0, long ? s * S * 0.46 : 0, 0.08, 2.2, 0.08, false);
  } else {
    // Traves nas cabeceiras.
    for (const s of [-1, 1]) {
      const cx = long ? s * (L / 2 - 0.7) : 0; const cz = long ? 0 : s * (L / 2 - 0.7);
      for (const k of [-1, 1]) g.box('white', cx + (long ? 0 : k * 1.5), 0, cz + (long ? k * 1.5 : 0), 0.1, 2, 0.1, false);
      g.box('white', cx, 2, cz, long ? 0.1 : 3.1, 0.1, long ? 3.1 : 0.1, false);
    }
  }
  // Alambrado: tela translúcida com montantes.
  const fh = beach ? 3 : 4;
  for (const [x, z, fw, fd] of [[0, -d / 2, w, 0.04], [0, d / 2, w, 0.04], [-w / 2, 0, 0.04, d], [w / 2, 0, 0.04, d]] as const) {
    g.box('fence', x, 0, z, fw, fh, fd, false);
    const n = Math.max(2, Math.round(Math.max(fw, fd) / 3));
    for (let i = 0; i <= n; i++) {
      const t = -0.5 + i / n;
      g.box('dark', x + (fw > fd ? t * fw : 0), 0, z + (fd > fw ? t * fd : 0), 0.06, fh, 0.06, false);
    }
  }
}

/** Playground: piso emborrachado, torre com escorregador e balanço. */
function playground(g: Kit, w: number, d: number) {
  g.box('rubber', 0, 0, 0, w, 0.06, d, false);
  const tx = -w * 0.18;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box('blue', tx + sx * 0.8, 0, sz * 0.8, 0.12, 2.6, 0.12);
  g.box('yellow', tx, 1.3, 0, 1.8, 0.1, 1.8); g.add('red', rotateY(cone(1.4, 1, 4), Math.PI / 4), tx, 3.1, 0);
  g.box('yellow', tx + 1.9, 0.55, 0, 0.6, 0.08, 2.6, false, [0, 0, 0.5]);
  const sw = w * 0.22;
  for (const s of [-1, 1]) g.box('red', sw + s * 1.3, 0, d * 0.15, 0.1, 2.3, 0.1, false, [0.15, 0, 0]);
  g.box('red', sw, 2.3, d * 0.15, 2.8, 0.1, 0.1, false);
  for (const s of [-0.6, 0.6]) g.box('dark', sw + s, 0.45, d * 0.15, 0.45, 0.05, 0.25, false);
}

/** Deque/lounge: piso de madeira, espreguiçadeiras e guarda-sóis. */
function deck(g: Kit, w: number, d: number) {
  g.box('deck', 0, 0, 0, w, 0.12, d, false);
  const n = Math.max(2, Math.floor(w / 3));
  for (let i = 0; i < n; i++) { const x = -w / 2 + (w / n) * (i + 0.5); lounger(g, x, d * 0.15, 0); if (i % 2 === 0) umbrella(g, x + 0.9, -d * 0.2); }
}

function bikes(g: Kit, w: number, d: number) {
  for (const sx of [-1, 1]) g.box('dark', sx * (w / 2 - 0.1), 0, -d / 2 + 0.1, 0.08, 2.4, 0.08, false);
  g.box('roof', 0, 2.3, 0, w, 0.08, d + 0.3, true, [-0.08, 0, 0]);
  for (let i = 0; i < Math.max(2, Math.round(w / 0.8)); i++) g.box('dark', -w / 2 + 0.4 + i * 0.8, 0, 0, 0.04, 0.8, 1.6, false);
}

export function buildAmenities(scene: Scene, parent: TransformNode, art: HTMLCanvasElement, lot: Point[], amenities: Amenity[], metersPerPixel: number, origin: Point, toSite: (p: Point) => Point, level: number) {
  const group = new TransformNode('amenities', scene); group.parent = parent;
  const materials = new Map<string, PBRMaterial>();
  const material = (m: Mat) => {
    const key = typeof m === 'string' ? m : m.toHexString();
    if (!materials.has(key)) materials.set(key, pbr(scene, `amenity-${key}`, { roughness: 0.85, ...(typeof m === 'string' ? materialSpec[m] : { color: m }) }));
    return materials.get(key)!;
  };
  const ctx = art.getContext('2d', { willReadFrequently: true })!;
  const { data, width, height } = ctx.getImageData(0, 0, art.width, art.height);
  // Só o que está dentro do lote conta (o fundo da arte costuma ser azul, como água).
  const mask = document.createElement('canvas'); mask.width = width; mask.height = height;
  const mctx = mask.getContext('2d', { willReadFrequently: true })!;
  mctx.beginPath(); lot.forEach(([x, y], i) => (i ? mctx.lineTo(x, y) : mctx.moveTo(x, y))); mctx.closePath(); mctx.fill();
  const inside = mctx.getImageData(0, 0, width, height).data;
  const inLot = (x: number, y: number) => inside[(y * width + x) * 4 + 3] > 127;
  for (const amenity of amenities) {
    if (!amenity.position) continue;
    const kind = kindOf(amenity.name);
    const marker: Point = [amenity.position.x / metersPerPixel + origin[0], amenity.position.z / metersPerPixel + origin[1]];
    const fp = findFootprint(data, width, height, marker, kind, metersPerPixel, inLot);
    const [cx, cz] = toSite([fp.x, fp.y]);
    const node = new TransformNode(amenity.name, scene); node.parent = group; node.position.set(cx, level, cz);
    const g = new Kit();
    const w = fp.w; const d = fp.h;
    switch (kind) {
      case 'pool': {
        const water = fp.water ? (() => { const [wx, wz] = toSite([fp.water!.x, fp.water!.y]); return { dx: wx - cx, dz: wz - cz, w: fp.water!.w, d: fp.water!.h }; })() : null;
        pool(g, w, d, water); break;
      }
      case 'court': court(g, w, d, fp.color, false); break;
      case 'beach': court(g, w, d, fp.color, true); break;
      case 'kiosk': kiosk(g, Math.min(w, 9), Math.min(d, 7)); break;
      case 'playground': playground(g, w, d); break;
      case 'deck': deck(g, w, d); break;
      case 'bikes': bikes(g, w, d); break;
      case 'small': building(g, w, d, 2.8); break;
      default: building(g, w, d, 3.4);
    }
    for (const [key, part] of g.parts) {
      const mesh = shadows(meshFrom(`${amenity.name}-${key}`, merge(part.geos), scene, material(part.material), node), part.cast, true);
      if (part.material === 'fence') mesh.alphaIndex = 2;
    }
  }
  return group;
}