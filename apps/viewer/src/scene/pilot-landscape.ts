import type {Building,Development,Point} from '../types';
import {Ground,surfaceFits,type GroundMap} from './ground';

export const pilotModels=['pilot_tree_canopy','pilot_tree_vertical','pilot_shrub_silver','pilot_groundcover','pilot_grass_tuft'] as const;
export interface PilotPlant{model:typeof pilotModels[number];point:Point;pixel:Point;scale:number;yScale:number;yaw:number;radius:number;original?:Point}
export interface PilotLandscape{plants:PilotPlant[];contains:(p:Point)=>boolean;replaces:(p:Point)=>boolean;center:Point;bounds:number[]}
const randomSeed=(seed:number)=>()=>{seed=seed*16807%2147483647;return(seed-1)/2147483646;};
const key=(p:Point)=>p.join(':');

/** Composicao visual limitada a Torre 3. Usa somente as classes de solo e obstaculos persistidos. */
export function planPilotLandscape(development:Development,ground:GroundMap):PilotLandscape|null{
  const layout=development.viewer.layout,tower=development.buildings.find(b=>b.code==='TORRE-03');
  if(development.slug!=='union-vista'||!layout||!tower?.position)return null;
  const center:Point=[tower.position.x,tower.position.z],angle=(tower.position.rotation??0)*Math.PI/180;
  const hx=(tower.model3d?.width??36)/2+18,hz=(tower.model3d?.depth??16.8)/2+28,cos=Math.cos(angle),sin=Math.sin(angle);
  const local=(p:Point):Point=>{const x=p[0]-center[0],z=p[1]-center[1];return[cos*x+sin*z,-sin*x+cos*z];};
  const contains=(p:Point)=>{const [x,z]=local(p);return Math.abs(x)<hx&&Math.abs(z)<hz;};
  const pixel=(p:Point):Point=>[p[0]/layout.metersPerPixel+layout.origin[0],p[1]/layout.metersPerPixel+layout.origin[1]];
  const site=(p:Point):Point=>[(p[0]-layout.origin[0])*layout.metersPerPixel,(p[1]-layout.origin[1])*layout.metersPerPixel];
  const blockers=development.buildings.filter((b):b is Building&{position:NonNullable<Building['position']>}=>!!b.position).map(b=>({point:[b.position.x,b.position.z] as Point,w:(b.model3d?.width??30)+1.2,d:(b.model3d?.depth??16)+3.2,a:(b.position.rotation??0)*Math.PI/180}));
  blockers.push(...Object.values(layout.amenityModels??{}).map(m=>({point:site(m.point),w:m.width,d:m.depth,a:(m.rotation??0)*Math.PI/180})));
  const blocked=(p:Point,r:number)=>blockers.some(b=>{const dx=p[0]-b.point[0],dz=p[1]-b.point[1],x=Math.cos(b.a)*dx+Math.sin(b.a)*dz,z=-Math.sin(b.a)*dx+Math.cos(b.a)*dz;return Math.hypot(Math.max(0,Math.abs(x)-b.w/2),Math.max(0,Math.abs(z)-b.d/2))<r+.2;});
  const fits=(p:Point,r:number)=>{const q=pixel(p);return contains(p)&&!blocked(p,r)&&surfaceFits(ground,q[0],q[1],0,r*2/layout.metersPerPixel,r*2/layout.metersPerPixel,Ground.Grass);};
  const rng=randomSeed(371),plants:PilotPlant[]=[],replaced=new Set<string>(),anchors=(layout.landscape?.trees??[]).map(t=>({...t,site:site(t.point)}));
  const add=(model:PilotPlant['model'],point:Point,scale:number,radius:number,original?:Point)=>{
    plants.push({model,point,pixel:pixel(point),scale,yScale:scale*(.9+rng()*.18),yaw:rng()*Math.PI*2,radius,original});if(original)replaced.add(key(original));
  };
  // Conserva as ancoras existentes que possuem espaco para a copa; duas silhuetas e alturas diferentes.
  for(const [i,t] of anchors.filter(t=>t.kind==='broadleaf'&&contains(t.site)).entries()){
    const vertical=i%3===1,scale=(t.height/(vertical?7:6.3))*(.88+rng()*.18),radius=(vertical?2:3.25)*scale;
    if(fits(t.site,.85)&&!blocked(t.site,radius+.35))add(vertical?'pilot_tree_vertical':'pilot_tree_canopy',t.site,scale,radius,t.point);
  }
  const candidates:Point[]=[];
  // Malha somente de busca; as plantas finais ficam em macicos irregulares, nao em fileiras.
  for(let x=center[0]-hx;x<center[0]+hx;x+=3.2)for(let z=center[1]-hz;z<center[1]+hz;z+=3.2){const p:Point=[x+(rng()-.5)*1.8,z+(rng()-.5)*1.8];if(fits(p,1.05))candidates.push(p);}
  const near=(p:Point,q:Point)=>Math.hypot(p[0]-q[0],p[1]-q[1]);
  // No maximo duas novas arvores, sem disputar espaco com as palmeiras ou arvores preservadas.
  for(const p of candidates){
    if(plants.filter(t=>t.model.startsWith('pilot_tree')&&!t.original).length>=2)break;
    if(!fits(p,1.4)||blocked(p,2.9)||anchors.some(t=>near(p,t.site)<6)||plants.some(t=>near(p,t.point)<6))continue;
    const s=.75+rng()*.18;add('pilot_tree_vertical',p,s,2*s);
  }
  const clusters:Point[]=[];
  // Agrupa estratos baixos junto a arvores/canteiros, deixando clareiras e gramado livre.
  const ranked=candidates.map(p=>({p,score:Math.sin(p[0]*.31)+Math.cos(p[1]*.27)+(!fits(p,2.6)?.5:0)})).sort((a,b)=>b.score-a.score);
  for(const {p} of ranked){
    if(clusters.length>=8)break;
    if(clusters.some(q=>near(p,q)<6)||anchors.some(t=>near(p,t.site)<1.8))continue;
    clusters.push(p);
    for(let j=0;j<13;j++){
      const a=rng()*Math.PI*2,r=Math.sqrt(rng())*2.4,q:Point=[p[0]+Math.cos(a)*r,p[1]+Math.sin(a)*r*.7];
      const model=j%4===0?'pilot_grass_tuft':j%3===0?'pilot_shrub_silver':'pilot_groundcover',scale=.65+rng()*.45,radius=(model==='pilot_grass_tuft'?.48:.65)*scale;
      if(!fits(q,radius+.18)||anchors.some(t=>near(q,t.site)<1.15)||plants.some(t=>!t.model.startsWith('pilot_tree')&&near(q,t.point)<(radius+t.radius)*.82))continue;
      add(model,q,scale,radius);
    }
  }
  return {plants,contains,replaces:p=>replaced.has(key(p)),center,bounds:[center[0]-hx,center[1]-hz,center[0]+hx,center[1]+hz]};
}
