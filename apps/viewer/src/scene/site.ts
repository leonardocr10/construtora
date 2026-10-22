import { Color3, DynamicTexture, PBRMaterial, TransformNode, Vector3, type Scene } from './babylon';
import type { Library } from './library';
import type { Development, Point, SiteLayout } from '../types';
import { buildTower, type TowerObject } from './tower';
import { buildCars, detectCars, lotBase } from './lot-relief';
import { asphaltLevel, buildGroundMesh, classifyGround, curbHeight, Ground, paintGround, planGround, settleStalls, surfaceFits, type Footprint, type GroundMap } from './ground';
import { buildAmenities } from './amenities';
import { buildVectorGround } from './ground-vector';
import { buildPlanGround } from './ground-plan';
import { planParking } from './parking';
import { buildPalms, buildTrees } from './trees';
import {pilotModels,planPilotLandscape} from './pilot-landscape';
import {createLoadQueue} from './load-queue';
import { box, compose, merge, meshFrom, pbr, polygon, prism, shadows, transform, type Geo } from './geometry';

/** Converte pixels da implantação para metros no referencial do terreno (antes da rotação do azimute). */
/** Retângulo girado no plano do terreno (metros): centro, ângulo do eixo x local e meias-dimensões. */
interface Rect { x: number; z: number; angle: number; hx: number; hz: number }

/** Os dois retângulos se sobrepõem? (teorema dos eixos separadores: testa os eixos de ambos). */
function rectsOverlap(a: Rect, b: Rect) {
  const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2];
  const reach = (r: Rect, ax: number, az: number) => Math.abs(Math.cos(r.angle) * ax + Math.sin(r.angle) * az) * r.hx + Math.abs(-Math.sin(r.angle) * ax + Math.cos(r.angle) * az) * r.hz;
  return axes.every((t) => {
    const ax = Math.cos(t), az = Math.sin(t);
    return Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) <= reach(a, ax, az) + reach(b, ax, az);
  });
}

export function pixelToSite(layout: SiteLayout, [px, py]: Point): Point {
  return [(px - layout.origin[0]) * layout.metersPerPixel, (py - layout.origin[1]) * layout.metersPerPixel];
}

/**
 * Cobre cada círculo de marcador da arte com a cor média do anel ao redor (um "remendo" discreto),
 * tirando o número impresso no chão sem afetar o restante da implantação.
 */
