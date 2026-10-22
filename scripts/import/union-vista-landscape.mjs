// Preview: node scripts/import/union-vista-landscape.mjs
// Aplicar: node scripts/import/union-vista-landscape.mjs --apply
// Restaurar: node scripts/import/union-vista-landscape.mjs --restore <auditId>
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { unionVistaLandscape } from './union-vista-landscape-data.mjs';

const prisma = new PrismaClient();
try {
  const development = await prisma.development.findUniqueOrThrow({where:{slug:'union-vista'},include:{viewerConfiguration:true}});
  const config = development.viewerConfiguration;
  const layout = config?.publicLayout;
  if (!config || layout?.imageWidth !== 1174 || layout?.imageHeight !== 1280 || !layout.lot?.length) throw new Error('Implantacao diferente da imagem revisada; ajuste os contornos antes de aplicar.');
  const restoreIndex = process.argv.indexOf('--restore');
  let next;
  if (restoreIndex >= 0) {
    const audit = await prisma.auditLog.findFirstOrThrow({where:{id:process.argv[restoreIndex+1],organizationId:development.organizationId,entityId:config.id,action:'REVIEW_LANDSCAPE'}});
    next = audit.before?.publicLayout;
    if (!next) throw new Error('Auditoria sem layout de recuperacao.');
  } else {
    const reviewed = unionVistaLandscape(layout.lot);
    next = {...layout,groundPlan:{polygons:reviewed.polygons,parkingRows:reviewed.parkingRows,updatedAt:new Date().toISOString(),source:'Book Union Vista, pagina 6, revisao vetorial'},landscape:reviewed.landscape};
  }
  console.log(JSON.stringify({development:development.slug,polygons:next.groundPlan?.polygons.length??0,trees:next.landscape?.trees.length??0,apply:process.argv.includes('--apply')||restoreIndex>=0}));
  if (process.argv.includes('--apply') || restoreIndex >= 0) {
    const result = await prisma.$transaction(async db=>{
      await db.viewerConfiguration.update({where:{id:config.id},data:{publicLayout:next}});
      return db.auditLog.create({data:{organizationId:development.organizationId,entityType:'ViewerConfiguration',entityId:config.id,action:restoreIndex>=0?'RESTORE_LANDSCAPE':'REVIEW_LANDSCAPE',before:{publicLayout:layout},after:{publicLayout:next}}});
    });
    console.log(`Layout persistido; auditoria para recuperacao: ${result.id}`);
  }
} finally { await prisma.$disconnect(); }
