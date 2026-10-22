import { Texture, TransformNode, Vector3, DynamicTexture, type Color3, type Matrix, type Scene } from './babylon';
import type { Point, Surroundings } from '../types';
import { asphaltTile, grassTile, pavingTile } from './ground';
import { crownGeometry } from './trees';
import { box, compose, extrude, instanced, merge, meshFrom, pbr, plane, polygon, rgb, rotateX, shadows, translate, type Geo } from './geometry';
import {buildContextBuildings} from './context-buildings';
import {buildVegetation} from './vegetation';
import type {Library} from './library';
import {partsToGeo} from './ground-vector';
import {buildRoadNetwork,placeHouses,roadWidth} from './urban-geometry';
import clipping,{type MultiPolygon} from 'polygon-clipping';

const labeledRoads = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const maxRoadLabels = 8;
const toGeo=(shape:MultiPolygon,y:number)=>partsToGeo(shape.map(p=>({outer:p[0] as Point[],holes:p.slice(1) as Point[][]})),y,p=>p);

/** Textura repetida a cada `meters` metros (UV da faixa em metros). */
function tiled(scene: Scene, name: string, canvas: HTMLCanvasElement, meters: number) {
  const texture = new DynamicTexture(name, canvas, scene, true);
  texture.update(true);
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = texture.vScale = 1 / meters; texture.anisotropicFilteringLevel = 8;
  return texture;
}

function canvas2d(width: number, height: number) {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  return { canvas, ctx: canvas.getContext('2d')! };
}

/**
 * Chão da cidade visto do alto, sem emenda (terrenos e quintais): capim de cerrado urbano, do verde-oliva ao
 * palha seco, com manchas de terra avermelhada. Antes era um verde-menta claro e uniforme que lavava a cena.
 */
function cityGroundTile(size: number) {
  const { canvas, ctx } = canvas2d(size, size);
  const random = seeded(7);
  ctx.fillStyle = '#8e9a68'; ctx.fillRect(0, 0, size, size);
  const blobs: [string, number][] = [['rgba(176,160,104,0.16)', 26], ['rgba(96,126,66,0.15)', 30], ['rgba(150,108,76,0.08)', 10], ['rgba(204,196,150,0.08)', 14], ['rgba(74,104,56,0.1)', 18]];
  for (const [color, count] of blobs) for (let i = 0; i < count; i++) {
    const x = random() * size, y = random() * size, r = size * (0.05 + random() * 0.16);
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  for (let i = 0; i < size * size * 0.04; i++) { const l = 140 + random() * 70; ctx.fillStyle = `rgba(${l},${l - 4},${l - 30},0.18)`; ctx.fillRect(random() * size, random() * size, 1.5, 1.5); }
  return canvas;
}

/** Fachada de casa (cada face da caixa recebe a imagem inteira): reboco claro tingido pela cor da casa, rodapé, porta e janelas. */
function houseWallTexture(scene: Scene,front=true) {
  const { canvas, ctx } = canvas2d(256, 128);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#d9d4cc'; ctx.fillRect(0, 112, 256, 16); // rodapé
  const pane = (x: number, w: number) => {
    ctx.fillStyle = '#f4f4f2'; ctx.fillRect(x - 3, 38, w + 6, 46); // moldura
    ctx.fillStyle = '#3d4a56'; ctx.fillRect(x, 41, w, 40);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 2, 43, w / 2 - 3, 36);
    ctx.fillStyle = '#e8e6e0'; ctx.fillRect(x + w / 2 - 1, 41, 2, 40);
  };
  pane(24, 44); pane(176, 52);
  if(front){
    ctx.fillStyle = '#55615e'; ctx.fillRect(108, 46, 34, 66);
    ctx.fillStyle = '#697470'; ctx.fillRect(112, 50, 26, 58);
    ctx.fillStyle = '#d8d9d6'; ctx.fillRect(133,78,3,2);
  }else pane(106,38);
  const texture = new DynamicTexture(front?'house-front':'house-side', canvas, scene, true);
  texture.update(true); texture.anisotropicFilteringLevel = 4;
  return texture;
}

