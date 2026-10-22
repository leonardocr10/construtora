import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
const server=await createServer({root:'apps/viewer',configFile:false,cacheDir:'node_modules/.vite-selection-check',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
const engine=new NullEngine(),scene=new Scene(engine);
try{
  const {buildTower}=await server.ssrLoadModule('/src/scene/tower.ts');
  const building={id:'test',name:'Torre teste',floorCount:12,floorHeight:2.9,position:{x:0,z:0},model3d:{width:32,depth:16},units:[]};
  for(const floor of [0,9,11])for(let final=1;final<=8;final++)building.units.push({id:`${floor}-${final}`,number:`${floor}${String(final).padStart(2,'0')}`,floor,final:String(final).padStart(2,'0'),status:final%2?'AVAILABLE':'SOLD'});
  const tower=buildTower(scene,building,null);
  const wall=scene.getMaterialByName('test-wall'),original=wall.albedoColor.clone();
  tower.setContextMuted(true);assert.ok(wall.albedoColor.r>original.r&&wall.alpha===1,'Contexto mais claro sem transparencia.');
  tower.setHover(true);tower.setHover(false);tower.setContextMuted(false);assert.ok(wall.albedoColor.equalsWithEpsilon(original,1e-8),'Cor original deve voltar sem acumular o clareamento.');
  tower.setUnitsVisible(true,9);tower.setSelectedUnit('9-1');
  assert.equal([...tower.unitMeshes.values()].filter(m=>m.isEnabled()).length,8);
  assert.equal(tower.unitMeshes.get('9-1').material.alpha,1,'Selecao nao pode ficar transparente/esbranquicada.');
  let outlines=scene.meshes.filter(m=>m.metadata?.unitEnvelope&&m.isEnabled());
  assert.equal(outlines.length,7);assert.ok(outlines.every(m=>!m.isPickable&&Math.abs(m.metadata.height-8.7)<.001));
  for(const m of tower.unitMeshes.values())if(m.isEnabled()){
    m.computeWorldMatrix(true);const bb=m.getBoundingInfo().boundingBox;
    assert.ok(bb.maximumWorld.x<=-1.92+.001||bb.minimumWorld.x>=1.92-.001,`Volume invadiu o nucleo central: ${m.name}, ${bb.minimumWorld.x}, ${bb.maximumWorld.x}`);
    assert.ok(bb.maximumWorld.x<=16&&bb.minimumWorld.x>=-16);
  }
  assert.notEqual(tower.unitMeshes.get('9-2').material,tower.unitMeshes.get('9-3').material,'Status distintos precisam manter cores distintas.');
  const quietColor=tower.unitMeshes.get('9-3').material.albedoColor.clone();
  tower.setSelectedUnit(null);assert.ok(tower.unitMeshes.get('9-3').material.albedoColor.r<quietColor.r,'Outras unidades clareiam somente durante a selecao.');
  tower.setSelectedUnit('9-1');
  tower.setUnitsVisible(true,0);assert.ok(!tower.unitMeshes.get('9-1').isEnabled());
  tower.setSelectedUnit('0-2');assert.equal(tower.unitMeshes.get('0-2').material.alpha,1);
  tower.setUnitsVisible(false);assert.equal(scene.meshes.filter(m=>m.metadata?.unitEnvelope&&m.isEnabled()).length,0);
  assert.equal([...tower.unitMeshes.values()].filter(m=>m.isEnabled()).length,0);
  assert.equal(scene.materials.filter(m=>m.clipPlane).length,0);
  console.log('OK: selecao solida, gabarito alto, cores por status, nucleo livre, troca de andar e restauracao.');
}finally{scene.dispose();engine.dispose();await server.close();}
