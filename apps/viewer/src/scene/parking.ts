import type { Color3 } from './babylon';
import type { GroundMap } from './ground';
import { asphaltAt, carColor, fleetColor, groundAt, type DetectedCar } from './lot-relief';

/** Carro parado numa vaga: cor, modelo (0 hatch, 1 sedã, 2 SUV) e se entrou de ré (frente para o corredor). */
export interface ParkedCar { color: Color3; kind: number; reversed: boolean }

/**
 * Vaga em pixels da arte: centro, ângulo do eixo longo (direção do carro) e, quando há meio-fio,
 * o lado dele (+1 ou −1 ao longo do eixo do carro). `car` vem preenchido quando a arte mostra a vaga ocupada.
 */
export interface Stall { x: number; y: number; angle: number; curb: number; width: number; car?: ParkedCar }

export const stallWidth = 2.5; // metros, ao longo da fileira
export const stallLength = 5;

const Asphalt = 1, Grass = 2, Paving = 3, Outside = 0;
/** Pseudoaleatório estável por posição (mesma cena a cada carga). */
const hash = (x: number, y: number) => { const t = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return t - Math.floor(t); };

/**
 * Monta as fileiras de vagas do estacionamento, para qualquer implantação:
 * 1. os carros encontrados na arte dão o eixo do estacionamento e as fileiras (carros paralelos lado a lado);
 * 2. cada fileira é encostada no meio-fio mais próximo (vaga de 5 m a partir dele), quando existe;
 * 3. a fileira é completada entre os carros e estendida nas duas pontas enquanto o chão for asfalto
 *    e o meio-fio continuar atrás, no passo de 2,5 m;
 * 4. cada vaga é ocupada ou não conforme a arte original (mancha de carro dentro dela), com a cor desenhada.
 * `art` é a imagem original (antes de apagar os carros), `map` o chão já classificado.
 */
