import {
  ArcRotateCamera, Color4, DefaultRenderingPipeline, DirectionalLight, DynamicTexture, HemisphericLight, ImageProcessingConfiguration,
  Plane, PointLight, Scene, ShadowGenerator, Texture, TransformNode, UniversalCamera, Vector3, type AbstractEngine, type PBRMaterial,
} from './babylon';
import { createEngine } from './engine';
import {compatibilityMode, renderScaling, waitForVisibleFrame} from './graphics-safety';
import {isMobile} from './quality';
import { box as boxGeo, compose, cylinder as cylinderGeo, merge, meshFrom, pbr, polygon, rgb, shadows, transform, translate, tube, type Geo, type MaterialOptions } from './geometry';
import { skyEnvironment } from './world';
import type { PlanLayout, Point, RoomKind } from '../types';
import { InteriorNavigation, pointInRoom, type InteriorObstacle } from './interior-navigation';
import { softBox, interiorLeaf } from './interior-shapes';

/**
 * Planta 3D mobiliada gerada da planta vetorizada: paredes com vãos de portas e janelas, piso por
 * cômodo e mobiliário ilustrativo posicionado automaticamente encostado nas paredes livres.
 * Dois modos: maquete (vista de cima, sem teto) e passeio em primeira pessoa.
 */

type Room = PlanLayout['rooms'][number];
interface Box2 { x0: number; y0: number; x1: number; y1: number; tallOnly?: boolean }
interface Placement { box: Box2; center: Point; normal: Point; side: Side | null; u: number }
type Side = { axis: 'x' | 'y'; fixed: number; from: number; to: number; normal: Point };

const eye = 1.6;
const inset = 0.08;
const deg = (d: number) => (d * Math.PI) / 180;
const roomLabel: Record<RoomKind, string> = { living: 'Sala', kitchen: 'Cozinha', bedroom: 'Quarto', suite: 'Suíte', bathroom: 'Banheiro', balcony: 'Varanda', service: 'Área de serviço', hall: 'Circulação', garden: 'Garden' };

// ——— materiais (criados por cena; a paleta é só a receita) ———
type Recipe = MaterialOptions & { tex?: () => HTMLCanvasElement; tile?: number };
const m = (color: string, roughness = 0.8, extra: Recipe = {}): Recipe => ({ color, roughness, ...extra });
function canvas(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d')!, size); return c;
}
const wood = (base: string) => () => canvas(512, (g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  const rows = 8; const h = s / rows;
  for (let r = 0; r < rows; r++) {
    const shift = (r % 3) * s / 3;
    for (let k = 0; k < 2; k++) {
      const x = (shift + k * s / 2) % s;
      const tone = 0.88 + ((r * 7 + k * 3) % 5) * 0.035;
      g.fillStyle = `rgba(${tone > 1 ? 255 : 0},${tone > 1 ? 240 : 0},0,${Math.abs(1 - tone) * 0.9})`;
      g.fillRect(x, r * h, s / 2, h);
      g.fillStyle = 'rgba(60,35,15,0.35)'; g.fillRect(x, r * h, 2, h);
    }
    g.fillStyle = 'rgba(60,35,15,0.35)'; g.fillRect(0, r * h, s, 2);
    for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(90,55,25,0.08)'; g.beginPath(); const y = r * h + Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(s / 3, y + 4, s * 2 / 3, y - 4, s, y); g.stroke(); }
  }
});
const tiles = (base: string, grout: string) => () => canvas(256, (g, s) => {
  g.fillStyle = grout; g.fillRect(0, 0, s, s);
  const n = 2; const t = s / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = base; g.fillRect(i * t + 0.7, j * t + 0.7, t - 1.4, t - 1.4); }
});
const textile = (base:string) => () => canvas(256,(g,s)=>{g.fillStyle=base;g.fillRect(0,0,s,s);for(let i=0;i<s;i+=2){g.strokeStyle=i%4?'rgba(255,255,255,.025)':'rgba(30,25,20,.02)';g.lineWidth=.5;g.beginPath();g.moveTo(i,0);g.lineTo(i,s);g.moveTo(0,i);g.lineTo(s,i);g.stroke();}});
const stone=()=>canvas(256,(g,s)=>{g.fillStyle='#e9e9e3';g.fillRect(0,0,s,s);for(let i=0;i<30;i++){const x=(i*83)%s,y=(i*59)%s;g.strokeStyle='rgba(111,118,111,.045)';g.lineWidth=.65;g.beginPath();g.moveTo(x,y);g.bezierCurveTo(x+24,y-12,x+42,y+15,x+80,y-9);g.stroke();}});

const palette = {
  wall: m('#f2efea', 0.92), skirting: m('#e2dbcf', 0.5), lamp: m('#ffffff', 0.4, { emissive: '#fff1d6', emissiveIntensity: 1.2 }), cap: m('#c9c2b8', 0.9), ceiling: m('#fbfaf8', 0.95, { doubleSided: true }),
  glass: m('#cfe6f2', 0.05, { alpha: 0.35, depthWrite: false }),
  frame: m('#2f2f35', 0.5, { metalness: 0.4 }), door: m('#f2f1eb', 0.5), doorTrim:m('#fafaf6',.4),doorReveal:m('#c9cec8',.75),sill: m('#e9e6e1', 0.6),
  fabric: m('#ffffff', 0.95,{tex:textile('#d4d5ce')}), fabricDark: m('#ffffff', 0.95,{tex:textile('#aaaead')}), cushion: m('#ffffff', 0.95,{tex:textile('#7b968e')}), linen: m('#ffffff', 0.95,{tex:textile('#f1eee7')}), blanket: m('#ffffff', 0.95,{tex:textile('#688791')}),
  white: m('#f7f7f5', 0.4), black: m('#1e1e22', 0.4), steel: m('#c9ccd0', 0.3, { metalness: 0.7 }),stem:m('#6a5741',1),
  porcelain: m('#ffffff', 0.2), mirror: m('#d7e3ea', 0.05, { metalness: 0.9 }), counterTop: m('#484744', 0.35), rug: m('#ffffff', 1,{tex:textile('#d3cabb')}), plant: m('#547b43', 0.9,{doubleSided:true}), pot: m('#c8bca8', 0.8), soil: m('#4a3626', 1), accent:m('#d79a5b',.5),
  lacquer:m('#e6e9e3',.58),cabinet:m('#8b9c91',.65),stone:m('#ffffff',.32,{tex:stone}),metalDark:m('#343b3c',.4,{metalness:.65}),ceramic:m('#d4dbd3',.4),
};
type Paint = keyof typeof palette;
const floorFor: Record<RoomKind, Recipe> = {
  living: m('#ffffff', 0.6, { tex: wood('#b98b5e'), tile: 1.6 }), bedroom: m('#ffffff', 0.6, { tex: wood('#c49a6c'), tile: 1.6 }), suite: m('#ffffff', 0.6, { tex: wood('#c49a6c'), tile: 1.6 }),
  hall: m('#ffffff', 0.6, { tex: wood('#b98b5e'), tile: 1.6 }), kitchen: m('#ffffff', 0.4, { tex: tiles('#e7e3dc', '#c9c3b8'), tile: 0.9 }),
  bathroom: m('#ffffff', 0.35, { tex: tiles('#dfe3e4', '#b8bfc2'), tile: 0.6 }), service: m('#ffffff', 0.4, { tex: tiles('#e7e3dc', '#c9c3b8'), tile: 0.6 }),
  balcony: m('#ffffff', 0.6, { tex: tiles('#c9b8a3', '#9e8e7a'), tile: 0.6 }), garden: m('#6fa35a', 1),
};

/**
 * Modelo montado por peças (caixas, cilindros…) já transformadas, agrupadas por material;
 * vira uma malha por material quando é colocado na cena.
 */
class Model {
  readonly parts: { paint: Paint; geo: Geo; cast: boolean }[] = [];
  add(paint: Paint, geo: Geo, cast = true) { this.parts.push({ paint, geo, cast }); return this; }
  /** Inclui outro modelo com posição e giro (y). */
  include(other: Model, x = 0, y = 0, z = 0, rotY = 0) {
    const matrix = compose(x, y, z, 0, rotY, 0);
    for (const p of other.parts) this.parts.push({ ...p, geo: transform(p.geo, matrix) });
    return this;
  }
}
function box(w: number, h: number, d: number, paint: Paint, x = 0, y = 0, z = 0, cast = true) {
  const soft=['fabric','fabricDark','cushion','linen','blanket'].includes(paint);
  return new Model().add(paint, translate(soft?softBox(w,h,d,.055):boxGeo(w,h,d), x, y + h / 2, z), cast);
}
function cylinder(r: number, h: number, paint: Paint, x = 0, y = 0, z = 0, top = r) { return new Model().add(paint, translate(cylinderGeo(top, r, h, 20), x, y + h / 2, z)); }
const group = (...children: Model[]) => { const g = new Model(); for (const c of children) g.include(c); return g; };

function faucet(x:number,y:number,z:number){
  const path:[number,number,number][]=[[x,y,z],[x,y+.2,z]];
  for(let i=0;i<=12;i++){const a=Math.PI*i/12;path.push([x,y+.2+Math.sin(a)*.065,z+.065-Math.cos(a)*.065]);}
  path.push([x,y+.16,z+.13]);
  return group(new Model().add('steel',tube(path,.013,10)),cylinder(.025,.025,'steel',x,y,z),box(.05,.01,.025,'steel',x+.032,y+.07,z));
}

