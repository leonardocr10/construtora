import type { PlanLayout, Point } from '../types';

export interface InteriorObstacle { x0: number; y0: number; x1: number; y1: number }
interface Segment { a: Point; b: Point; radius: number }
export const walkingRadius = 0.17;

export function pointInRoom([x,y]: Point, points: Point[]) {
  let inside = false;
  for (let i=0,j=points.length-1;i<points.length;j=i++) {
    const [ax,ay]=points[i], [bx,by]=points[j];
    if ((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax) inside=!inside;
  }
  return inside;
}
const distance = (a: Point,b: Point) => Math.hypot(a[0]-b[0],a[1]-b[1]);
function toSegment(p: Point,a: Point,b: Point) {
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);
}

/** Navegacao no piso real: vãos de porta, colisao do corpo e mobiliario. Sem teletransporte entre ambientes. */
export class InteriorNavigation {
  readonly segments: Segment[] = [];
  readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number;
  private readonly cell = 0.1;
  private readonly width: number; private readonly height: number;
  private readonly free: Uint8Array;

  constructor(readonly layout: PlanLayout, readonly obstacles: InteriorObstacle[] = [], readonly radius = walkingRadius) {
    const points=layout.rooms.flatMap(r=>r.points);
    this.minX=Math.min(...points.map(p=>p[0])); this.maxX=Math.max(...points.map(p=>p[0]));
    this.minY=Math.min(...points.map(p=>p[1])); this.maxY=Math.max(...points.map(p=>p[1]));
    for (const wall of layout.walls) {
      const len=distance(wall.a,wall.b); if(len<1e-6)continue;
      const at=(u:number):Point=>[wall.a[0]+(wall.b[0]-wall.a[0])*u/len,wall.a[1]+(wall.b[1]-wall.a[1])*u/len];
      const doors=layout.openings.filter(o=>o.wallId===wall.id&&o.kind!=='window').map(o=>[Math.max(0,o.offset-o.width/2+0.025),Math.min(len,o.offset+o.width/2-0.025)]).sort((a,b)=>a[0]-b[0]);
      let cursor=0;
      for(const [start,end] of [...doors,[len,len]]) {
        if(start>cursor)this.segments.push({a:at(cursor),b:at(start),radius:wall.thickness/2});
        cursor=Math.max(cursor,end);
      }
    }
    this.width=Math.ceil((this.maxX-this.minX)/this.cell); this.height=Math.ceil((this.maxY-this.minY)/this.cell);
    this.free=new Uint8Array(this.width*this.height);
    for(let i=0;i<this.free.length;i++)this.free[i]=this.blocked(this.point(i))?0:1;
  }

  blocked(p:Point) {
    if(!this.layout.rooms.some(r=>pointInRoom(p,r.points)||r.points.some((a,i)=>toSegment(p,a,r.points[(i+1)%r.points.length])<0.012)))return true;
    if(this.segments.some(s=>toSegment(p,s.a,s.b)<s.radius+this.radius-1e-6))return true;
    return this.obstacles.some(o=>Math.hypot(Math.max(o.x0-p[0],0,p[0]-o.x1),Math.max(o.y0-p[1],0,p[1]-o.y1))<this.radius);
  }

  canTravel(a:Point,b:Point) {
    const steps=Math.max(1,Math.ceil(distance(a,b)/0.045));
    for(let i=0;i<=steps;i++)if(this.blocked([a[0]+(b[0]-a[0])*i/steps,a[1]+(b[1]-a[1])*i/steps]))return false;
    return true;
  }

  nearest(p:Point, within?:Point[], maxDistance=Infinity):Point|null {
    if(!this.blocked(p)&&(!within||pointInRoom(p,within)))return [...p];
    let best:Point|null=null, d=maxDistance;
    for(let i=0;i<this.free.length;i++) {
      if(!this.free[i])continue;
      const q=this.point(i), next=distance(p,q);
      if(next<d&&(!within||pointInRoom(q,within))){best=q;d=next;}
    }
    return best;
  }

  path(from:Point,to:Point):Point[]|null {
    if(this.blocked(from)||this.blocked(to))return null;
    if(this.canTravel(from,to))return [[...from],[...to]];
    const start=this.index(from),end=this.index(to);
    if(start<0||end<0)return null;
    const costs=new Float64Array(this.free.length).fill(Infinity),parent=new Int32Array(this.free.length).fill(-1),closed=new Uint8Array(this.free.length);
    const open=[start]; costs[start]=0;
    const estimate=(i:number)=>costs[i]+distance(this.point(i),to);
    while(open.length) {
      let n=0;for(let k=1;k<open.length;k++)if(estimate(open[k])<estimate(open[n]))n=k;
      const current=open.splice(n,1)[0]; if(closed[current])continue; closed[current]=1;
      if(current===end) {
        const points:Point[]=[to];let i=parent[current];
        while(i!==start&&i>=0){points.push(this.point(i));i=parent[i];}points.push(from);points.reverse();
        const smooth:Point[]=[points[0]];
        for(let i=0;i<points.length-1;){let j=points.length-1;while(j>i+1&&!this.canTravel(points[i],points[j]))j--;smooth.push(points[j]);i=j;}
        return smooth.every((p,i)=>i===0||this.canTravel(smooth[i-1],p))?smooth:null;
      }
      const x=current%this.width,y=Math.floor(current/this.width),p=this.point(current);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=this.width||ny>=this.height)continue;
        const next=ny*this.width+nx;if(!this.free[next]||closed[next])continue;
        const q=this.point(next);if(!this.canTravel(current===start?from:p,next===end?to:q))continue;
        const cost=costs[current]+distance(p,q);
        if(cost<costs[next]){costs[next]=cost;parent[next]=current;open.push(next);}
      }
    }
    return null;
  }

  private point(i:number):Point {return [this.minX+(i%this.width+0.5)*this.cell,this.minY+(Math.floor(i/this.width)+0.5)*this.cell];}
  private index(p:Point) {
    let x=Math.floor((p[0]-this.minX)/this.cell),y=Math.floor((p[1]-this.minY)/this.cell);
    if(x<0||y<0||x>=this.width||y>=this.height)return -1;
    let index=y*this.width+x;
    if(this.free[index]&&this.canTravel(p,this.point(index)))return index;
    let best=-1,d=Infinity;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=this.width||ny>=this.height)continue;const i=ny*this.width+nx,q=this.point(i),next=distance(p,q);if(this.free[i]&&next<d&&this.canTravel(p,q)){best=i;d=next;}}
    return best;
  }
}
