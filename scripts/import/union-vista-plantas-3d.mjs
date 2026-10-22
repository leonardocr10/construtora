// Planta vetorizada (paredes, portas, janelas e cômodos) das plantas 01 e 02 do Union Vista,
// tracejada sobre as imagens do e-book (págs. 7 e 8) e calibrada pelas cotas impressas
// (sala 3,00 m / suíte 3,30 m / cozinha 4,60 m). Medidas aproximadas, só para a planta 3D ilustrativa.
// As versões garden usam a mesma planta do apartamento (o garden não está vetorizado).
//
// Uso (depois de `npm run build`, que compila o validador da API):
//   node scripts/import/union-vista-plantas-3d.mjs
import 'dotenv/config';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { parsePlanLayout } = require('../../apps/api/dist/structure/plan-layout.js');

const EXT = 0.15; const INT = 0.1;

/**
 * Planta em pixels da imagem → metros. Paredes: [a, b, espessura, aberturas];
 * cada abertura informa o centro em pixels na coordenada que varia ao longo da parede.
 */
function build({ ppm, walls, rooms }) {
  const m = (v) => Math.round((v / ppm) * 1000) / 1000;
  const layout = { version: 1, pxPerMeter: ppm, wallHeight: 2.6, walls: [], openings: [], rooms: [] };
  walls.forEach(([a, b, thickness, openings = []], i) => {
    const id = `w${i + 1}`;
    layout.walls.push({ id, a: [m(a[0]), m(a[1])], b: [m(b[0]), m(b[1])], thickness });
    const axis = a[0] === b[0] ? 1 : 0;
    openings.forEach(({ at, ...rest }, j) => layout.openings.push({ id: `${id}o${j + 1}`, wallId: id, offset: m(Math.abs(at - a[axis])), ...rest }));
  });
  rooms.forEach(([name, kind, points], i) => layout.rooms.push({ id: `r${i + 1}`, name, kind, points: points.map(([x, y]) => [m(x), m(y)]) }));
  return layout;
}

const door = (at, width = 0.8) => ({ at, width, kind: 'door' });
const sliding = (at, width) => ({ at, width, kind: 'sliding' });
const window_ = (at, width, sill = 1.1, height = 1.2) => ({ at, width, kind: 'window', sill, height });
const small = (at) => window_(at, 0.6, 1.5, 0.6);

const planta01 = build({
  ppm: 153,
  walls: [
    [[377, 162], [1520, 162], EXT, [door(760, 0.9)]],
    [[1520, 162], [1520, 752], EXT],
    [[1150, 752], [1520, 752], EXT, [window_(1335, 2.2, 1.0, 1.5)]],
    [[1152, 752], [1152, 1370], EXT, [small(845)]],
    [[632, 1370], [1152, 1370], EXT, [window_(895, 1.4)]],
    [[632, 1278], [632, 1370], EXT],
    [[55, 1278], [632, 1278], EXT, [window_(300, 1.2), small(535)]],
    [[55, 752], [55, 1278], EXT],
    [[55, 752], [437, 752], EXT],
    [[377, 162], [377, 752], EXT],
    [[845, 162], [845, 365], INT],
    [[1150, 452], [1520, 452], INT, [sliding(1285, 1.2)]],
    [[1150, 452], [1150, 752], INT, [sliding(600, 1.4)]],
    [[632, 752], [1150, 752], INT, [door(700)]],
    [[437, 752], [437, 1278], INT, [door(824)]],
    [[437, 895], [632, 895], INT, [door(560, 0.7)]],
    [[632, 752], [632, 1278], INT],
    [[800, 752], [800, 950], INT, [door(850, 0.7)]],
    [[800, 950], [1152, 950], INT],
  ],
  rooms: [
    ['Sala de estar e jantar', 'living', [[377, 162], [845, 162], [845, 752], [632, 752], [632, 895], [437, 895], [437, 752], [377, 752]]],
    ['Cozinha e área de serviço', 'kitchen', [[845, 162], [1520, 162], [1520, 452], [1150, 452], [1150, 752], [845, 752]]],
    ['Varanda gourmet', 'balcony', [[1150, 452], [1520, 452], [1520, 752], [1150, 752]]],
    ['Quarto', 'bedroom', [[55, 752], [437, 752], [437, 1278], [55, 1278]]],
    ['Banheiro social', 'bathroom', [[437, 895], [632, 895], [632, 1278], [437, 1278]]],
    ['Suíte', 'suite', [[632, 752], [800, 752], [800, 950], [1152, 950], [1152, 1370], [632, 1370]]],
    ['Banheiro da suíte', 'bathroom', [[800, 752], [1152, 752], [1152, 950], [800, 950]]],
  ],
});