function eraseMarkers(image: HTMLImageElement, markers: Point[], radius: number) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const scale = canvas.width / image.naturalWidth;
  for (const [mx, my] of markers) {
    const x = mx * scale; const y = my * scale; const r = radius * scale;
    const outer = Math.ceil(r * 1.55);
    const box = ctx.getImageData(Math.max(0, x - outer), Math.max(0, y - outer), outer * 2, outer * 2);
    let red = 0, green = 0, blue = 0, n = 0;
    for (let j = 0; j < box.height; j++) for (let i = 0; i < box.width; i++) {
      const d = Math.hypot(i - outer, j - outer);
      if (d < r * 1.2 || d > r * 1.55) continue;
      const k = (j * box.width + i) * 4; red += box.data[k]; green += box.data[k + 1]; blue += box.data[k + 2]; n++;
    }
    if (!n) continue;
    const gradient = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.35);
    const fill = `rgb(${Math.round(red / n)},${Math.round(green / n)},${Math.round(blue / n)})`;
    gradient.addColorStop(0, fill); gradient.addColorStop(1, `rgba(${Math.round(red / n)},${Math.round(green / n)},${Math.round(blue / n)},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, Math.PI * 2); ctx.fill();
  }
  return canvas;
}

function insidePolygon([x, y]: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Encontra as copas de árvores desenhadas na arte (manchas verde-escuras) para erguê-las em 3D.
 * Retorna [x px, y px, tamanho em metros], com espaçamento mínimo entre árvores.
 */
function detectTrees(canvas: HTMLCanvasElement, lot: Point[], footprints: { x: number; y: number; r: number }[], metersPerPixel: number) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const isCanopy = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const k = (Math.round(y) * width + Math.round(x)) * 4;
    const r = data[k]; const g = data[k + 1]; const b = data[k + 2];
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    return g > r * 1.07 && g > b * 1.2 && lum < 150 && lum > 25;
  };
  const step = Math.max(4, Math.round(1.2 / metersPerPixel));
  const minGap = Math.round(3.4 / metersPerPixel);
  const found: [number, number, number][] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!insidePolygon([x, y], lot) || footprints.some((f) => Math.hypot(f.x - x, f.y - y) < f.r)) continue;
      let hits = 0; const rad = Math.max(3, Math.round(1.4 / metersPerPixel));
      for (const [dx, dy] of [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad], [rad, rad], [-rad, -rad], [rad, -rad], [-rad, rad]]) if (isCanopy(x + dx, y + dy)) hits++;
      if (hits < 6 || found.some(([fx, fy]) => Math.hypot(fx - x, fy - y) < minGap)) continue;
      found.push([x, y, 2.4 + (hits - 6) * 0.45 + Math.random() * 1.2]);
      if (found.length > 400) return found;
    }
  }
  return found;
}

/**
 * Pontos de palmeira ao longo do muro: a cada ~7 m, 1,8 m para dentro do lote, só onde o chão é grama
 * e longe de árvores já detectadas. Retorna pixels da arte.
 */
function borderPalms(lot: Point[], ground: GroundMap, metersPerPixel: number, trees: [number, number, number][]) {
  const m = 1 / metersPerPixel; const spacing = 7 * m; const inset = 1.8 * m;
  const isGrass = (x: number, y: number) => {
    const gx = Math.round(x) - ground.x0, gy = Math.round(y) - ground.y0;
    if (gx < 0 || gy < 0 || gx >= ground.w || gy >= ground.h) return false;
    // Faixa inteira de grama em volta (1 m) para não pôr palmeira na borda de calçada.
    for (const [dx, dy] of [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]]) {
      const ix = Math.round(gx + dx), iy = Math.round(gy + dy);
      if (ix < 0 || iy < 0 || ix >= ground.w || iy >= ground.h || ground.classes[iy * ground.w + ix] !== 2) return false;
    }
    return true;
  };
  const points: [number, number][] = [];
  for (let i = 0; i < lot.length; i++) {
    const [ax, ay] = lot[i]; const [bx, by] = lot[(i + 1) % lot.length];
    const length = Math.hypot(bx - ax, by - ay); if (length < spacing) continue;
    const ux = (bx - ax) / length, uy = (by - ay) / length;
    for (let t = spacing / 2; t < length - spacing / 3; t += spacing) {
      // A faixa de grama pode vir depois da calçada: tenta algumas distâncias do muro.
      search: for (const depth of [1, 2, 3]) for (const side of [1, -1]) {
        const x = ax + ux * t - uy * inset * depth * side, y = ay + uy * t + ux * inset * depth * side;
        if (!insidePolygon([x, y], lot) || !isGrass(x, y)) continue;
        if (trees.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 4 * m) || points.some(([px, py]) => Math.hypot(px - x, py - y) < spacing * 0.7)) break search;
        points.push([x, y]); break search;
      }
    }
  }
  return points;
}

/** Muro baixo no contorno do lote, como nas maquetes de vendas. */
function buildWall(scene: Scene, parent: TransformNode, lot: Point[], entrances:{a:Point;b:Point}[]=[]) {
  const parts: Geo[] = [];
  for (let i = 0; i < lot.length; i++) {
    const [ax, az] = lot[i]; const [bx, bz] = lot[(i + 1) % lot.length];
    const length = Math.hypot(bx - ax, bz - az); if (length < 0.5) continue;
    const ux=(bx-ax)/length,uz=(bz-az)/length;
    const gaps=entrances.map(e=>{const project=(p:Point)=>(p[0]-ax)*ux+(p[1]-az)*uz;const near=(p:Point)=>Math.abs((p[0]-ax)*uz-(p[1]-az)*ux)<.5;return near(e.a)&&near(e.b)?[Math.max(0,Math.min(project(e.a),project(e.b))),Math.min(length,Math.max(project(e.a),project(e.b)))]:null;}).filter((g):g is number[]=>!!g&&g[1]>g[0]).sort((a,b)=>a[0]-b[0]);
    let cursor=0;for(const [start,end] of [...gaps,[length,length]]){if(start>cursor){const mid=(start+cursor)/2;parts.push(transform(box(start-cursor,1.6,.22),compose(ax+ux*mid,.8,az+uz*mid,0,-Math.atan2(bz-az,bx-ax),0)));}cursor=Math.max(cursor,end);}
  }
  return shadows(meshFrom('lot-wall', merge(parts), scene, pbr(scene, 'lot-wall', { color: 0xe9e7e1, roughness: 0.9 }), parent), true);
}

export interface SiteResult {
  group: TransformNode; towers: TowerObject[]; lotWorld: Point[];
  amenityAnchors: Map<string, Vector3>; roadAnchors: { name: string; position: Vector3 }[];
  /** Resolve quando o chão, os carros, a vegetação e os modelos das torres terminaram de carregar. */
  ready: Promise<void>;
  /** Chao navegavel pronto; nao espera os GLB detalhados nem vegetacao/carros. */
  baseReady: Promise<void>;
}

/**
 * Terreno do empreendimento: o lote recebe a própria arte da implantação como textura e as torres
 * paramétricas são erguidas sobre ela. O grupo é girado pelo azimute para casar com o mapa real.
 */
export function buildSite(scene: Scene, development: Development, siteImageUrl: string | null, library: Library | null = null, towerModels: Map<string, string> = new Map()): SiteResult {
  const layout = development.viewer.layout;
  // Pronto quando a arte foi processada e os modelos (carros, vegetação, torres) carregaram.
  let resolveSite!: () => void; const siteLoaded = new Promise<void>((resolve) => (resolveSite = resolve));
  const readyTasks: Promise<unknown>[] = [];
  const group = new TransformNode('site', scene);
  group.rotation.y = -((layout?.azimuth ?? 0) * Math.PI) / 180;
  group.computeWorldMatrix(true);

  let lotWorld: Point[] = [];
  if (layout?.lot?.length) {
    const lot = layout.lot.map((p) => pixelToSite(layout, p));
    const groundMaterial = pbr(scene, 'lot', { color: 0xffffff, roughness: 1, doubleSided: true });
    let lotMesh = shadows(meshFrom('lot', polygon(lot, 0.18, (_, i) => [layout.lot![i][0] / layout.imageWidth, 1 - layout.lot![i][1] / layout.imageHeight]), scene, groundMaterial, group), false);
    if (siteImageUrl) {
      // Os marcadores numerados já existem em 3D: apaga os círculos pintados na arte para não duplicar.
      const markers = development.amenities.filter((a) => a.position).map((a) => [a.position!.x / layout.metersPerPixel + layout.origin[0], a.position!.z / layout.metersPerPixel + layout.origin[1]] as Point);
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const canvas = eraseMarkers(image, markers, layout.markerRadius ?? Math.round(layout.imageWidth * 0.0145));
        // Carros desenhados viram volumes 3D; o asfalto fica rebaixado em relação às calçadas e gramados.
        // Carros agrupados em fileiras alinhadas, com todas as vagas da fileira demarcadas.
        const original = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
        const erased = new Uint8Array(canvas.width * canvas.height);
        const detected = detectCars(canvas, layout.lot!, layout.metersPerPixel, erased);
        // Chão modelado: asfalto, grama e piso redesenhados e calçadas/canteiros com meio-fio de verdade.
        const towerFootprints: Footprint[] = development.buildings.filter((b) => b.position).map((b) => ({
          x: b.position!.x / layout.metersPerPixel + layout.origin[0], y: b.position!.z / layout.metersPerPixel + layout.origin[1],
          width: b.model3d?.width ?? 30, depth: b.model3d?.depth ?? 16, angle: ((b.position!.rotation ?? 0) * Math.PI) / 180,
        }));
        // Chão desenhado no painel (polígonos) quando houver; senão, deduzido pela cor de cada pixel da arte.
        const plan = layout.groundPlan?.polygons.length ? layout.groundPlan.polygons : null;
        const ground = plan ? planGround(layout.lot!, plan, canvas.width, canvas.height) : classifyGround(canvas, layout.lot!, layout.metersPerPixel, [], erased, towerFootprints, original);
        // Fileiras de vagas encostadas no meio-fio, completas, e ocupadas conforme a arte.
        const parking = planParking(detected, ground, original, layout.metersPerPixel, layout.groundPlan?.parkingRows);
        // Vaga cujo centro foi desenhado no painel como outra coisa que não asfalto sai (com o carro).
        parking.stalls = parking.stalls.filter((stall) => (!plan || surfaceFits(ground, stall.x, stall.y, stall.angle, 4.8 / layout.metersPerPixel, (stall.width - 0.15) / layout.metersPerPixel, Ground.Asphalt))&&!(layout.parkingExclusions??[]).some(p=>insidePolygon([stall.x,stall.y],p)));
        settleStalls(ground, parking.stalls, layout.metersPerPixel);
        const painted = paintGround(canvas, ground, layout.metersPerPixel, parking.stalls);
        // Áreas de lazer em 3D, a partir do nome e da arte em volta de cada marcador.
        buildAmenities(scene, group, canvas, layout.lot!, development.amenities, layout.metersPerPixel, layout.origin, (p) => pixelToSite(layout, p), asphaltLevel + curbHeight,layout.amenityModels);
        // Volumes das torres no chão (corpo e bloco das varandas, com folga): carro nenhum pode ocupar esse espaço.
        const towerRects: Rect[] = development.buildings.filter((b) => b.position).flatMap((b) => {
          const w = b.model3d?.width ?? 30, d = b.model3d?.depth ?? 16, angle = ((b.position!.rotation ?? 0) * Math.PI) / 180;
          const balconies = (b.model3d?.facade as { balconies?: { enabled?: boolean; projection?: number } } | undefined)?.balconies;
          const rects: Rect[] = [{ x: b.position!.x, z: b.position!.z, angle, hx: w / 2 + 0.4, hz: d / 2 + 0.4 }];
          if (balconies?.enabled !== false) rects.push({ x: b.position!.x, z: b.position!.z, angle, hx: w * 0.13 + 0.4, hz: d / 2 + (balconies?.projection ?? 1.3) + 0.4 });
          return rects;
        });
        // Um carro em cada vaga ocupada, no centro dela, com a frente para o meio-fio (ou de ré); a vaga que encosta
        // numa torre (arte e torre não batem exatamente) fica vazia em vez de pôr o carro dentro do prédio.
        const cars = parking.stalls.filter((stall) => stall.car).map((stall) => {
          const [x, z] = pixelToSite(layout, [stall.x, stall.y]);
          const nose = (stall.curb || 1) * (stall.car!.reversed ? -1 : 1);
          return { x, z, angle: stall.angle + (nose < 0 ? Math.PI : 0), color: stall.car!.color, kind: stall.car!.kind, seed: stall.x * 7 + stall.y * 13 };
        }).filter((car) => !towerRects.some((tower) => rectsOverlap({ x: car.x, z: car.z, angle: car.angle, hx: 2.45, hz: 1.0 }, tower)));
        const footprints = development.buildings.filter((b) => b.position).map((b) => ({ x: b.position!.x / layout.metersPerPixel + layout.origin[0], y: b.position!.z / layout.metersPerPixel + layout.origin[1], r: Math.hypot(b.model3d?.width ?? 30, b.model3d?.depth ?? 16) / 2 / layout.metersPerPixel + 4 }));
        const plantingFits = (p: Point, clearance = 0.65) => surfaceFits(ground, p[0], p[1], 0, clearance * 2 / layout.metersPerPixel, clearance * 2 / layout.metersPerPixel, Ground.Grass);
        const reviewedTrees = layout.landscape?.trees.filter((t) => plantingFits(t.point));
        const trees: [number, number, number][] = reviewedTrees
          ? reviewedTrees.filter((t) => t.kind === 'broadleaf').map((t) => [...t.point, t.height / 1.7])
          : detectTrees(canvas, layout.lot!, footprints, layout.metersPerPixel).filter(([x, y]) => plantingFits([x, y]));
        const place = (list: typeof trees) => list.map(([px, py, size]) => { const [x, z] = pixelToSite(layout, [px, py]); return [x, z, size] as [number, number, number]; });
        // Palmeiras em fileira nas faixas de grama junto ao muro (paisagismo típico), longe das árvores.
        const palmPixels: [number, number, number][] = reviewedTrees
          ? reviewedTrees.filter((t) => t.kind === 'palm').map((t) => [...t.point, t.height])
          : borderPalms(layout.lot!, ground, layout.metersPerPixel, trees).map(([x,y]) => [x,y,8.5]);
        const palms = place(palmPixels);
        lotMesh.dispose();

        if (library) {
          // Chão com materiais PBR da biblioteca (asfalto, grama, piso) e a arte só onde não há classe;
          // faixas pintadas e linhas das vagas numa camada transparente por cima do asfalto.
          const art = new DynamicTexture('lot-art', painted.canvas, scene, true);
          art.anisotropicFilteringLevel = 16; art.update(true);
          const refined = development.slug === 'union-vista' && new URLSearchParams(location.search).get('acabamento') !== 'original';
          const surface = (name: string) => refined && library.hasTexture(`pilot_${name}`) ? `pilot_${name}` : name;
          const materials: Record<number, PBRMaterial> = {
            1: library.material('lot-asphalt', surface('asphalt')), 2: library.material('lot-grass', surface('grass')), 3: library.material('lot-paving', surface('paving')),
          };
          const other = pbr(scene, 'lot-other', { color: 0xffffff, roughness: 0.95 }); other.albedoTexture = art;
          const tiled = (geo: Geo, meters: number) => ({ ...geo, uvs: geo.uvs.map((v) => v / meters) });
          // Asfalto: o polígono do lote inteiro. Por cima, o chão elevado em contornos vetoriais suavizados.
          const base = polygon(lot, asphaltLevel);
          shadows(meshFrom('lot-asphalt', tiled(base, library.tileMeters(surface('asphalt'))), scene, materials[1], group), false).freezeWorldMatrix();
          const vector = plan ? buildPlanGround(layout.lot!, plan, (p) => pixelToSite(layout, p)) : buildVectorGround(ground, (p) => pixelToSite(layout, p));
          const top = (name: string, geo: Geo | null, material: PBRMaterial, set?: string) => {
            if (!geo) return;
            shadows(meshFrom(name, set ? tiled(geo, library.tileMeters(surface(set))) : { ...geo, uvs: artUv(geo, ground, layout) }, scene, material, group), false).freezeWorldMatrix();
          };
          top('lot-paving', vector.raised, materials[3], 'paving');
          top('lot-grass', vector.grass, materials[2], 'grass');
          top('lot-other', vector.other, other);
          const marks = new DynamicTexture('lot-marks', paintGround(canvas, ground, layout.metersPerPixel, parking.stalls, true).canvas, scene, true);
          marks.hasAlpha = true; marks.anisotropicFilteringLevel = 16; marks.update(true);
          const markMaterial = pbr(scene, 'lot-marks', { color: 0xffffff, roughness: 0.7 });
          markMaterial.albedoTexture = marks; markMaterial.useAlphaFromAlbedoTexture = true;
          markMaterial.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST; markMaterial.alphaCutOff = 0.4;
          markMaterial.zOffset = -2; // fica por cima do asfalto sem levantar a malha
          shadows(meshFrom('lot-marks', { ...base, uvs: artUv(base, ground, layout) }, scene, markMaterial, group), false).isPickable = false;
          const curb = library.material('curb', surface('concrete')); curb.backFaceCulling = false;
          shadows(meshFrom('lot-curbs', tiled(vector.curbs, library.tileMeters(surface('concrete'))), scene, curb, group), false);
          const tasks: Promise<unknown>[] = [];
          const carModels = ['car_hatch', 'car_sedan', 'car_suv'];
          const jitter = (seed: number, k: number) => { const t = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return t - Math.floor(t) - 0.5; };
          carModels.forEach((model, kind) => {
            const list = cars.filter((c) => c.kind === kind);
            if (!list.length || !library.has(model)) return;
            tasks.push(library.instances(model, list.map((c) => ({
              // Pequenos desvios dentro da vaga, como no estacionamento de verdade.
              matrix: compose(c.x + jitter(c.seed, 2) * 0.25, lotBase, c.z + jitter(c.seed, 3) * 0.15, 0, -(c.angle + jitter(c.seed, 1) * 0.05), 0),
              color: c.color,
            })), { parent: group, chunk: 90, lodDistance: 140, cull: 900, shadowLevels: 1, tint: (name) => name === 'VH_CarPaint' }));
          });
          const random = seededRandom(17);
          const pilot=pilotModels.every(model=>library.has(model))&&new URLSearchParams(location.search).get('vegetacao')!=='original'?planPilotLandscape(development,ground):null;
          const regularTrees=pilot?trees.filter(([x,z])=>!pilot.replaces([x,z])):trees;
          if (regularTrees.length) tasks.push(library.instances('tree_broadleaf', place(regularTrees).map(([x, z, size]) => {
            const s = (size * 1.7) / 6.6 * (0.9 + random() * 0.25);
            return { matrix: compose(x, asphaltLevel + curbHeight, z, 0, random() * Math.PI * 2, 0, s, s * (0.9 + random() * 0.2), s) };
          }), { parent: group, chunk: 120, lodDistance: 170, cull: 1600 }));
          if(pilot){
            group.metadata={...group.metadata,vegetationPilot:{version:1,tower:'TORRE-03',bounds:pilot.bounds,plants:pilot.plants}};
            for(const model of pilotModels){
              const list=pilot.plants.filter(p=>p.model===model);if(!list.length)continue;
              tasks.push(library.instances(model,list.map((p,i)=>({matrix:compose(p.point[0],asphaltLevel+curbHeight,p.point[1],0,p.yaw,0,p.scale,p.yScale,p.scale),color:new Color3(.9+(i%3)*.04,.94+(i%2)*.04,.86+(i%4)*.04)})),{parent:group,chunk:80,lodDistance:model.startsWith('pilot_tree')?130:55,cull:model.startsWith('pilot_tree')?700:280,shadowLevels:model.startsWith('pilot_tree')?2:1,tint:name=>name.startsWith('VH_Leaf')}));
            }
          }
          if (palms.length) tasks.push(library.instances('tree_palm', palms.map(([x, z, height]) => {
            const s = height / 9 * (0.96 + random() * 0.08);
            return { matrix: compose(x, asphaltLevel + curbHeight, z, 0, random() * Math.PI * 2, 0, s, s, s) };
          }), { parent: group, chunk: 120, lodDistance: 170, cull: 1600 }));
          // Forracao baixa na borda dos canteiros. A base inteira precisa caber na grama.
          if (plan && library.has('shrub')) {
            const shrubs: { matrix: ReturnType<typeof compose> }[] = [];
            const spacing = 1.55 / layout.metersPerPixel;
            for (let py = ground.y0 + spacing / 2; py < ground.y0 + ground.h; py += spacing) {
              for (let px = ground.x0 + spacing / 2; px < ground.x0 + ground.w; px += spacing) {
                if (!plantingFits([px,py], 0.5)) continue;
                // Apenas bordaduras; centros dos gramados ficam livres.
                const edge = !plantingFits([px,py], 1.55);
                if (!edge || [...trees,...palmPixels].some(([tx,ty]) => Math.hypot(tx-px,ty-py) * layout.metersPerPixel < 1.35)) continue;
                const [x,z] = pixelToSite(layout,[px,py]); const s = 0.38 + random() * 0.22;
                if(pilot?.plants.some(p=>!p.model.startsWith('pilot_tree')&&Math.hypot(p.point[0]-x,p.point[1]-z)<2))continue;
                shrubs.push({matrix:compose(x,asphaltLevel+curbHeight,z,0,random()*Math.PI*2,0,s,s*0.8,s)});
              }
            }
            tasks.push(library.instances('shrub',shrubs,{parent:group,chunk:80,lodDistance:80,cull:500,shadowLevels:1}));
          }
          readyTasks.push(Promise.all(tasks).catch((error) => console.warn('Modelos da biblioteca indisponíveis', error)));
        } else {
          const meshes = buildGroundMesh(ground, (p) => pixelToSite(layout, p), { u: (px) => (px - ground.x0) / ground.w, v: (py) => 1 - (py - ground.y0) / ground.h });
          buildCars(scene, group, cars);
          const texture = new DynamicTexture('lot-art', painted.canvas, scene, true);
          texture.anisotropicFilteringLevel = 16;
          texture.update(true);
          groundMaterial.albedoTexture = texture;
          lotMesh = shadows(meshFrom('lot', meshes.top, scene, groundMaterial, group), false);
          shadows(meshFrom('lot-curbs', meshes.side, scene, pbr(scene, 'curb', { color: 0xd4d1c8, roughness: 0.9, doubleSided: true }), group), false);
          if (trees.length) buildTrees(scene, group, place(trees));
          if (palms.length) buildPalms(scene, group, palms.map(([x,z,height]) => [x,z,Math.max(0.5,(height-6)/1.2)]));
        }
        resolveSite();
      };
      image.onerror = () => resolveSite();
      image.src = siteImageUrl;
    }
    // Meio-fio em volta do lote.
    shadows(meshFrom('lot-edge', prism(lot, 0, 0.16), scene, pbr(scene, 'lot-edge', { color: 0xd9d6cc, roughness: 1 }), group), false);
    buildWall(scene, group, lot,(layout.entrances??[]).map(e=>({a:pixelToSite(layout,e.a),b:pixelToSite(layout,e.b)})));
  }

  if (!layout?.lot?.length || !siteImageUrl) resolveSite();
  const refineFacade = development.slug === 'union-vista' && new URLSearchParams(location.search).get('acabamento') !== 'original';
  const scheduleTower = createLoadQueue(2);
  const towers = development.buildings.map((building) => buildTower(scene, building, group, towerModels.get(building.id) ?? null, library, refineFacade && building.code === 'TORRE-03', scheduleTower));
  for (const tower of towers) readyTasks.push(tower.loaded);
  // Recalcula as âncoras já com a rotação do terreno aplicada.
  for (const tower of towers) {
    const matrix = tower.group.computeWorldMatrix(true);
    Vector3.TransformCoordinatesToRef(new Vector3(0, tower.height / 2, 0), matrix, tower.center);
    Vector3.TransformCoordinatesToRef(new Vector3(0, tower.height + 6, 0), matrix, tower.top);
  }

  const toWorld = (x: number, y: number, z: number) => Vector3.TransformCoordinates(new Vector3(x, y, z), group.getWorldMatrix());
  if (layout?.lot?.length) lotWorld = layout.lot.map((p) => { const [x, z] = pixelToSite(layout, p); const v = toWorld(x, 0, z); return [v.x, v.z] as Point; });
  const amenityAnchors = new Map<string, Vector3>();
  for (const amenity of development.amenities) if (amenity.position) amenityAnchors.set(amenity.id, toWorld(amenity.position.x, 3, amenity.position.z));
  const roadAnchors = (layout?.roads ?? []).map((road) => {
    const mid = road.points.length === 2
      ? [(road.points[0][0] + road.points[1][0]) / 2, (road.points[0][1] + road.points[1][1]) / 2] as Point
      : road.points[Math.floor(road.points.length / 2)];
    const [x, z] = pixelToSite(layout!, mid);
    return { name: road.name, position: toWorld(x, 1.5, z) };
  });
  const ready = siteLoaded.then(() => Promise.all(readyTasks)).then(() => undefined);
  return { group, towers, lotWorld, amenityAnchors, roadAnchors, ready, baseReady: siteLoaded };
}

/** UV da arte (0–1 no recorte do lote) para uma malha em coordenadas do terreno. */
function artUv(geo: Geo, ground: GroundMap, layout: SiteLayout) {
  const uv: number[] = [];
  for (let i = 0; i < geo.positions.length; i += 3) {
    const px = geo.positions[i] / layout.metersPerPixel + layout.origin[0]; const py = geo.positions[i + 2] / layout.metersPerPixel + layout.origin[1];
    uv.push((px - ground.x0) / ground.w, 1 - (py - ground.y0) / ground.h);
  }
  return uv;
}

function seededRandom(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }
