/** Planta vetorizada em metros (mesmo formato validado pela API em structure/plan-layout.ts). */
export type Vec = [number, number];
export type RoomKind = 'living' | 'kitchen' | 'bedroom' | 'suite' | 'bathroom' | 'balcony' | 'service' | 'hall' | 'garden';
export type OpeningKind = 'door' | 'window' | 'sliding';
export interface PlanWall { id: string; a: Vec; b: Vec; thickness: number }
export interface PlanOpening { id: string; wallId: string; offset: number; width: number; kind: OpeningKind; sill?: number; height?: number }
export interface PlanRoom { id: string; name: string; kind: RoomKind; points: Vec[] }
export interface PlanLayout { version: 1; imageAssetId?: string; pxPerMeter?: number; wallHeight: number; walls: PlanWall[]; openings: PlanOpening[]; rooms: PlanRoom[] }

export const roomKinds: Record<RoomKind, { label: string; color: string }> = {
  living: { label: 'Sala', color: '#f6d38b' }, kitchen: { label: 'Cozinha', color: '#a9d8f5' }, bedroom: { label: 'Quarto', color: '#c7b8f2' },
  suite: { label: 'Suíte', color: '#e4b4e0' }, bathroom: { label: 'Banheiro', color: '#9fe3d4' }, balcony: { label: 'Varanda', color: '#bfe39b' },
  service: { label: 'Área de serviço', color: '#b9d2e8' }, hall: { label: 'Circulação', color: '#e2e6ec' }, garden: { label: 'Garden', color: '#8fd38a' },
};
export const openingKinds: Record<OpeningKind, { label: string; width: number }> = {
  door: { label: 'Porta', width: 0.8 }, window: { label: 'Janela', width: 1.2 }, sliding: { label: 'Porta de correr', width: 2 },
};

/** Sugere o tipo do cômodo pelo nome ("Dormitório 2" → quarto, "WC" → banheiro…). */
export function guessRoomKind(name: string): RoomKind {
  const n = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/suite/.test(n)) return 'suite';
  if (/quarto|dorm/.test(n)) return 'bedroom';
  if (/banh|wc|lavabo/.test(n)) return 'bathroom';
  if (/cozinha/.test(n)) return 'kitchen';
  if (/varanda|sacada|terraco/.test(n)) return 'balcony';
  if (/servico|lavanderia/.test(n)) return 'service';
  if (/garden|quintal|jardim/.test(n)) return 'garden';
  if (/circ|hall|corredor/.test(n)) return 'hall';
  return 'living';
}

export const round = (v: number, step = 0.01) => Math.round(v / step) * step;
export const dist = (a: Vec, b: Vec) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Projeção de p sobre o segmento ab: distância ao longo da parede (t em metros) e distância perpendicular. */
export function project(p: Vec, a: Vec, b: Vec) {
  const len = dist(a, b) || 1e-9;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const t = Math.max(0, Math.min(len, (p[0] - a[0]) * ux + (p[1] - a[1]) * uy));
  const q: Vec = [a[0] + ux * t, a[1] + uy * t];
  return { t, len, distance: dist(p, q), point: q };
}

export function polygonArea(points: Vec[]) {
  let s = 0;
  for (let i = 0; i < points.length; i++) { const [x1, y1] = points[i]; const [x2, y2] = points[(i + 1) % points.length]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}
export function centroid(points: Vec[]): Vec {
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
}
