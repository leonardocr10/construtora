import {DynamicTexture,Texture,type Matrix,type Scene,type TransformNode} from './babylon';
import type {Point,Surroundings} from '../types';
import {box,compose,instanced,merge,meshFrom,openRing,pbr,polygon,prism,rgb,shadows,type Geo} from './geometry';
import clipping from 'polygon-clipping';
import {area as polygonArea,ring} from './urban-geometry';

type MappedBuilding=Surroundings['buildings'][number];
interface Opening{building:number;edge:number;floor:number;center:Point;normal:Point;y:number;width:number;height:number;kind:'window'|'door'}
export interface ContextBuildingGeometry{
  walls:Geo;roofs:Geo;frames:Matrix[];mullions:Matrix[];glass:Matrix[];glassColors:ReturnType<typeof rgb>[];sills:Matrix[];trim:Matrix[];equipment:Matrix[];canopies:Matrix[];
  openings:Opening[];buildings:{points:Point[];height:number;area:number;large:boolean;floors:number}[];
}
const signedArea=(p:Point[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
const tint=(g:Geo,color:number)=>{const c=rgb(color);g.colors=Array.from({length:g.positions.length/3},()=>[c.r,c.g,c.b,1]).flat();return g;};
const inside=([x,z]:Point,p:Point[])=>{let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};

/** Acabamentos ilustrativos sobre o contorno/altura mapeados: nao substitui o cadastro por caixas. */
export function contextBuildingGeometry(input:MappedBuilding[],roads:Surroundings['roads']=[]):ContextBuildingGeometry{
  const result:ContextBuildingGeometry={walls:merge([]),roofs:merge([]),frames:[],mullions:[],glass:[],glassColors:[],sills:[],trim:[],equipment:[],canopies:[],openings:[],buildings:[]};
  const walls:Geo[]=[],roofs:Geo[]=[],wallPalette=[0xe1e1d8,0xcbd4d2,0xd7d3c8,0xdce0dc,0xd4d8df],roofPalette=[0x989f9e,0xa6aaa6,0x8e999e];
  const roadSegments=roads.flatMap(r=>r.points.slice(1).map((b,i)=>({a:r.points[i],b})));
  for(const raw of input){
    const points=openRing(raw.points).filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>.01);
    const area=Math.abs(signedArea(points));if(points.length<3||area<1||points.some(p=>!p.every(Number.isFinite)))continue;
    const index=result.buildings.length,height=Math.max(3,Math.min(Number.isFinite(raw.height)?raw.height:3,60)),large=area>1800&&height<=12;
    const floors=large?Math.max(1,Math.floor(height/4)):Math.max(1,Math.floor(height/3)),floorHeight=height/floors;
    result.buildings.push({points,height,area,large,floors});
    walls.push(tint(prism(points,.04,height),wallPalette[index%wallPalette.length]));
    const orientation=signedArea(points)>0?1:-1;
    const edges=points.map((a,i)=>{const b=points[(i+1)%points.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/(length||1),dz=(b[1]-a[1])/(length||1);return {a,b,length,dx,dz,normal:[dz*orientation,-dx*orientation] as Point};});
    const longest=edges.reduce((a,b)=>b.length>a.length?b:a),ux=longest.dx,uz=longest.dz;
    roofs.push(tint(polygon(points,height+.025,([x,z])=>[(x*ux+z*uz)/12,(-x*uz+z*ux)/12]),roofPalette[index%roofPalette.length]));

    // A entrada fica na fachada voltada para a via mais proxima, nunca em todas as faces.
    let entrance=-1,best=Infinity;
    edges.forEach((e,i)=>{
      if(e.length<4)return;const x=(e.a[0]+e.b[0])/2,z=(e.a[1]+e.b[1])/2;
      for(const s of roadSegments){
        const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],t=Math.max(0,Math.min(1,((x-s.a[0])*dx+(z-s.a[1])*dz)/(dx*dx+dz*dz||1))),rx=s.a[0]+dx*t-x,rz=s.a[1]+dz*t-z,d=Math.hypot(rx,rz);
        if(d<best&&d<90&&rx*e.normal[0]+rz*e.normal[1]>d*.4){entrance=i;best=d;}
      }
    });
    if(entrance<0)entrance=edges.indexOf(longest);
    const opening=(edge:number,floor:number,along:number,y:number,w:number,h:number,kind:Opening['kind'])=>{
      const e=edges[edge],nx=e.normal[0],nz=e.normal[1],x=e.a[0]+e.dx*along,z=e.a[1]+e.dz*along,yaw=Math.atan2(nx,nz);
      result.frames.push(compose(x+nx*.045,y,z+nz*.045,0,yaw,0,w+.14,h+.14,.09));
      result.glass.push(compose(x+nx*.1,y,z+nz*.1,0,yaw,0,w,h,.035));
      result.mullions.push(compose(x+nx*.13,y,z+nz*.13,0,yaw,0,.045,h,.035));
      const tone=(index*19+edge*7+floor*11+Math.round(along))%9;
      result.glassColors.push(rgb(tone===0?0x83928e:tone===1?0x4f6468:0x334b56));
      if(kind==='window')result.sills.push(compose(x+nx*.12,y-h/2-.07,z+nz*.12,0,yaw,0,w+.27,.09,.26));
      result.openings.push({building:index,edge,floor,center:[x,z],normal:e.normal,y,width:w,height:h,kind});
    };
    edges.forEach((e,edge)=>{
      if(e.length<.15)return;
      const yaw=Math.atan2(e.normal[0],e.normal[1]),cx=(e.a[0]+e.b[0])/2,cz=(e.a[1]+e.b[1])/2;
      // Platibanda dentro da projecao do predio; cobertura nunca vira uma caixa retangular sobre o patio.
      result.trim.push(compose(cx-e.normal[0]*.09,height+.2,cz-e.normal[1]*.09,0,yaw,0,Math.max(.05,e.length-.2),.4,.16));
      if(e.length<2.6)return;
      const spacing=large?5.8:3.15,count=Math.max(1,Math.floor((e.length-.7)/spacing)),pitch=(e.length-.7)/count;
      for(let floor=0;floor<floors;floor++){
        if(floor>0)result.trim.push(compose(cx+e.normal[0]*.025,floor*floorHeight,cz+e.normal[1]*.025,0,yaw,0,e.length-.08,.09,.08));
        for(let c=0;c<count;c++){
          const along=.35+pitch*(c+.5),doorWidth=large?3.4:1.35;
          if(floor===0&&edge===entrance&&Math.abs(along-e.length/2)<doorWidth/2+1.1)continue;
          const w=Math.min(large?2.5:1.25,pitch-.65),h=Math.min(large?1.25:1.35,floorHeight-1.1),y=floor*floorHeight+(large?floorHeight*.62:floorHeight*.55);
          if(w>.5&&h>.5)opening(edge,floor,along,y,w,h,'window');
        }
      }
      if(edge===entrance){
        const doorWidth=Math.min(large?3.4:1.35,e.length-1),doorHeight=Math.min(large?2.7:2.25,height-.45);
        opening(edge,0,e.length/2,doorHeight/2+.05,doorWidth,doorHeight,'door');
        result.canopies.push(compose(cx+e.normal[0]*.52,doorHeight+.3,cz+e.normal[1]*.52,0,yaw,0,doorWidth+.55,.14,1.2));
      }
    });
    // Equipamentos baixos e discretos; todos os cantos devem estar dentro do contorno concavo.
    const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
    const step=large?Math.max(24,Math.sqrt(area)/5):8;let placed=0;
    for(let x=minX+3;x<maxX-2&&placed<(large?20:1);x+=step)for(let z=minZ+3;z<maxZ-2&&placed<(large?20:1);z+=step){
      const corners:Point[]=[[-1.2,-1.7],[1.2,-1.7],[1.2,1.7],[-1.2,1.7]].map(([a,b])=>[x+ux*a-uz*b,z+uz*a+ux*b]);
      if(!corners.every(p=>inside(p,points))||polygonArea(clipping.difference(ring(corners),ring(points)))>.00001)continue;
      result.equipment.push(compose(x,height+.48,z,0,Math.atan2(-uz,ux),0,2.4,.85,3.4));placed++;
    }
  }
  result.walls=merge(walls);result.roofs=merge(roofs);return result;
}

function roofTexture(scene:Scene){
  const canvas=Object.assign(document.createElement('canvas'),{width:256,height:256}),ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#e5e8e6';ctx.fillRect(0,0,256,256);
  for(let x=0;x<256;x+=16){ctx.fillStyle='#b9c0bf';ctx.fillRect(x,0,1,256);ctx.fillStyle='#f7f8f5';ctx.fillRect(x+1,0,1,256);}
  for(let y=0;y<256;y+=128){ctx.fillStyle='#c5ccca';ctx.fillRect(0,y,256,1);}
  const texture=new DynamicTexture('osm-roof-standing-seams',canvas,scene,true);texture.update(true);texture.wrapU=texture.wrapV=Texture.WRAP_ADDRESSMODE;texture.anisotropicFilteringLevel=8;return texture;
}

export function buildContextBuildings(scene:Scene,data:Surroundings,parent:TransformNode){
  const g=contextBuildingGeometry(data.buildings,data.roads);
  if(!g.buildings.length)return {buildings:0,windows:0,doors:0};
  shadows(meshFrom('osm-buildings',g.walls,scene,pbr(scene,'osm-building-stucco',{roughness:.93}),parent),true);
  shadows(meshFrom('osm-building-roofs',g.roofs,scene,pbr(scene,'osm-building-roof',{map:roofTexture(scene),roughness:.77,metalness:.12}),parent),true);
  const add=(name:string,matrices:Matrix[],color:number,cast=false)=>{if(matrices.length)shadows(instanced(name,box(1,1,1),scene,pbr(scene,name,{color,roughness:.8}),matrices,parent),cast);};
  add('osm-window-frames',g.frames,0xc6ceca);
  add('osm-window-mullions',g.mullions,0xc6ceca);
  if(g.glass.length)shadows(instanced('osm-window-glass',box(1,1,1),scene,pbr(scene,'osm-window-glass',{roughness:.25,metalness:.24}),g.glass,parent,g.glassColors),false);
  add('osm-window-sills',g.sills,0xe2e3da);
  add('osm-building-trim',g.trim,0xbcc6c2,true);
  add('osm-roof-equipment',g.equipment,0x929d9b,true);
  add('osm-entry-canopies',g.canopies,0xd0d7d3,true);
  return {buildings:g.buildings.length,windows:g.openings.filter(o=>o.kind==='window').length,doors:g.openings.filter(o=>o.kind==='door').length};
}
