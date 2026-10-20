import { BadRequestException } from '@nestjs/common';

/**
 * Planta vetorizada, em metros, com origem no canto superior esquerdo da imagem da planta
 * (x para a direita, y para baixo). É a base da planta 3D mobiliada do visualizador.
 */
export type Vec = [number, number];
export const roomKinds = ['living', 'kitchen', 'bedroom', 'suite', 'bathroom', 'balcony', 'service', 'hall', 'garden'] as const;
export const openingKinds = ['door', 'window', 'sliding'] as const;
export type RoomKind = (typeof roomKinds)[number];
export type OpeningKind = (typeof openingKinds)[number];

export interface PlanWall { id: string; a: Vec; b: Vec; thickness: number }
export interface PlanOpening { id: string; wallId: string; offset: number; width: number; kind: OpeningKind; sill?: number; height?: number }
export interface PlanRoom { id: string; name: string; kind: RoomKind; points: Vec[] }
export interface PlanLayout {
  version: 1;
  imageAssetId?: string;
  /** Escala da imagem usada para vetorizar (pixels por metro). */
  pxPerMeter?: number;
  wallHeight: number;
  walls: PlanWall[];
  openings: PlanOpening[];
  rooms: PlanRoom[];
}

const limits = { walls: 400, openings: 200, rooms: 60, points: 64, size: 60 };

function fail(message: string): never { throw new BadRequestException(`Planta vetorizada inválida: ${message}`); }
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function num(v: unknown, what: string, min: number, max: number) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${what} deve ser um número entre ${min} e ${max}`);
  return Math.round(v * 1000) / 1000;
}
function text(v: unknown, what: string, max: number) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) fail(`${what} é obrigatório (até ${max} caracteres)`);
  return v.trim();
}
const point = (v: unknown, what: string): Vec => {
  if (!Array.isArray(v) || v.length !== 2) fail(`${what} deve ser [x, y]`);
  return [num(v[0], what, 0, limits.size), num(v[1], what, 0, limits.size)];
};
function list(v: unknown, what: string, max: number) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) fail(`${what} deve ser uma lista com até ${max} itens`);
  return v as unknown[];
}

/** Valida e normaliza a planta vetorizada enviada pelo editor. */
export function parsePlanLayout(input: unknown): PlanLayout {
  if (!isObject(input)) fail('formato esperado é um objeto');
  const ids = new Set<string>();
  const id = (v: unknown, what: string) => { const value = text(v, `${what}.id`, 40); if (ids.has(value)) fail(`id repetido: ${value}`); ids.add(value); return value; };

  const walls = list(input.walls, 'walls', limits.walls).map((raw, i): PlanWall => {
    if (!isObject(raw)) fail(`parede ${i + 1}`);
    const wall = { id: id(raw.id, 'parede'), a: point(raw.a, 'parede.a'), b: point(raw.b, 'parede.b'), thickness: num(raw.thickness ?? 0.15, 'espessura da parede', 0.05, 0.6) };
    if (Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) < 0.1) fail(`parede ${i + 1} curta demais`);
    return wall;
  });
  const wallLength = new Map(walls.map((w) => [w.id, Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])]));

  const openings = list(input.openings, 'openings', limits.openings).map((raw, i): PlanOpening => {
    if (!isObject(raw)) fail(`abertura ${i + 1}`);
    const kind = raw.kind as OpeningKind;
    if (!openingKinds.includes(kind)) fail(`tipo da abertura ${i + 1}`);
    const wallId = text(raw.wallId, 'abertura.wallId', 40);
    const length = wallLength.get(wallId) ?? fail(`abertura ${i + 1} aponta para parede inexistente`);
    const width = num(raw.width, 'largura da abertura', 0.3, 6);
    const offset = num(raw.offset, 'posição da abertura', 0, length);
    if (offset - width / 2 < -0.01 || offset + width / 2 > length + 0.01) fail(`abertura ${i + 1} não cabe na parede`);
    const opening: PlanOpening = { id: id(raw.id, 'abertura'), wallId, offset, width, kind };
    if (raw.sill !== undefined) opening.sill = num(raw.sill, 'peitoril', 0, 2);
    if (raw.height !== undefined) opening.height = num(raw.height, 'altura da abertura', 0.3, 3);
    return opening;
  });

  const rooms = list(input.rooms, 'rooms', limits.rooms).map((raw, i): PlanRoom => {
    if (!isObject(raw)) fail(`cômodo ${i + 1}`);
    const kind = raw.kind as RoomKind;
    if (!roomKinds.includes(kind)) fail(`tipo do cômodo ${i + 1}`);
    const points = list(raw.points, 'pontos do cômodo', limits.points).map((p) => point(p, 'ponto do cômodo'));
    if (points.length < 3) fail(`cômodo ${i + 1} precisa de ao menos 3 pontos`);
    return { id: id(raw.id, 'cômodo'), name: text(raw.name, 'nome do cômodo', 60), kind, points };
  });

  const layout: PlanLayout = { version: 1, wallHeight: num(input.wallHeight ?? 2.6, 'pé-direito', 2.2, 4), walls, openings, rooms };
  if (input.imageAssetId !== undefined && input.imageAssetId !== null) layout.imageAssetId = text(input.imageAssetId, 'imagem', 40);
  if (input.pxPerMeter !== undefined && input.pxPerMeter !== null) layout.pxPerMeter = num(input.pxPerMeter, 'escala', 1, 2000);
  return layout;
}