/** Telhado: fiadas de telha (linhas na altura do cone) sobre a cor da instância. */
function roofTexture(scene: Scene) {
  const { canvas, ctx } = canvas2d(64, 64);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 6) { ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(0, y, 64, 1.5); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, y + 2, 64, 1); }
  const texture = new DynamicTexture('house-roof', canvas, scene, true);
  texture.update(true); texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE; texture.vScale = 2;
  return texture;
}

function insidePolygon([x, z]: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]; const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Índice espacial simples de segmentos de rua para evitar casas sobre as vias. */
class SegmentGrid {
  private readonly cells = new Map<string, [Point, Point, number][]>();
  constructor(private readonly size = 40) {}
  private key(x: number, z: number) { return `${Math.floor(x / this.size)}:${Math.floor(z / this.size)}`; }
  add(a: Point, b: Point, halfWidth: number) {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (this.size / 2)) + 1;
    const keys = new Set<string>();
    for (let s = 0; s <= steps; s++) { const t = s / steps; keys.add(this.key(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)); }
    for (const k of keys) { if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k)!.push([a, b, halfWidth]); }
  }
  near([x, z]: Point, clearance: number) {
    const cx = Math.floor(x / this.size); const cz = Math.floor(z / this.size);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const [a, b, half] of this.cells.get(`${cx + i}:${cz + j}`) ?? []) {
        const dx = b[0] - a[0]; const dz = b[1] - a[1]; const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
        if (Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz)) < half + clearance) return true;
      }
    }
    return false;
  }
}

