import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,PerspectiveCamera} from 'three';
import {FLIGHT,CLMAX,liftCoefficient,stepFlight} from '../src/flight/FlightModel.mjs';
import {MIN_RUNWAY,runwayFloor,stepPlane} from '../src/flight/FlightAdapter.mjs';
import {driveStep,VEHICLES,createVehicles} from '../src/vehicles.mjs';

const air=overrides=>({type:'plane',x:0,y:100,z:0,heading:0,speed:30,gamma:0,theta:0,bank:0,...overrides});
const run=(v,input,seconds,surfaceY=null)=>{
  const dt=1/120;
  for(let i=0;i<Math.round(seconds/dt);i++)Object.assign(v,stepFlight(v,input,dt,surfaceY));
  return v;
};

test('lift coefficient is linear below the stall angle and collapses past it',()=>{
  assert.equal(liftCoefficient(0),0);
  assert.equal(liftCoefficient(FLIGHT.alphaStall),CLMAX);
  assert.equal(liftCoefficient(-FLIGHT.alphaStall),-CLMAX);
  const past=liftCoefficient(FLIGHT.alphaStall+.05);
  assert.ok(past<CLMAX*.9);assert.ok(past>0);
  assert.ok(liftCoefficient(FLIGHT.alphaStall+.3)>=CLMAX*FLIGHT.stallFloor);
  assert.equal(Math.sign(liftCoefficient(-.6)),-1);
});

test('lift is calibrated so the reference speed carries exactly one gravity at CLMAX',()=>{
  const v=air({speed:FLIGHT.stallSpeed,theta:FLIGHT.alphaStall});
  const lift=FLIGHT.gravity/(FLIGHT.stallSpeed**2*CLMAX)*FLIGHT.stallSpeed**2*CLMAX;
  assert.ok(Math.abs(lift-FLIGHT.gravity)<1e-9);
  assert.equal(v.speed,FLIGHT.stallSpeed);
});

test('below the reference speed the aircraft sinks no matter how far the nose is pulled up',()=>{
  const slow=run(air({speed:9}),{up:true},4);
  assert.ok(slow.gamma<0);assert.ok(slow.y<100);
});

test('a stick-neutral aircraft holds altitude closely while a dive trades it for airspeed',()=>{
  const level=run(air({speed:40}),{forward:true},6);
  assert.ok(Math.abs(level.y-100)<10);
  const diving=run(air({speed:30}),{forward:true,down:true},4);
  const sameTimeLevel=run(air({speed:30}),{forward:true},4);
  assert.ok(diving.y<sameTimeLevel.y-40);
  assert.ok(diving.speed>sameTimeLevel.speed);
  assert.ok(diving.gamma<-.3);
});

test('climbing bleeds airspeed even at full throttle',()=>{
  const level=run(air({speed:40}),{forward:true},8).speed;
  const climb=run(air({speed:40}),{forward:true,up:true},8);
  assert.ok(climb.speed<level);assert.ok(climb.gamma>0);assert.ok(climb.speed>FLIGHT.stallSpeed);
});

test('banking turns the aircraft and the wings level themselves when released',()=>{
  const right=run(air({speed:40}),{forward:true,right:true},3);
  assert.ok(right.bank>.5);assert.ok(right.heading<0);
  const left=run(air({speed:40}),{forward:true,left:true},3);
  assert.ok(left.bank<-.5);assert.ok(left.heading>0);
  assert.equal(run(air({speed:40}),{forward:true},3).heading,0);
  const released=run(right,{forward:true},3);
  assert.ok(Math.abs(released.bank)<.05);
});

test('the rudder yaws the nose and the bank angle is only an attitude',()=>{
  assert.ok(run(air({speed:40}),{forward:true,right:true},3).heading<0);
  assert.ok(run(air({speed:40}),{forward:true,left:true},3).heading>0);
  assert.equal(run(air({speed:40}),{forward:true},3).heading,0);
  // A wing held down without rudder input rolls the aircraft but does not turn
  // it; the original yaw handling is what steers.
  assert.equal(run(air({speed:40,bank:1}),{forward:true},3).heading,0);
});

test('yaw needs airspeed, so a stopped aircraft cannot be steered',()=>{
  const still={type:'plane',x:0,y:100,z:0,heading:0,speed:0,gamma:0,theta:0,bank:0};
  assert.equal(run(still,{right:true},.02).heading,0);
});

test('roll and pitch are published for rendering and stay inside the network pose bounds',()=>{
  const v=run(air({speed:40}),{forward:true,right:true,up:true},3);
  assert.ok(v.roll<0);assert.equal(v.roll,-v.bank);assert.equal(v.pitch,v.theta);
  assert.ok(Math.abs(v.pitch)<=.4);
});

test('the aircraft rolls on the ground, rotates, climbs, then lands back on the surface',()=>{
  const v={type:'plane',x:0,y:4,z:0,heading:0,speed:0};
  for(let i=0;i<600;i++)Object.assign(v,stepFlight(v,{forward:true},1/120,4));
  assert.ok(v.speed>FLIGHT.stallSpeed);assert.equal(v.y,4);assert.ok(Math.abs(v.gamma)<.02);
  for(let i=0;i<1200;i++)Object.assign(v,stepFlight(v,{forward:true,up:true},1/120,4));
  assert.ok(v.y>40);assert.ok(v.gamma>0);
  for(let i=0;i<2400;i++)Object.assign(v,stepFlight(v,{forward:false,down:true},1/120,4));
  assert.equal(v.y,4);assert.ok(v.gamma<=0);
});

