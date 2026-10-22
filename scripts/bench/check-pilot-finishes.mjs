import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {createServer} from 'vite';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
const server = await createServer({root:'apps/viewer', configFile:false, cacheDir:'node_modules/.vite-finishes-check', optimizeDeps:{noDiscovery:true}, server:{middlewareMode:true}, appType:'custom'});
const engine = new NullEngine(), scene = new Scene(engine);
try {
  const {TransformNode, Vector3} = await server.ssrLoadModule('/src/scene/babylon.ts');
  const {meshFrom, pbr} = await server.ssrLoadModule('/src/scene/geometry.ts');
  const {windowOpenings, buildFacadeDetails} = await server.ssrLoadModule('/src/scene/facade-details.ts');
  const {configureFacadeGlass, glassReflection} = await server.ssrLoadModule('/src/scene/facade-glass.ts');
  const parent = new TransformNode('tower', scene), child = new TransformNode('glb-root', scene);
  parent.position.set(23, 0, -6); parent.rotation.y = .63;
  child.parent = parent; child.position.set(3, 0, -8);
  const pane = (name, height) => meshFrom(name, {positions:[-1,1,0, 1,1,0, 1,1+height,0, -1,1+height,0], indices:[0,1,2, 0,2,3], uvs:[0,0,1,0,1,1,0,1]}, scene, pbr(scene,'VH_Glass'), child);
  const window = pane('window',1), door = pane('door',2.2);
  const openings = windowOpenings(window,parent);
  assert.equal(openings.length,1);
  assert.ok(Vector3.Distance(openings[0].center,new Vector3(3,.92,-8))<1e-6,'Transformar GLB para referencial da torre sem duplicar giro.');
  assert.ok(openings[0].normal.z>.99,'Peitoril aponta para fora.');
  assert.equal(windowOpenings(door,parent).length,0,'Nao bloquear portas.');
  const details = buildFacadeDetails(scene,[window,door,window],parent,1);
  assert.equal(details.length,2,'Duas malhas agregadas, nao uma por janela.');
  assert.ok(details.every(m=>m.metadata.openings===1&&!m.isPickable),'Sem duplicar vaos nem interferir no clique.');
  assert.ok(details.every(m=>m.getLODLevels().length===1),'LOD de proximidade.');
  assert.equal(glassReflection(scene,'day'),null,'Simulador sem GPU nao cria textura WebGL.');
  configureFacadeGlass(window.material,window,undefined,true);
  assert.equal(window.material.roughness,.14);
  assert.equal(window.material.specularIntensity,.85);
  assert.equal(window.material.alpha,.88,'Mantem transparencia para os interiores.');
  assert.equal(window.metadata.castShadow,false);
  const catalog = JSON.parse(await readFile('apps/viewer/public/library/library.json','utf8'));
  let bytes = 0;
  for(const name of ['pilot_grass','pilot_asphalt','pilot_paving','pilot_concrete','pilot_paint']) {
    const set=catalog.textures[name]; assert.ok(set&&set.meters>0&&set.metal===0);
    for(const kind of ['albedo','normal','orm','albedo_lo','normal_lo','orm_lo']) {
      const entry=set.files[kind], path=`apps/viewer/public/library/${entry.file}`;
      assert.equal((await stat(path)).size,entry.bytes);
      const file=await readFile(path); assert.equal(file.toString('ascii',8,12),'WEBP'); bytes+=entry.bytes;
    }
  }
  assert.ok(bytes<2_000_000,'Orcamento dos cinco acabamentos, incluindo versoes leves.');
  console.log(JSON.stringify({result:'OK',extraKB:Math.round(bytes/1024),checks:['vaos reais','transformacao GLB','portas livres','sem duplicacao','LOD','vidro sem GPU','30 texturas PBR']}));
} finally { scene.dispose(); engine.dispose(); await server.close(); }
