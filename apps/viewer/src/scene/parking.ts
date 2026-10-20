import type { DetectedCar } from './lot-relief';

/** Vaga de estacionamento em pixels da arte: centro e ângulo do eixo longo (direção do carro). */
export interface Stall { x: number; y: number; angle: number }

const stallWidth = 2.5; // metros, ao longo da fileira
export const stallLength = 5;

/**
 * Organiza os carros encontrados na arte em fileiras de estacionamento:
 * carros paralelos, com a frente alinhada e próximos lado a lado formam uma fileira.
 * Cada fileira ganha um ângulo único, os carros são alinhados às vagas (passo de 2,5 m)
 * e as vagas vazias entre eles também são criadas. Serve para qualquer implantação.
 */
export function planParking(detected: DetectedCar[], metersPerPixel: number) {
  const m = 1 / metersPerPixel; // pixels por metro
  // Estacionamentos seguem dois eixos perpendiculares: o ângulo dominante (média de 4θ) corrige carros tortos.
  let qx = 0, qy = 0;
  for (const car of detected) { qx += Math.cos(4 * car.angle); qy += Math.sin(4 * car.angle); }
  const axis = Math.atan2(qy, qx) / 4;
  const cars = detected.map((car) => {
    const k = Math.round((car.angle - axis) / (Math.PI / 2)); const snapped = axis + k * (Math.PI / 2);
    return { ...car, angle: snapped };
  });
  // Carro vizinho lado a lado (2 a 3,4 m) define a orientação: o carro fica perpendicular à linha entre os dois.
  // Corrige manchas quase quadradas (carro + sombra) que saíram deitadas na fileira.
  for (let i = 0; i < cars.length; i++) {
    let best = -1; let bestD = Infinity;
    for (let j = 0; j < cars.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(cars[j].x - cars[i].x, cars[j].y - cars[i].y);
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best < 0 || bestD < 1.8 * m || bestD > 3.9 * m) continue;
    const across = Math.atan2(cars[best].y - cars[i].y, cars[best].x - cars[i].x) + Math.PI / 2;
    const k = Math.round((across - axis) / (Math.PI / 2));
    cars[i] = { ...cars[i], angle: axis + k * (Math.PI / 2) };
  }
  const parent = cars.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const axial = (a: number, b: number) => { const d = Math.abs(((a - b) % Math.PI) + Math.PI) % Math.PI; return Math.min(d, Math.PI - d); };
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i]; const b = cars[j];
    if (axial(a.angle, b.angle) > 0.3) continue;
    const ux = Math.cos(a.angle); const uy = Math.sin(a.angle);
    const dx = b.x - a.x; const dy = b.y - a.y;
    const along = dx * ux + dy * uy; const across = -dx * uy + dy * ux;
    if (Math.abs(along) < 1.3 * m && Math.abs(across) < 9 * m) parent[find(i)] = find(j);
  }
  const rows = new Map<number, number[]>();
  cars.forEach((_, i) => { const r = find(i); rows.set(r, [...(rows.get(r) ?? []), i]); });

  const placed: DetectedCar[] = []; const stalls: Stall[] = [];
  for (const members of rows.values()) {
    // Ângulo médio axial (2θ) da fileira.
    let sx = 0, sy = 0;
    for (const i of members) { sx += Math.cos(2 * cars[i].angle); sy += Math.sin(2 * cars[i].angle); }
    const angle = Math.atan2(sy, sx) / 2;
    const ux = Math.cos(angle), uy = Math.sin(angle); const vx = -uy, vy = ux;
    const origin = cars[members[0]];
    const coords = members.map((i) => ({ i, t: (cars[i].x - origin.x) * ux + (cars[i].y - origin.y) * uy, s: (cars[i].x - origin.x) * vx + (cars[i].y - origin.y) * vy }));
    const ts = coords.map((c) => c.t).sort((a, b) => a - b); const t0 = ts[Math.floor(ts.length / 2)];
    const pitch = stallWidth * m;
    const s0 = Math.min(...coords.map((c) => c.s));
    // Fase da grade: média dos restos, para errar o mínimo ao encaixar os carros.
    let px = 0, py = 0;
    for (const c of coords) { const phase = (((c.s - s0) / pitch) % 1) * Math.PI * 2; px += Math.cos(phase); py += Math.sin(phase); }
    const shift = (Math.atan2(py, px) / (Math.PI * 2)) * pitch;
    const slotOf = (s: number) => Math.round((s - s0 - shift) / pitch);
    const point = (slot: number) => ({ x: origin.x + ux * t0 + vx * (s0 + shift + slot * pitch), y: origin.y + uy * t0 + vy * (s0 + shift + slot * pitch) });
    const taken = new Set<number>();
    for (const c of coords) {
      const slot = slotOf(c.s); if (taken.has(slot)) continue;
      taken.add(slot);
      placed.push({ ...cars[c.i], ...point(slot), angle });
    }
    const slots = [...taken]; const first = Math.min(...slots); const last = Math.max(...slots);
    for (let slot = first; slot <= last; slot++) stalls.push({ ...point(slot), angle });
  }
  return { cars: placed, stalls, stallWidth, stallLength };
}

/** Desenha os retângulos das vagas (em pixels da arte, deslocados por x0/y0) num contexto 2D. */
export function traceStalls(ctx: CanvasRenderingContext2D, stalls: Stall[], metersPerPixel: number, x0 = 0, y0 = 0, scale = 1, margin = 0) {
  const m = scale / metersPerPixel;
  for (const stall of stalls) {
    ctx.save();
    ctx.translate((stall.x - x0) * scale, (stall.y - y0) * scale); ctx.rotate(stall.angle);
    ctx.fillRect(-(stallLength / 2 + margin) * m, -(stallWidth / 2 + margin) * m, (stallLength + margin * 2) * m, (stallWidth + margin * 2) * m);
    ctx.restore();
  }
}
