import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({root:'apps/viewer',configFile:false,cacheDir:'node_modules/.vite-loading-check',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
try {
  const {createLoadQueue}=await server.ssrLoadModule('/src/scene/load-queue.ts');
  const queue=createLoadQueue(2);let active=0,peak=0;const starts=[];
  const tasks=Array.from({length:6},(_,i)=>queue(async()=>{
    starts.push(i);active++;peak=Math.max(peak,active);
    await new Promise(r=>setTimeout(r,5));active--;
    if(i===1)throw Error('falha esperada');return i;
  }));
  const result=await Promise.allSettled(tasks);
  assert.equal(peak,2);assert.equal(active,0);assert.deepEqual(starts,[0,1,2,3,4,5]);
  assert.equal(result[1].status,'rejected');assert.equal(result[5].status,'fulfilled');
  assert.throws(()=>createLoadQueue(0));
  const {detectQuality,savedQuality,saveQuality}=await server.ssrLoadModule('/src/scene/quality.ts');
  Object.defineProperty(globalThis,'navigator',{value:{hardwareConcurrency:16,deviceMemory:16,userAgent:'desktop',maxTouchPoints:0},configurable:true});
  assert.equal(detectQuality('nvidia'),'high','Ultra somente por escolha do visitante.');
  assert.equal(detectQuality('swiftshader'),'eco');
  let saved=null;globalThis.localStorage={getItem:()=>saved,setItem:(_k,v)=>saved=v};
  saveQuality('ultra');assert.equal(savedQuality(),'ultra','Nao sobrescrever preferencia salva.');
  Object.defineProperty(globalThis,'navigator',{value:{hardwareConcurrency:4,deviceMemory:4,userAgent:'Android Mobile',maxTouchPoints:1},configurable:true});
  assert.equal(detectQuality('mobile'),'eco');
  console.log('OK: fila limitada, falha nao bloqueia proximas torres, prioridade estavel e qualidade inicial conservadora.');
} finally {await server.close();}
