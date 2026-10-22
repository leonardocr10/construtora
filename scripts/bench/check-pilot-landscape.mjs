import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode.js';
const server=await createServer({root:'apps/viewer',configFile:false,cacheDir:'node_modules/.vite-pilot-check',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
try{
  const {planPilotLandscape,pilotModels}=await server.ssrLoadModule('/src/scene/pilot-landscape.ts'),{surfaceFits}=await server.ssrLoadModule('/src/scene/ground.ts');
  const response=await fetch('http://localhost:3000/api/v1/public/developments/union-vista');assert.ok(response.ok);const d=await response.json(),l=d.viewer.layout,before=JSON.stringify(d);
  const w=l.imageWidth,h=l.imageHeight,classes=new Uint8Array(w*h),mask=new Uint8Array(w*h);
  const fill=(points,target,value)=>{const zs=points.map(p=>p[1]);for(let z=Math.max(0,Math.floor(Math.min(...zs)));z<Math.min(h,Math.ceil(Math.max(...zs)));z++){
    const xs=[];for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>z+.5)!==(b[1]>z+.5))xs.push(a[0]+(b[0]-a[0])*(z+.5-a[1])/(b[1]-a[1]));}xs.sort((a,b)=>a-b);
    for(let i=0;i<xs.length;i+=2)target.fill(value,z*w+Math.max(0,Math.ceil(xs[i]-.5)),z*w+Math.min(w,Math.ceil(xs[i+1]-.5)));
  }};
  fill(l.lot,mask,1);fill(l.lot,classes,1);const kinds={asphalt:1,grass:2,paving:3,art:4};for(const p of l.groundPlan.polygons)fill(p.points,classes,kinds[p.kind]);for(let i=0;i<classes.length;i++)if(!mask[i])classes[i]=0;
  const ground={x0:0,y0:0,w,h,classes},pilot=planPilotLandscape(d,ground);
  assert.ok(pilot&&pilot.plants.length>15,'Piloto vazio.');assert.equal(JSON.stringify(d),before,'Nao editar dados persistidos no planejamento.');
  assert.deepEqual(pilot.plants,planPilotLandscape(d,ground).plants,'Composicao estavel entre recargas.');
  assert.equal(planPilotLandscape({...d,slug:'outro'},ground),null,'Nao alterar outros empreendimentos.');
  const counts={};
  for(const p of pilot.plants){counts[p.model]=(counts[p.model]??0)+1;assert.ok(pilot.contains(p.point));const r=(p.model.startsWith('pilot_tree')?.85:p.radius+.18)/l.metersPerPixel;assert.ok(surfaceFits(ground,...p.pixel,0,r*2,r*2,2),'Planta fora da grama/calçada ocupada.');
    for(const b of d.buildings){const dx=p.point[0]-b.position.x,dz=p.point[1]-b.position.z,a=(b.position.rotation??0)*Math.PI/180,x=Math.cos(a)*dx+Math.sin(a)*dz,z=-Math.sin(a)*dx+Math.cos(a)*dz;assert.ok(Math.abs(x)>(b.model3d.width/2+.5)||Math.abs(z)>(b.model3d.depth/2+1.5),'Planta dentro da torre.');}
  }
  for(const model of pilotModels){const data=await readFile(`apps/viewer/public/library/models/${model}.glb`),n=data.readUInt32LE(12),g=JSON.parse(data.toString('utf8',20,20+n));assert.ok(g.nodes.some(n=>n.name===`${model}_lod0`)&&g.nodes.some(n=>n.name===`${model}_lod1`),'Dois LODs por modelo.');assert.ok(g.materials.every(m=>(m.alphaMode??'OPAQUE')!=='BLEND'),'Folhas sem ordenacao transparente.');}
  const catalog=JSON.parse(await readFile('apps/viewer/public/library/library.json','utf8'));
  const {buildVegetation}=await server.ssrLoadModule('/src/scene/vegetation.ts');
  const engine=new NullEngine(),scene=new Scene(engine),seed=()=>{let n=19;return()=>{n=n*16807%2147483647;return(n-1)/2147483646;};},r1=seed(),r2=seed();
  try{
    const input={roads:[{kind:'residential',points:[[-70,0],[70,0]]}],footprints:[],exclusion:[],onRoad:p=>Math.abs(p[1])<4,radius:90,maxTrees:250};
    const a=buildVegetation(scene,new TransformNode('original',scene),{...input,random:r1}),replaced=[];
    const contains=p=>p[0]>0&&Math.hypot(...p)<55;
    const b=buildVegetation(scene,new TransformNode('piloto',scene),{...input,random:r2,detail:{contains,place:p=>replaced.push(p)}});
    assert.equal(a.count,b.count);assert.ok(replaced.length>0);
    assert.deepEqual(Array.from({length:10},r1),Array.from({length:10},r2),'Troca de modelo nao deve alterar o ruido do restante do bairro.');
    const matrices=g=>g.group.getChildMeshes().filter(m=>m.name.startsWith('vegetation-crowns')).flatMap(m=>m.thinInstanceGetWorldMatrices()).filter(m=>!contains([m.getTranslation().x,m.getTranslation().z])).map(m=>Array.from(m.asArray()));
    assert.deepEqual(matrices(a),matrices(b),'Arvores fora do piloto devem permanecer identicas.');
  }finally{scene.dispose();engine.dispose();}
  console.log(JSON.stringify({result:'OK',plants:pilot.plants.length,counts,extraKB:Math.round(pilotModels.reduce((s,n)=>s+catalog.models[n].bytes,0)/1024),checks:['solo livre','fora de torres','escopo Torre 3','sem mutacao de dados','determinismo','LOD e alpha']}));
}finally{await server.close();}
