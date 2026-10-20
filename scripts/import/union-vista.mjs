// Importa o Union Vista (HLTS) como primeiro empreendimento real do VistaHub.
// Dados extraídos do e-book (páginas indicadas), da implantação e do espelho de vendas enviado pelo cliente.
//
// Uso:
//   python -I scripts/import/extract-pdf-pages.py "<e-book.pdf>" <pasta> 55
//   (copie a imagem da implantação para <pasta>/implantacao.jpg)
//   node scripts/import/union-vista.mjs <pasta> <email-do-admin>
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient, AssetKind, DevelopmentStatus, OrganizationRole, UnitStatus } from '@prisma/client';

const [mediaDir, adminEmail] = process.argv.slice(2);
if (!mediaDir || !adminEmail) { console.error('Uso: node scripts/import/union-vista.mjs <pasta-com-imagens> <email-do-admin>'); process.exit(1); }
const storageRoot = process.env.LOCAL_STORAGE_PATH ?? join(process.cwd(), 'storage');

// Implantação (imagem 1174 × 1280 px). Escala estimada pela largura das torres (8 aptos de ~57 m² por andar).
// O topo da imagem aponta para o azimute 202,5°. Centro e rotação calibrados casando a Alameda dos Mandarins (22,5°)
// e a Av. Manuel Lúcio (320°) da arte com as mesmas vias no OpenStreetMap.
const layout = {
  siteImage: 'implantacao.jpg', imageWidth: 1174, imageHeight: 1280, metersPerPixel: 0.16, origin: [600, 640], azimuth: 202.5,
  lot: [[122, 1088], [122, 400], [140, 322], [185, 262], [250, 212], [330, 182], [430, 170], [480, 175], [1090, 468], [1090, 838], [335, 838], [335, 1088]],
  roads: [{ name: 'Av. Manuel Lúcio', points: [[440, 120], [1110, 440]] }, { name: 'Alameda dos Mandarins, nº 201', points: [[100, 1090], [100, 430]] }],
  showPrices: false,
  notes: ['Imagens meramente ilustrativas.', 'Metragens aproximadas; as oficiais constam no Registro de Incorporação.', 'Volumetria gerada parametricamente a partir da implantação do material de vendas.'],
};
const px = ([x, y]) => ({ x: +((x - layout.origin[0]) * layout.metersPerPixel).toFixed(2), z: +((y - layout.origin[1]) * layout.metersPerPixel).toFixed(2) });

// Posição dos finais na torre (lado "frente" = topo da torre na implantação, colunas da esquerda para a direita).
const unitSlots = [
  { final: '06', side: 'front', column: 0 }, { final: '05', side: 'front', column: 1 }, { final: '04', side: 'front', column: 2 }, { final: '03', side: 'front', column: 3 },
  { final: '07', side: 'back', column: 0 }, { final: '08', side: 'back', column: 1 }, { final: '01', side: 'back', column: 2 }, { final: '02', side: 'back', column: 3 },
];
const towerModel = { width: 36, depth: 16.8, colors: { facade: '#eceeea', accent: '#e0622a', roof: '#d8dbd6', base: '#c9ccc6' }, elevators: 2, unitSlots };

// Espelho de vendas por andar (térreo = 0) e final 01..08. D disponível, R reservado, V vendido.
// Torre 1: o cliente não enviou o espelho; todas as unidades ficam disponíveis até a atualização no painel.
const mirror = {
  'TORRE-02': ['RVVDDVVR', 'DDDDDDDV', 'DRDVVDDD', 'DVVVVVDD', 'DVVVVDDD', 'VVVVVRVV', 'VVVVVVVV', 'RVVVVVVD', 'VVVVVVVV', 'DVVVVVVV', 'DVVVVVDV', 'DVVVVVDD'],
  'TORRE-03': ['VVVVVVVV', 'DVDDDDDD', 'DDDDDDDD', 'DVDRVVDD', 'VDDVVVVV', 'VVDVVVVV', 'RVVVVVVD', 'DVRVVRVD', 'DVRVVVRD', 'DVRVVVRD', 'DVVVVRDD', 'DVVVVVVD'],
  'TORRE-04': ['VVVVVVVD', 'RDDDDDDD', 'VDDDDDVD', 'DDDRDDVD', 'DDDRDVVD', 'DDDVDVVV', 'VDDVVVVD', 'VDDVDVVD', 'DDRVVVVD', 'DDRVVVVD', 'DVRVVVVD', 'DVRVVVVD'],
};
const statusOf = { D: UnitStatus.AVAILABLE, R: UnitStatus.RESERVED, V: UnitStatus.SOLD };
const towers = [
  { code: 'TORRE-01', name: 'Torre 1', center: [402, 770], rotation: 180 },
  { code: 'TORRE-02', name: 'Torre 2', center: [402, 462], rotation: 0 },
  { code: 'TORRE-03', name: 'Torre 3', center: [740, 601], rotation: 0 },
  { code: 'TORRE-04', name: 'Torre 4', center: [1000, 660], rotation: 90 },
];
const floorCount = 12;

