// Revisao localizada do book, sem apagar alteracoes do editor. Preview por padrao.
// node scripts/import/union-vista-details.mjs --apply
// node scripts/import/union-vista-details.mjs --restore <auditId>
import 'dotenv/config';
import {PrismaClient} from '@prisma/client';

const prisma=new PrismaClient();
try{
  const d=await prisma.development.findUniqueOrThrow({where:{slug:'union-vista'},include:{viewerConfiguration:true,amenities:true,floorPlans:true}});
  const config=d.viewerConfiguration,layout=config?.publicLayout;
  if(!config||layout?.imageWidth!==1174||layout?.imageHeight!==1280)throw Error('Implantacao diferente da revisada.');
  const restore=process.argv.indexOf('--restore');
  if(restore>=0){
    const audit=await prisma.auditLog.findFirstOrThrow({where:{id:process.argv[restore+1],organizationId:d.organizationId,entityId:config.id,action:'REVIEW_BOOK_DETAILS'}});
    const backup=audit.before;if(!backup?.publicLayout||!Array.isArray(backup.plans))throw Error('Auditoria sem backup valido.');
    await prisma.$transaction(async db=>{
      await db.viewerConfiguration.update({where:{id:config.id},data:{publicLayout:backup.publicLayout}});
      for(const p of backup.plans)await db.floorPlan.update({where:{id:p.id},data:{layout:p.layout}});
      await db.auditLog.create({data:{organizationId:d.organizationId,entityType:'ViewerConfiguration',entityId:config.id,action:'RESTORE_BOOK_DETAILS',before:{publicLayout:layout,plans:d.floorPlans.map(p=>({id:p.id,layout:p.layout}))},after:backup}});
    });console.log('Revisao restaurada.');
  }else{
    // Centros e limites conferidos na implantacao da pagina 6; alturas e acabamentos nos renders 16–18.
    // Dimensoes ilustrativas estimadas, nao substituem o projeto executivo.
    const definitions={
      1:{kind:'gatehouse',point:[162,662],width:6.4,depth:4.8},
      2:{kind:'pool',point:[304,1016],width:7.7,depth:16.6,water:{point:[309,1028],width:4.4,depth:11}},
      3:{kind:'bar',point:[231,1048],width:13.8,depth:7},
      4:{kind:'building',point:[309,910],width:7.5,depth:17.2},
      5:{kind:'building',point:[255,275],width:9.1,depth:7.3},
      6:{kind:'court',point:[361,260],width:18.9,depth:11.5},
      7:{kind:'grills',point:[466,275],width:10.5,depth:6.6},
      8:{kind:'deck',point:[642,357],width:8.4,depth:4.6},
      9:{kind:'beach',point:[683,407],width:18,depth:9.5},
      10:{kind:'gourmet',point:[788,432],width:13.8,depth:6},
      11:{kind:'playground',point:[993,516],width:12.8,depth:5.2},
      12:{kind:'bikes',point:[164,602],width:5.4,depth:6.3},
      13:{kind:'small',point:[172,732],width:5.6,depth:4.5},
      14:{kind:'small',point:[159,558],width:4.8,depth:4.5},
    };
    const amenityModels={...layout.amenityModels};
    for(const a of d.amenities){if(definitions[a.marker])amenityModels[a.id]=definitions[a.marker];}
    const entrances=[{a:[122,646],b:[122,711]}];
    // A via chega a divisa. Nao apagar os poligonos existentes do paisagismo.
    const driveway={kind:'asphalt',points:[[122,679],[220,679],[220,710],[122,710]]};
    const pedestrian={kind:'paving',points:[[122,646],[145,646],[145,679],[122,679]]};
    const polygons=layout.groundPlan.polygons.filter(p=>JSON.stringify(p)!==JSON.stringify(driveway)&&JSON.stringify(p)!==JSON.stringify(pedestrian));
    const parkingExclusions=[[[122,669],[229,669],[229,720],[122,720]]];
    const next={...layout,amenityModels,entrances,parkingExclusions,groundPlan:{...layout.groundPlan,polygons:[...polygons,pedestrian,driveway]},detailsSource:'Book Union Vista, paginas 6, 7, 16–18; revisao ilustrativa'};
    const plans=d.floorPlans.filter(p=>['P01','P01-G'].includes(p.code)).map(p=>{
      const l=structuredClone(p.layout);if(!l?.walls?.find(w=>w.id==='w15')||l.rooms?.[0]?.points?.[0]?.[0]!==2.464)throw Error(`Planta ${p.code} diferente da revisada.`);
      // Porta do quarto abre para o corredor lateral, como na planta do book.
      l.openings=l.openings.filter(o=>o.id!=='w9o1'&&o.id!=='w15o1');l.openings.push({id:'w15o1',wallId:'w15',kind:'door',width:.8,offset:.471});
      return {id:p.id,layout:l};
    });
    console.log(JSON.stringify({models:Object.keys(amenityModels).length,entrances:entrances.length,plans:plans.length,apply:process.argv.includes('--apply')}));
    if(process.argv.includes('--apply')){
      const result=await prisma.$transaction(async db=>{
        await db.viewerConfiguration.update({where:{id:config.id},data:{publicLayout:next}});
        for(const p of plans)await db.floorPlan.update({where:{id:p.id},data:{layout:p.layout}});
        return db.auditLog.create({data:{organizationId:d.organizationId,entityType:'ViewerConfiguration',entityId:config.id,action:'REVIEW_BOOK_DETAILS',before:{publicLayout:layout,plans:d.floorPlans.filter(p=>plans.some(q=>q.id===p.id)).map(p=>({id:p.id,layout:p.layout}))},after:{publicLayout:next,plans}}});
      });console.log(`Persistido no MySQL. Auditoria/backup: ${result.id}`);
    }
  }
}finally{await prisma.$disconnect();}
