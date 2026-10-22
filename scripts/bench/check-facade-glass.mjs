import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
const server=await createServer({root:'apps/viewer',configFile:false,cacheDir:'node_modules/.vite-glass-check',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
const engine=new NullEngine(),scene=new Scene(engine);
try{
  const {configureFacadeGlass}=await server.ssrLoadModule('/src/scene/facade-glass.ts');
  const {applyFacadePalette}=await server.ssrLoadModule('/src/scene/facade-materials.ts');
  for(const name of ['VH_Glass','VH_GlassLit','VH_GlassWarm','VH_GlassSoft','VH_GlassFrost']){
    const m=new PBRMaterial(name,scene);configureFacadeGlass(m);
    assert.ok(m.alpha<1&&m.alpha>0);assert.equal(m.metallic,0);assert.equal(m.transparencyMode,2);assert.equal(m.forceDepthWrite,false);assert.equal(m.disableDepthWrite,true);assert.equal(m.emissiveIntensity,0,'O vidro nao pode virar uma placa luminosa opaca.');
    if(name==='VH_GlassFrost')assert.ok(m.alpha>=.9&&m.roughness>.4);else assert.ok(m.alpha>=.7&&m.alpha<.9,'Vidro com tonalidade, sem voltar ao aspecto esbranquicado.');
  }
  const model={width:36,depth:16.8,colors:{facade:'#819d90',accent:'#b35b2f',roof:'#b9c2b7'},facade:{appearance:'contrasted',tones:['#819d90','#a8b4ae'],frame:'#adb9b1'}};
  const tones=[];
  for(const name of ['VH_Tone0','VH_Tone1','VH_Wall','VH_Accent','VH_Trim','VH_Roof','VH_Frame']){
    const m=new PBRMaterial(name,scene);m.alpha=.4;assert.ok(applyFacadePalette(m,model));assert.equal(m.alpha,1,'Alvenaria opaca.');assert.equal(m.transparencyMode,0);assert.equal(m.disableDepthWrite,false);if(name.startsWith('VH_Tone'))tones.push(m.albedoColor.clone());
  }
  assert.ok(tones[0].g<tones[1].g&&tones[1].g-tones[0].g>.08,'Dois tons de fachada distintos.');
  assert.equal(applyFacadePalette(new PBRMaterial('VH_Glass',scene),model),false,'Nao aplicar tinta de parede ao vidro.');
  console.log('OK: fachada opaca em dois tons, vidro mais escuro, transparencia discreta, fosco separado e sem emissao na superficie.');
}finally{scene.dispose();engine.dispose();await server.close();}
