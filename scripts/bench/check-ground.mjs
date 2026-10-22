// Regressao de geometria, sem navegador/GPU: node scripts/bench/check-ground.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { unionVistaLandscape } from '../import/union-vista-landscape-data.mjs';

// Cache proprio: o teste SSR nao pode invalidar os shaders otimizados do Vite que esta aberto.
const server = await createServer({root:'apps/viewer',configFile:false,cacheDir:'node_modules/.vite-ground-check',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
try {
  const {buildPlanGround} = await server.ssrLoadModule('/src/scene/ground-plan.ts');
  const {surfaceFits} = await server.ssrLoadModule('/src/scene/ground.ts');
  const lot = [[122,1088],[122,400],[140,322],[185,262],[250,212],[330,182],[430,170],[480,175],[1090,468],[1090,838],[335,838],[335,1088]];
  const reviewed = unionVistaLandscape(lot);
  const mesh = buildPlanGround(lot,reviewed.polygons,p=>p);
  assert.equal(mesh.other,null,'A arte com sombras/copas nao pode reaparecer projetada no chao revisado.');
  const inside = ([x,y],ring) => { let yes=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++) { const [a,b]=ring[i],[c,d]=ring[j]; if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)yes=!yes; } return yes; };
  const triangleArea = (g) => { let area=0; for(let i=0;i<g.indices.length;i+=3){const p=g.indices.slice(i,i+3).map(v=>[g.positions[v*3],g.positions[v*3+2]]);area+=Math.abs((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[2][0]-p[0][0])*(p[1][1]-p[0][1]))/2; const center=[p.reduce((s,v)=>s+v[0],0)/3,p.reduce((s,v)=>s+v[1],0)/3];assert.ok(inside(center,lot),'Triangulo de solo fora da divisa.');}return area;};
  const hasPoint=(g,[x,z])=>{for(let i=0;i<g.indices.length;i+=3){const t=g.indices.slice(i,i+3).map(v=>[g.positions[v*3],g.positions[v*3+2]]);const sides=t.map(([a,b],k)=>{const [c,d]=t[(k+1)%3];return (c-a)*(z-b)-(d-b)*(x-a);});if(sides.every(v=>v>=-1e-7)||sides.every(v=>v<=1e-7))return true;}return false;};
  assert.ok(mesh.grass?.indices.length&&mesh.raised.indices.length&&mesh.curbs.indices.length);
  for(const g of [mesh.grass,mesh.raised,mesh.curbs])assert.ok(g.positions.every(Number.isFinite)&&g.normals.every(Number.isFinite));
  for(const point of [[153,900],[260,541],[535,542]]) {assert.ok(hasPoint(mesh.grass,point));assert.ok(!hasPoint(mesh.raised,point),'Grama e calcada sobrepostas.');}
  for(const point of [[278,900],[402,462],[300,620]]) {assert.ok(hasPoint(mesh.raised,point));assert.ok(!hasPoint(mesh.grass,point),'Calcada coberta por grama.');}
  for(const point of [[210,900],[175,693],[400,570]])assert.ok(!hasPoint(mesh.raised,point)&&!hasPoint(mesh.grass,point),'Via de circulacao ocupada por piso ou canteiro.');
  const grassArea=triangleArea(mesh.grass), pavingArea=triangleArea(mesh.raised);
  assert.ok(grassArea>10000&&pavingArea>10000,'Superficies ausentes.');
  const map={x0:100,y0:200,w:20,h:20,classes:new Uint8Array(400).fill(1)};
  assert.ok(surfaceFits(map,110,210,Math.PI/2,20,20,1),'Contato exato com a borda nao e invasao por arredondamento.');
  assert.ok(surfaceFits(map,110,210,0,8,4,1));
  map.classes[8*20+12]=2;
  assert.ok(!surfaceFits(map,110,210,0,8,4,1),'Verificar somente o centro deixa carro invadir o canteiro.');
  assert.ok(!surfaceFits(map,101,210,Math.PI/4,8,4,1),'Vaga nao pode cruzar a divisa.');
  console.log(JSON.stringify({result:'OK',regions:reviewed.polygons.length,parkingRows:reviewed.parkingRows.length,grassM2:+(grassArea*.16**2).toFixed(1),pavingM2:+(pavingArea*.16**2).toFixed(1),checks:['divisa','sem arte projetada','separacao grama/piso/asfalto','vagas inteiras','normais finitas']}));
} finally {await server.close();}
