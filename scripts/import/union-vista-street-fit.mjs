// Preview / --apply / --restore ID. Nao altera escala nem a geometria das ruas.
import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {createServer} from 'vite';
import clipping from 'polygon-clipping';
const prisma=new PrismaClient();
const server=await createServer({root:'apps/viewer',configFile:false,cacheDir:'node_modules/.vite-street-fit',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
try{
  const {roadBuffer,roadWidth,area,union,ring}=await server.ssrLoadModule('/src/scene/urban-geometry.ts');
  const d=await prisma.development.findUniqueOrThrow({where:{slug:'union-vista'},include:{viewerConfiguration:true}}),c=d.viewerConfiguration,l=c?.publicLayout;
  if(!c||l?.imageWidth!==1174||l?.imageHeight!==1280)throw Error('Implantacao diferente da revisada.');
  const restore=process.argv.indexOf('--restore');let next;
  if(restore>=0){
    const audit=await prisma.auditLog.findFirstOrThrow({where:{id:process.argv[restore+1],organizationId:d.organizationId,entityId:c.id,action:'REVIEW_STREET_FIT'}});
    next=audit.before?.publicLayout;if(!next)throw Error('Auditoria sem layout anterior.');
  }else{
    if(l.streetFitReview?.version===1){console.log('Revisao ja aplicada; nenhuma alteracao.');process.exitCode=0;}
    else{
      if(l.azimuth!==202.5||JSON.stringify(l.origin)!=='[600,640]'||l.metersPerPixel!==.16)throw Error('Alinhamento foi editado. Recalcule o ajuste, nao reaplique deltas antigos.');
      next=structuredClone(l);
      const a=202.75*Math.PI/180,dx=2.5,dz=-3;
      next.azimuth=202.75;
      next.origin=[l.origin[0]-(Math.cos(a)*dx+Math.sin(a)*dz)/l.metersPerPixel,l.origin[1]-(-Math.sin(a)*dx+Math.cos(a)*dz)/l.metersPerPixel];
      const base=next.groundPlan?.polygons?.[0];
      if(!base||JSON.stringify(base.points)!==JSON.stringify(l.lot))throw Error('Base do terreno mudou; revisar antes de aplicar.');
      base.kind='grass';
      next.streetFitReview={version:1,updatedAt:new Date().toISOString(),translationMeters:[dx,dz],rotationDegrees:.25,clearanceMeters:1.3,source:'Ajuste visual aproximado ao corredor viario OSM; nao cadastral'};
    }
  }
  if(next){
    const response=await fetch('http://localhost:3000/api/v1/public/developments/union-vista/surroundings');if(!response.ok)throw Error('Nao foi possivel verificar o arruamento.');
    const surroundings=await response.json(),roads=surroundings.roads.filter(r=>roadWidth[r.kind]&&r.points.some(p=>Math.hypot(...p)<240));
    const asphalt=union(roads.map(r=>roadBuffer(r.points,roadWidth[r.kind]))),corridor=union(roads.map(r=>roadBuffer(r.points,roadWidth[r.kind]+2.6)));
    const overlap=layout=>{const a=layout.azimuth*Math.PI/180;const p=layout.lot.map(([x,z])=>{x=(x-layout.origin[0])*layout.metersPerPixel;z=(z-layout.origin[1])*layout.metersPerPixel;return[Math.cos(a)*x-Math.sin(a)*z,Math.sin(a)*x+Math.cos(a)*z];});return{asphaltM2:area(clipping.intersection(ring(p),asphalt)),corridorM2:area(clipping.intersection(ring(p),corridor))};};
    const after=overlap(next);console.log(JSON.stringify({before:overlap(l),after,origin:next.origin,azimuth:next.azimuth,base:next.groundPlan.polygons[0].kind}));
    if(restore<0&&after.corridorM2>.001)throw Error('Ainda existe sobreposicao com rua/calcada.');
    if(process.argv.includes('--apply')||restore>=0){
      const audit=await prisma.$transaction(async db=>{
        const changed=await db.viewerConfiguration.updateMany({where:{id:c.id,updatedAt:c.updatedAt},data:{publicLayout:next}});
        if(changed.count!==1)throw Error('Configuracao mudou durante a revisao.');
        return db.auditLog.create({data:{organizationId:d.organizationId,entityType:'ViewerConfiguration',entityId:c.id,action:restore>=0?'RESTORE_STREET_FIT':'REVIEW_STREET_FIT',before:{publicLayout:l},after:{publicLayout:next}}});
      });console.log(`Persistido; auditoria para recuperacao: ${audit.id}`);
    }
  }
}finally{await server.close();await prisma.$disconnect();}
