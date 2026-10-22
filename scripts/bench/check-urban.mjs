import assert from 'node:assert/strict';
import {createServer} from 'vite';
import clipping from 'polygon-clipping';
const server=await createServer({root:'apps/viewer',configFile:false,cacheDir:'node_modules/.vite-urban-check',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
try{
  const {roadBuffer,roadWidth,area,ring,buildRoadNetwork,placeHouses}=await server.ssrLoadModule('/src/scene/urban-geometry.ts');
  const {partsToGeo}=await server.ssrLoadModule('/src/scene/ground-vector.ts');
  const road=(points,kind='residential')=>({kind,points});
  const sample=[road([[0,0],[40,0]]),road([[20,30],[20,5]])];
  const net=buildRoadNetwork(sample);
  assert.equal(net.repairs.length,1,'Fechar curto intervalo ate a rua transversal.');
  assert.ok(area(clipping.intersection(net.asphalt,roadBuffer([[20,0],[20,7]],2)))>13,'Asfalto continuo no encontro em T.');
  assert.ok(area(clipping.intersection(net.asphalt,net.sidewalks))<.00001,'Calcada nao pode cruzar asfalto.');
  const obstacle=[[18,2],[22,2],[22,4],[18,4]];
  assert.equal(buildRoadNetwork(sample,obstacle).repairs.length,0,'Nao prolongar rua atraves de lote.');
  assert.equal(buildRoadNetwork(sample,[],[obstacle]).repairs.length,0,'Nao atravessar edificio mapeado.');
  assert.equal(buildRoadNetwork([sample[0],road([[20,40],[20,16]])]).repairs.length,0,'Nao completar ruas longas sem evidencia.');
  assert.equal(buildRoadNetwork([road([[0,0],[20,0]])]).repairs.length,0,'Preservar final de rua sem destino conhecido.');
  const bent=roadBuffer([[0,0],[20,0],[20,20]],8);
  assert.equal(bent.length,1);assert.equal(bent[0].length,1,'Curva sem frestas ou furos.');
  const d=await(await fetch('http://localhost:3000/api/v1/public/developments/union-vista')).json(),data=await(await fetch('http://localhost:3000/api/v1/public/developments/union-vista/surroundings')).json(),l=d.viewer.layout;
  const a=l.azimuth*Math.PI/180,lot=l.lot.map(([x,z])=>{x=(x-l.origin[0])*l.metersPerPixel;z=(z-l.origin[1])*l.metersPerPixel;return[Math.cos(a)*x-Math.sin(a)*z,Math.sin(a)*x+Math.cos(a)*z];});
  const start=performance.now(),network=buildRoadNetwork(data.roads,lot,data.buildings.map(b=>b.points)),networkMs=performance.now()-start;
  console.log(JSON.stringify({stage:'network',milliseconds:Math.round(networkMs)}));
  const overlap=area(clipping.intersection(ring(lot),network.corridor));
  assert.ok(overlap<.001,`Lote invade via/calcada: ${overlap}m2`);
  assert.ok(area(clipping.intersection(network.asphalt,network.sidewalks))<.001);
  const parts=network.asphalt.map(p=>({outer:p[0],holes:p.slice(1)})),geo=partsToGeo(parts,.1,p=>p);
  assert.ok(geo.positions.every(Number.isFinite)&&geo.normals.every(Number.isFinite));
  let triangles=0;
  for(let i=0;i<geo.indices.length;i+=3){const p=geo.indices.slice(i,i+3).map(j=>[geo.positions[j*3],geo.positions[j*3+2]]);triangles+=Math.abs((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[2][0]-p[0][0])*(p[1][1]-p[0][1]))/2;}
  assert.ok(Math.abs(triangles-area(network.asphalt))<.01,'Triangulacao deve preservar todas as ruas e ilhas.');
  const sites=placeHouses(network,lot,data.buildings.map(b=>b.points),data.radius);
  console.log(JSON.stringify({stage:'houses',count:sites.length,milliseconds:Math.round(performance.now()-start)}));
  assert.ok(sites.length>100,'Entorno vazio.');
  const segments=[...network.roads,...network.repairs].flatMap(r=>r.points.slice(1).map((b,i)=>({a:r.points[i],b,half:roadWidth[r.kind]/2})));
  for(let i=0;i<sites.length;i++){
    const s=sites[i];
    // Prova conservadora independente: circulo que contem o quintal inteiro deve ficar fora da via.
    const radius=Math.hypot(s.width+1.6,s.depth+2)/2;
    for(const seg of segments){const [x,z]=s.center,[ax,az]=seg.a,[bx,bz]=seg.b,dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));assert.ok(Math.hypot(x-ax-dx*t,z-az-dz*t)>=seg.half+1.1+radius-.001,'Cobertura/quintal sobre via.');}
    if(Math.hypot(...s.center)<200)assert.ok(area(clipping.intersection(ring(s.footprint),ring(lot)))<.001,'Casa sobre empreendimento.');
    assert.ok(Math.abs(Math.sin(s.yaw)-s.front[0])<1e-9&&Math.abs(Math.cos(s.yaw)-s.front[1])<1e-9);
    for(let j=0;j<i;j++)if(Math.hypot(s.center[0]-sites[j].center[0],s.center[1]-sites[j].center[1])<25)assert.ok(area(clipping.intersection(ring(s.footprint),ring(sites[j].footprint)))<.001,'Casas sobrepostas.');
  }
  assert.equal(l.groundPlan.polygons[0].kind,'grass');
  assert.equal(JSON.stringify(l.groundPlan.polygons[0].points),JSON.stringify(l.lot));
  console.log(JSON.stringify({result:'OK',networkMs:Math.round(networkMs),roads:network.roads.length,shortRepairs:network.repairs.length,houses:sites.length,lotOverlapM2:overlap,asphaltM2:Math.round(area(network.asphalt)),checks:['encontros e curvas','calcada sem sobreposicao','divisa livre','casas fora de vias e lote','fachadas orientadas','base de grama']}));
}finally{await server.close();}
