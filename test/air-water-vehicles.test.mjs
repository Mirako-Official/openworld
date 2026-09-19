import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,PerspectiveCamera} from 'three';
import {createVehicles,driveStep} from '../src/vehicles.mjs';
import {playerPose} from '../shared/player-state.mjs';
import {vehicleCategory} from '../shared/vehicle-types.mjs';
import {carSeats,carSeatPose} from '../shared/car-seats.mjs';

const system=(surface,ground=surface)=>createVehicles(new Scene(),{surface,ground,obstacle:()=>false,origin:()=>({x:0,z:0})});
test('categories reject unknown and inherited property names',()=>{
  assert.equal(vehicleCategory(),'car');for(const v of ['bike','__proto__',{},'helicopter'])assert.throws(()=>vehicleCategory(v));
});
test('boats require water across their footprint and cannot spawn on land',()=>{
  assert.equal(system(()=>4).summon(0,0,0,null,'boat'),false);
  assert.equal(system((x)=>Math.abs(x)<.5?-3:4).summon(0,0,0,null,'boat'),false);
  const water=system(()=>-3);assert.equal(water.summon(0,0,0,null,'boat'),true);assert.equal(water.personal.y,-.35);
  water.enter(water.personal);const exit=water.exit();assert.ok(exit);assert.equal(exit.y,-1.3);assert.equal(water.active,null);water.enter(water.personal);
  water.update(.05,new Set(['KeyW']),true,new PerspectiveCamera());assert.equal(water.personal.y,-.35);
});
test('planes need dry ground, accelerate before climbing, and respect blocked movement',()=>{
  assert.equal(system(()=>-3).summon(0,0,0,null,'plane'),false);
  // The floor is passed here because a plane without one is airborne by
  // definition and now falls, as it should; driveStep always receives the
  // runway floor in the game.
  const v={type:'plane',x:0,y:4,z:0,heading:0,speed:0};
  driveStep(v,{up:true},.05,()=>true,()=>4);assert.equal(v.y,4);
  v.speed=30;driveStep(v,{up:true,forward:true},.05,()=>true,()=>4);assert.ok(v.y>4);
  // Blocked movement stops the aircraft horizontally. Its altitude is no longer
  // part of that: a blocked plane keeps losing altitude so it can drop away from
  // an obstacle instead of hanging on it (covered in flight-model.test.mjs).
  const before={x:v.x,z:v.z};driveStep(v,{up:true},.05,()=>false,()=>4);
  assert.deepEqual({x:v.x,z:v.z},before);
});
test('airborne vehicles do not block pedestrians below and cannot dismount in midair',()=>{
  const s=system(()=>4);assert.ok(s.summon(0,0,0,null,'plane'));const v=s.personal;v.y=50;s.enter(v);
  assert.equal(s.exit(),null);assert.equal(s.blocks(v.x,v.z,.35,4),false);assert.equal(s.blocks(v.x,v.z,.35,50),true);
});
test('multiplayer accepts plane and boat types and bounds attitude',()=>{
  for(const type of ['plane','boat']){const p=playerPose({x:0,y:5,z:0,yaw:0,vehicleType:type,personalCar:{x:0,y:5,z:0,yaw:0,type,pitch:99}});assert.equal(p.vehicleType,type);assert.equal(p.personalCar.type,type);assert.ok(p.personalCar.pitch<=.4);}
  const pose=roll=>playerPose({x:0,y:5,z:0,yaw:0,vehicleType:'plane',personalCar:{x:0,y:5,z:0,yaw:0,type:'plane',roll}}).personalCar;
  assert.equal(pose(99).roll,1.25);assert.equal(pose(-.6).roll,-.6);assert.equal(pose(undefined).roll,0);
});
test('plane update climbs, respects ceiling, lands and freezes while paused',()=>{
  const s=system(()=>4),camera=new PerspectiveCamera();assert.ok(s.summon(100,100,0,null,'plane'));s.enter(s.personal);
  for(let i=0;i<200;i++)s.update(.05,new Set(['KeyW','KeyE']),true,camera);
  const v=s.personal;assert.ok(v.y>40);assert.ok(v.group.rotation.x>0);assert.ok(v.group.getObjectByName('propeller').rotation.z!==0);
  const before=[v.x,v.y,v.z];s.update(.05,new Set(['KeyW','KeyE']),false,camera);assert.deepEqual([v.x,v.y,v.z],before);
  v.y=599.99;s.update(.05,new Set(['KeyW','KeyE']),true,camera);assert.equal(v.y,600);
  // The nose now leads the trajectory, so descending takes a dive rather than a
  // single frame; the surface clamp still settles it exactly on the ground.
  v.y=4.1;for(let i=0;i<400;i++)s.update(.05,new Set(['KeyQ']),true,camera);assert.equal(v.y,4);
  for(let i=0;i<100;i++)s.update(.05,new Set(['Space']),true,camera);assert.ok(s.canExit());assert.equal(s.active,v);assert.ok(s.exit());
});
test('boat stops before shore and dismounts only when stopped beside land',()=>{
  const s=system((x,z)=>z>0?4:-3),camera=new PerspectiveCamera();assert.ok(s.summon(0,2,0,null,'boat'));const v=s.personal;s.enter(v);
  assert.ok(s.canExit());v.speed=8;assert.equal(s.canExit(),false);v.heading=Math.PI;
  for(let i=0;i<100;i++)s.update(.05,new Set(['KeyW']),true,camera);
  assert.ok(v.z<=-3.2);assert.ok(v.speed<1);assert.equal(v.y,-.35);assert.ok(s.exit());
});
test('plane seat coordinates follow pitch and category limits retain car compatibility',()=>{
  assert.throws(()=>carSeats([[2,1,0]],'car'));assert.deepEqual(carSeats([[2,1,0]],'plane'),[[2,1,0]]);
  const seat=carSeats(undefined,'plane')[0],p=carSeatPose({x:0,y:10,z:0,yaw:0,pitch:.2,type:'plane'},seat);
  assert.ok(Math.abs(p.y-(10+seat[1]*Math.cos(.2)-seat[2]*Math.sin(.2)-.87))<1e-8);assert.equal(p.ridingType,'plane');
});