function seeded(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

export interface SurroundingsResult { group: TransformNode; illustrativeHouses: number; roadLabels: { name: string; position: Vector3 }[];ready:Promise<unknown> }

/**
 * Entorno real a partir do OpenStreetMap: ruas, áreas verdes, água e edificações mapeadas.
 * Onde o OSM não tem casas, gera casas ilustrativas ao longo das ruas residenciais.
 */
export function buildSurroundings(scene: Scene, data: Surroundings, exclusion: Point[], maxTrees = 6000, detail?:{library:Library;contains:(p:Point)=>boolean}): SurroundingsResult {
  const group = new TransformNode('surroundings', scene);
  const random = seeded(42);
  const flat = (name: string, geo: Geo, material: ReturnType<typeof pbr>) => shadows(meshFrom(name, geo, scene, material, group), false);

  const disc = Array.from({ length: 64 }, (_, i) => { const t = (i / 64) * Math.PI * 2; return [Math.cos(t) * data.radius * 2.6, Math.sin(t) * data.radius * 2.6] as Point; });
  flat('city-ground', polygon(disc, -0.05), pbr(scene, 'city-ground', { map: tiled(scene, 'city-ground', cityGroundTile(1024), 80), roughness: 1 }));

  // Uma unica topologia: as calcadas sao a diferenca, nao faixas brancas sobre os cruzamentos.
  const network=buildRoadNetwork(data.roads,exclusion,data.buildings.map(b=>b.points));

  const greens = data.green.filter((g) => g.points.length > 3).map((g) => toGeo(clipping.difference([g.points],network.corridor),.02)).filter((g):g is Geo=>!!g);
  if (greens.length) flat('greens', merge(greens), pbr(scene, 'greens', { map: tiled(scene, 'grass', grassTile(512), 8), roughness: 1, doubleSided: true }));
  const water = data.water.filter((g) => g.points.length > 3).map((g) => polygon(g.points, 0.05));
  if (water.length) flat('water', merge(water), pbr(scene, 'water', { color: 0x5b9bc7, roughness: 0.15, metalness: 0.1, doubleSided: true }));

  const grid = new SegmentGrid();
  const roadLabels: SurroundingsResult['roadLabels'] = [];
  const named = new Map<string, { points: Point[]; length: number; total: number }>();
  for (const road of [...network.roads,...network.repairs]) {
    const width = roadWidth[road.kind]; if (!width || road.points.length < 2) continue;
    for (let i = 1; i < road.points.length; i++) grid.add(road.points[i - 1], road.points[i], width / 2);
    // Só as vias principais recebem nome na tela; ruas de bairro ficariam amontoadas.
    if (road.name && labeledRoads.has(road.kind)) {
      let length = 0; for (let i = 1; i < road.points.length; i++) length += Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][1] - road.points[i - 1][1]);
      const current = named.get(road.name);
      if (!current) named.set(road.name, { points: road.points, length, total: length });
      else { current.total += length; if (length > current.length) Object.assign(current, { points: road.points, length }); }
    }
  }
  const sidewalks=toGeo(network.sidewalks,.12),asphalt=toGeo(network.asphalt,.1);
  if(sidewalks)flat('sidewalks',sidewalks,pbr(scene,'sidewalks',{map:tiled(scene,'paving',pavingTile(256,64),4),roughness:.95,doubleSided:true}));
  if(asphalt)flat('roads',asphalt,pbr(scene,'roads',{map:tiled(scene,'asphalt',asphaltTile(512),10),roughness:.94,doubleSided:true}));
  // Faixas tracejadas no eixo das vias principais.
  const dashes: Matrix[] = [];
  for (const road of data.roads) {
    if ((roadWidth[road.kind] ?? 0) < 11) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]; const b = road.points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (let d = 2; d < len - 2; d += 9) {
        const t = d / len;
        dashes.push(compose(a[0] + (b[0] - a[0]) * t, 0.13, a[1] + (b[1] - a[1]) * t, 0, -angle, 0, 3, 1, 0.25));
      }
    }
  }
  if (dashes.length) instanced('road-dashes', rotateX(plane(1, 1), -Math.PI / 2), scene, pbr(scene, 'dashes', { color: 0xf2f0e6, unlit: true }), dashes, group);
  // As mais extensas primeiro, no máximo maxRoadLabels, e nunca duas muito próximas.
  const ranked = [...named].filter(([, r]) => r.total >= 150).sort((a, b) => b[1].total - a[1].total);
  for (const [name, { points }] of ranked) {
    if (roadLabels.length >= maxRoadLabels) break;
    const mid = points[Math.floor(points.length / 2)];
    const position = new Vector3(mid[0], 2, mid[1]);
    if (Math.hypot(mid[0], mid[1]) > data.radius * 0.9 || roadLabels.some((l) => Vector3.Distance(l.position, position) < 120)) continue;
    roadLabels.push({ name, position });
  }

  const mappedBuildings=buildContextBuildings(scene,data,group);

  const sites=placeHouses(network,exclusion,data.buildings.map(b=>b.points),data.radius);
  const houses:Matrix[]=[],roofs:Matrix[]=[],slabs:Matrix[]=[],paths:Matrix[]=[],awnings:Matrix[]=[];
  for(const s of sites){
    const [x,z]=s.center,w=s.width,d=s.depth,h=s.height;
    houses.push(compose(x,h/2,z,0,s.yaw,0,w,h,d));
    (s.flatRoof?slabs:roofs).push(compose(x,h+(s.flatRoof?.13:.65),z,0,s.yaw,0,w+.6,s.flatRoof?.26:1.3,d+.6));
    const forward=d/2+s.pathLength/2;
    paths.push(compose(x+s.front[0]*forward,.065,z+s.front[1]*forward,0,s.yaw,0,1.3,1,s.pathLength));
    awnings.push(compose(x+s.front[0]*(d/2+.4),2.7,z+s.front[1]*(d/2+.4),0,s.yaw,0,1.8,.12,1));
  }
  if (houses.length) {
    const walls = [0xf1ece2, 0xe8e2d4, 0xdfe3e2, 0xf3eadb, 0xe6ddd0, 0xd9d4ca]; const tiles = [0xb26b50, 0xa15e48, 0xbf8060, 0x9c6855, 0x777b78];
    const wallColors: Color3[] = houses.map(() => rgb(walls[Math.floor(random() * walls.length)]));
    const roofColors: Color3[] = roofs.map(() => rgb(tiles[Math.floor(random() * tiles.length)]));
    shadows(instanced('houses',box(1,1,1,['px','nx','py','ny','nz']),scene,pbr(scene,'houses',{map:houseWallTexture(scene,false),roughness:.95}),houses,group,wallColors),true);
    shadows(instanced('house-fronts',box(1,1,1,['pz']),scene,pbr(scene,'house-fronts',{map:houseWallTexture(scene),roughness:.95}),houses,group,wallColors),true);
    if(roofs.length)shadows(instanced('house-roofs',translate(extrude([[-.5,-.5],[.5,-.5],[0,.5]],1),0,0,-.5),scene,pbr(scene,'house-roofs',{map:roofTexture(scene),roughness:.9}),roofs,group,roofColors),true);
    if(slabs.length)shadows(instanced('house-flat-roofs',box(1,1,1),scene,pbr(scene,'house-flat-roofs',{color:0xb5b6b0,roughness:.95}),slabs,group),true);
    flat('house-yards',merge(sites.map(s=>polygon(s.footprint,.035))),pbr(scene,'house-yards',{map:tiled(scene,'yard-grass',grassTile(256),6),roughness:1}));
    instanced('house-paths',rotateX(plane(1,1),-Math.PI/2),scene,pbr(scene,'house-paths',{color:0xc7c6ba,roughness:1}),paths,group);
    shadows(instanced('house-awnings',box(1,1,1),scene,pbr(scene,'house-awnings',{color:0xe2dfd5,roughness:.9}),awnings,group),true);
  }

  // Árvores nas áreas verdes.
  const trees: Matrix[] = [];
  for (const area of data.green) {
    if (area.points.length < 4) continue;
    const xs = area.points.map((p) => p[0]); const zs = area.points.map((p) => p[1]);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const count = Math.min(400, Math.floor(((maxX - minX) * (maxZ - minZ)) / 600));
    for (let i = 0; i < count; i++) {
      const p: Point = [minX + random() * (maxX - minX), minZ + random() * (maxZ - minZ)];
      const s = 3 + random() * 3;
      if (!insidePolygon(p, area.points) || insidePolygon(p, exclusion)||grid.near(p,s+1.2)) continue;
      trees.push(compose(p[0], s, p[1], 0, 0, 0, s, s * 1.1, s));
    }
  }
  if (trees.length) shadows(instanced('osm-trees', crownGeometry(), scene, pbr(scene, 'osm-trees', { color: 0x5b9a45, roughness: 0.9 }), trees, group), true);
  // Arborização de calçadas e terrenos vazios: sem ela o entorno é um chão liso entre casas soltas.
  const detailedTrees:Matrix[]=[];
  const vegetation=buildVegetation(scene,group,{roads:data.roads,footprints:[...sites.map(s=>s.footprint),...data.buildings.map(b=>b.points)],exclusion,onRoad:(p,clearance)=>grid.near(p,clearance),radius:data.radius,random,maxTrees,detail:detail?{contains:detail.contains,place:(p,height,spin)=>{const s=height/7;detailedTrees.push(compose(p[0],0,p[1],0,spin,0,s,s,s));}}:undefined});
  const ready=detail&&detailedTrees.length?detail.library.instances('pilot_tree_vertical',detailedTrees.map(matrix=>({matrix})),{parent:group,chunk:100,lodDistance:130,cull:700,shadowLevels:2}):Promise.resolve();
  group.metadata={roadRepairs:network.repairs,houseCount:sites.length,roadSurface:'union-buffer',sidewalks:'corridor-minus-asphalt',mappedBuildings,vegetation:vegetation.count,detailedTrees:detailedTrees.length};
  return { group, illustrativeHouses: houses.length, roadLabels,ready };
}
