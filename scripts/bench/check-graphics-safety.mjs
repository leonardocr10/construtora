import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {Observable} from '@babylonjs/core/Misc/observable.js';
const server=await createServer({root:'apps/viewer',configFile:false,cacheDir:'node_modules/.vite-safety-check',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
try {
  const {compatibilityMode,renderScaling,waitForVisibleFrame}=await server.ssrLoadModule('/src/scene/graphics-safety.ts');
  assert.equal(compatibilityMode(false,''),true);
  assert.equal(compatibilityMode(true,''),false);
  assert.equal(compatibilityMode(true,'?seguro=1'),true);
  assert.equal(compatibilityMode(false,'?seguro=0'),false);
  for(const [w,h,dpr]of [[1920,1080,1],[3840,2160,2],[2560,1440,1.5],[390,844,3]])for(const safe of [false,true]){
    const scale=renderScaling(w,h,dpr,2,safe);
    assert.ok((w/scale)*(h/scale)<=(safe?1280*720:1920*1080)+1,'Orcamento real de pixels.');
  }
  function fixture(){
    const lost=new Observable(),after=new Observable(),disposed=new Observable();let ready=false;
    const mesh={name:'tower',isEnabled:()=>true,isVisible:true,getTotalVertices:()=>24,isReady:()=>ready};
    return {scene:{onAfterRenderObservable:after,onDisposeObservable:disposed,getEngine:()=>({onContextLostObservable:lost}),getActiveMeshes:()=>({data:[mesh],length:1})},lost,after,disposed,ready:()=>{ready=true;}};
  }
  const a=fixture();let resolved=false;const success=waitForVisibleFrame(a.scene,1000).then(()=>resolved=true);
  a.after.notifyObservers();await Promise.resolve();assert.equal(resolved,false,'Nao liberar so porque CPU montou a geometria.');
  a.ready();a.after.notifyObservers();await Promise.resolve();assert.equal(resolved,false,'Esperar dois quadros.');
  a.after.notifyObservers();await success;assert.equal(resolved,true);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(a.after.observers.length,0);assert.equal(a.lost.observers.length,0);
  const b=fixture(),failure=waitForVisibleFrame(b.scene,1000);b.lost.notifyObservers();await assert.rejects(failure,/contexto/);
  const c=fixture();await assert.rejects(waitForVisibleFrame(c.scene,5),/primeiro quadro/);
  const d=fixture(),closed=waitForVisibleFrame(d.scene,1000);d.disposed.notifyObservers();await assert.rejects(closed,/encerrada/);
  const {World}=await server.ssrLoadModule('/src/scene/world.ts');
  let projections=0,adjustments=0;
  const fake={inset:200,applyingInset:false,host:{clientWidth:1280},engine:{getRenderHeight:()=>800},camera:{getProjectionMatrix:()=>{
    projections++;World.prototype.applyInset.call(fake);return {addAtIndex:()=>adjustments++};
  }}};
  World.prototype.applyInset.call(fake);
  assert.equal(projections,1,'Observable da camera nao pode reentrar infinitamente.');assert.equal(adjustments,1);
  fake.engine.getRenderHeight=()=>0;World.prototype.applyInset.call(fake);assert.equal(projections,1,'Nao recalcular camera sem buffer valido.');
  console.log('OK: modo WebGL conservador, limite de pixels 4K/retina, primeiro quadro e falhas sem loop.');
} finally {await server.close();}