// ——— mobiliário (origem no centro da base; costas em -z, frente em +z) ———
const furniture = {
  bed(w: number, d: number) {
    const g = group(box(w,.2,d,'fabricDark',0,.1),box(w-.06,.22,d-.1,'linen',0,.3,.03),box(w+.06,1.05,.1,'fabric',0,0,-d/2+.04),box(w-.04,.06,d*.58,'blanket',0,.52,d*.2));
    for(const x of [-w*.36,w*.36])for(const z of [-d*.36,d*.36])g.include(cylinder(.025,.1,'metalDark',x,0,z));
    for(const x of [-w/4,w/4])g.include(box(w/2-.025,.62,.08,'fabricDark',x,.4,-d/2+.11));
    const pillows = w > 1.2 ? [-w / 4, w / 4] : [0];
    for (const x of pillows) g.include(box(Math.min(0.6, w / pillows.length - 0.1), 0.12, 0.35, 'linen', x, 0.52, -d / 2 + 0.3));
    return g;
  },
  nightstand: () => group(box(.45,.34,.4,'lacquer',0,.12),box(.4,.13,.014,'cabinet',0,.29,.207),box(.12,.009,.02,'metalDark',0,.4,.222),box(.45,.025,.4,'stone',0,.46),...[-.17,.17].map(x=>box(.025,.12,.3,'metalDark',x,0)),cylinder(.09,.025,'ceramic',0,.49),cylinder(.016,.24,'steel',0,.515),cylinder(.12,.16,'linen',0,.755,0,.08)),
  wardrobe(w: number) {
    const g = group(box(w, 2.1, 0.6, 'white'));
    const doors = Math.max(2, Math.round(w / 0.5));
    for (let i = 1; i < doors; i++) g.include(box(0.01, 2.0, 0.01, 'frame', -w / 2 + (w / doors) * i, 0.05, 0.3));
    for (let i = 0; i < doors; i++) g.include(box(0.02, 0.3, 0.02, 'steel', -w / 2 + (w / doors) * (i + 0.5) + (i % 2 ? -0.08 : 0.08), 0.95, 0.31));
    return g;
  },
  sofa(w: number) {
    const d = 0.88;
    const g = group(box(w,.17,d,'fabricDark',0,.12),box(w,.47,.18,'fabric',0,.32,-d/2+.1),box(.15,.35,d,'fabric',-w/2+.075,.29),box(.15,.35,d,'fabric',w/2-.075,.29));
    for(const x of [-w/2+.14,w/2-.14])for(const z of [-.31,.31])g.include(cylinder(.022,.12,'metalDark',x,0,z));
    const seats = Math.max(2, Math.round((w - 0.32) / 0.7));
    const sw = (w - 0.34) / seats;
    for (let i = 0; i < seats; i++) {const x=-w/2+.17+sw*(i+.5);g.include(box(sw-.02,.15,d-.26,'fabric',x,.29,.08));g.include(box(sw-.025,.34,.12,'fabric',x,.44,-.25));}
    g.include(box(.34,.31,.12,'cushion',-w/2+.4,.46,-.16)).include(box(.34,.31,.12,'linen',w/2-.4,.46,-.16));
    return g;
  },
  tv(w: number, panel = false) {
    const g = group(box(w,.28,.38,'lacquer',0,.14),box(w,.025,.4,'stone',0,.42),box(w/2-.02,.22,.015,'cabinet',-w/4,.17,.197),box(w/2-.02,.22,.015,'lacquer',w/4,.17,.197),box(Math.min(1.25,w-.2),.72,.035,'black',0,.74,-.09),box(.3,.025,.16,'metalDark',0,.445,-.04));
    for(const x of [-w/2+.1,w/2-.1])g.include(box(.025,.14,.3,'metalDark',x,0));
    // Sem parede atrás (sala integrada): painel ripado solto, como nas plantas humanizadas.
    if (panel) g.include(box(w,1.8,.025,'lacquer',0,.2,-.22));
    return g;
  },
  coffeeTable: () => group(new Model().add('stone',translate(softBox(.9,.04,.5,.015),0,.38,0)), ...[-.3,.3].map(x=>box(.025,.36,.34,'metalDark',x,0)),cylinder(.07,.09,'ceramic',.25,.4,.02)),
  rug: (w: number, d: number) => box(w, 0.01, d, 'rug', 0, 0, 0, false),
  dining(w: number, d: number) {
    const g = group(new Model().add('stone',translate(softBox(w,.045,d,.018),0,.7425,0)),cylinder(.065,.7,'metalDark'),box(w*.5,.035,d*.55,'metalDark'));
    const seats = w > .95 ? [-w / 4, w / 4] : [0];
    for (const x of seats) { g.include(furniture.chair(.44), x, 0, -d / 2 - 0.15, 0).include(furniture.chair(.44), x, 0, d / 2 + 0.15, Math.PI); }
    g.include(cylinder(.065,.1,'ceramic',0,.77));
    return g;
  },
  counter(w: number) {
    const g = group(box(w, 0.86, 0.6, 'white'), box(w, 0.04, 0.62, 'counterTop', 0, 0.86, 0.01));
    if (w >= 1.2) g.include(box(.5,.02,.4,'steel',-w/2+.45,.89,.02)).include(box(.42,.004,.32,'counterTop',-w/2+.45,.912,.02)).include(faucet(-w/2+.45,.9,-.22));
    if (w >= 1.8) { g.include(box(0.58, 0.015, 0.5, 'black', w / 2 - 0.5, 0.9, 0.02)); for (const [x, z] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) g.include(cylinder(0.07, 0.01, 'steel', w / 2 - 0.5 + x, 0.915, 0.02 + z)); }
    const modules=Math.max(2,Math.round(w/.55));
    for(let i=0;i<modules;i++){const x=-w/2+w/modules*(i+.5);g.include(box(w/modules-.012,.69,.015,'cabinet',x,.09,.305));g.include(box(w/modules-.055,.012,.02,'metalDark',x,.72,.325));}
    return g;
  },
  upper(w:number){const g=group(box(w,.68,.32,'lacquer',0,1.55,-.12),box(w-.08,.018,.025,'lamp',0,1.53,.02));const n=Math.max(2,Math.round(w/.55));for(let i=1;i<n;i++)g.include(box(.009,.61,.008,'doorReveal',-w/2+w*i/n,1.59,.045));return g;},
  fridge: () => group(box(0.7, 1.85, 0.68, 'steel'), box(0.02, 0.5, 0.03, 'black', 0.3, 1.1, 0.35), box(0.02, 0.4, 0.03, 'black', 0.3, 0.4, 0.35), box(0.7, 0.01, 0.01, 'black', 0, 1.0, 0.345)),
  toilet: () => group(box(0.38, 0.4, 0.2, 'porcelain', 0, 0, -0.22), cylinder(0.19, 0.4, 'porcelain', 0, 0, 0.08, 0.2), box(0.38, 0.4, 0.17, 'porcelain', 0, 0.4, -0.25)),
  vanity: (w = 0.8) => group(box(w,.51,.46,'cabinet',0,.27),box(w-.035,.012,.02,'metalDark',0,.63,.24),box(w+.02,.05,.48,'stone',0,.8),cylinder(.17,.02,'porcelain',0,.84,.03),faucet(0,.85,-.17),box(w-.1,.8,.02,'mirror',0,1.15,-.22)),
  shower() {
    // Cano na parede do fundo até o chuveiro (nada flutua quando a maquete corta as paredes).
    const g = group(box(0.9, 0.05, 0.9, 'porcelain', 0, 0, 0, false), box(0.9, 1.95, 0.01, 'glass', 0, 0.05, 0.45, false), box(0.01, 1.95, 0.9, 'glass', 0.45, 0.05, 0, false),
      box(0.03, 0.03, 0.3, 'steel', 0, 1.95, -0.28, false), cylinder(0.015, 1.98, 'steel', 0, 0, -0.43), cylinder(0.1, 0.02, 'steel', 0, 1.94, -0.14), box(0.12, 0.04, 0.03, 'steel', 0.2, 1.05, -0.43, false));
    for (const p of g.parts) p.cast = false;
    return g;
  },
  washer: () => group(box(0.6, 0.85, 0.6, 'white'), cylinder(0.2, 0.02, 'black', 0, 0.45, 0.3)),
  tank: () => group(box(0.55, 0.85, 0.5, 'white'), box(0.45, 0.05, 0.35, 'steel', 0, 0.83, 0.03)),
  chair(w=.5){return group(box(w,.075,.44,'cushion',0,.43),box(w-.02,.36,.07,'cushion',0,.5,-.19),...[-1,1].flatMap(sx=>[-1,1].map(sz=>cylinder(.016,.43,'metalDark',sx*(w/2-.055),0,sz*.16))));},
  sideTable: () => group(cylinder(0.25, 0.03, 'white', 0, 0.6, 0), cylinder(0.03, 0.6, 'black')),
  plant(scale = 1) {
    const g=group(cylinder(.16*scale,.37*scale,'pot',0,0,0,.2*scale),cylinder(.18*scale,.02,'soil',0,.365*scale,0),cylinder(.012*scale,.65*scale,'stem',0,.37*scale,0));
    for(let i=0;i<13;i++)g.add('plant',transform(interiorLeaf((.3+(i%3)*.07)*scale,.15*scale),compose(0,(.5+(i%5)*.11)*scale,0,-.25+(i%3)*.22,i*2.4,0)));
    return g;
  },
};

