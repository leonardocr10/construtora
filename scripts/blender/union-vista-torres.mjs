// Fachada das torres do Union Vista (e-book) e geração dos GLB no Blender, já em uso no visualizador.
//   npm run build --workspace=@vistahub/api      (o script usa o serviço compilado da API)
//   node scripts/blender/union-vista-torres.mjs [slug]
//
// O que vem do material do cliente e o que é estimado fica registrado em model3d.facade (source/estimated),
// e o painel permite corrigir. Não altera pavimentos nem unidades.
import 'dotenv/config';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const slug = process.argv[2] ?? 'union-vista';
const prisma = new PrismaClient();

// Render do e-book (págs. 1 e 3): painéis verde-menta nas pontas e cinza-claro junto ao núcleo, faixa do
// núcleo laranja com varandas em balanço e guarda-corpo metálico escuro, janelas quadradas com caixilho claro.
// Varanda gourmet de 2,30 m nas plantas 01 (finais junto ao núcleo, pág. 7); balanço e janelas não têm cota.
const facade = {
  tones: ['#d0e2d8', '#e3e4e9'],
  frame: '#eceeee',
  glass: '#2f3a44',
  railing: '#2e3236',
  window: { width: 1.2, height: 1.0, sill: 1.05 },
  smallWindow: 0.6,
  balconies: { enabled: true, width: 2.3, projection: 1.2, fromFloor: 1, railHeight: 1.1 },
  floorJoints: true,
  source: 'e-book Union Vista: render das págs. 1 e 3 (cores, faixa do núcleo, varandas, guarda-corpo) e planta 01, pág. 7 (varanda gourmet 2,30 m)',
  estimated: ['tones', 'window', 'smallWindow', 'balconies.projection', 'frame', 'railing', 'glass'],
};
const accent = '#dc733c';

const development = await prisma.development.findFirst({ where: { slug }, include: { buildings: { orderBy: { code: 'asc' } } } });
if (!development) { console.error(`Empreendimento ${slug} não encontrado`); process.exit(1); }
const editor = await prisma.organizationUser.findFirst({ where: { organizationId: development.organizationId, active: true, role: { in: ['SUPERADMIN', 'ADMIN', 'MANAGER', 'EDITOR'] } } });
if (!editor) { console.error('Nenhum usuário editor na organização'); process.exit(1); }

for (const building of development.buildings) {
  const model3d = { ...(building.model3d ?? {}) };
  model3d.colors = { ...(model3d.colors ?? {}), facade: facade.tones[0], accent };
  model3d.facade = { ...facade, ...(model3d.facade ?? {}), source: facade.source };
  await prisma.building.update({ where: { id: building.id }, data: { model3d } });
}
console.log(`Fachada gravada em ${development.buildings.length} torres`);

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../apps/api/dist/app.module.js');
const { ModelGenerationService } = require('../../apps/api/dist/model-generation/model-generation.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
const generation = app.get(ModelGenerationService);
const context = { userId: editor.userId, organizationId: development.organizationId, role: editor.role };
for (const building of development.buildings) {
  const started = Date.now();
  const result = await generation.generateTowerModel(context, building.id, { activate: true });
  console.log(`${building.name}: versão ${result.modelVersion.version}, ${(Number(result.asset.byteSize) / 1048576).toFixed(2)} MB, ${result.unitNodes} volumes de apartamento, ${Date.now() - started} ms`);
}
await app.close();
await prisma.$disconnect();
