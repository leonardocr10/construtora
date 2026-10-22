import clipping, {type MultiPolygon,type Polygon} from 'polygon-clipping';
import type {Point,Surroundings} from '../types';

export type Road=Surroundings['roads'][number];
export const roadWidth:Record<string,number>={motorway:22,trunk:20,primary:16,secondary:13,tertiary:11,unclassified:8,residential:8,living_street:6,service:4.5,motorway_link:9,trunk_link:9,primary_link:9,secondary_link:8,tertiary_link:8};
// Micrometros: remove diferencas de seno/cosseno em arestas coincidentes nas unioes.
export const ring=(points:Point[]):Polygon=>[points.map(([x,z])=>[Math.round(x*1e6)/1e6,Math.round(z*1e6)/1e6])];
export function area(shape:MultiPolygon){return shape.reduce((sum,polygon)=>sum+polygon.reduce((n,r,i)=>{let a=0;for(let j=1;j<r.length;j++)a+=r[j-1][0]*r[j][1]-r[j][0]*r[j-1][1];return n+(i?-1:1)*Math.abs(a/2);},0),0);}
export function union(shapes:MultiPolygon[]):MultiPolygon{
  let result:MultiPolygon=[];
  // Limita o tamanho de cada chamada sem perder os recortes/ilhas do arruamento.
  for(let i=0;i<shapes.length;i+=32){const batch=shapes.slice(i,i+32);if(batch.length)result=clipping.union(result,...batch);}
  return result;
}
export function distanceToSegment(p:Point,a:Point,b:Point){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);}

/** Buffer em metros, com encontros arredondados. Retangulos soltos deixam frestas nas curvas. */
export function roadBuffer(points:Point[],width:number):MultiPolygon{
  const shapes:MultiPolygon[]=[],r=width/2;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l<.001)continue;
    const nx=-(b[1]-a[1])*r/l,ny=(b[0]-a[0])*r/l;
    shapes.push([ring([[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]])]);
  }
  for(const p of points)shapes.push([ring(Array.from({length:12},(_,i)=>{const t=i*Math.PI/6;return[p[0]+Math.cos(t)*r,p[1]+Math.sin(t)*r] as Point;}))]);
  return shapes.length?clipping.union(shapes[0],...shapes.slice(1)):[];
}

export interface RoadNetwork{roads:Road[];repairs:Road[];asphalt:MultiPolygon;sidewalks:MultiPolygon;corridor:MultiPolygon}
/** Fecha apenas pequenos vãos colineares ate uma via existente; nao inventa ruas longas. */
export function buildRoadNetwork(input:Road[],lot:Point[]=[],buildings:Point[][]=[]):RoadNetwork{
  const roads=input.filter(r=>roadWidth[r.kind]&&r.points.length>=2).map(r=>({...r,points:r.points.filter((p,i)=>!i||Math.hypot(p[0]-r.points[i-1][0],p[1]-r.points[i-1][1])>.01)})).filter(r=>r.points.length>=2);
  const segments=roads.flatMap((r,index)=>r.points.slice(1).map((b,i)=>({a:r.points[i],b,index})));
  const obstacles=[...(lot.length?[lot]:[]),...buildings].map(p=>({p,minX:Math.min(...p.map(q=>q[0])),maxX:Math.max(...p.map(q=>q[0])),minY:Math.min(...p.map(q=>q[1])),maxY:Math.max(...p.map(q=>q[1]))}));
  const repairs:Road[]=[];
  for(let index=0;index<roads.length;index++){
    const road=roads[index];if(!['residential','living_street','unclassified','service'].includes(road.kind))continue;
    for(const reverse of [false,true]){
      const points=reverse?[...road.points].reverse():road.points,p=points.at(-1)!,prev=points.at(-2)!,len=Math.hypot(p[0]-prev[0],p[1]-prev[1]);
      const direction:Point=[(p[0]-prev[0])/len,(p[1]-prev[1])/len];
      if(segments.some(s=>s.index!==index&&distanceToSegment(p,s.a,s.b)<.65))continue;
      let best:Point|null=null,dist=14;
      for(const s of segments){
        if(s.index===index)continue;const ex=s.b[0]-s.a[0],ey=s.b[1]-s.a[1],den=direction[0]*ey-direction[1]*ex;
        if(Math.abs(den)<1e-7)continue;
        const ax=s.a[0]-p[0],ay=s.a[1]-p[1],t=(ax*ey-ay*ex)/den,u=(ax*direction[1]-ay*direction[0])/den;
        if(t>.65&&t<dist&&u>=0&&u<=1){best=[p[0]+direction[0]*t,p[1]+direction[1]*t];dist=t;}
      }
      if(!best)continue;
      const shape=roadBuffer([p,best],roadWidth[road.kind]+2.2),xs=[p[0],best[0]],ys=[p[1],best[1]],margin=roadWidth[road.kind]/2+1.1;
      if(obstacles.some(o=>o.maxX>=Math.min(...xs)-margin&&o.minX<=Math.max(...xs)+margin&&o.maxY>=Math.min(...ys)-margin&&o.minY<=Math.max(...ys)+margin&&area(clipping.intersection(shape,ring(o.p)))>.01))continue;
      repairs.push({kind:road.kind,name:road.name,points:[p,best]});
    }
  }
  const all=[...roads,...repairs];
  const asphalt=union(all.map(r=>roadBuffer(r.points,roadWidth[r.kind])));
  const corridor=union(all.map(r=>roadBuffer(r.points,roadWidth[r.kind]+2.2)));
  const sidewalks=clipping.difference(corridor,asphalt);
  return {roads,repairs,asphalt,sidewalks,corridor};
}

