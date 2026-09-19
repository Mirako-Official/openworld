import {roadGraph} from './road-graph.mjs';
import {drivingRoute} from './driving-route.mjs';

const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
class MinHeap{
  items=[];
  push(value){const a=this.items;let i=a.length;a.push(value);while(i){const p=(i-1)>>1;if(a[p].score<=value.score)break;a[i]=a[p];i=p;}a[i]=value;}
  pop(){const a=this.items,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].score<a[c].score)c++;if(a[c].score>=last.score)break;a[i]=a[c];i=c;}a[i]=last;}return first;}
}
export function createRoadNavigator(roads){
  const graph=roadGraph(roads),edges=[...graph.edges.values()];
  function lanes(points){
    const widths=points.slice(1).map((b,i)=>{
      const a=points[i],mid=a.map((v,j)=>(v+b[j])/2);let best=Infinity,width=0;
      for(const edge of edges){const u=edge.a.p,v=edge.b.p,dx=v[0]-u[0],dz=v[2]-u[2],t=Math.max(0,Math.min(1,((mid[0]-u[0])*dx+(mid[2]-u[2])*dz)/(dx*dx+dz*dz)));
        const d=Math.hypot(mid[0]-u[0]-dx*t,mid[2]-u[2]-dz*t)+Math.abs(mid[1]-u[1]-(v[1]-u[1])*t)*4;
        if(d<best){best=d;width=edge.width;}
      }return width;
    });return drivingRoute(points,widths);
  }
  function snap(position){
    let best=null,score=Infinity;
    for(const edge of edges){const a=edge.a.p,b=edge.b.p,dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((position.x-a[0])*dx+(position.z-a[2])*dz)/(dx*dx+dz*dz))),p=a.map((v,i)=>v+(b[i]-v)*t),gap=Math.hypot(position.x-p[0],position.z-p[2]);
      const cost=gap+(Number.isFinite(position.y)?Math.abs(position.y-p[1])*2:0);if(cost<score){score=cost;best={edge,p,gap};}
    }return best&&best.gap<=120?best:null;
  }
  return {route(start,target){
    if(![start?.x,start?.z,target?.x,target?.z].every(Number.isFinite))return {status:'invalid',points:[]};
    const from=snap(start),to=snap(target);if(!from||!to)return {status:edges.length?'off-road':'no-roads',points:[]};
    if(from.edge===to.edge)return {status:'ok',points:[from.p,to.p],drivingPoints:lanes([from.p,to.p]),distance:distance(from.p,to.p),startGap:from.gap,endGap:to.gap};
    const goal={p:to.p},heap=new MinHeap(),costs=new Map(),previous=new Map();
    for(const node of [from.edge.a,from.edge.b]){const cost=distance(from.p,node.p);costs.set(node,cost);heap.push({node,cost,score:cost+distance(node.p,to.p)});}
    let visited=0;
    while(heap.items.length){const current=heap.pop(),{node,cost}=current;if(cost!==costs.get(node))continue;if(node===goal){const points=[to.p];let cursor=previous.get(goal);while(cursor){points.push(cursor.p);cursor=previous.get(cursor);}points.push(from.p);points.reverse();return {status:'ok',points,drivingPoints:lanes(points),distance:cost,startGap:from.gap,endGap:to.gap,visited};}
      visited++;const neighbors=node.arms.map(a=>a.to);if(node===to.edge.a||node===to.edge.b)neighbors.push(goal);
      for(const next of neighbors){const total=cost+distance(node.p,next.p);if(total>=(costs.get(next)??Infinity))continue;costs.set(next,total);previous.set(next,node);heap.push({node:next,cost:total,score:total+distance(next.p,to.p)});}
    }return {status:'disconnected',points:[],visited};
  },nodeCount:graph.nodes.size};
}