/** Folha laqueada com frisos discretos, ferragens em ambos os lados e dobradicas reais. */
function detailedDoor(w:number,h:number){
  const leaf=box(w,h,.042,'door',w/2);
  for(const side of [-1,1]){
    for(const y of [.43,1.52])leaf.include(box(w-.075,.004,.002,'doorReveal',w/2,y,side*.022,false));
    leaf.add('steel',transform(cylinderGeo(.025,.025,.012,20),compose(w-.105,1.02,side*.032,Math.PI/2,0,0)));
    leaf.include(box(.105,.016,.026,'steel',w-.147,1.012,side*.058));
    leaf.add('steel',transform(cylinderGeo(.011,.011,.008,16),compose(w-.105,.91,side*.026,Math.PI/2,0,0)));
    leaf.include(box(.003,.014,.002,'black',w-.105,.905,side*.031,false));
  }
  for(const y of [.24,h/2,h-.24])leaf.include(cylinder(.008,.075,'steel',.005,y,.022));
  leaf.include(box(.004,.14,.025,'steel',w-.002,.95));
  return leaf;
}

// ——— geometria auxiliar em coordenadas da planta (x, y) ———
const polygonArea = (pts: Point[]) => Math.abs(pts.reduce((s, [x1, y1], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x1 * y2 - x2 * y1; }, 0)) / 2;
/** Centroide de área do polígono (cai dentro da parte maior do cômodo em formas em L). */
function centroid(pts: Point[]): Point {
  let a = 0, cx = 0, cy = 0;
  pts.forEach(([x1, y1], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; const k = x1 * y2 - x2 * y1; a += k; cx += (x1 + x2) * k; cy += (y1 + y2) * k; });
  if (Math.abs(a) < 1e-9) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [cx / (3 * a), cy / (3 * a)];
}
function inside([px, py]: Point, poly: Point[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const overlaps = (a: Box2, b: Box2) => a.x0 < b.x1 - 0.01 && a.x1 > b.x0 + 0.01 && a.y0 < b.y1 - 0.01 && a.y1 > b.y0 + 0.01;

/** Distribui o mobiliário de um cômodo evitando portas, janelas (para móveis altos) e outros móveis. */
class Furnisher {
  readonly placed: Box2[] = [];
  readonly solids: InteriorObstacle[] = [];
  viewFocus:{point:Point;normal:Point}|null=null;
  readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number;
  constructor(private readonly room: Room, private readonly obstacles: Box2[], private readonly out: (model: Model, at: Point, rotY: number) => void, private readonly walls: { a: Point; b: Point }[]) {
    const xs = room.points.map((p) => p[0]); const ys = room.points.map((p) => p[1]);
    this.minX = Math.min(...xs) + inset; this.maxX = Math.max(...xs) - inset; this.minY = Math.min(...ys) + inset; this.maxY = Math.max(...ys) - inset;
  }
  get width() { return this.maxX - this.minX; }
  get depth() { return this.maxY - this.minY; }
  get area() { return polygonArea(this.room.points); }

  /** Lados do cômodo a partir das arestas do polígono (funciona em salas em L), com a normal para dentro. */
  sides(): Side[] {
    const pts = this.room.points; const out: Side[] = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const horizontal = Math.abs(a[1] - b[1]) < 0.02; const vertical = Math.abs(a[0] - b[0]) < 0.02;
      if (!horizontal && !vertical) return;
      const axis = horizontal ? 'x' : 'y'; const k = horizontal ? 0 : 1;
      const from = Math.min(a[k], b[k]) + inset; const to = Math.max(a[k], b[k]) - inset;
      if (to - from < 0.4) return;
      const mid = (from + to) / 2; const line = horizontal ? a[1] : a[0];
      const probe = (sign: number): Point => (horizontal ? [mid, line + sign * 0.15] : [line + sign * 0.15, mid]);
      const sign = inside(probe(1), pts) ? 1 : -1;
      out.push({ axis, fixed: line + sign * inset, from, to, normal: horizontal ? [0, sign] : [sign, 0] });
    });
    return out.sort((p, q) => (q.to - q.from) - (p.to - p.from));
  }

  private footprint(side: Side, u: number, w: number, d: number): Box2 {
    if (side.axis === 'x') { const y0 = side.normal[1] > 0 ? side.fixed : side.fixed - d; return { x0: u - w / 2, x1: u + w / 2, y0, y1: y0 + d }; }
    const x0 = side.normal[0] > 0 ? side.fixed : side.fixed - d; return { x0, x1: x0 + d, y0: u - w / 2, y1: u + w / 2 };
  }
  private free(b: Box2, tall: boolean) {
    const c: Point = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    if (b.x0 < this.minX - 0.01 || b.x1 > this.maxX + 0.01 || b.y0 < this.minY - 0.01 || b.y1 > this.maxY + 0.01 || !inside(c, this.room.points)) return false;
    if(!([[b.x0+.005,b.y0+.005],[b.x1-.005,b.y0+.005],[b.x1-.005,b.y1-.005],[b.x0+.005,b.y1-.005]] as Point[]).every(p=>inside(p,this.room.points)))return false;
    return !this.obstacles.some((o) => (tall || !o.tallOnly) && overlaps(b, o)) && !this.placed.some((o) => overlaps(b, o));
  }

  /** Há parede de verdade atrás do trecho [u - w/2, u + w/2] do lado? (Em salas integradas o contorno do cômodo pode ser aberto.) */
  private backed(side: Side, u: number, w: number) {
    const k = side.axis === 'x' ? 0 : 1; const fixedAxis = 1 - k;
    const spans = this.walls
      .filter((wall) => Math.abs(wall.a[fixedAxis] - wall.b[fixedAxis]) < 0.05 && Math.abs(wall.a[fixedAxis] - side.fixed) < inset + 0.2)
      .map((wall) => [Math.min(wall.a[k], wall.b[k]) - 0.1, Math.max(wall.a[k], wall.b[k]) + 0.1] as const)
      .sort((p, q) => p[0] - q[0]);
    let reach = u - w / 2;
    for (const [s0, s1] of spans) { if (s0 > reach + 0.01) break; reach = Math.max(reach, s1); }
    return reach >= u + w / 2 - 0.01;
  }

  /** Encosta o móvel numa parede; prefer: 'center' | 'start' | 'end' ou uma coordenada ao longo da parede. */
  wall(model: Model, w: number, d: number, opts: { tall?: boolean; prefer?: 'center' | 'start' | 'end' | number; sides?: Side[]; loose?: boolean } = {}) {
    for (const side of opts.sides ?? this.sides()) {
      if (side.to - side.from < w) continue;
      const lo = side.from + w / 2; const hi = side.to - w / 2;
      const target = typeof opts.prefer === 'number' ? opts.prefer : opts.prefer === 'start' ? lo : opts.prefer === 'end' ? hi : (lo + hi) / 2;
      let best: number | null = null;
      for (let u = lo; u <= hi + 1e-6; u += 0.05) {
        if (this.free(this.footprint(side, u, w, d), !!opts.tall) && (opts.loose || this.backed(side, u, w)) && (best == null || Math.abs(u - target) < Math.abs(best - target))) best = u;
      }
      if (best == null) continue;
      return this.put(model, this.footprint(side, best, w, d), side.normal, side, best);
    }
    return null;
  }

  /** Móvel solto (mesa, tapete): posição livre mais próxima do ponto preferido. */
  /** margin: folga em volta; [largura, profundidade] quando difere (mesa: cadeiras só nos lados compridos). */
  center(model: Model, w: number, d: number, near: Point, facing: Point = [0, 1], margin: number | [number, number] = 0, turnable = false): Placement | null {
    if (turnable) return this.center(model, w, d, near, [0, 1], margin) ?? this.center(model, w, d, near, [1, 0], margin);
    let best: { b: Box2; score: number } | null = null;
    const swap = Math.abs(facing[0]) > 0.5;
    const fw = swap ? d : w; const fd = swap ? w : d;
    const [mw, md] = typeof margin === 'number' ? [margin, margin] : margin;
    const [mx, my] = swap ? [md, mw] : [mw, md];
    for (let x = this.minX + fw / 2; x <= this.maxX - fw / 2 + 1e-6; x += 0.1) for (let y = this.minY + fd / 2; y <= this.maxY - fd / 2 + 1e-6; y += 0.1) {
      const b = { x0: x - fw / 2 - mx, x1: x + fw / 2 + mx, y0: y - fd / 2 - my, y1: y + fd / 2 + my };
      if (!this.free(b, false)) continue;
      const score = Math.hypot(x - near[0], y - near[1]);
      if (!best || score < best.score) best = { b, score };
    }
    if (!best) return null;
    this.placed.push(best.b);
    const b = { x0: best.b.x0 + mx, x1: best.b.x1 - mx, y0: best.b.y0 + my, y1: best.b.y1 - my };
    return this.put(model, b, facing, null, 0, 0, false);
  }

  private put(model: Model, b: Box2, normal: Point, side: Side | null, u: number, margin = 0, track = true): Placement {
    if (track) this.placed.push({ x0: b.x0 - margin, x1: b.x1 + margin, y0: b.y0 - margin, y1: b.y1 + margin });
    const c: Point = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    if(model.parts.some(p=>p.geo.positions.some((v,i)=>i%3===1&&v>.18)))this.solids.push({...b});
    this.out(model, c, Math.atan2(normal[0], normal[1]));
    return { box: b, center: c, normal, side, u };
  }
  mount(model:Model,at:Placement) {
    if(!this.obstacles.some(o=>overlaps(at.box,o)))this.out(model,at.center,Math.atan2(at.normal[0],at.normal[1]));
  }
  /** Lado em frente (normal contrária) que mais se sobrepõe ao trecho do móvel em u. */
  opposite(side: Side, u: number): Side {
    const facing = this.sides().filter((o) => o.axis === side.axis && o.normal[0] === -side.normal[0] && o.normal[1] === -side.normal[1]);
    const gap = (o: Side) => (u < o.from ? o.from - u : u > o.to ? u - o.to : 0);
    return facing.sort((p, q) => gap(p) - gap(q) || Math.abs(p.fixed - side.fixed) - Math.abs(q.fixed - side.fixed))[0] ?? side;
  }
}