export function rectangle(center:Point,w:number,d:number,yaw:number):Point[]{return[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([x,z])=>[center[0]+Math.cos(yaw)*x+Math.sin(yaw)*z,center[1]-Math.sin(yaw)*x+Math.cos(yaw)*z] as Point);}

export interface HouseSite{center:Point;width:number;depth:number;height:number;yaw:number;flatRoof:boolean;footprint:Point[];front:Point;pathLength:number}
/** Ocupacao ilustrativa, com a fachada voltada para a rua e a cobertura inteira fora das vias. */
export function placeHouses(network:RoadNetwork,lot:Point[],buildings:Point[][],radius:number):HouseSite[]{
  let seed=42;const random=()=>{seed=seed*16807%2147483647;return(seed-1)/2147483646;};
  const cells=new Map<string,Point[][]>(),roadCells=new Map<string,{a:Point;b:Point;half:number}[]>(),size=40;
  const keys=(points:Point[],margin=0)=>{const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),out:string[]=[];for(let x=Math.floor((Math.min(...xs)-margin)/size);x<=Math.floor((Math.max(...xs)+margin)/size);x++)for(let z=Math.floor((Math.min(...zs)-margin)/size);z<=Math.floor((Math.max(...zs)+margin)/size);z++)out.push(`${x}:${z}`);return out;};
  const occupy=(p:Point[])=>{for(const k of keys(p)){if(!cells.has(k))cells.set(k,[]);cells.get(k)!.push(p);}};
  if(lot.length)occupy(lot);for(const b of buildings)if(b.length>=3)occupy(b);
  for(const r of [...network.roads,...network.repairs])for(let i=1;i<r.points.length;i++){
    const s={a:r.points[i-1],b:r.points[i],half:roadWidth[r.kind]/2};for(const k of keys([s.a,s.b],s.half+15)){if(!roadCells.has(k))roadCells.set(k,[]);roadCells.get(k)!.push(s);}
  }
  const houses:HouseSite[]=[];
  for(const road of network.roads){
    if(!['residential','living_street','unclassified','tertiary'].includes(road.kind))continue;
    const half=roadWidth[road.kind]/2;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<16)continue;
      const dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
      for(let d=8;d<len-7;d+=12.8)for(const side of [1,-1]){
        if(random()<.12)continue;
        const offset=half+10.4,center:Point=[a[0]+dx*d-dz*offset*side,a[1]+dz*d+dx*offset*side];if(Math.hypot(...center)>radius)continue;
        const width=6.8+random()*1.8,depth=8.8+random()*2.6,height=3.2+(random()<.12?2.7:0);
        const front:Point=[dz*side,-dx*side],yaw=Math.atan2(front[0],front[1]);
        const footprint=rectangle(center,width+1.6,depth+2,yaw),r=Math.hypot(width+1.6,depth+2)/2;
        const nearRoads=roadCells.get(`${Math.floor(center[0]/size)}:${Math.floor(center[1]/size)}`)??[];
        if(nearRoads.some(s=>distanceToSegment(center,s.a,s.b)<s.half+1.2+r))continue;
        const occupied=new Set(keys(footprint).flatMap(k=>cells.get(k)??[]));
        if([...occupied].some(p=>area(clipping.intersection(ring(footprint),ring(p)))>.001))continue;
        houses.push({center,width,depth,height,yaw,front,flatRoof:random()<.23,footprint,pathLength:offset-half-1.1-depth/2});occupy(footprint);
      }
    }
  }
  return houses;
}
