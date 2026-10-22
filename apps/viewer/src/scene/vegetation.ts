import { Color3, TransformNode, type Matrix, type Scene } from './babylon';
import type { Point } from '../types';
import { compose, cylinder, hsl, instanced, pbr, shadows, translate } from './geometry';
import { crownGeometry } from './trees';
import { roadWidth } from './urban-geometry';

/** Vias que recebem arborização de calçada (as expressas e de serviço ficam sem). */
const streetKinds = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street']);
/** Até onde as árvores lançam sombra: além disso a sombra mal aparece e só custa desenho no mapa de sombra. */
const shadowRadius = 420;

interface Road { kind: string; points: Point[] }
export interface VegetationInput {
  roads: Road[];
  /** Contornos ocupados (casas ilustrativas e edificações do OSM): nenhuma árvore em cima. */
  footprints: Point[][];
  /** Lote do empreendimento (vegetação própria, fora daqui). */
  exclusion: Point[];
  /** Ponto em cima de uma via ou perto demais dela (com a folga dada). */
  onRoad: (p: Point, clearance: number) => boolean;
  radius: number;
  random: () => number;
  /** Teto de árvores (pelo nível de qualidade): as de calçada entram primeiro, os maciços completam. */
  maxTrees: number;
}

function inside([x, z]: Point, polygon: Point[]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]; const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** Grade de ocupação (células de 3 m) a partir das caixas dos contornos, com uma margem. */
function occupancy(footprints: Point[][], margin: number) {
  const size = 3, cells = new Set<string>();
  for (const shape of footprints) {
    const xs = shape.map((p) => p[0]), zs = shape.map((p) => p[1]);
    for (let x = Math.floor((Math.min(...xs) - margin) / size); x <= Math.floor((Math.max(...xs) + margin) / size); x++)
      for (let z = Math.floor((Math.min(...zs) - margin) / size); z <= Math.floor((Math.max(...zs) + margin) / size); z++) cells.add(`${x}:${z}`);
  }
  return (p: Point) => cells.has(`${Math.floor(p[0] / size)}:${Math.floor(p[1] / size)}`);
}

/**
 * Arborização do entorno a partir do OSM: árvores de calçada ao longo das ruas e maciços nos terrenos vazios,
 * fora das vias, das casas, das edificações e do lote. Copas de poucos triângulos (milhares de instâncias), com
 * cor, tamanho e giro variados; só as próximas do empreendimento projetam sombra.
 */
export function buildVegetation(scene: Scene, parent: TransformNode, input: VegetationInput) {
  const { roads, exclusion, onRoad, radius, random, maxTrees } = input;
  const occupied = occupancy(input.footprints, 0.5);
  const points: [number, number, number][] = [];
  const free = (p: Point, clearance: number) => Math.hypot(p[0], p[1]) < radius * 1.25 && !occupied(p) && !inside(p, exclusion) && !onRoad(p, clearance);

  // Calçadas: uma árvore a cada 11–19 m dos dois lados, no passeio junto ao meio-fio (só não pode cair no asfalto
  // de outra via, por isso a folga é pequena).
  for (const road of roads) {
    if (!streetKinds.has(road.kind)) continue;
    const offset = (roadWidth[road.kind] ?? 8) / 2 + 1.7;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 8) continue;
      const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      for (const side of [-1, 1]) for (let d = 4 + random() * 6; d < len - 4; d += 11 + random() * 8) {
        if (random() < 0.3) continue; // falhas na fileira, como nas ruas de verdade
        const p: Point = [a[0] + dx * d - dz * offset * side, a[1] + dz * d + dx * offset * side];
        const size = 2.2 + random() * 1.6;
        if (free(p, 0.4)) points.push([p[0], p[1], size]);
      }
    }
  }

  // Terrenos vazios: maciços de 4 a 16 árvores em volta de centros sorteados no disco do entorno, mais densos perto
  // do empreendimento (raio sorteado linear, não pela área), que é o que aparece nas vistas.
  const centers = Math.round((Math.PI * radius * radius) / 5200);
  for (let c = 0; c < centers && points.length < maxTrees; c++) {
    const r = radius * 1.2 * random(), t = random() * Math.PI * 2;
    const center: Point = [Math.cos(t) * r, Math.sin(t) * r];
    if (!free(center, 6)) continue;
    const count = 4 + Math.floor(random() * 13), spread = 7 + random() * 14;
    for (let k = 0; k < count; k++) {
      const a = random() * Math.PI * 2, s = spread * Math.sqrt(random());
      const p: Point = [center[0] + Math.cos(a) * s, center[1] + Math.sin(a) * s];
      const size = 2.6 + random() * 2.8;
      if (free(p, size * 0.6 + 0.8)) points.push([p[0], p[1], size]);
    }
  }

  const group = new TransformNode('vegetation', scene); group.parent = parent;
  const near: [number, number, number][] = [], far: [number, number, number][] = [];
  for (const p of points.slice(0, maxTrees)) (Math.hypot(p[0], p[1]) < shadowRadius ? near : far).push(p);
  // Perto do empreendimento (vistas baixas) a copa arredondada; longe, a de poucos triângulos, que não se nota.
  const crowns = { near: crownGeometry(1), far: crownGeometry(0) }, trunk = translate(cylinder(0.12, 0.2, 1, 5), 0, 0.5, 0);
  const crownMaterial = pbr(scene, 'vegetation-crown', { color: 0xffffff, roughness: 0.92 });
  const trunkMaterial = pbr(scene, 'vegetation-trunk', { color: 0x6a5240, roughness: 1 });
  for (const [name, list, cast] of [['near', near, true], ['far', far, false]] as const) {
    if (!list.length) continue;
    const trunks: Matrix[] = [], matrices: Matrix[] = [], colors: Color3[] = [];
    for (const [x, z, size] of list) {
      const height = size * 0.75, spin = random() * Math.PI * 2;
      trunks.push(compose(x, 0, z, 0, spin, 0, size * 0.45, height, size * 0.45));
      const s = size * (0.95 + random() * 0.25);
      matrices.push(compose(x, height + s * 0.55, z, (random() - 0.5) * 0.2, spin, (random() - 0.5) * 0.2, s, s * (0.8 + random() * 0.25), s));
      // Verdes de cerrado urbano: do oliva seco ao verde-escuro de mangueira e oiti.
      colors.push(hsl(0.2 + random() * 0.1, 0.32 + random() * 0.2, 0.22 + random() * 0.1));
    }
    shadows(instanced(`vegetation-trunks-${name}`, trunk, scene, trunkMaterial, trunks, group), cast, false);
    shadows(instanced(`vegetation-crowns-${name}`, crowns[name], scene, crownMaterial, matrices, group, colors), cast, true);
  }
  return { group, count: near.length + far.length };
}
