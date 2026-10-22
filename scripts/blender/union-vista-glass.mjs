// Preview / --apply / --restore AUDIT_ID. Gera novas versoes; ativa as quatro apenas depois do sucesso.
import 'dotenv/config';
import {createRequire} from 'node:module';
import {PrismaClient} from '@prisma/client';
import {isDeepStrictEqual} from 'node:util';
const require=createRequire(import.meta.url),prisma=new PrismaClient();let app;
try{
  const d=await prisma.development.findUniqueOrThrow({where:{slug:'union-vista'},include:{buildings:{orderBy:{code:'asc'}}}});
  const editor=await prisma.organizationUser.findFirstOrThrow({where:{organizationId:d.organizationId,active:true,role:{in:['SUPERADMIN','ADMIN','MANAGER','EDITOR']}}});
  const before={buildings:d.buildings.map(b=>({id:b.id,model3d:b.model3d}))};
  const restore=process.argv.indexOf('--restore');let after;
  if(restore>=0){
    const audit=await prisma.auditLog.findFirstOrThrow({where:{id:process.argv[restore+1],organizationId:d.organizationId,entityId:d.id,action:'REVIEW_FACADE_GLASS'}});
    after=audit.before;
    if(!after?.buildings||after.buildings.length!==d.buildings.length||after.buildings.some(b=>!d.buildings.some(current=>current.id===b.id)))throw Error('Auditoria nao corresponde as torres atuais.');
  }else if(process.argv.includes('--apply')){
    const {NestFactory}=require('@nestjs/core'),{AppModule}=require('../../apps/api/dist/app.module.js'),{ModelGenerationService}=require('../../apps/api/dist/model-generation/model-generation.service.js');
    app=await NestFactory.createApplicationContext(AppModule,{logger:['error','warn']});
    const generation=app.get(ModelGenerationService),context={userId:editor.userId,organizationId:d.organizationId,role:editor.role};
    after={buildings:[]};
    for(const b of d.buildings){
      let r;
      if(process.argv.includes('--reuse')){
        const asset=await prisma.developmentAsset.findFirstOrThrow({where:{developmentId:d.id,kind:'MODEL_3D',metadata:{path:'$.buildingId',equals:b.id}},include:{modelVersions:{orderBy:{version:'desc'},take:1}},orderBy:{createdAt:'desc'}});
        if(!asset.modelVersions[0]||!(asset.metadata?.interiorRooms>0)||!isDeepStrictEqual(asset.metadata?.params?.model3d,b.model3d))throw Error('Versao recente nao corresponde aos parametros atuais ou nao possui interiores.');
        r={asset,modelVersion:asset.modelVersions[0],stats:asset.metadata};
      }else r=await generation.generateTowerModel(context,b.id,{activate:false});
      after.buildings.push({id:b.id,model3d:{...b.model3d,glb:{assetId:r.asset.id,version:r.modelVersion.version,generatedAt:new Date().toISOString()},glassReview:{version:1,generatorVersion:3,source:'Ambientes 3D ilustrativos de fachada; passeio interno usa a planta cadastrada'}}});
      console.log(JSON.stringify({tower:b.name,version:r.modelVersion.version,MB:+(Number(r.asset.byteSize)/1048576).toFixed(2),rooms:r.stats?.interiorRooms}));
    }
  }else console.log(JSON.stringify({development:d.slug,towers:d.buildings.map(b=>({name:b.name,currentVersion:b.model3d?.glb?.version})),apply:false}));
  if(after){
    const audit=await prisma.$transaction(async db=>{
      for(const b of after.buildings){
        const initial=d.buildings.find(current=>current.id===b.id);
        const changed=await db.building.updateMany({where:{id:b.id,updatedAt:initial.updatedAt},data:{model3d:b.model3d}});
        if(changed.count!==1)throw Error('Torre editada durante a geracao; modelos anteriores preservados.');
      }
      return db.auditLog.create({data:{organizationId:d.organizationId,userId:editor.userId,entityType:'Development',entityId:d.id,action:restore>=0?'RESTORE_FACADE_GLASS':'REVIEW_FACADE_GLASS',before,after}});
    });console.log(`Modelos ativados em transacao; auditoria para recuperacao: ${audit.id}`);
  }
}finally{if(app)await app.close();await prisma.$disconnect();}
