import * as T from 'three';
import {animateVehicleModel,releaseCar} from './custom-car.mjs';
import {VEHICLE_TYPES,vehicleCategory} from '../shared/vehicle-types.mjs';
import {carSeats} from '../shared/car-seats.mjs';
import {createDefaultCar} from './default-car.mjs';
import {runwayFloor,stepPlane} from './flight/FlightAdapter.mjs';

export const VEHICLES={bike:{name:'单车',max:9,accel:3,reverse:2,radius:.4,length:1.8},...VEHICLE_TYPES};
const approach=(a,b,rate,dt)=>a+(b-a)*(1-Math.exp(-rate*dt));
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
function carStep(v,input,dt,canMove){
  const c=VEHICLES.car,count=Math.max(1,Math.ceil(dt*120)),step=dt/count;
  v.steer??=0;v.yawRate??=0;v.travelHeading??=v.heading;v.reverseWait??=0;v.drift??=0;
  for(let i=0;i<count;i++){
    const throttle=Number(!!input.forward)-Number(!!input.back),opposing=throttle&&v.speed*throttle<0;
    if(input.brake||input.handbrake||opposing){const decel=input.brake?16:opposing?12:3.5;v.speed=Math.sign(v.speed)*Math.max(0,Math.abs(v.speed)-decel*step);v.reverseWait=opposing?.2:0;}
    else if(throttle){if(v.reverseWait>0)v.reverseWait=Math.max(0,v.reverseWait-step);else{const acceleration=throttle>0?c.accel*(1-.4*Math.max(0,v.speed)/c.max):4;v.speed=T.MathUtils.clamp(v.speed+throttle*acceleration*step,-c.reverse,c.max);}}
    else{v.speed=Math.sign(v.speed)*Math.max(0,Math.abs(v.speed)-(.35+.0018*v.speed*v.speed)*step);v.reverseWait=0;}
    const steer=Number(!!input.left)-Number(!!input.right),speed=Math.abs(v.speed);
    v.steer=approach(v.steer,steer,steer?(steer*v.steer<0?12:8):11,step);
    v.steerAngle=v.steer*(.62/(1+speed*.045+speed*speed*.0015));
    v.drift=approach(v.drift,input.handbrake&&speed>4?1:0,input.handbrake?5:3.5,step);
    const maxYaw=Math.min(1.15,(9.5+v.drift*5)/Math.max(4,speed)),target=T.MathUtils.clamp(v.speed/2.6*Math.tan(v.steerAngle)*(1+v.drift*.6),-maxYaw,maxYaw);
    v.yawRate=approach(v.yawRate,target,8,step);
    const heading=v.heading+v.yawRate*step,grip=12-10.3*v.drift;
    const travel=v.travelHeading+angleDelta(v.travelHeading,heading)*(1-Math.exp(-grip*step));
    const x=v.x-Math.sin(travel)*v.speed*step,z=v.z-Math.cos(travel)*v.speed*step;
    if(!canMove(x,z,heading)){v.speed=0;v.yawRate=0;v.drift=0;v.travelHeading=v.heading;break;}
    v.x=x;v.z=z;v.heading=heading;v.travelHeading=travel;
  }
}
export function driveStep(v,input,dt,canMove,floorAt){
  if(v.type==='plane'){stepPlane(v,input,dt,canMove,floorAt);return;}
  if(v.type==='boat'){
    dt=Math.max(0,Math.min(dt,.05));const c=VEHICLES[v.type],steps=Math.max(1,Math.ceil(dt*120));
    for(let i=0;i<steps;i++){
      const step=dt/steps,throttle=Number(!!input.forward)-Number(!!input.back),drag=input.brake?10:.8;
      v.speed=throttle&&!input.brake?T.MathUtils.clamp(v.speed+throttle*c.accel*step,-c.reverse,c.max):Math.sign(v.speed)*Math.max(0,Math.abs(v.speed)-drag*step);
      const steer=Number(!!input.left)-Number(!!input.right);v.steerAngle=approach(v.steerAngle||0,steer*.3,4,step);
      const heading=v.heading+v.steerAngle*Math.min(1.5,Math.abs(v.speed)*.15)*Math.sign(v.speed)*step;
      const x=v.x-Math.sin(heading)*v.speed*step,z=v.z-Math.cos(heading)*v.speed*step;
      if(!canMove(x,z,heading,v.y)){v.speed=0;break;}
      v.x=x;v.z=z;v.heading=heading;v.pitch=0;
    }return;
  }
  if(v.type==='car'){carStep(v,input,Math.max(0,Math.min(dt,.05)),canMove);return;}
  dt=Math.max(0,Math.min(dt,.05));const c=VEHICLES[v.type],throttle=Number(!!input.forward)-Number(!!input.back),brake=input.brake?14:throttle===0?1.8:0;
  v.speed=brake?Math.sign(v.speed)*Math.max(0,Math.abs(v.speed)-brake*dt):Math.max(-c.reverse,Math.min(c.max,v.speed+throttle*c.accel*dt));
  const steer=Number(!!input.left)-Number(!!input.right),turn=steer*Math.min(1.3,Math.abs(v.speed)*.22)*Math.sign(v.speed)*dt;
  v.steerAngle=steer*.35;
  const steps=Math.max(1,Math.ceil(Math.abs(v.speed)*dt/.15));
  for(let i=0;i<steps;i++){const heading=v.heading+turn/steps,x=v.x-Math.sin(heading)*v.speed*dt/steps,z=v.z-Math.cos(heading)*v.speed*dt/steps;
    if(!canMove(x,z,heading)){v.speed=0;break;}v.x=x;v.z=z;v.heading=heading;
  }
}
export function createVehicleModel(type){
  if(type==='car')return createDefaultCar();
  const group=new T.Group(),wheels=[],materials={paint:new T.MeshStandardMaterial({color:type==='car'?'#bf6548':'#4b938a',roughness:.45,metalness:.25}),rubber:new T.MeshStandardMaterial({color:'#242a2b',roughness:1}),metal:new T.MeshStandardMaterial({color:'#aebabc',metalness:.65,roughness:.3}),glass:new T.MeshStandardMaterial({color:'#28434d',roughness:.22}),lamp:new T.MeshStandardMaterial({color:'#fff0c8',emissive:'#ddbd70',emissiveIntensity:.5})};
  function mesh(g,m,x,y,z,rx=0,ry=0,rz=0){const o=new T.Mesh(g,materials[m]);o.position.set(x,y,z);o.rotation.set(rx,ry,rz);o.castShadow=o.receiveShadow=true;group.add(o);return o;}
  const box=(x,y,z,w,h,d,m)=>mesh(new T.BoxGeometry(w,h,d),m,x,y,z);
  function tube(a,b,r,m='paint'){const x=new T.Vector3(...a),y=new T.Vector3(...b),o=mesh(new T.CylinderGeometry(r,r,x.distanceTo(y),8),m,...x.clone().add(y).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),y.sub(x).normalize());}
  function assembleWheel(start,x,y,z,radius){const pivot=new T.Group(),spin=new T.Group();pivot.position.set(x,y,z);for(const part of group.children.slice(start)){part.position.sub(pivot.position);spin.add(part);}pivot.add(spin);group.add(pivot);wheels.push({pivot,spin,radius,front:z<0});}
  if(type==='plane'){
    const body=mesh(new T.SphereGeometry(1,20,12),'paint',0,1.05,0);body.scale.set(.65,.65,3.7);
    box(0,1.9,-.65,1.1,.8,1.8,'glass');box(0,2.38,-.65,1.2,.12,1.85,'paint');
    box(0,1.8,0,9.8,.15,1.5,'paint');box(0,1.45,2.8,3.5,.12,.85,'paint');box(0,2,2.8,.15,1.35,1,'paint');
    for(const x of [-.8,.8]){tube([x,1,0],[x,.28,.2],.055,'metal');const start=group.children.length;mesh(new T.CylinderGeometry(.27,.27,.18,16),'rubber',x,.27,.2,0,0,Math.PI/2);assembleWheel(start,x,.27,.2,.27);}
    box(0,1.1,-3.7,.12,1.9,.1,'metal').name='propeller';box(0,.65,0,1.3,.15,1.4,'rubber');
  }else if(type==='boat'){
    const hull=new T.Shape();hull.moveTo(-1.4,3.3);hull.lineTo(1.4,3.3);hull.lineTo(1.4,-1.6);hull.lineTo(.7,-3.1);hull.lineTo(0,-3.5);hull.lineTo(-.7,-3.1);hull.lineTo(-1.4,-1.6);hull.closePath();
    const geometry=new T.ExtrudeGeometry(hull,{depth:.65,bevelEnabled:false});geometry.rotateX(Math.PI/2);geometry.translate(0,.65,0);mesh(geometry,'paint',0,0,0);
    for(const x of [-1.3,1.3])box(x,.8,.55,.14,.4,4.6,'paint');
    box(0,1.2,-1.1,2.25,.65,.12,'glass');box(0,.65,.35,1.7,.16,1.1,'rubber');box(0,.9,3.2,.6,1,.5,'metal');
  }else{
    for(const z of [-.73,.73]){const start=group.children.length;mesh(new T.TorusGeometry(.34,.055,8,20),'rubber',0,.4,z,0,Math.PI/2);for(let i=0;i<8;i++){const a=i*Math.PI/4;tube([0,.4,z],[0,.4+Math.sin(a)*.31,z+Math.cos(a)*.31],.012,'metal');}assembleWheel(start,0,.4,z,.34);}
    const a=[0,.4,.73],b=[0,.4,-.73],c=[0,.5,.05],d=[0,.94,.32],e=[0,.98,-.48];
    for(const [u,v] of [[a,c],[a,d],[c,d],[d,e],[e,c],[e,b]])tube(u,v,.038);
    tube(d,[0,1.12,.35],.03,'metal');box(0,1.14,.35,.3,.1,.4,'rubber');tube(e,[0,1.2,-.5],.035,'metal');tube([-.35,1.2,-.5],[.35,1.2,-.5],.035,'rubber');box(0,.47,.05,.45,.06,.16,'metal');
  }
  const pedals=[];if(type==='bike')for(const side of [-1,1])pedals.push(box(side*.22,.5,.05,.2,.06,.16,'metal'));
  return {group,wheels,pedals,...(type!=='bike'?{seats:carSeats(undefined,type)}:{})};
}
export function createVehicles(scene,{surface,ground=surface,obstacle,origin,roofAt=surface}){
  const items=['bike','car'].map((type,i)=>{const model=createVehicleModel(type);scene.add(model.group);return {...model,type,x:i?4:-4,z:42,heading:0,speed:0,crankPhase:0,y:null};});
  let active=null,personal=null,orbit=0,pitch=.3,chaseHeading=0,lookIdle=0;const firstPersonLook={yaw:0,pitch:-.08};
  const planeFloor=runwayFloor(roofAt);
  function rebase(){const o=origin();for(const v of items){v.group.position.set(v.x-o.x*70,v.y??0,v.z-o.z*70);v.group.rotation.set(v.pitch||0,v.heading,v.roll||0,'YXZ');v.group.updateMatrixWorld(true);}}
  function clear(v,x,z,heading,base){
    const c=VEHICLES[v.type],boat=v.type==='boat',plane=v.type==='plane';
    for(const along of [-c.length/2+.2,0,c.length/2-.2])for(const side of plane||boat?[-c.radius,0,c.radius]:[0]){
      const px=x-Math.sin(heading)*along+Math.cos(heading)*side,pz=z-Math.cos(heading)*along-Math.sin(heading)*side,h=surface(px,pz);
      if(boat){if(ground(px,pz)>-.8||(h>=-.35&&h<3.3)||obstacle(px,pz,0,.35))return false;}
      else if(plane){if((h<.5&&base<.8)||h>base+.45||(obstacle(px,pz,base,1.5)||obstacle(px,pz,base+1.6,1.5)))return false;}
      else if(Math.abs(h-base)>.45||obstacle(px,pz,h,c.radius))return false;
      for(const other of items)if(other!==v&&Math.abs((other.y??surface(other.x,other.z))-base)<3.5&&Math.hypot(px-other.x,pz-other.z)<(plane||boat ? .35 : c.radius)+VEHICLES[other.type].radius)return false;
    }return true;
  }
  function exit(checkOnly=false){if(!active)return null;const v=active,c=VEHICLES[v.type];if((v.type==='boat'||v.type==='plane')&&Math.abs(v.speed)>1.5)return null;for(const distance of v.type==='boat'?[c.radius+1,4,6]:[c.radius+1])for(const side of [-1,1])for(const along of [0,-c.length/2-1,c.length/2+1]){const x=v.x+Math.cos(v.heading)*distance*side-Math.sin(v.heading)*along,z=v.z-Math.sin(v.heading)*distance*side-Math.cos(v.heading)*along,h=surface(x,z);if(Math.abs(h-v.y)<(v.type==='boat'?6:1)&&!obstacle(x,z,h,.35)){if(checkOnly)return true;active=null;v.coasting=v.type==='car'&&Math.abs(v.speed)>.01;if(!v.coasting)v.speed=0;return {x,y:h+1.7,z,heading:v.heading};}}return null;}
  return {
    get personal(){return personal;},
    replacePersonal(model){if(!personal){releaseCar(model.group);return;}releaseCar(personal.group);Object.assign(personal,model);scene.add(personal.group);rebase();},
    summon(x,z,heading,model,type='car'){
      vehicleCategory(type);
      if(personal)return false;const v={type,x,z,heading,speed:0,crankPhase:0,y:null,gamma:0,theta:0,bank:0,returnPosition:{x,y:surface(x,z)+1.7,z}};
      let found=false;search:for(const distance of type==='boat'?[3,4.5,6]:[type==='plane'?10:6])for(const angle of [0,-Math.PI/4,Math.PI/4,Math.PI/2,-Math.PI/2,Math.PI]){const px=x-Math.sin(heading+angle)*distance,pz=z-Math.cos(heading+angle)*distance,h=type==='boat'?-.35:surface(px,pz);if((type!=='plane'||h>=.5)&&clear(v,px,pz,heading,h)){v.x=px;v.z=pz;v.y=h;found=true;break search;}}
      if(!found)return false;Object.assign(v,model||createVehicleModel(type));personal=v;items.push(v);scene.add(v.group);rebase();return true;
    },
    recall(){if(!personal)return false;if(active===personal){active.speed=0;active=null;}const v=personal;personal=null;items.splice(items.indexOf(v),1);releaseCar(v.group);return true;},
    get active(){return active;},canExit:()=>!!exit(true),
    get firstPersonLook(){return {...firstPersonLook};},
    rebase,
    targets(){return items.map(v=>({root:v.group,node:v.group,position:[0,.8,0],range:v.type==='plane'?10:v.type==='boat'?8:3.2,yaw:v.heading,vehicle:v}));},
    enter(v){active=v;v.speed=v.coasting?v.speed:0;v.coasting=false;v.yawRate=0;v.drift=0;v.travelHeading=v.heading;v.steer=0;v.reverseWait=0;v.gamma=0;v.theta=0;v.bank=0;v.pitch=0;v.roll=0;v.crashed=false;orbit=0;pitch=.3;chaseHeading=v.heading;lookIdle=0;firstPersonLook.yaw=0;firstPersonLook.pitch=-.08;},exit,
    stop(){if(active)active.speed=0;active=null;},
    look(dx,dy,firstPerson=false){if(firstPerson){firstPersonLook.yaw=T.MathUtils.clamp(firstPersonLook.yaw-dx*.0025,-2.65,2.65);firstPersonLook.pitch=T.MathUtils.clamp(firstPersonLook.pitch-dy*.0025,-1.1,.9);return;}orbit-=dx*.0025;pitch=T.MathUtils.clamp(pitch+dy*.002,-.05,.9);lookIdle=1.5;},
    blocks(x,z,r=.35,y=surface(x,z)){return items.some(v=>{if(y+1.7<v.y||y>v.y+(VEHICLES[v.type].height||2))return false;const dx=x-v.x,dz=z-v.z,c=VEHICLES[v.type],side=dx*Math.cos(v.heading)-dz*Math.sin(v.heading),along=dx*Math.sin(v.heading)+dz*Math.cos(v.heading);return Math.abs(side)<c.radius+r&&Math.abs(along)<c.length/2+r;});},
    update(dt,keys,enabled,camera){
      for(const v of items){if(v.y===null)v.y=surface(v.x,v.z);if(v===active&&enabled){driveStep(v,{forward:keys.has('KeyW'),back:keys.has('KeyS'),left:keys.has('KeyA'),right:keys.has('KeyD'),brake:keys.has('Space'),up:keys.has('KeyE'),down:keys.has('KeyQ'),handbrake:keys.has('ShiftLeft')||keys.has('ShiftRight')},dt,(x,z,h,y)=>clear(v,x,z,h,v.type==='plane'?Math.max(y,surface(x,z)>=.5&&surface(x,z)<=v.y+.45?surface(x,z):.8):v.y),v.type==='plane'?planeFloor:null);if(v.type==='boat')v.y=-.35;else if(v.type==='plane'){v.y=Math.max(v.y,planeFloor(v.x,v.z));v.airborne=v.y>surface(v.x,v.z)+.5;}else v.y=surface(v.x,v.z);}else if(v.coasting&&enabled){
        const beforeX=v.x,beforeZ=v.z,sign=Math.sign(v.speed);driveStep(v,{},dt,(x,z,h)=>clear(v,x,z,h,v.y));v.y=surface(v.x,v.z);
        const travel=Math.hypot(v.x-beforeX,v.z-beforeZ)*sign;v.crankPhase+=travel*1.4;for(const wheel of v.wheels){wheel.spin.rotation.x-=travel/wheel.radius;wheel.pivot.rotation.y=wheel.front?v.steerAngle||0:0;}
        animateVehicleModel(v,v.crankPhase,v.speed,v.steerAngle);v.speed=Math.sign(v.speed)*Math.max(0,Math.abs(v.speed)-1.8*Math.min(.05,Math.max(0,dt)));if(Math.abs(v.speed)<.05){v.speed=0;v.yawRate=0;v.coasting=false;}
      }}rebase();
      if(active&&enabled){const follow=active.type==='car'?active.heading+angleDelta(active.heading,active.travelHeading??active.heading)*.35:active.heading;chaseHeading+=angleDelta(chaseHeading,follow)*(1-Math.exp(-5*dt));lookIdle=Math.max(0,lookIdle-dt);if(!lookIdle&&Math.abs(active.speed)>2)orbit+=angleDelta(orbit,0)*(1-Math.exp(-2*dt));}
      if(active){const v=active,o=origin(),angle=chaseHeading+orbit,d=v.type==='plane'?15:v.type==='boat'?9:v.type==='car'?6+Math.abs(v.speed)*.045:4.5,target=new T.Vector3(v.x-o.x*70,v.y+1,v.z-o.z*70);if(enabled){v.crankPhase+=v.speed*dt*1.4;const propeller=v.group.getObjectByName('propeller');if(propeller)propeller.rotation.z=v.crankPhase*8;v.pedals.forEach((p,i)=>{const a=v.crankPhase+i*Math.PI;p.position.y=.5+.17*Math.sin(a);p.position.z=.05+.17*Math.cos(a);});for(const wheel of v.wheels){wheel.spin.rotation.x-=v.speed*dt/wheel.radius;wheel.pivot.rotation.y=wheel.front?v.steerAngle||0:0;}animateVehicleModel(v,v.crankPhase,v.speed,v.steerAngle);}camera.position.set(target.x+Math.sin(angle)*d,target.y+1.4+Math.sin(pitch)*d,target.z+Math.cos(angle)*d);if(v.type==='car'){const ahead=T.MathUtils.clamp(v.speed*.1,-.5,2.5),travel=v.travelHeading??v.heading;target.x-=Math.sin(travel)*ahead;target.z-=Math.cos(travel)*ahead;}camera.lookAt(target);}
    }
  };
}