export function planParking(detected: DetectedCar[], map: GroundMap, art: ImageData, metersPerPixel: number) {
  const m = 1 / metersPerPixel;
  const cls = (x: number, y: number) => {
    const gx = Math.round(x) - map.x0, gy = Math.round(y) - map.y0;
    return gx < 0 || gy < 0 || gx >= map.w || gy >= map.h ? Outside : map.classes[gy * map.w + gx];
  };
  // Fundo de vaga pintado em bege quente na arte conta como estacionamento; cinza claro neutro é calçada.
  const { data, width } = art;
  const onPlaza = (x: number, y: number) => { const gx = Math.round(x) - map.x0, gy = Math.round(y) - map.y0; return !!map.plaza && gx >= 0 && gy >= 0 && gx < map.w && gy < map.h && map.plaza[gy * map.w + gx] === 1; };
  const drivable = (x: number, y: number) => {
    if (onPlaza(x, y)) return false;
    const k = cls(x, y); if (k === Asphalt) return true; if (k !== Paving) return false;
    const i = (Math.round(y) * width + Math.round(x)) * 4; const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    return lum > 150 && lum < 220 && r - b >= 18;
  };
  if (!detected.length) return { stalls: [] as Stall[] };

  // Estacionamentos seguem dois eixos perpendiculares: ângulo dominante pela média de 4θ.
  let qx = 0, qy = 0;
  for (const car of detected) { qx += Math.cos(4 * car.angle); qy += Math.sin(4 * car.angle); }
  const axis = Math.atan2(qy, qx) / 4;
  const snap = (a: number) => axis + Math.round((a - axis) / (Math.PI / 2)) * (Math.PI / 2);
  // Orientação de cada carro pela própria arte: a faixa de 4 × 1 m ao longo do carro é quase toda carro;
  // atravessada, pega o vão entre ele e os vizinhos. Mais firme que o formato da mancha (carro + sombra).
  const solid = (x: number, y: number) => { const i = (Math.round(y) * width + Math.round(x)) * 4; return !asphaltAt(data, i) && !groundAt(data, i); };
  const fill = (car: DetectedCar, angle: number) => {
    const ux = Math.cos(angle), uy = Math.sin(angle); let hit = 0, n = 0;
    for (let a = -2; a <= 2.001; a += 0.2) for (let c = -0.5; c <= 0.501; c += 0.25) { n++; if (solid(car.x + (ux * a - uy * c) * m, car.y + (uy * a + ux * c) * m)) hit++; }
    return hit / n;
  };
  const cars = detected.map((car) => {
    const a = snap(car.angle), b = a + Math.PI / 2;
    return { ...car, angle: fill(car, b) > fill(car, a) + 0.08 ? b : a };
  });
  // Fileiras: carros paralelos com a frente alinhada (±1,3 m) e a menos de 6,5 m um do outro.
  const parent = cars.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const parallel = (a: number, b: number) => Math.abs(Math.sin(a - b)) < 0.3;
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if (!parallel(a.angle, b.angle)) continue;
    const ux = Math.cos(a.angle), uy = Math.sin(a.angle); const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx * ux + dy * uy) < 1.3 * m && Math.abs(-dx * uy + dy * ux) < 6.5 * m) parent[find(i)] = find(j);
  }
  const rows = new Map<number, number[]>();
  cars.forEach((_, i) => { const r = find(i); rows.set(r, [...(rows.get(r) ?? []), i]); });

  // Largura da vaga da arte (2,1 a 2,8 m): o passo que melhor explica a distância entre carros da mesma fileira.
  const gaps: number[] = [];
  for (const members of rows.values()) {
    if (members.length < 2) continue;
    const a = cars[members[0]].angle; const vx = -Math.sin(a), vy = Math.cos(a);
    const s = members.map((i) => (cars[i].x * vx + cars[i].y * vy) * metersPerPixel).sort((p, q) => p - q);
    for (let k = 1; k < s.length; k++) if (s[k] - s[k - 1] > 1.6 && s[k] - s[k - 1] < 12) gaps.push(s[k] - s[k - 1]);
  }
  let width0 = stallWidth; let bestScore = Infinity;
  if (gaps.length >= 6) for (let p = 2.1; p <= 2.8; p += 0.01) {
    let score = 0;
    for (const g of gaps) { const r = g / p; score += (r - Math.round(r)) ** 2; }
    // Leve preferência pelos 2,5 m usuais, para não cair num passo menor só porque mais múltiplos cabem.
    score = score / gaps.length + 0.02 * Math.abs(p - stallWidth);
    if (score < bestScore) { bestScore = score; width0 = p; }
  }
  const stalls: Stall[] = [];
  const pitch = width0 * m;
  const taken = (x: number, y: number) => stalls.some((s) => Math.hypot(s.x - x, s.y - y) < 2.1 * m);
  // Fileiras maiores primeiro: elas definem as vagas quando duas fileiras disputam o mesmo trecho.
  const ordered = [...rows.values()].sort((a, b) => b.length - a.length);
  for (const members of ordered) {
    // Ângulo da fileira: o eixo mais votado entre os carros (0 ou 90° em relação ao eixo dominante).
    const votes = [0, 0];
    for (const i of members) votes[Math.round((cars[i].angle - axis) / (Math.PI / 2)) & 1]++;
    const angle = axis + (votes[1] > votes[0] ? Math.PI / 2 : 0);
    const ux = Math.cos(angle), uy = Math.sin(angle); const vx = -uy, vy = ux;
    const origin = cars[members[0]];
    const coords = members.map((i) => ({ t: (cars[i].x - origin.x) * ux + (cars[i].y - origin.y) * uy, s: (cars[i].x - origin.x) * vx + (cars[i].y - origin.y) * vy }));
    const at = (t: number, s: number) => [origin.x + ux * t + vx * s, origin.y + uy * t + vy * s] as const;
    const ts = coords.map((c) => c.t).sort((a, b) => a - b); let t0 = ts[ts.length >> 1];

    // Meio-fio: a partir do centro da fileira, procura chão elevado (ou o muro) ao longo do eixo do carro.
    let curb = 0; let curbT = 0;
    const hits = [1, -1].map((dir) => {
      const found: number[] = [];
      // Três pontos na largura da vaga: o meio-fio é onde a maioria deixa de ser estacionamento.
      for (const c of coords) for (let d = 1.6; d <= 4.6; d += 0.16) {
        let off = 0;
        for (const b of [-0.6, 0, 0.6]) { const [x, y] = at(t0 + dir * d * m, c.s + b * m); if (!drivable(x, y)) off++; }
        if (off >= 2) { found.push(d); break; }
      }
      found.sort((a, b) => a - b);
      return { dir, count: found.length, distance: found[found.length >> 1] ?? Infinity };
    });
    const side = hits.filter((h) => h.count >= Math.max(1, members.length * 0.4)).sort((a, b) => b.count - a.count || a.distance - b.distance)[0];
    if (side) {
      curb = side.dir; curbT = t0 + side.dir * side.distance * m;
      const center = curbT - side.dir * (stallLength / 2 + 0.05) * m;
      if (Math.abs(center - t0) < 2.2 * m) t0 = center; else curb = 0;
    }

    // Fileira pequena sem meio-fio é mais provável ser carro mal lido que fileira de verdade.
    if (!curb && members.length <= 2) continue;

    // Grade de vagas: fase pela média circular dos carros, para errar o mínimo ao encaixar.
    const s0 = Math.min(...coords.map((c) => c.s));
    let px = 0, py = 0;
    for (const c of coords) { const phase = (((c.s - s0) / pitch) % 1) * Math.PI * 2; px += Math.cos(phase); py += Math.sin(phase); }
    const shift = (Math.atan2(py, px) / (Math.PI * 2)) * pitch;
    const slotS = (slot: number) => s0 + shift + slot * pitch;
    const slots = coords.map((c) => Math.round((c.s - s0 - shift) / pitch));
    const first = Math.min(...slots), last = Math.max(...slots);

    // Vaga válida: quase toda em asfalto, dentro do lote, sem grama, com o meio-fio atrás (quando a fileira tem).
    const fits = (slot: number) => {
      const s = slotS(slot); let asphalt = 0, bad = 0, n = 0;
      for (let a = -0.45; a <= 0.451; a += 0.15) for (let b = -0.4; b <= 0.401; b += 0.2) {
        const [x, y] = at(t0 + a * stallLength * m, s + b * width0 * m); const k = cls(x, y); n++;
        if (drivable(x, y)) asphalt++; else if (k === Outside || k === Grass) bad++;
      }
      if (asphalt / n < 0.6 || bad / n > 0.12) return false;
      if (!curb) return true;
      let behind = 0;
      // Atrás da vaga: calçada, canteiro ou fundo de vaga da fileira de trás; corredor (asfalto) encerra a fileira.
      for (const b of [-0.35, 0, 0.35]) { const [x, y] = at(curbT + curb * 0.3 * m, s + b * width0 * m); if (cls(x, y) !== Asphalt) behind++; }
      return behind >= 2;
    };
    // Vaga com carro na arte, mesmo sem meio-fio atrás: basta não estar em cima de calçada, grama ou fora do lote.
    const onPavement = (slot: number) => {
      const s = slotS(slot); let asphalt = 0, n = 0;
      for (let a = -0.4; a <= 0.401; a += 0.2) for (let b = -0.3; b <= 0.301; b += 0.3) { const [x, y] = at(t0 + a * stallLength * m, s + b * width0 * m); n++; if (drivable(x, y)) asphalt++; }
      return asphalt / n >= 0.55;
    };
    const add = (slot: number) => {
      const [x, y] = at(t0, slotS(slot));
      if (taken(x, y)) return false;
      stalls.push({ x, y, angle, curb, width: width0 });
      return true;
    };
    // Entre o primeiro e o último carro a fileira é contínua onde o chão permite (vaga vazia na arte também é vaga).
    const withCar = new Set(slots);
    for (let slot = first; slot <= last; slot++) if (fits(slot) || (withCar.has(slot) && onPavement(slot))) add(slot);
    // Nas pontas, só fileira encostada em meio-fio cresce: sem ele não há como saber onde a fileira acaba.
    if (curb) {
      for (let slot = first - 1, n = 0; n < 40 && fits(slot); slot--, n++) if (!add(slot)) break;
      for (let slot = last + 1, n = 0; n < 40 && fits(slot); slot++, n++) if (!add(slot)) break;
    }
  }

  // Ocupação pela arte original: mancha que não é asfalto nem chão (carro e sombra) no miolo da vaga.
  for (const stall of stalls) {
    const ux = Math.cos(stall.angle), uy = Math.sin(stall.angle);
    let solid = 0, n = 0, r = 0, g = 0, b = 0, lit = 0;
    for (let a = -2.1; a <= 2.1; a += 0.25) for (let c = -0.8; c <= 0.8; c += 0.2) {
      const x = Math.round(stall.x + (ux * a - uy * c) * m), y = Math.round(stall.y + (uy * a + ux * c) * m);
      if (x < 0 || y < 0 || x >= width || y >= art.height) continue;
      const k = (y * width + x) * 4; n++;
      if (asphaltAt(data, k) || groundAt(data, k)) continue;
      solid++;
      const lum = 0.3 * data[k] + 0.59 * data[k + 1] + 0.11 * data[k + 2];
      if (lum > 58) { r += data[k]; g += data[k + 1]; b += data[k + 2]; lit++; }
    }
    const near = detected.find((car) => Math.hypot(car.x - stall.x, car.y - stall.y) < 1.6 * m);
    if (!near && (!n || solid / n < 0.33)) continue;
    const roll = hash(stall.x, stall.y);
    const color = near ? near.color : lit > solid * 0.3 ? carColor([r / lit, g / lit, b / lit]) : fleetColor(stall.x * 31 + stall.y * 17);
    stall.car = { color, kind: roll < 0.45 ? 0 : roll < 0.75 ? 1 : 2, reversed: hash(stall.y, stall.x) < 0.28 };
  }
  return { stalls };
}

/** Desenha os retângulos das vagas (em pixels da arte, deslocados por x0/y0) num contexto 2D. */
export function traceStalls(ctx: CanvasRenderingContext2D, stalls: Stall[], metersPerPixel: number, x0 = 0, y0 = 0, scale = 1, margin = 0) {
  const m = scale / metersPerPixel;
  for (const stall of stalls) {
    ctx.save();
    ctx.translate((stall.x - x0) * scale, (stall.y - y0) * scale); ctx.rotate(stall.angle);
    ctx.fillRect(-(stallLength / 2 + margin) * m, -(stall.width / 2 + margin) * m, (stallLength + margin * 2) * m, (stall.width + margin * 2) * m);
    ctx.restore();
  }
}