/** Mesa de jantar com cadeiras: tenta a de 4 lugares e, sem espaço, a de 2. */
function dining(f: Furnisher, near: Point) {
  return f.center(furniture.dining(1.2, 0.8), 1.2, 0.8, near, [0, 1], [0.15, 0.5], true) ?? f.center(furniture.dining(0.8, 0.75), 0.8, 0.75, near, [0, 1], [0.1, 0.45], true);
}

function furnish(f: Furnisher, kind: RoomKind, home: { dining: boolean }) {
  const area = f.area;
  switch (kind) {
    case 'suite':
    case 'bedroom': {
      const double = kind === 'suite' || area > 10.5;
      const bw = double ? (kind === 'suite' && area > 11 ? 1.6 : 1.4) : 0.9; const bd = double ? 1.95 : 1.9;
      const bed = f.wall(furniture.bed(bw, bd), bw, bd, { prefer: 'center' });
      if (bed?.side) for (const s of double ? [-1, 1] : [1]) f.wall(furniture.nightstand(), 0.45, 0.4, { prefer: bed.u + s * (bw / 2 + 0.25), sides: [bed.side] });
      f.wall(furniture.wardrobe(area > 10 ? 1.8 : 1.4), area > 10 ? 1.8 : 1.4, 0.6, { tall: true, prefer: 'end' }) ?? f.wall(furniture.wardrobe(1), 1, 0.6, { tall: true });
      if (area > 11) f.wall(furniture.plant(0.9), 0.4, 0.4, { prefer: 'start', loose: true });
      break;
    }
    case 'living': {
      const sofaW = Math.min(2.2, Math.max(1.5, f.width * 0.55, f.depth * 0.55));
      const sofa = f.wall(furniture.sofa(sofaW), sofaW, 0.88, { prefer: 'center' }) ?? f.wall(furniture.sofa(1.5), 1.5, 0.88);
      if(sofa)f.viewFocus={point:sofa.center,normal:sofa.normal};
      if (sofa?.side) {
        const opp = f.opposite(sofa.side, sofa.u);
        f.wall(furniture.tv(1.6), 1.6, 0.4, { prefer: sofa.u, sides: [opp] }) ?? f.wall(furniture.tv(1.2), 1.2, 0.4, { prefer: sofa.u, sides: [opp] })
          ?? f.wall(furniture.tv(1.2), 1.2, 0.35, { tall:true });
        const front: Point = [sofa.center[0] + sofa.normal[0] * 1.0, sofa.center[1] + sofa.normal[1] * 1.0];
        const rug=f.center(furniture.rug(Math.min(2, sofaW), 1.4), Math.min(2, sofaW), 1.4, front, sofa.normal);
        if(rug)f.placed.pop(); // o tapete fica sob a mesa de centro
        f.center(furniture.coffeeTable(), 0.9, 0.5, front, sofa.normal, 0.25);
      }
      if (area > 11 && !home.dining) {
        const far: Point = sofa ? [sofa.center[0] + sofa.normal[0] * 8, sofa.center[1] + sofa.normal[1] * 8] : centroid([[f.minX, f.minY], [f.maxX, f.maxY]]);
        home.dining = !!dining(f, far);
      }
      f.wall(furniture.plant(), 0.4, 0.4, { prefer: 'start', loose: true });
      break;
    }
    case 'kitchen': {
      const cw = Math.min(2.6, Math.max(1.2, Math.max(f.width, f.depth) - 0.9));
      const counter = f.wall(furniture.counter(cw), cw, 0.6, { prefer: 'start' }) ?? f.wall(furniture.counter(1.2), 1.2, 0.6);
      if(counter)f.mount(furniture.upper(Math.max(counter.box.x1-counter.box.x0,counter.box.y1-counter.box.y0)),counter);
      if (counter?.side) f.wall(furniture.fridge(), 0.7, 0.68, { tall: true, prefer: 'end', sides: [counter.side] }) ?? f.wall(furniture.fridge(), 0.7, 0.68, { tall: true });
      else f.wall(furniture.fridge(), 0.7, 0.68, { tall: true });
      if (area > 8 && !home.dining) home.dining = !!dining(f, [(f.minX + f.maxX) / 2, (f.minY + f.maxY) / 2]);
      break;
    }
    case 'bathroom': {
      f.wall(furniture.shower(), 0.9, 0.9, { tall: true, prefer: 'end' }) ?? f.wall(furniture.shower(), 0.9, 0.9, { prefer: 'end' });
      f.wall(furniture.toilet(), 0.42, 0.65, { prefer: 'start' });
      f.wall(furniture.vanity(), 0.8, 0.46, { prefer: 'center' }) ?? f.wall(furniture.vanity(0.6), 0.6, 0.46, { prefer: 'center' });
      break;
    }
    case 'service': f.wall(furniture.washer(), 0.6, 0.6, { prefer: 'start' }); f.wall(furniture.tank(), 0.55, 0.5, { prefer: 'end' }); break;
    case 'balcony': {
      const table = f.center(furniture.sideTable(), 0.5, 0.5, [(f.minX + f.maxX) / 2, (f.minY + f.maxY) / 2], [0, 1], 0.1);
      if (table) for (const dx of [-0.6, 0.6]) {
        const horizontal = f.width >= f.depth;
        const p: Point = horizontal ? [table.center[0] + dx, table.center[1]] : [table.center[0], table.center[1] + dx];
        f.center(furniture.chair(), 0.5, 0.5, p, horizontal ? [-Math.sign(dx), 0] : [0, -Math.sign(dx)]);
      }
      f.wall(furniture.plant(), 0.4, 0.4, { prefer: 'end', loose: true });
      break;
    }
    case 'garden': for (const prefer of ['start', 'end'] as const) f.wall(furniture.plant(1.4), 0.6, 0.6, { prefer, loose: true }); break;
    case 'hall': break;
  }
}

export interface InteriorOptions { title: string; subtitle?: string; onClose?: () => void }

/** Sobreposição em tela cheia com a planta 3D mobiliada (motor próprio, liberado ao fechar). */
export class InteriorViewer {
  readonly ready:Promise<void>;
  private readonly root: HTMLElement;
  private engine: AbstractEngine | null = null;
  private scene!: Scene;
  private orbit!: ArcRotateCamera;
  private walker!: UniversalCamera;
  private sun!: DirectionalLight;
  private hemi!: HemisphericLight;
  private materials = new Map<string, PBRMaterial>();
  private readonly ceilings: TransformNode[] = [];
  private readonly lamps: (TransformNode | PointLight)[] = [];
  /** Paredes: na maquete ficam rebaixadas (corte a ~1,1 m) para mostrar os ambientes. */
  private readonly wallGroups: TransformNode[] = [];
  private readonly walls: { a: Point; b: Point; t: number; doors: [number, number][] }[] = [];
  private readonly architectureMaterials = new Set<PBRMaterial>();
  private readonly cutCaps:TransformNode[]=[];
  private readonly furnitureObstacles:InteriorObstacle[]=[];
  private navigation!:InteriorNavigation;
  private readonly rooms: { room: Room; center: Point; look: Point }[] = [];
  private readonly keys = new Set<string>();
  private readonly offset: Point;
  private readonly size: number;
  private mode: 'model' | 'walk' = 'model';
  private walk = { pos: new Vector3(), yaw: 0, pitch: 0 };
  private route:Point[]|null=null;
  private routeIndex=1;
  private routeYaw:number|null=null;
  private currentRoom=-1;
  private destination=-1;
  private touring=false;
  private tourQueue:number[]=[];
  private tourPause=0;
  private cutaway=true;
  private lighting:'day'|'warm'='day';
  private walkStarted=false;
  private targetMarker!:TransformNode;
  private readonly previousFocus=document.activeElement as HTMLElement|null;
  private last = performance.now();
  private closed = false;
  private compatibilityMode = false;
  private readonly onKey = (e: KeyboardEvent) => this.key(e);
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private readonly onResize = () => {
    this.engine?.setHardwareScalingLevel(renderScaling(innerWidth, innerHeight, devicePixelRatio, 1.5, this.compatibilityMode));
    this.engine?.resize();this.orbit?.getProjectionMatrix(true);
  };
  private readonly onBlur = () => this.keys.clear();

