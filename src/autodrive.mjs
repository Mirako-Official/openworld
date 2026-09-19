const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angle=v=>Math.atan2(Math.sin(v),Math.cos(v));
export function createAutodrive({canDrive=()=>true}={}){
  let route=[],enabled=false,status='',blocked=0,waiting=0,owner=null,parking=false;
  let sensorTime=0,sensorGap=Infinity;
  function nearest(v){let best=null;for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(length<.01)continue;
    const t=clamp(((v.x-a[0])*dx+(v.z-a[2])*dz)/(length*length),0,1),x=a[0]+dx*t,z=a[2]+dz*t,d=Math.hypot(v.x-x,v.z-z);
    if(!best||d<best.d)best={i,t,x,z,d,length};
  }return best;}
  function stop(message,brake=false){enabled=false;status=message;parking=brake;blocked=waiting=0;}
  return {
    get enabled(){return enabled;},get status(){return status;},
    setRoute(points){route=Array.isArray(points)&&points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))?points.map(p=>[...p]):[];sensorTime=0;},
    toggle(v){if(enabled){stop('已关闭');return false;}const near=v&&nearest(v);
      if(v?.type!=='car'){status='请先驾驶小汽车';return false;}
      if(!near){status='请先按 M 设置导航终点';return false;}
      if(near.d>8){status='请先驶近导航路线';return false;}
      enabled=true;owner=v;parking=false;blocked=waiting=0;sensorTime=0;status='自动驾驶';return true;
    },
    reset(){stop('');owner=null;},
    update(v,input,dt){
      if(owner!==v){stop('');owner=null;return input;}
      if(Object.values(input).some(Boolean)){stop('手动驾驶');return input;}
      if(!enabled)return parking?{brake:true}:input;
      const near=nearest(v);if(!near){waiting+=dt;status='等待导航路线';if(waiting>8)stop('导航已结束',true);return {brake:true};}waiting=0;
      if(near.d>8){stop('偏离路线，请接管',true);return {brake:true};}
      const end=route.at(-1),endDistance=Math.hypot(v.x-end[0],v.z-end[2]);
      if(endDistance<2){stop('已到达',true);return {brake:true};}
      let remaining=(1-near.t)*near.length;for(let i=near.i+1;i<route.length;i++)remaining+=Math.hypot(route[i][0]-route[i-1][0],route[i][2]-route[i-1][2]);
      let look=clamp(2+Math.abs(v.speed)*.25,2.5,5),x=near.x,z=near.z;
      for(let i=near.i;i<route.length;i++){const p=route[i],d=Math.hypot(p[0]-x,p[2]-z);if(d>=look){x+=(p[0]-x)*look/d;z+=(p[2]-z)*look/d;break;}look-=d;x=p[0];z=p[2];}
      const error=angle(Math.atan2(-(x-v.x),-(z-v.z))-v.heading),distance=Math.max(1,Math.hypot(x-v.x,z-v.z));
      const maxSteer=.62/(1+Math.abs(v.speed)*.045+v.speed*v.speed*.0015),steering=clamp(Math.atan2(5.2*Math.sin(error),distance)/maxSteer,-1,1);
      let speed=Math.min(11,Math.sqrt(Math.max(0,remaining-1)*5),11/(1+Math.abs(error)*4));
      let ahead=(1-near.t)*near.length;
      for(let i=near.i;i<route.length-1&&ahead<25;i++){
        const a=route[i-1],b=route[i],c=route[i+1],turn=Math.abs(angle(Math.atan2(b[0]-a[0],b[2]-a[2])-Math.atan2(c[0]-b[0],c[2]-b[2])));
        const curvature=turn/Math.max(.1,(Math.hypot(b[0]-a[0],b[2]-a[2])+Math.hypot(c[0]-b[0],c[2]-b[2]))/2);
        if(curvature>.015)speed=Math.min(speed,Math.sqrt(Math.min(121,2/curvature)+Math.max(0,ahead-4)*4));
        if(turn>.25)speed=Math.min(speed,Math.sqrt(9+Math.max(0,ahead-5)*4));ahead+=Math.hypot(c[0]-b[0],c[2]-b[2]);
      }
      sensorTime-=dt;sensorGap=Math.max(0,sensorGap-Math.abs(v.speed)*dt);
      if(sensorTime<=0){
      const horizon=Math.max(8,v.speed*v.speed/8+Math.abs(v.speed)*.6+6);
      let gap=Infinity,traveled=0,previous=[v.x,v.y,v.z];
      const path=[[near.x,route[near.i-1][1]+(route[near.i][1]-route[near.i-1][1])*near.t,near.z],...route.slice(near.i)];
      probe:for(const point of path){
        const segment=Math.hypot(point[0]-previous[0],point[2]-previous[2]),heading=segment>.01?Math.atan2(-(point[0]-previous[0]),-(point[2]-previous[2])):v.heading;
        const count=Math.max(1,Math.ceil(segment));
        for(let j=1;j<=count;j++){
          const d=traveled+segment*j/count;if(d>horizon)break probe;
          const p=previous.map((value,k)=>value+(point[k]-value)*j/count);
          if(!canDrive(v,p,heading)){gap=d;break probe;}
        }traveled+=segment;previous=point;
      }
      sensorGap=gap;sensorTime=.1;
      }
      const gap=sensorGap;
      if(Number.isFinite(gap)){
        speed=Math.min(speed,Math.sqrt(Math.max(0,gap-4)*6));blocked=0;
        status=speed<.3?'前方有障碍，等待通行':'前方有障碍，减速';
        return {steering,forward:v.speed<speed-.3,brake:speed<.3||v.speed>speed+.1};
      }
      blocked=v.speed<.2&&speed>1?blocked+dt:0;if(blocked>3){stop('前方受阻，请接管',true);return {brake:true};}
      status='自动驾驶';return {forward:v.speed<speed-.3,brake:v.speed>speed+.3,steering};
    }
  };
}
