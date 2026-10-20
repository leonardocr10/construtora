import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import { asphaltLevel, curbHeight } from './ground';
import { curbFaces, partsToGeo, type VectorGround } from './ground-vector';
import type { GroundPolygon, Point } from '../types';

/**
 * Chão do lote a partir dos polígonos desenhados no painel, com as bordas exatas deles (retas e cantos vivos):
 * cada polígono, recortado pelo lote, entra na sua classe e sai das demais (o último da lista vence). O chão
 * elevado (grama, piso, arte) leva meio-fio em todo o contorno; o asfalto é o polígono do lote, feito fora daqui.
 * Diferente da dedução pela cor, as classes não se sobrepõem: "raised" aqui é só o piso.
 */
export function buildPlanGround(lot: Point[], polygons: GroundPolygon[], toSite: (p: Point) => Point): VectorGround {
  const ring = (points: Point[]): Polygon => [points.map(([x, y]) => [x, y] as [number, number])];
  const lotShape: MultiPolygon = [ring(lot)];
  const regions: Record<GroundPolygon['kind'], MultiPolygon> = { asphalt: lotShape, grass: [], paving: [], art: [] };
  for (const g of polygons) {
    if (g.points.length < 3) continue;
    const shape = polygonClipping.intersection(ring(g.points), lotShape);
    if (!shape.length) continue;
    for (const kind of Object.keys(regions) as GroundPolygon['kind'][]) {
      if (kind === g.kind) regions[kind] = polygonClipping.union(regions[kind], shape);
      else if (regions[kind].length) regions[kind] = polygonClipping.difference(regions[kind], shape);
    }
  }
  // Anéis do polygon-clipping vêm fechados (o primeiro ponto repetido no fim).
  const open = (r: [number, number][]) => r.slice(0, -1) as Point[];
  const parts = (m: MultiPolygon) => m.map(([outer, ...holes]) => ({ outer: open(outer), holes: holes.map(open) }));
  const raised = polygonClipping.union([], regions.grass, regions.paving, regions.art);
  const level = asphaltLevel + curbHeight;
  // Regiões exatas e sem sobreposição: cada classe na mesma cota, encostada nas vizinhas (sem z-fighting).
  return {
    raised: partsToGeo(parts(regions.paving), level, toSite) ?? { positions: [], indices: [], uvs: [] },
    grass: partsToGeo(parts(regions.grass), level, toSite),
    other: partsToGeo(parts(regions.art), level, toSite),
    curbs: curbFaces(raised.flatMap((polygon) => polygon.map((r) => open(r).map(toSite)))),
  };
}