  constructor(private readonly layout: PlanLayout, private readonly options: InteriorOptions) {
    const pts = [...layout.walls.flatMap((w) => [w.a, w.b]), ...layout.rooms.flatMap((r) => r.points)];
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    this.offset = [(minX + maxX) / 2, (minY + maxY) / 2];
    this.size = Math.max(maxX - minX, maxY - minY, 4);

    this.root = document.createElement('div');
    this.root.className = 'interior loading';
    this.root.setAttribute('role','dialog');this.root.setAttribute('aria-modal','true');this.root.setAttribute('aria-label',`Visita ao apartamento — ${options.title}`);
    this.root.innerHTML = `
      <div class="interior-stage"></div>
      <div class="interior-top">
        <div class="interior-title"><b></b><small></small></div>
        <div class="card group"><button class="btn on" data-mode="model">▦ Planta 3D</button><button class="btn" data-mode="walk">◉ Passeio interno</button></div>
        <button class="interior-x" aria-label="Voltar ao empreendimento" title="Voltar ao empreendimento">×</button>
      </div>
      <aside class="interior-panel card" aria-label="Explorar o apartamento">
        <button class="interior-panel-toggle" aria-expanded="true">Explorar apartamento <span>−</span></button>
        <div class="interior-status" role="status" aria-live="polite"><span class="interior-status-dot"></span><div><b>Preparando apartamento</b><small>Escolha um ambiente para conhecer</small></div><button data-action="stop" aria-label="Parar deslocamento" hidden>Parar</button></div>
        <div class="interior-panel-content">
          <div class="interior-section-label">AMBIENTES</div>
          <div class="interior-rooms"></div>
          <div class="interior-tools"><button class="btn" data-action="walls" aria-pressed="true">Paredes baixas</button><button class="btn" data-action="light" aria-pressed="false">☀ Luz do dia</button><button class="btn" data-action="look">⤢ Olhar livre</button></div>
          <button class="btn primary interior-tour" data-action="tour">▷ Visita guiada</button>
          <p class="interior-note">Decoração ilustrativa. Medidas aproximadas da planta.</p>
        </div>
      </aside>
      <div class="interior-hint"></div>
      <aside class="interior-map card" aria-label="Mapa do apartamento"><button class="interior-map-toggle" aria-expanded="true">Localização <span>−</span></button><div class="interior-map-content"></div><small>Clique em um ambiente para visitar</small></aside>
      <div class="interior-pad" aria-label="Controles de movimento"><button data-k="arrowup" aria-label="Avançar">↑</button><button data-k="a" aria-label="Passo à esquerda">←</button><button data-k="arrowdown" aria-label="Recuar">↓</button><button data-k="d" aria-label="Passo à direita">→</button><button data-k="arrowleft" aria-label="Girar à esquerda">↶</button><button data-k="arrowright" aria-label="Girar à direita">↷</button></div>
      <div class="interior-loading"><span class="spinner"></span>Preparando sua visita…</div>`;
    (this.root.querySelector('.interior-title b') as HTMLElement).textContent = options.title;
    (this.root.querySelector('.interior-title small') as HTMLElement).textContent = options.subtitle ?? '';
    document.getElementById('app')!.appendChild(this.root);
    if(window.innerWidth<=760){const panel=this.root.querySelector('.interior-panel')!;panel.classList.add('collapsed');panel.querySelector('button')!.setAttribute('aria-expanded','false');panel.querySelector('.interior-panel-toggle span')!.textContent='+';}
    this.root.querySelector('.interior-x')!.addEventListener('click', () => this.close());
    window.addEventListener('keydown', this.onKey, true);
    this.ready=this.init().catch(error=>{this.engine?.stopRenderLoop();this.root.classList.remove('loading');this.status('Não foi possível abrir o apartamento','Feche esta vista. Se o monitor piscar, nao insista e use o modo seguro.');throw error;});
    void this.ready.catch(error=>console.error('Interior indisponível',error));
  }

  private async init() {
    const stage = this.root.querySelector('.interior-stage') as HTMLElement;
    const { engine, canvas, webgpu } = await createEngine(stage);
    if (this.closed) { engine.dispose(); return; }
    this.engine = engine;
    this.compatibilityMode = compatibilityMode(webgpu, location.search, isMobile());
    engine.setHardwareScalingLevel(renderScaling(innerWidth, innerHeight, devicePixelRatio, 1.5, this.compatibilityMode));
    const scene = this.scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.94, 0.935, 0.92, 1);
    scene.skipPointerMovePicking = true;
    scene.environmentTexture = skyEnvironment(scene);
    scene.environmentIntensity = 0.55;

    this.orbit = new ArcRotateCamera('orbit', 0, 1, 10, new Vector3(0, 0.6, 0), scene);
    let applyingInset = false;
    this.orbit.onProjectionMatrixChangedObservable.add(()=>{
      if(applyingInset||engine.getRenderHeight()<1)return;
      if(this.mode==='model'&&window.innerWidth>760){
        const width=this.root.querySelector('.interior-panel')!.getBoundingClientRect().width;
        applyingInset=true;
        try{this.orbit.getProjectionMatrix().addAtIndex(8,-(width+16)/window.innerWidth);}
        finally{applyingInset=false;}
      }
    });
    this.orbit.minZ = 0.05; this.orbit.maxZ = 300; this.orbit.fov = deg(45);
    this.orbit.upperBetaLimit = deg(80); this.orbit.lowerRadiusLimit = 2; this.orbit.upperRadiusLimit = this.size * 3;
    this.orbit.wheelDeltaPercentage = 0.01; this.orbit.inertia = 0.85; this.orbit.panningSensibility = 300;
    this.orbit.attachControl(false, false, 2);
    this.walker = new UniversalCamera('walk', new Vector3(0, eye, 0), scene);
    this.walker.minZ = 0.035; this.walker.maxZ = 300; this.walker.fov = deg(68); this.walker.inputs.clear();
    canvas.tabIndex=0;canvas.setAttribute('aria-label','Apartamento 3D. Arraste para olhar e use W A S D para caminhar.');
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    if (this.compatibilityMode) {
      const image = scene.imageProcessingConfiguration;
      image.applyByPostProcess = false; image.toneMappingEnabled = true;
      image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
      image.exposure = .94 / .6; image.contrast = 1.06;
    } else {
      const pipeline = new DefaultRenderingPipeline('interior', true, scene, [this.orbit, this.walker]);
      pipeline.samples = 2; pipeline.fxaaEnabled = false; pipeline.bloomEnabled = false;
      pipeline.imageProcessingEnabled = true;
      pipeline.imageProcessing.toneMappingEnabled = true;
      pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
      pipeline.imageProcessing.exposure = .94 / .6;
      pipeline.imageProcessing.contrast=1.06;
    }

