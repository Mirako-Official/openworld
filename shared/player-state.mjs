import {MAX_COORDINATE,PLOT} from './terrain.mjs';
export const PLAYER_RADIUS=180,PLAYER_LIMIT=16;
export function playerPose(value){
  if(!value||typeof value!=='object')return null;
  const {x,y,z,yaw}=value,limit=MAX_COORDINATE*PLOT.cell;
  if(![x,y,z,yaw].every(Number.isFinite)||Math.abs(x)>limit||Math.abs(z)>limit||y< -200||y>2000)return null;
  let personalCar=null;if(value.personalCar){const c=value.personalCar;if(![c.x,c.y,c.z,c.yaw].every(Number.isFinite)||Math.abs(c.x)>limit||Math.abs(c.z)>limit||c.y< -200||c.y>2000)return null;personalCar={type:['plane','boat'].includes(c.type)?c.type:'car',pitch:Number.isFinite(c.pitch)?Math.max(-.4,Math.min(.4,c.pitch)):0,roll:Number.isFinite(c.roll)?Math.max(-1.25,Math.min(1.25,c.roll)):0,x:c.x,y:c.y,z:c.z,yaw:Math.atan2(Math.sin(c.yaw),Math.cos(c.yaw)),phase:Number.isFinite(c.phase)?c.phase%(Math.PI*2):0,speed:Number.isFinite(c.speed)?Math.max(-60,Math.min(60,c.speed)):0,steer:Number.isFinite(c.steer)?Math.max(-.6,Math.min(.6,c.steer)):0,driving:c.driving===true};}
  return {x,y,z,yaw:Math.atan2(Math.sin(yaw),Math.cos(yaw)),active:value.active===true,moving:value.moving===true,running:value.running===true,seated:value.seated===true,
    climbing:value.climbing===true&&value.seated!==true&&!value.vehicleType,vehicleType:['bike','car','plane','boat'].includes(value.vehicleType)?value.vehicleType:null,crankPhase:Number.isFinite(value.crankPhase)?value.crankPhase%(2*Math.PI):0,personalCar};
}
export function blendPose(a,b,t){
  const distance=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);if(distance>40)return {...b};
  return {...b,pitch:(a.pitch||0)+((b.pitch||0)-(a.pitch||0))*t,roll:(a.roll||0)+((b.roll||0)-(a.roll||0))*t,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,yaw:a.yaw+Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw))*t};
}
