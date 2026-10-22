import {createServer} from 'vite';
import clipping from 'polygon-clipping';
const server=await createServer({root:'apps/viewer',configFile:false,cacheDir:'node_modules/.vite-urban-check',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
try{
  const {roadBuffer,roadWidth,area,union,ring}=await server.ssrLoadModule('/src/scene/urban-geometry.ts');
  const d=await(await fetch('http://localhost:3000/api/v1/public/developments/union-vista')).json(),s=await(await fetch('http://localhost:3000/api/v1/public/developments/union-vista/surroundings')).json(),l=d.viewer.layout;
  const roads=s.roads.filter(r=>roadWidth[r.kind]&&r.points.some(p=>Math.hypot(...p)<240));
  const asphalt=union(roads.map(r=>roadBuffer(r.points,roadWidth[r.kind]))),corridor=union(roads.map(r=>roadBuffer(r.points,roadWidth[r.kind]+2.6)));
  const transform=(dx=0,dz=0,da=0)=>l.lot.map(([x,z])=>{x=(x-l.origin[0])*l.metersPerPixel;z=(z-l.origin[1])*l.metersPerPixel;const a=(l.azimuth+da)*Math.PI/180;return[Math.cos(a)*x-Math.sin(a)*z+dx,Math.sin(a)*x+Math.cos(a)*z+dz];});
  const initial=transform(),before={roadM2:area(clipping.intersection(ring(initial),asphalt)),corridorM2:area(clipping.intersection(ring(initial),corridor))};
  // Primeiro busca uma translacao pequena; a escala nao pode ser reduzida para caber.
  let best=null;
  for(let da=-1.5;da<=1.501;da+=.25)for(let dx=-.5;dx<=6;dx+=.25)for(let dz=-6;dz<=.501;dz+=.25){
    const change=dx*dx+dz*dz+da*da*8;if(best&&change>=best.change)continue;
    const points=transform(dx,dz,da);if(area(clipping.intersection(ring(points),corridor))>.001)continue;
    best={dx,dz,da,change,roadM2:area(clipping.intersection(ring(points),asphalt)),corridorM2:area(clipping.intersection(ring(points),corridor))};
  }
  console.log(JSON.stringify({before,best,nearRoads:roads.length,origin:l.origin,azimuth:l.azimuth}));
}finally{await server.close();}
