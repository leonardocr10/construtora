import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({root:'apps/viewer',configFile:false,cacheDir:'node_modules/.vite-interior-check',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
try{
  const {InteriorNavigation}=await server.ssrLoadModule('/src/scene/interior-navigation.ts');
  const layout={version:1,wallHeight:2.6,rooms:[{id:'a',kind:'living',points:[[0,0],[3,0],[3,4],[0,4]]},{id:'b',kind:'bedroom',points:[[3,0],[6,0],[6,4],[3,4]]}],walls:[{id:'divide',a:[3,0],b:[3,4],thickness:.1}],openings:[{id:'door',wallId:'divide',offset:3,width:.8,kind:'door'}]};
  const nav=new InteriorNavigation(layout,[{x0:1.3,y0:1.2,x1:2,y1:2.4}]);
  assert.ok(nav.blocked([-1,1]));assert.ok(nav.blocked([1.5,1.5]));assert.ok(nav.blocked([3,1]));
  assert.ok(!nav.canTravel([1,1],[5,1]));assert.ok(!nav.canTravel([1,1.8],[2.5,1.8]));
  const path=nav.path([1,1],[5,1]);assert.ok(path?.length>2,'A rota deve passar pela porta.');
  assert.ok(path.every((p,i)=>!i||nav.canTravel(path[i-1],p)),'Todos os trechos devem respeitar paredes e moveis.');
  assert.equal(new InteriorNavigation({...layout,openings:[]}).path([1,1],[5,1]),null);
  const data=await(await fetch('http://localhost:3000/api/v1/public/developments/union-vista')).json();
  for(const plan of data.floorPlans){
    if(!plan.layout)continue;const n=new InteriorNavigation(plan.layout);
    const centers=plan.layout.rooms.map(r=>n.nearest([r.points.reduce((s,p)=>s+p[0],0)/r.points.length,r.points.reduce((s,p)=>s+p[1],0)/r.points.length],r.points));
    assert.ok(centers.every(Boolean),`${plan.code}: todos os comodos precisam ter piso livre.`);
    for(const a of centers)for(const b of centers){const p=n.path(a,b);assert.ok(p,`${plan.code}: comodos desconectados`);assert.ok(p.every((q,i)=>!i||n.canTravel(p[i-1],q)));}
  }
  console.log('OK: colisao, porta, mobiliario, limites e conectividade das quatro plantas persistidas.');
}finally{await server.close();}