const rooms01 = 'Sala de estar e jantar: 3,00 × 3,75 m\nCozinha e área de serviço: 4,30 × 1,80 m\nVaranda gourmet: 2,30 × 1,85 m\nSuíte: 3,30 × 2,65 m\nQuarto: 2,40 × 3,35 m\nBanheiro da suíte: 2,20 × 1,20 m\nBanheiro social: 1,20 × 2,20 m';
const rooms02 = 'Sala de TV e jantar: 5,80 × 3,75 m\nCozinha e área de serviço: 4,60 × 1,80 m\nVaranda gourmet: 1,85 × 2,60 m\nSuíte: 3,30 × 2,65 m\nQuarto: 2,40 × 3,35 m\nBanheiro da suíte: 2,20 × 1,20 m\nBanheiro social: 1,20 × 2,20 m';
const plans = [
  { code: 'P01', name: 'Planta 01', area: 57, finals: ['01', '04', '05', '08'], garden: false, image: 'planta-01.jpg', description: `Finais 1, 4, 5 e 8. 2 quartos, sendo 1 suíte; varanda gourmet. (e-book, pág. 7)\n${rooms01}` },
  { code: 'P02', name: 'Planta 02', area: 58, finals: ['02', '03', '06', '07'], garden: false, image: 'planta-02.jpg', description: `Finais 2, 3, 6 e 7. 2 quartos, sendo 1 suíte; varanda gourmet. (e-book, pág. 8)\n${rooms02}` },
  { code: 'P01-G', name: 'Planta 01 Garden', area: 57, gardenArea: 25.3, total: 82.2, finals: ['01', '04', '05', '08'], garden: true, image: 'planta-01-garden.jpg', description: `Térreo, finais 1, 4, 5 e 8: 57 m² + área garden de 25,3 m² (total 82,2 m²). (e-book, pág. 9)\n${rooms01}` },
  { code: 'P02-G', name: 'Planta 02 Garden', area: 58, gardenArea: 35.1, total: 93.5, finals: ['02', '03', '06', '07'], garden: true, image: 'planta-02-garden.jpg', description: `Térreo, finais 2, 3, 6 e 7: 58 m² + área garden de 35,1 m² (total 93,5 m²). (e-book, pág. 10)\n${rooms02}` },
];
const amenities = [
  [1, 'Portaria', [168, 677], []], [2, 'Piscina adulto e infantil', [309, 1031], ['pagina-17.jpg']], [3, 'Bar', [241, 1050], ['pagina-17.jpg']],
  [4, 'Salão de festas', [313, 907], ['pagina-16.jpg']], [5, 'Espaço fitness', [241, 277], []], [6, 'Quadra poliesportiva', [359, 263], []],
  [7, '2 quiosques grill', [464, 274], ['pagina-16.jpg']], [8, 'Deck beach', [637, 356], ['pagina-15.jpg']], [9, 'Quadra de beach tennis', [684, 401], ['pagina-15.jpg', 'pagina-14.jpg']],
  [10, 'Área gourmet', [783, 424], ['pagina-16.jpg']], [11, 'Playground', [981, 512], []], [12, 'Bicicletário', [174, 596], ['pagina-18.jpg']],
  [13, 'Apoio aos funcionários', [179, 731], []], [14, 'Lixeira', [159, 556], []],
];
const gallery = [
  ['pagina-01.jpg', AssetKind.FACADE, 'Fachada'], ['pagina-03.jpg', AssetKind.FACADE, 'Fachada e Parque do Sabiá'], ['pagina-04.jpg', AssetKind.AERIAL, 'Parque do Sabiá'],
  ['pagina-11.jpg', AssetKind.INTERIOR_RENDER, 'Sala e cozinha'], ['pagina-12.jpg', AssetKind.INTERIOR_RENDER, 'Varanda gourmet'], ['pagina-13.jpg', AssetKind.INTERIOR_RENDER, 'Suíte'],
  ['pagina-14.jpg', AssetKind.AMENITY, 'A maior área de lazer da linha'], ['pagina-15.jpg', AssetKind.AMENITY, 'Quadra de beach tennis'], ['pagina-16.jpg', AssetKind.AMENITY, 'Quiosque grill, área gourmet e salão de festas'],
  ['pagina-17.jpg', AssetKind.AMENITY, 'Piscina adulto e infantil e bar'], ['pagina-18.jpg', AssetKind.AMENITY, 'Elevadores e bicicletário'], ['pagina-19.jpg', AssetKind.AERIAL, 'Vista ao pôr do sol'],
];