const planta02 = build({
  ppm: 140,
  walls: [
    [[578, 185], [1222, 185], EXT],
    [[1222, 185], [1222, 445], EXT],
    [[1222, 272], [1385, 272], EXT, [door(1300, 0.9)]],
    [[1385, 272], [1385, 805], EXT],
    [[1095, 805], [1385, 805], EXT],
    [[1095, 805], [1095, 1275], EXT],
    [[578, 1275], [1095, 1275], EXT, [small(667), window_(880, 1.2)]],
    [[578, 1275], [578, 1358], EXT],
    [[108, 1358], [578, 1358], EXT, [window_(342, 1.4)]],
    [[108, 800], [108, 1358], EXT, [small(890)]],
    [[108, 800], [430, 800], EXT],
    [[320, 445], [320, 800], EXT, [window_(622, 2.2, 1.0, 1.5)]],
    [[320, 445], [578, 445], EXT],
    [[578, 185], [578, 445], EXT, [window_(365, 0.9)]],
    [[578, 445], [625, 445], INT],
    [[578, 445], [578, 800], INT, [sliding(622, 2.0)]],
    [[430, 800], [578, 800], INT],
    [[430, 800], [430, 980], INT, [door(862, 0.7)]],
    [[108, 980], [430, 980], INT],
    [[430, 935], [578, 935], INT, [door(504)]],
    [[578, 935], [750, 935], INT, [door(655, 0.7)]],
    [[578, 935], [578, 1275], INT],
    [[750, 805], [750, 1275], INT],
    [[750, 805], [1095, 805], INT, [door(812)]],
  ],
  rooms: [
    ['Cozinha e área de serviço', 'kitchen', [[578, 185], [1222, 185], [1222, 445], [578, 445]]],
    ['Sala de TV e jantar', 'living', [[578, 445], [1222, 445], [1222, 272], [1385, 272], [1385, 805], [750, 805], [750, 935], [430, 935], [430, 800], [578, 800]]],
    ['Varanda gourmet', 'balcony', [[320, 445], [578, 445], [578, 800], [320, 800]]],
    ['Banheiro da suíte', 'bathroom', [[108, 800], [430, 800], [430, 980], [108, 980]]],
    ['Suíte', 'suite', [[108, 980], [430, 980], [430, 935], [578, 935], [578, 1358], [108, 1358]]],
    ['Banheiro social', 'bathroom', [[578, 935], [750, 935], [750, 1275], [578, 1275]]],
    ['Quarto', 'bedroom', [[750, 805], [1095, 805], [1095, 1275], [750, 1275]]],
  ],
});

const prisma = new PrismaClient();
try {
  const development = await prisma.development.findFirst({ where: { slug: 'union-vista' } });
  if (!development) throw new Error('Empreendimento union-vista não encontrado. Rode antes scripts/import/union-vista.mjs.');
  const byCode = { P01: planta01, 'P01-G': planta01, P02: planta02, 'P02-G': planta02 };
  for (const [code, base] of Object.entries(byCode)) {
    const plan = await prisma.floorPlan.findFirst({ where: { developmentId: development.id, code }, include: { assets: { where: { kind: 'FLOOR_PLAN' }, select: { id: true } } } });
    if (!plan) { console.warn(`Planta ${code} não encontrada, ignorada.`); continue; }
    // A imagem de fundo do editor só vale para a planta tracejada (as garden têm outra arte).
    const layout = parsePlanLayout({ ...base, imageAssetId: code.endsWith('-G') ? undefined : plan.assets[0]?.id });
    await prisma.floorPlan.update({ where: { id: plan.id }, data: { layout } });
    console.log(`${plan.name}: ${layout.walls.length} paredes, ${layout.openings.length} aberturas, ${layout.rooms.length} cômodos.`);
  }
} finally {
  await prisma.$disconnect();
}