    this.build();
    this.bind(canvas);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur',this.onBlur);document.addEventListener('visibilitychange',this.onBlur);
    this.setMode('model');
    engine.onContextLostObservable.add(() => {
      engine.stopRenderLoop();
      this.root.classList.remove('loading');
      this.status('Renderizacao interrompida', 'O navegador perdeu o contexto grafico. Feche esta vista; nao sera recarregada automaticamente.');
    });
    engine.runRenderLoop(() => {
      try { this.loop(); } catch (error) {
        engine.stopRenderLoop(); console.error('Falha no passeio 3D', error);
        this.root.classList.remove('loading'); this.status('Falha grafica', 'Feche esta vista e use o modo seguro.');
      }
    });
    await waitForVisibleFrame(scene);
    if(this.closed)return;
    this.root.classList.remove('loading');
  }

  private toWorld = ([x, y]: Point, h = 0) => new Vector3(x - this.offset[0], h, y - this.offset[1]);

  private material(key: string, recipe: Recipe) {
    if (!this.materials.has(key)) {
      const { tex, tile, ...options } = recipe;
      let map: DynamicTexture | null = null;
      if (tex) {
        map = new DynamicTexture(`${key}-tex`, tex(), this.scene, true);
        map.update(true); map.wrapU = map.wrapV = Texture.WRAP_ADDRESSMODE;
        map.uScale = map.vScale = 1 / (tile ?? 1); map.anisotropicFilteringLevel = 8;
      }
      this.materials.set(key, pbr(this.scene, key, { ...options, map, maxLights: this.compatibilityMode ? 4 : 8 }));
    }
    return this.materials.get(key)!;
  }

  /** Coloca um modelo na cena: uma malha por material, sob um nó posicionado e girado. */
  private place(model: Model, position: Vector3, rotY = 0, parent?: TransformNode, architecture=false) {
    const node = new TransformNode('model', this.scene);
    if (parent) node.parent = parent;
    node.position.copyFrom(position); node.rotation.y = rotY;
    const byKey = new Map<string, { paint: Paint; cast: boolean; geos: Geo[] }>();
    for (const p of model.parts) {
      const key = `${p.paint}|${p.cast}`;
      if (!byKey.has(key)) byKey.set(key, { paint: p.paint, cast: p.cast, geos: [] });
      byKey.get(key)!.geos.push(p.geo);
    }
    for (const part of byKey.values()) {
      const mat=this.material(`${architecture?'architecture-':''}${part.paint}`,palette[part.paint]);
      if(architecture)this.architectureMaterials.add(mat);
      shadows(meshFrom(part.paint,merge(part.geos),this.scene,mat,node),part.cast);
    }
    return node;
  }

  private build() {
    const scene = this.scene;
    const L = this.layout; const H = L.wallHeight;
    const s = this.size;
    this.sun = new DirectionalLight('sun', new Vector3(-0.6, -1.4, -0.8).normalize(), scene);
    this.sun.diffuse = rgb('#fff3e2'); this.sun.intensity = 2.2;
    this.sun.position = new Vector3(s * 0.6, s * 1.4, s * 0.8);
    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    this.hemi.diffuse = rgb('#f5f7fb'); this.hemi.groundColor = rgb('#b8ad9c'); this.hemi.intensity = 1.1 / Math.PI; this.hemi.specular.set(0, 0, 0);
    if (!this.compatibilityMode) {
    const shadow = new ShadowGenerator(1024, this.sun);
    shadow.usePercentageCloserFiltering = true; shadow.filteringQuality = ShadowGenerator.QUALITY_HIGH;
    shadow.bias = 0.0008; shadow.normalBias = 0.01;
    scene.onNewMeshAddedObservable.add(() => { dirty = true; });
    let dirty = true;
    scene.onBeforeRenderObservable.add(() => {
      if (!dirty) return; dirty = false;
      shadow.getShadowMap()!.renderList = scene.meshes.filter((mesh) => mesh.metadata?.castShadow === true && mesh.isEnabled());
    });
    this.refreshShadows = () => { dirty = true; };
    }

    const disc = Array.from({ length: 48 }, (_, i) => { const t = (i / 48) * Math.PI * 2; return [Math.cos(t) * s * 3, Math.sin(t) * s * 3] as Point; });
    shadows(meshFrom('ground', polygon(disc, -0.04), scene, this.material('ground', m('#ebe9e3', 1))), false);

    // Pisos e tetos por cômodo
    for (const room of L.rooms) {
      const pts = room.points.map(([x, y]) => [x - this.offset[0], y - this.offset[1]] as Point);
      const floor=shadows(meshFrom(`floor-${room.id}`, polygon(pts, 0.005), scene, this.material(`floor-${room.kind}`, floorFor[room.kind])), false);
      floor.metadata={...floor.metadata,walkTarget:true,roomId:room.id};
      if (room.kind !== 'balcony' && room.kind !== 'garden') {
        const ceiling = new TransformNode(`ceiling-${room.id}`, scene);
        shadows(meshFrom(`ceiling-${room.id}`, polygon(pts, H), scene, this.material('ceiling', palette.ceiling), ceiling), true);
        this.ceilings.push(ceiling);
        // Luminária de teto: luz quente que só acende no passeio.
        const [cx, cy] = centroid(room.points);
        const lamp = new PointLight(`lamp-${room.id}`, this.toWorld([cx, cy], H - 0.35), scene);
        lamp.diffuse = rgb('#fff0d8'); lamp.intensity = 1;lamp.range=3.5; lamp.specular = rgb('#fff0d8').scale(0.15);
        const fixture = this.place(new Model().add('lamp', cylinderGeo(0.18, 0.18, 0.03, 24), false), this.toWorld([cx, cy], H - 0.02));
        this.lamps.push(lamp, fixture);
      }
    }

    // Paredes com vãos
    const obstacles: Box2[] = [];
    for (const wall of L.walls) {
      const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]); const t = wall.thickness;
      const ux = (wall.b[0] - wall.a[0]) / len, uy = (wall.b[1] - wall.a[1]) / len;
      const model = new Model();const cutModel=new Model();
      const leaves:{model:Model;u:number;id:string}[]=[];
      /** Trecho de parede (com rodapé no chão e topo escuro, que aparece como "corte" na maquete). */
      const piece = (s0: number, s1: number, y0: number, y1: number, paint: Paint | null = null, depth = t) => {
        if (s1 - s0 < 0.005 || y1 - y0 < 0.005) return;
        const at = (geo: Geo) => translate(geo, (s0 + s1) / 2, y0 + (y1 - y0) / 2, 0);
        if (paint) { model.add(paint, at(boxGeo(s1 - s0, y1 - y0, depth))); return; }
        model.add('wall', at(boxGeo(s1 - s0, y1 - y0, depth, ['px', 'nx', 'ny', 'pz', 'nz'])));
        model.add('cap', at(boxGeo(s1 - s0, y1 - y0, depth, ['py'])));
        if(y0<=1.12&&y1>1.12)cutModel.add('cap',translate(boxGeo(s1-s0,.018,depth), (s0+s1)/2,1.12,0),false);
        if (y0 === 0) model.add('skirting', translate(boxGeo(s1 - s0, 0.08, depth + 0.02), (s0 + s1) / 2, 0.04, 0), false);
      };
      const openings = L.openings.filter((o) => o.wallId === wall.id).sort((p, q) => p.offset - q.offset);
      const doors: [number, number][] = [];
      let cursor = -t / 2;
      for (const o of openings) {
        const s0 = Math.max(0, o.offset - o.width / 2), s1 = Math.min(len, o.offset + o.width / 2);
        piece(cursor, s0, 0, H);
        const at = (u: number): Point => [wall.a[0] + ux * u, wall.a[1] + uy * u];
        const [p0, p1] = [at(s0), at(s1)];
        const bx = { x0: Math.min(p0[0], p1[0]), x1: Math.max(p0[0], p1[0]), y0: Math.min(p0[1], p1[1]), y1: Math.max(p0[1], p1[1]) };
        if (o.kind === 'window') {
          const sill = o.sill ?? 1.1; const top = Math.min(H - 0.05, sill + (o.height ?? 1.0));
          piece(s0, s1, 0, sill); piece(s0, s1, top, H);
          piece(s0 - 0.02, s1 + 0.02, sill - 0.03, sill, 'sill', t + 0.08);
          model.include(box(s1 - s0 - 0.04, top - sill - 0.04, 0.02, 'glass', (s0 + s1) / 2, sill + 0.02, 0, false));
          model.include(box(0.03, top - sill, 0.05, 'frame', (s0 + s1) / 2, sill, 0));
          // Janela baixa impede só móveis altos na frente; janela alta (basculante) não impede nada.
          if (sill < 1.4) {
            const [hx, hy] = Math.abs(ux) > 0.5 ? [0.05, 0.45] : [0.45, 0.05];
            obstacles.push({ x0: bx.x0 - hx, x1: bx.x1 + hx, y0: bx.y0 - hy, y1: bx.y1 + hy, tallOnly: true });
          }
        } else {
          const top = Math.min(H - 0.05, o.height ?? (o.kind === 'sliding' ? 2.2 : 2.1));
          piece(s0, s1, top, H);
          doors.push([s0, s1]);
          if (o.kind === 'door') {
            // Porta integralmente aberta: ferragens visiveis e passagem livre durante o passeio.
            leaves.push({model:detailedDoor(s1-s0-.045,top-.025),u:s0+.022,id:o.id});
            for(const u of [s0,s1]){
              model.include(box(.024,top,t+.006,'doorTrim',u+(u===s0?.012:-.012),0));
              for(const side of [-1,1])model.include(box(.067,top+.065,.022,'doorTrim',u+(u===s0?-.027:.027),0,side*(t/2+.012)));
              model.include(box(.012,top,.012,'doorReveal',u+(u===s0?.027:-.027),0,t/2-.006));
            }
            model.include(box(s1-s0,.026,t+.006,'doorTrim',(s0+s1)/2,top-.026));
            for(const side of [-1,1])model.include(box(s1-s0+.12,.067,.022,'doorTrim',(s0+s1)/2,top,side*(t/2+.012)));
          } else {
            const half = (s1 - s0) / 2;
            for (const [k, z] of [[0, -0.02], [1, 0.02]] as const) {
              model.include(box(half + 0.04, top - 0.04, 0.02, 'glass', s0 + half * (k + 0.5) + (k ? -0.02 : 0.02), 0.02, z, false));
              model.include(box(0.04, top, 0.04, 'frame', s0 + half * k + (k ? 0 : 0.02), 0, z));
            }
            model.include(box(s1 - s0, 0.04, t, 'frame', (s0 + s1) / 2, top - 0.04, 0));
          }
          // Área livre do vão: ao longo da parede, a largura; para os dois lados, o giro da folha.
          const along = (s1 - s0) / 2 + 0.05; const across = o.kind === 'door' ? Math.min(0.75, s1 - s0) : 0.6;
          const c: Point = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
          const [hx, hy] = Math.abs(ux) > 0.5 ? [along, across] : [across, along];
          obstacles.push({ x0: c[0] - hx, x1: c[0] + hx, y0: c[1] - hy, y1: c[1] + hy });
        }
        cursor = s1;
      }
      piece(cursor, len + t / 2, 0, H);
      this.walls.push({ a: wall.a, b: wall.b, t, doors });
      const wallGroup=this.place(model,this.toWorld(wall.a),-Math.atan2(uy,ux),undefined,true);this.wallGroups.push(wallGroup);
      for(const leaf of leaves){const node=this.place(leaf.model,new Vector3(leaf.u,.012,t/2),-Math.PI/2,wallGroup,true);node.name=`door-leaf-${leaf.id}`;node.metadata={doorLeaf:true,openingId:leaf.id,finish:'lacquer',openDegrees:90};}
      this.cutCaps.push(this.place(cutModel,this.toWorld(wall.a),-Math.atan2(uy,ux)));
    }

    // Mobiliário
    const home = { dining: false };
    // Sala antes da cozinha: em plantas integradas a mesa de jantar fica num só lugar.
    const order: RoomKind[] = ['living', 'kitchen'];
    const rooms = [...L.rooms].sort((p, q) => (order.indexOf(p.kind) + 1 || 9) - (order.indexOf(q.kind) + 1 || 9));
    for (const room of rooms) {
      const f = new Furnisher(room, obstacles, (model, at, rotY) => this.place(model, this.toWorld(at), rotY), L.walls);
      try { furnish(f, room.kind, home); } catch { /* cômodo irregular: segue sem mobiliário */ }
      this.furnitureObstacles.push(...f.solids);
      const view = this.bestView(room, f);
      this.rooms.push({ room, center: view.pos, look: view.look });
    }
    this.navigation=new InteriorNavigation(L,this.furnitureObstacles);
    for(const r of this.rooms)r.center=this.navigation.nearest(r.center,r.room.points)??r.center;
    this.targetMarker=this.place(group(cylinder(.2,.012,'accent'),cylinder(.135,.014,'white',0,.01)),new Vector3());
    this.targetMarker.setEnabled(false);

    const list = this.root.querySelector('.interior-rooms')!;
    list.innerHTML = this.rooms.map((r, i) => `<button data-i="${i}">${escapeHtml(r.room.name)}<small>${polygonArea(r.room.points).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m² · ${roomLabel[r.room.kind]}</small></button>`).join('');
    list.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {this.stopRoute();this.goRoom(Number(b.dataset.i));}));
    this.buildMinimap();
  }
  private refreshShadows = () => {};

  /**
   * Ponto de vista do passeio em cada cômodo: entre posições livres (longe das paredes e fora dos
   * móveis), escolhe a direção com a maior profundidade de visão até as paredes.
   */
  private bestView(room: Room, f: Furnisher): { pos: Point; look: Point } {
    const segments = this.layout.walls.map((w) => [w.a, w.b] as const);
    const ray = (p: Point, angle: number) => {
      const dx = Math.cos(angle), dy = Math.sin(angle); let best = 12;
      for (const [a, b] of segments) {
        const ex = b[0] - a[0], ey = b[1] - a[1]; const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den; const u = ((a[0] - p[0]) * dy - (a[1] - p[1]) * dx) / den;
        if (t > 0.05 && u >= 0 && u <= 1 && t < best) best = t;
      }
      return best;
    };
    const clearance = (p: Point) => Math.min(...segments.map(([a, b]) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9; const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      const t = Math.max(0, Math.min(len, (p[0] - a[0]) * ux + (p[1] - a[1]) * uy));
      return Math.hypot(p[0] - (a[0] + ux * t), p[1] - (a[1] + uy * t));
    }));
    const fallback = centroid(room.points);
    let best = { score: -1, pos: fallback, angle: 0 };
    let focused:{score:number;pos:Point;look:Point}|null=null;
    for (let x = f.minX; x <= f.maxX; x += 0.2) for (let y = f.minY; y <= f.maxY; y += 0.2) {
      const p: Point = [x, y];
      if (!inside(p, room.points) || clearance(p) < 0.45 || f.placed.some((b) => x > b.x0 - 0.15 && x < b.x1 + 0.15 && y > b.y0 - 0.15 && y < b.y1 + 0.15)) continue;
      if(f.viewFocus){
        const {point,normal}=f.viewFocus,dx=p[0]-point[0],dy=p[1]-point[1],angle=Math.atan2(-dy,-dx),tangent:Point=[-normal[1],normal[0]];
        const score=Math.hypot(p[0]-point[0]-normal[0]*2.3+tangent[0]*.75,p[1]-point[1]-normal[1]*2.3+tangent[1]*.75);
        if(dx*normal[0]+dy*normal[1]>.8&&ray(p,angle)>=Math.hypot(dx,dy)-.1&&(!focused||score<focused.score))focused={score,pos:p,look:[point[0]+tangent[0]*.35,point[1]+tangent[1]*.35]};
      }
      for (let k = 0; k < 16; k++) {
        const angle = (k / 16) * Math.PI * 2;
        const score = ray(p, angle) * 2 + ray(p, angle - 0.45) + ray(p, angle + 0.45);
        if (score > best.score) best = { score, pos: p, angle };
      }
    }
    return focused??{ pos: best.pos, look: [best.pos[0] + Math.cos(best.angle), best.pos[1] + Math.sin(best.angle)] };
  }

  private bind(canvas: HTMLCanvasElement) {
    const panel=this.root.querySelector('.interior-panel')!,toggle=panel.querySelector('.interior-panel-toggle')!;
    toggle.addEventListener('click',()=>{const collapsed=panel.classList.toggle('collapsed');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.querySelector('span')!.textContent=collapsed?'+':'−';});
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode as 'model' | 'walk')));
    this.root.querySelector('[data-action=walls]')!.addEventListener('click',()=>{this.cutaway=!this.cutaway;this.applyCutaway();});
    this.root.querySelector('[data-action=light]')!.addEventListener('click',()=>{this.lighting=this.lighting==='day'?'warm':'day';this.applyLighting();});
    this.root.querySelector('[data-action=tour]')!.addEventListener('click',()=>this.touring?this.stopRoute():this.startTour());
    this.root.querySelector('[data-action=stop]')!.addEventListener('click',()=>this.stopRoute());
    this.root.querySelector('[data-action=look]')!.addEventListener('click',()=>{if(this.mode!=='walk')this.setMode('walk');canvas.requestPointerLock?.()?.catch(()=>this.status('Arraste para olhar','Seu navegador nao liberou o cursor; o passeio continua disponivel.'));});
    let drag: { x: number; y: number; moved:number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { canvas.focus();if (this.mode === 'walk') { drag = { x: e.clientX, y: e.clientY,moved:0 }; canvas.setPointerCapture(e.pointerId); } });
    canvas.addEventListener('pointermove', (e) => {
      if (this.mode !== 'walk'||(!drag&&document.pointerLockElement!==canvas)) return;
      const dx=document.pointerLockElement===canvas?e.movementX:e.clientX-drag!.x,dy=document.pointerLockElement===canvas?e.movementY:e.clientY-drag!.y;
      this.walk.yaw += dx * 0.0028; this.walk.pitch = Math.min(0.7, Math.max(-0.9, this.walk.pitch - dy * 0.0028));
      if(drag){drag.moved+=Math.hypot(dx,dy);drag.x=e.clientX;drag.y=e.clientY;}
      if(this.route||this.touring)this.stopRoute();
    });
    canvas.addEventListener('pointerup', (e) => {
      if(drag&&drag.moved<6&&document.pointerLockElement!==canvas){
        const rect=canvas.getBoundingClientRect();const hit=this.scene.pick((e.clientX-rect.left)*this.engine!.getRenderWidth()/rect.width,(e.clientY-rect.top)*this.engine!.getRenderHeight()/rect.height,m=>!!m.metadata?.walkTarget);
        if(hit?.pickedPoint){const p:Point=[hit.pickedPoint.x+this.offset[0],hit.pickedPoint.z+this.offset[1]];const room=this.rooms.find(r=>r.room.id===hit.pickedMesh?.metadata?.roomId);const to=this.navigation.nearest(p,room?.room.points,.8);if(to){this.stopRoute();this.moveTo(to);}}
      }
      drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointercancel',()=>{drag=null;});
    canvas.addEventListener('wheel', (e) => { if (this.mode === 'walk') { e.preventDefault();this.stopRoute();this.step(-Math.sign(e.deltaY) * 0.25, 0); } }, { passive: false });
    this.root.querySelectorAll<HTMLButtonElement>('.interior-pad button').forEach((b) => {
      const k = b.dataset.k!;
      b.addEventListener('pointerdown', (e) => {this.stopRoute();b.setPointerCapture(e.pointerId);this.keys.add(k);}); for (const ev of ['pointerup', 'pointercancel','lostpointercapture']) b.addEventListener(ev, () => this.keys.delete(k));
    });
  }

  private status(title:string,detail:string){
    this.root.querySelector('.interior-status b')!.textContent=title;
    this.root.querySelector('.interior-status small')!.textContent=detail;
    (this.root.querySelector('[data-action=stop]') as HTMLButtonElement).hidden=!this.route&&!this.touring;
  }

  private buildMinimap(){
    const n=this.navigation,pad=.3;
    this.root.querySelector('.interior-map-content')!.innerHTML=`<svg viewBox="${n.minX-pad} ${n.minY-pad} ${n.maxX-n.minX+pad*2} ${n.maxY-n.minY+pad*2}" aria-label="Planta de localização">${this.rooms.map((r,i)=>`<g data-room="${i}" role="button" tabindex="0" aria-label="Visitar ${escapeHtml(r.room.name)}"><polygon points="${r.room.points.map(p=>p.join(',')).join(' ')}"/><text x="${centroid(r.room.points)[0]}" y="${centroid(r.room.points)[1]}">${escapeHtml(roomLabel[r.room.kind])}</text></g>`).join('')}<polyline class="map-route"/><g class="map-position"><path d="M 0 -.48 L -.22 -.03 L .22 -.03 Z"/><circle r=".12"/></g></svg>`;
    this.root.querySelectorAll<SVGGElement>('[data-room]').forEach(g=>{const go=()=>{this.stopRoute();this.goRoom(Number(g.dataset.room));};g.addEventListener('click',go);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});
    const toggle=this.root.querySelector<HTMLButtonElement>('.interior-map-toggle')!;
    toggle.addEventListener('click',()=>{const collapsed=this.root.querySelector('.interior-map')!.classList.toggle('collapsed');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.querySelector('span')!.textContent=collapsed?'+':'−';});
  }

  private applyCutaway(){
    const cut=this.mode==='model'&&this.cutaway;
    for(const material of this.architectureMaterials)material.clipPlane=cut?new Plane(0,1,0,-1.12):null;
    for(const cap of this.cutCaps)cap.setEnabled(cut);
    const button=this.root.querySelector('[data-action=walls]')!;button.setAttribute('aria-pressed',String(this.cutaway));button.textContent=this.cutaway?'Paredes baixas':'Paredes completas';
    this.refreshShadows();
  }

  private applyLighting(){
    const walk=this.mode==='walk',warm=this.lighting==='warm',s=this.size;
    this.sun.position.set(s*.6,s*(walk?.65:1.4),s*.8);this.sun.direction=this.sun.position.scale(-1).normalize();
    this.sun.intensity=warm?1.65:2.4;this.hemi.intensity=(warm?.9:walk?1.65:1.1)/Math.PI;this.scene.environmentIntensity=warm?.45:walk?.75:.62;
    this.sun.diffuse=rgb(warm?'#ffe1bc':'#fff8ed');
    for(const lamp of this.lamps){lamp.setEnabled(walk);if(lamp instanceof PointLight)lamp.intensity=warm?1.25:.45;}
    const button=this.root.querySelector('[data-action=light]')!;button.textContent=warm?'☾ Luz aconchegante':'☀ Luz do dia';button.setAttribute('aria-pressed',String(warm));
  }

  private key(e: KeyboardEvent) {
    if(e.key==='Tab'){
      const focusable=[...this.root.querySelectorAll<HTMLElement>('button,[tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.hasAttribute('disabled'));
      const first=focusable[0],last=focusable.at(-1);
      if(e.shiftKey&&(document.activeElement===first||!this.root.contains(document.activeElement))){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!this.root.contains(document.activeElement))){e.preventDefault();first?.focus();}
      return;
    }
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault();if(this.route||this.touring)this.stopRoute();else if(this.mode==='walk')this.setMode('model');else this.close();return; }
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      e.stopPropagation(); e.preventDefault();
      if (!this.engine) return;
      if (this.mode !== 'walk') this.setMode('walk');
      this.stopRoute();
      this.keys.add(k);
    }
  }

  setMode(mode: 'model' | 'walk', room?: number) {
    this.stopRoute();this.keys.clear();
    this.mode = mode;
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    this.root.classList.toggle('walking', mode === 'walk');
    if (!this.engine) return;
    const walk = mode === 'walk';
    for (const c of this.ceilings) c.setEnabled(walk);
    this.applyLighting();this.applyCutaway();
    if(walk)this.orbit.detachControl();else{this.orbit.attachControl(false,false,2);if(document.pointerLockElement)this.root.ownerDocument.exitPointerLock();}
    this.scene.activeCamera = walk ? this.walker : this.orbit;
    this.orbit.getProjectionMatrix(true);
    (this.root.querySelector('.interior-hint') as HTMLElement).textContent = walk
      ? 'Clique no piso para caminhar · arraste para olhar · W A S D ou setas · Esc volta'
      : 'Arraste para girar · roda aproxima · escolha um ambiente para entrar';
    if (!walk) {
      this.orbit.setTarget(new Vector3(0, 0.6, 0));
      this.orbit.setPosition(new Vector3(this.size * 0.3, this.size * 1.15, this.size * 0.75));
      this.status('Apartamento em 3D','Explore a planta ou inicie uma visita guiada.');
    } else {
      const living = this.rooms.findIndex((r) => r.room.kind === 'living');
      if(!this.walkStarted||room!==undefined){this.goRoom(room ?? (living >= 0 ? living : 0), true);this.walkStarted=true;}
      else this.status('Passeio livre','Escolha um destino na planta ou caminhe pelo piso.');
    }
  }

  private goRoom(index: number, instant = false) {
    const r = this.rooms[index]; if (!r) return;
    if (this.mode === 'model') { this.setMode('walk', index); return; }
    const dir = this.toWorld(r.look).subtract(this.toWorld(r.center));
    const yaw = Math.atan2(dir.x, -dir.z);
    this.walk.pitch = r.room.kind==='living'?-.22:-.12;
    this.destination=index;
    if (instant) { this.walk.pos.copyFrom(this.toWorld(r.center,eye));this.walk.yaw=yaw;this.currentRoom=index;this.status(r.room.name,'Arraste para olhar ao redor.');return; }
    if(this.moveTo(r.center,yaw))this.status(`A caminho: ${r.room.name}`,'Percurso pelas portas, sem atravessar paredes ou móveis.');
  }

  private moveTo(to:Point,yaw:number|null=null){
    const from:Point=[this.walk.pos.x+this.offset[0],this.walk.pos.z+this.offset[1]];
    const route=this.navigation.path(from,to);
    if(!route){this.status('Caminho indisponível','Escolha outro ponto livre no piso ou volte à visão geral.');return false;}
    this.route=route;this.routeIndex=1;this.routeYaw=yaw;this.targetMarker.position.copyFrom(this.toWorld(to,.025));this.targetMarker.setEnabled(true);
    this.status('Caminhando até o destino','Você pode interromper com as setas ou arrastando a vista.');return true;
  }

  private stopRoute(){
    this.route=null;this.touring=false;this.tourQueue=[];this.tourPause=0;this.targetMarker?.setEnabled(false);
    const b=this.root.querySelector('[data-action=tour]');if(b){b.textContent='▷ Visita guiada';b.setAttribute('aria-pressed','false');}
    if(this.root.querySelector('.interior-status'))this.status(this.rooms[this.currentRoom]?.room.name??'Passeio livre','Escolha um ambiente ou caminhe pelo piso.');
  }

  private startTour(){
    if(this.mode!=='walk')this.setMode('walk');this.stopRoute();this.touring=true;this.tourQueue=this.rooms.map((_,i)=>i).filter(i=>i!==this.currentRoom);this.tourPause=.2;
    const b=this.root.querySelector('[data-action=tour]')!;b.textContent='■ Encerrar visita';b.setAttribute('aria-pressed','true');this.status('Visita guiada','Percorrendo os ambientes do apartamento.');
  }

  /** Bloqueia o passeio nas paredes, exceto pelos vãos de portas. */
  private blocked(x: number, z: number) {
    return this.navigation.blocked([x+this.offset[0],z+this.offset[1]]);
  }

  private step(forward: number, strafe: number) {
    const sin = Math.sin(this.walk.yaw), cos = Math.cos(this.walk.yaw);
    const dx = sin * forward + cos * strafe; const dz = -cos * forward + sin * strafe;
    const pos = this.walk.pos;
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.04));
    for(let i=0;i<steps;i++){if (!this.blocked(pos.x + dx/steps, pos.z)) pos.x += dx/steps;if (!this.blocked(pos.x, pos.z + dz/steps)) pos.z += dz/steps;}
  }

  private loop() {
    if(document.hidden || this.closed)return;
    if(performance.now()-this.last<1000/(this.compatibilityMode?30:60)-1)return;
    const now = performance.now(); const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (this.mode === 'walk') {
      const k = this.keys; const speed = 1.2 * dt;
      const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const turn = (k.has('arrowright') ? 1 : 0) - (k.has('arrowleft') ? 1 : 0);
      const strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
      if (turn) this.walk.yaw += turn * 1.2 * dt;
      if (fwd || strafe){const norm=Math.hypot(fwd,strafe);this.step(fwd/norm*speed,strafe/norm*speed);}
      if(this.route){
        const p=this.toWorld(this.route[this.routeIndex],eye),delta=p.subtract(this.walk.pos),distance=delta.length(),travel=1.1*dt;
        if(distance<=travel){this.walk.pos.copyFrom(p);this.routeIndex++;if(this.routeIndex>=this.route.length){this.route=null;this.targetMarker.setEnabled(false);if(this.routeYaw!==null)this.walk.yaw=this.routeYaw;this.tourPause=3;this.status(this.rooms[this.destination]?.room.name??'Destino alcançado','Olhe ao redor ou escolha o próximo ambiente.');}}
        else{this.walk.pos.addInPlace(delta.scale(travel/distance));let angle=Math.atan2(delta.x,-delta.z)-this.walk.yaw;angle=Math.atan2(Math.sin(angle),Math.cos(angle));this.walk.yaw+=angle*Math.min(1,dt*4);}
      }else if(this.touring){
        this.tourPause-=dt;if(this.tourPause<=0){const next=this.tourQueue.shift();if(next===undefined){this.stopRoute();this.status('Visita concluída','Continue explorando livremente.');}else{this.goRoom(next);if(!this.route)this.tourPause=1;}}
      }
      const { pos, yaw, pitch } = this.walk;
      this.walker.position.copyFrom(pos);
      this.walker.setTarget(new Vector3(pos.x + Math.sin(yaw) * Math.cos(pitch), pos.y + Math.sin(pitch), pos.z - Math.cos(yaw) * Math.cos(pitch)));
      const point:Point=[pos.x+this.offset[0],pos.z+this.offset[1]];
      const nextRoom=this.rooms.findIndex(r=>pointInRoom(point,r.room.points));
      if(nextRoom!==this.currentRoom){this.currentRoom=nextRoom;if(nextRoom>=0&&!this.route&&!this.touring)this.status(this.rooms[nextRoom].room.name,'Explore este ambiente ou escolha o próximo destino.');}
      this.root.querySelector('.map-position')?.setAttribute('transform',`translate(${point[0]} ${point[1]}) rotate(${yaw*180/Math.PI})`);
      this.root.querySelector('.map-route')?.setAttribute('points',this.route?[point,...this.route.slice(this.routeIndex)].map(p=>p.join(',')).join(' '):'');
      this.root.querySelectorAll<HTMLElement>('[data-i]').forEach(b=>{const on=Number(b.dataset.i)===this.currentRoom;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
      this.root.querySelectorAll<SVGGElement>('[data-room]').forEach(g=>g.classList.toggle('on',Number(g.dataset.room)===this.currentRoom));
    }
    this.scene.render();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur',this.onBlur);document.removeEventListener('visibilitychange',this.onBlur);
    if(document.pointerLockElement&&this.root.contains(document.pointerLockElement))document.exitPointerLock();
    this.engine?.stopRenderLoop();
    this.scene?.dispose();
    this.engine?.dispose();
    this.root.remove();
    this.previousFocus?.focus();
    this.options.onClose?.();
  }
}

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
