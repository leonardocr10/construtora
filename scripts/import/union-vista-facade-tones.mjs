// Preview / --apply / --restore AUDIT_ID. Somente cores/acabamentos; geometria e versoes GLB preservadas.
import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
const prisma=new PrismaClient();
try{
  const d=await prisma.development.findUniqueOrThrow({where:{slug:'union-vista'},include:{buildings:{orderBy:{code:'asc'}}}});
  const before={buildings:d.buildings.map(b=>({id:b.id,model3d:b.model3d}))};
  const restore=process.argv.indexOf('--restore');let after;
  if(restore>=0){
    const audit=await prisma.auditLog.findFirstOrThrow({where:{id:process.argv[restore+1],organizationId:d.organizationId,entityId:d.id,action:'REVIEW_FACADE_TONES'}});
    after=audit.before;if(!after?.buildings||after.buildings.length!==d.buildings.length||after.buildings.some(b=>!d.buildings.some(c=>c.id===b.id)))throw Error('Auditoria nao corresponde as torres atuais.');
  }else after={buildings:d.buildings.map(b=>({id:b.id,model3d:{...b.model3d,colors:{...b.model3d?.colors,facade:'#a5bfb2',accent:'#b35b2f',roof:'#c9d0c6'},facade:{...b.model3d?.facade,appearance:'contrasted',tones:['#a5bfb2','#cdd4d0'],frame:'#adb9b1',glass:'#294238'}}}))};
  console.log(JSON.stringify({towers:after.buildings.length,palette:after.buildings[0].model3d.facade,apply:process.argv.includes('--apply')||restore>=0}));
  if(process.argv.includes('--apply')||restore>=0){
    const audit=await prisma.$transaction(async db=>{
      for(const b of after.buildings){const initial=d.buildings.find(c=>c.id===b.id),r=await db.building.updateMany({where:{id:b.id,updatedAt:initial.updatedAt},data:{model3d:b.model3d}});if(r.count!==1)throw Error('Torre editada durante a revisao.');}
      return db.auditLog.create({data:{organizationId:d.organizationId,entityType:'Development',entityId:d.id,action:restore>=0?'RESTORE_FACADE_TONES':'REVIEW_FACADE_TONES',before,after}});
    });console.log(`Paleta persistida; auditoria para recuperacao: ${audit.id}`);
  }
}finally{await prisma.$disconnect();}
