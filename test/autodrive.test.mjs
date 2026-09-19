import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutodrive} from '../src/autodrive.mjs';
import {driveStep,createVehicles} from '../src/vehicles.mjs';
import {Scene,PerspectiveCamera} from 'three';
import {drivingRoute} from '../shared/driving-route.mjs';

test('autodrive follows a right-angle route and stops at its end',()=>{
  const pilot=createAutodrive(),v={type:'car',x:0,y:4,z:0,heading:0,speed:0};
  pilot.setRoute([[0,4,0],[0,4,-50],[50,4,-50]]);assert.equal(pilot.toggle(v),true);
  for(let i=0;i<3600;i++){driveStep(v,pilot.update(v,{},1/60),1/60,()=>true);}
  assert.ok(Math.hypot(v.x-50,v.z+50)<3,JSON.stringify(v));assert.equal(v.speed,0);
  assert.equal(pilot.status,'已到达');
});
test('manual input takes over and missing routes brake until replanned',()=>{
  const pilot=createAutodrive(),v={type:'car',x:0,y:4,z:0,heading:0,speed:8};
  assert.equal(pilot.toggle(v),false);pilot.setRoute([[0,4,0],[0,4,-100]]);pilot.toggle(v);
  pilot.setRoute([]);assert.equal(pilot.update(v,{},.05).brake,true);
  pilot.setRoute([[0,4,0],[0,4,-100]]);assert.equal(pilot.update(v,{},.05).forward,true);
  assert.deepEqual(pilot.update(v,{left:true},.05),{left:true});assert.equal(pilot.enabled,false);
});
test('unsupported vehicles, distant routes and sustained blockage are refused',()=>{
  const pilot=createAutodrive(),v={type:'car',x:0,y:4,z:0,heading:0,speed:0};
  pilot.setRoute([[0,4,0],[0,4,-100]]);assert.equal(pilot.toggle({...v,type:'plane'}),false);
  assert.equal(pilot.toggle({...v,x:50}),false);assert.equal(pilot.toggle(v),true);
  for(let i=0;i<100;i++)pilot.update(v,{},.05);
  assert.equal(pilot.enabled,false);assert.equal(pilot.status,'前方受阻，请接管');
});
test('vehicle update drives autonomously, pauses, rebases and allows braking takeover',()=>{
  const origin={x:0,z:0},system=createVehicles(new Scene(),{surface:()=>4,obstacle:()=>false,origin:()=>origin}),camera=new PerspectiveCamera();
  const car=system.targets()[1].vehicle;system.enter(car);system.autopilot.setRoute([[4,4,42],[4,4,-100]]);system.autopilot.toggle(car);
  for(let i=0;i<120;i++)system.update(1/60,new Set(),true,camera);
  assert.ok(car.z<35);const z=car.z;system.update(.05,new Set(),false,camera);assert.equal(car.z,z);
  origin.z=-1;system.rebase();system.update(.05,new Set(),true,camera);assert.ok(car.z<z);assert.equal(system.autopilot.enabled,true);
  const speed=car.speed;system.update(.05,new Set(['Space']),true,camera);assert.ok(car.speed<speed);assert.equal(system.autopilot.enabled,false);
});
test('lane following stays in the right lane through a turn',()=>{
  const p=drivingRoute([[0,4,0],[0,4,-50],[50,4,-50]],[12,12]),pilot=createAutodrive(),v={type:'car',x:3,y:4,z:0,heading:0,speed:0};
  pilot.setRoute(p);pilot.toggle(v);
  for(let i=0;i<3000;i++){driveStep(v,pilot.update(v,{},1/60),1/60,()=>true);
    assert.ok(Math.abs(v.x)<=4.95||Math.abs(v.z+50)<=4.95,'vehicle leaves asphalt');
  }
  assert.ok(Math.hypot(v.x-50,v.z+47)<3);
});
test('obstacle sensor stops before collision, waits and resumes once clear',()=>{
  let obstacle=true,nearest=Infinity;
  const pilot=createAutodrive({canDrive:(v,p)=>!obstacle||p[2]>-24}),v={type:'car',x:0,y:4,z:0,heading:0,speed:10};
  pilot.setRoute([[0,4,0],[0,4,-100]]);pilot.toggle(v);
  for(let i=0;i<600;i++){driveStep(v,pilot.update(v,{},1/60),1/60,()=>true);nearest=Math.min(nearest,v.z);}
  assert.ok(nearest>-24);assert.equal(v.speed,0);assert.equal(pilot.enabled,true);assert.equal(pilot.status,'前方有障碍，等待通行');
  obstacle=false;for(let i=0;i<180;i++)driveStep(v,pilot.update(v,{},1/60),1/60,()=>true);
  assert.ok(v.z<nearest-5);assert.ok(v.speed>0);
});
test('traffic probe respects height and stops for a parked remote car',()=>{
  let traffic=[{x:4,y:4,z:10,heading:0,type:'car'}];
  const system=createVehicles(new Scene(),{surface:()=>4,obstacle:()=>false,origin:()=>({x:0,z:0}),traffic:()=>traffic}),camera=new PerspectiveCamera();
  const car=system.targets()[1].vehicle;system.enter(car);system.autopilot.setRoute([[4,4,42],[4,4,-100]]);system.autopilot.toggle(car);
  for(let i=0;i<700;i++)system.update(1/60,new Set(),true,camera);
  assert.ok(car.z>14);assert.equal(car.speed,0);assert.equal(system.autopilot.enabled,true);
  traffic[0].y=20;for(let i=0;i<300;i++)system.update(1/60,new Set(),true,camera);
  assert.ok(car.z<10);
});