const prisma = new PrismaClient();
async function storeAsset(db, developmentId, file, kind, extra = {}) {
  const source = join(mediaDir, file);
  const buffer = await readFile(source);
  const checksum = createHash('sha256').update(buffer).digest('hex');
  const existing = await db.developmentAsset.findFirst({ where: { developmentId, checksum, kind } });
  if (existing) return existing;
  const storageKey = `${developmentId}/import-${checksum.slice(0, 12)}-${file}`;
  await mkdir(join(storageRoot, developmentId), { recursive: true });
  await copyFile(source, join(storageRoot, storageKey));
  return db.developmentAsset.create({ data: { developmentId, kind, originalName: file, storageKey, mimeType: 'image/jpeg', byteSize: BigInt((await stat(source)).size), checksum, metadata: { source: 'e-book HLTS Union Vista', ...extra.metadata }, ...extra.links } });
}

try {
  const user = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!user) throw new Error(`Usuário ${adminEmail} não existe; crie com npm run provision:admin`);
  const result = await prisma.$transaction(async (db) => {
    const organization = await db.organization.upsert({ where: { slug: 'hlts' }, update: {}, create: { name: 'HLTS Incorporadora', slug: 'hlts' } });
    await db.organizationUser.upsert({ where: { organizationId_userId: { organizationId: organization.id, userId: user.id } }, update: { active: true }, create: { organizationId: organization.id, userId: user.id, role: OrganizationRole.ADMIN } });
    const data = { organizationId: organization.id, name: 'Union Vista', code: 'UNION-VISTA', description: 'Sua vida com vista para o Parque do Sabiá. Linha Union: suíte, varanda gourmet* e elevador. Apartamentos de 57 m² e 58 m², 2 quartos com 1 suíte.', city: 'Uberlândia', state: 'MG', address: 'Alameda dos Mandarins, 201 - Grand Ville', latitude: -18.909164, longitude: -48.217248, status: DevelopmentStatus.PUBLISHED };
    const development = await db.development.upsert({ where: { slug: 'union-vista' }, update: data, create: { slug: 'union-vista', ...data } });
    const id = development.id;
    await db.developmentSettings.upsert({ where: { developmentId: id }, update: { officialSite: 'https://hlts.com.br' }, create: { developmentId: id, officialSite: 'https://hlts.com.br' } });
    await db.developmentTheme.upsert({ where: { developmentId: id }, update: { primaryColor: '#e0622a', secondaryColor: '#2b2140' }, create: { developmentId: id, primaryColor: '#e0622a', secondaryColor: '#2b2140' } });

    const site = await storeAsset(db, id, layout.siteImage, AssetKind.IMPLANTATION, { metadata: { page: 6 } });
    const cover = await storeAsset(db, id, 'pagina-01.jpg', AssetKind.FACADE, { metadata: { title: 'Fachada', page: 1 } });
    await db.development.update({ where: { id }, data: { coverAssetId: cover.id } });
    for (const [file, kind, title] of gallery) await storeAsset(db, id, file, kind, { metadata: { title, page: Number(file.slice(7, 9)) } });

    const planIds = {};
    for (const plan of plans) {
      const existing = await db.floorPlan.findFirst({ where: { developmentId: id, code: plan.code } });
      const fields = { name: plan.name, area: plan.garden ? plan.total : plan.area, bedrooms: 2, suites: 1, bathrooms: 2, parkingSpaces: 1, description: plan.description };
      const saved = existing ? await db.floorPlan.update({ where: { id: existing.id }, data: fields }) : await db.floorPlan.create({ data: { developmentId: id, code: plan.code, ...fields } });
      await storeAsset(db, id, plan.image, AssetKind.FLOOR_PLAN, { metadata: { title: plan.name }, links: { floorPlanId: saved.id } });
      planIds[plan.code] = saved.id;
    }

    let units = 0;
    for (const [index, tower] of towers.entries()) {
      const position = { ...px(tower.center), rotation: tower.rotation };
      const fields = { name: tower.name, sortOrder: index + 1, position, floorCount, unitsPerFloor: 8, floorHeight: 2.9, model3d: towerModel };
      const building = await db.building.upsert({ where: { developmentId_code: { developmentId: id, code: tower.code } }, update: fields, create: { developmentId: id, code: tower.code, ...fields } });
      for (let floorNumber = 0; floorNumber < floorCount; floorNumber++) {
        const floor = await db.floor.upsert({ where: { buildingId_number: { buildingId: building.id, number: floorNumber } }, update: {}, create: { buildingId: building.id, number: floorNumber, sortOrder: floorNumber, name: floorNumber === 0 ? 'Térreo' : `${floorNumber}º andar` } });
        for (let f = 1; f <= 8; f++) {
          const final = String(f).padStart(2, '0');
          const number = `${floorNumber === 0 ? '0' : floorNumber}${final}`.padStart(3, '0');
          const plan = plans.find((p) => p.garden === (floorNumber === 0) && p.finals.includes(final));
          const status = statusOf[mirror[tower.code]?.[floorNumber]?.[f - 1] ?? 'D'];
          const unitFields = { floorId: floor.id, final, privateArea: plan.area, totalArea: plan.garden ? plan.total : plan.area };
          const existing = await db.unit.findUnique({ where: { buildingId_number: { buildingId: building.id, number } } });
          const unit = existing ? await db.unit.update({ where: { id: existing.id }, data: unitFields }) : await db.unit.create({ data: { buildingId: building.id, number, status, ...unitFields } });
          if (!existing) await db.salesStatusHistory.create({ data: { unitId: unit.id, status, reason: 'Importação do espelho de vendas' } });
          await db.unitFloorPlan.upsert({ where: { unitId_floorPlanId: { unitId: unit.id, floorPlanId: planIds[plan.code] } }, update: { primary: true }, create: { unitId: unit.id, floorPlanId: planIds[plan.code], primary: true } });
          units++;
        }
      }
    }

    for (const [marker, name, at, media] of amenities) {
      const fields = { name, marker, sortOrder: marker, position: px(at) };
      const existing = await db.amenity.findFirst({ where: { developmentId: id, marker } });
      const amenity = existing ? await db.amenity.update({ where: { id: existing.id }, data: fields }) : await db.amenity.create({ data: { developmentId: id, ...fields } });
      await db.amenityMedia.deleteMany({ where: { amenityId: amenity.id } });
      for (const [order, file] of media.entries()) {
        const asset = await storeAsset(db, id, file, AssetKind.AMENITY, { metadata: { page: Number(file.slice(7, 9)) } });
        await db.amenityMedia.create({ data: { amenityId: amenity.id, assetId: asset.id, sortOrder: order } });
      }
    }

    const publicLayout = { ...layout, siteImageAssetId: site.id };
    const viewer = { camera: { distance: 330, polar: 58, azimuth: 35 }, lighting: { mode: 'day' }, interaction: { autoRotate: false }, publicLayout };
    await db.viewerConfiguration.upsert({ where: { developmentId: id }, update: viewer, create: { developmentId: id, ...viewer } });
    await db.auditLog.create({ data: { organizationId: organization.id, userId: user.id, entityType: 'Development', entityId: id, action: 'IMPORT', after: { source: 'scripts/import/union-vista.mjs', units } } });
    return { organizationId: organization.id, developmentId: id, units };
  }, { timeout: 120_000 });
  console.log(`Union Vista importado: ${result.units} unidades. Organização ${result.organizationId}, empreendimento ${result.developmentId}.`);
} catch (error) {
  console.error(`Falha na importação: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