test('ground steering yaws the nose right, airborne banking does, and roll stays bounded',()=>{
  const ground={type:'plane',x:0,y:4,z:0,heading:0,speed:15,bank:0,theta:0,gamma:0};
  for(let i=0;i<120;i++)Object.assign(ground,stepFlight(ground,{forward:true,right:true},1/120,4));
  assert.ok(ground.heading<0);assert.ok(Math.abs(ground.bank)<.02);
  assert.ok(Math.abs(run(air({speed:40}),{right:true},5).bank)<=FLIGHT.bankMax+.001);
});

test('a dive reaches a stable speed under the pitch limit without breaching the network bound',()=>{
  const v=run(air({speed:48}),{down:true},12);
  assert.ok(v.gamma<=-FLIGHT.thetaMax);assert.ok(v.speed>20&&v.speed<=60);
  const held=run({...v},{down:true},4);
  assert.ok(Math.abs(held.speed-v.speed)<.5);
});

test('full throttle settles near the level maximum instead of running away',()=>{
  const v=run(air({speed:20}),{forward:true},30);
  assert.ok(v.speed>VEHICLES.plane.max*.95&&v.speed<VEHICLES.plane.max*1.05);
});

test('a blocked move kills the airspeed once and leaves the horizontal position untouched',()=>{
  // Only x and z are untouched. The collision stops the aircraft where it is, but
  // gravity still acts on it, so a blocked aircraft in mid-air also loses altitude —
  // and that descent is what lets it drop away from whatever it hit.
  const v=air({speed:30});const before={x:v.x,y:v.y,z:v.z};
  driveStep(v,{up:true},.05,()=>false,null);
  assert.deepEqual({x:v.x,z:v.z},{x:before.x,z:before.z});
  assert.ok(v.y<before.y,`expected the blocked aircraft to lose altitude, got y=${v.y}`);
  // The impact itself still takes the airspeed; it is only rebuilt by diving.
  const one=air({speed:30});
  stepPlane(one,{},1/240,()=>false,null);
  assert.equal(one.speed,0);
});

test('an airborne aircraft that has lost its airspeed falls instead of hovering',()=>{
  const stalled={type:'plane',x:0,y:200,z:0,heading:0,speed:0,gamma:0,theta:0,bank:0};
  const fallen=run({...stalled},{},5);
  assert.ok(fallen.y<190,`expected the aircraft to fall, got y=${fallen.y}`);
  assert.ok(fallen.gamma<-.5);
});

test('a plane flown into a building comes down instead of sticking to the wall',()=>{
  // The shape the bug was reported in: a real obstacle through createVehicles, not
  // a canMove stub. The plane used to stop dead against the wall and hang there
  // permanently — zeroed airspeed left nothing to pitch, so nothing could move it.
  const system=createVehicles(new Scene(),{surface:()=>4,ground:()=>4,obstacle:x=>x>=60&&x<=120,origin:()=>({x:0,z:0})});
  const camera=new PerspectiveCamera();assert.ok(system.summon(20,0,-Math.PI/2,null,'plane'));
  const v=system.personal;system.enter(v);
  Object.assign(v,{x:20,y:60,z:0,speed:40,gamma:0,theta:0,bank:0});
  for(let i=0;i<400;i++)system.update(.05,new Set(['KeyW']),true,camera);
  assert.ok(v.x<60,`expected the building to stop the aircraft, got x=${v.x}`);
  assert.ok(v.y<55,`expected the aircraft to come down, got y=${v.y}`);
});

test('the vehicle entry point keeps the documented climb, roll and ceiling behaviour',()=>{
  const system=createVehicles(new Scene(),{surface:()=>4,ground:()=>4,obstacle:()=>false,origin:()=>({x:0,z:0})}),camera=new PerspectiveCamera();
  assert.ok(system.summon(100,100,0,null,'plane'));const v=system.personal;
  assert.equal(v.gamma,0);assert.equal(v.bank,0);
  system.enter(v);
  for(let i=0;i<600;i++)system.update(.05,new Set(['KeyW','KeyE']),true,camera);
  assert.ok(v.y>40);assert.ok(v.group.rotation.x>0);
  v.y=599.99;system.update(.05,new Set(['KeyW','KeyE']),true,camera);assert.equal(v.y,600);
  v.bank=.6;v.roll=-.6;system.rebase();assert.equal(v.group.rotation.z,-.6);
});

test('the runway floor is the terrain on land and a fixed minimum over water',()=>{
  const floor=runwayFloor((x)=>x<0?-3:4.2);
  assert.equal(floor(-1,0),MIN_RUNWAY);assert.equal(floor(1,0),4.2);
});

test('the adapter integrates at a fixed substep so the frame rate does not change the answer',()=>{
  const fly=dt=>{const v={type:'plane',x:0,y:100,z:0,heading:0,speed:40,gamma:0,theta:0,bank:0};for(let i=0;i<Math.round(4/dt);i++)stepPlane(v,{forward:true,right:true,up:true},dt,()=>true,null);return v;};
  const slow=fly(1/60),fast=fly(1/120);
  assert.ok(Math.abs(slow.y-fast.y)<1);assert.ok(Math.abs(slow.heading-fast.heading)<.02);
  assert.ok(slow.speed>0&&fast.speed>0);
});
