import type { Geo } from './geometry';
import { computeNormals } from './geometry';

/** Cantos arredondados em estofados, com normais continuas; preserva as dimensoes do movel. */
export function softBox(w:number,h:number,d:number,r:number):Geo {
  r=Math.min(r,w/3,h/3,d/3);
  const g:Geo={positions:[],indices:[],uvs:[],normals:[]};
  const half=[w/2,h/2,d/2];
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]) {
    const u=(axis+1)%3,v=(axis+2)%3,base=g.positions.length/3;
    const samples=(a:number)=>[-a,-a+r*.3,-a+r,a-r,a-r*.3,a];
    const us=samples(half[u]),vs=samples(half[v]);
    for(let j=0;j<6;j++)for(let i=0;i<6;i++) {
      const p=[0,0,0];p[axis]=half[axis]*sign;p[u]=us[i];p[v]=vs[j];
      const core=p.map((x,k)=>Math.max(-half[k]+r,Math.min(half[k]-r,x)));
      const delta=p.map((x,k)=>x-core[k]),len=Math.hypot(...delta)||1;
      g.positions.push(...core.map((x,k)=>x+delta[k]/len*r));g.normals!.push(...delta.map(x=>x/len));g.uvs.push(i/5,j/5);
    }
    for(let j=0;j<5;j++)for(let i=0;i<5;i++){const a=base+j*6+i,b=a+1,c=a+6,e=c+1;g.indices.push(...(sign>0?[a,b,c,b,e,c]:[a,c,b,b,c,e]));}
  }
  return g;
}

/** Folha com nervura e perfil arqueado, em vez de uma esfera como copa. */
export function interiorLeaf(length:number,width:number):Geo {
  const g:Geo={positions:[],indices:[],uvs:[]};
  for(let i=0;i<=6;i++) {
    const t=i/6,spread=Math.sin(Math.PI*t)*width/2;
    const y=Math.sin(t*Math.PI*.9)*length*.28-t*t*length*.12;
    g.positions.push(-spread,y,t*length,0,y+spread*.18,t*length,spread,y,t*length);g.uvs.push(0,t,.5,t,1,t);
    if(i){const a=(i-1)*3,b=i*3;g.indices.push(a,b,a+1,a+1,b,b+1,a+1,b+1,a+2,a+2,b+1,b+2);}
  }
  return computeNormals(g);
}
