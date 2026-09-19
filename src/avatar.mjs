import * as T from 'three';
import {createVehicleAvatarClip} from './vehicle-avatar-clip.mjs';
import {createRiggedAvatar} from './rigged-avatar.mjs';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

export function cyclingLeg(phase){
  const hip=new T.Vector3(0,.87,0),foot=new T.Vector3(0,.33+.17*Math.sin(phase),-.23+.17*Math.cos(phase)),delta=foot.clone().sub(hip),d=delta.length(),bend=Math.sqrt(Math.max(0,.42**2-d*d/4));
  const knee=hip.clone().add(foot).multiplyScalar(.5).add(new T.Vector3(0,-delta.z,delta.y).normalize().multiplyScalar(bend));return {hip,knee,foot};
}
export function cyclingArm(side){
  const shoulder=new T.Vector3(side*.31,.46,0).applyAxisAngle(new T.Vector3(1,0,0),-.55).add(new T.Vector3(0,.87,0)),hand=new T.Vector3(side*.3,.96,-.85),delta=hand.clone().sub(shoulder),direction=delta.clone().normalize();
  const bend=new T.Vector3(side,0,0);bend.addScaledVector(direction,-bend.dot(direction)).normalize();
  const elbow=shoulder.clone().add(hand).multiplyScalar(.5).addScaledVector(bend,Math.sqrt(Math.max(0,.4**2-delta.lengthSq()/4)));return {shoulder,elbow,hand};
}

export function createAvatar(scene){
  const root=new T.Group(),skin=new T.MeshStandardMaterial({color:'#d2ad94',roughness:.82}),shirt=new T.MeshStandardMaterial({color:'#71828c',roughness:.94}),pants=new T.MeshStandardMaterial({color:'#495262',roughness:.98}),shoe=new T.MeshStandardMaterial({color:'#343b45',roughness:.86}),hair=new T.MeshStandardMaterial({color:'#302923',roughness:.95}),trim=new T.MeshStandardMaterial({color:'#b6bab8',roughness:.8}),eyeWhite=new T.MeshStandardMaterial({color:'#d9d4c8',roughness:.8}),lip=new T.MeshStandardMaterial({color:'#986f60',roughness:.9});
  function mesh(parent,geometry,x,y,z,material){const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
  function box(parent,w,h,d,x,y,z,material){return mesh(parent,new RoundedBoxGeometry(w,h,d,2,Math.min(w,h,d)*.22),x,y,z,material);}
  function oval(parent,w,h,d,x,y,z,material){return mesh(parent,new T.SphereGeometry(1,16,12).scale(w/2,h/2,d/2),x,y,z,material);}
  function profile(points,depth=1){return new T.LatheGeometry(points.map(([r,y])=>new T.Vector2(r,y)),20).scale(1,1,depth);}
  function limb(parent,w,d,material){return mesh(parent,profile([[0,-.57],[.22,-.55],[.36,-.5],[.43,-.38],[.5,-.12],[.49,.18],[.43,.4],[.32,.51],[.15,.55],[0,.56]],d/w).scale(w,1,w),0,0,0,material);}
  const torso=new T.Group();torso.position.y=.87;root.add(torso);
  mesh(torso,profile([[0,.015],[.17,.015],[.19,.045],[.19,.14],[.205,.28],[.24,.39],[.245,.43],[.21,.475],[.115,.505],[.08,.515]],.64),0,0,0,shirt);
  box(torso,.355,.21,.265,0,-.015,0,pants);
  oval(torso,.13,.17,.135,0,.54,0,skin);oval(torso,.265,.335,.27,0,.725,-.008,skin);
  mesh(torso,new T.SphereGeometry(1,24,12,0,Math.PI*2,0,Math.PI*.48).scale(.14,.173,.146),0,.745,.006,hair);
  const fringe=oval(torso,.17,.055,.09,-.037,.833,-.103,hair);fringe.rotation.z=.2;
  for(const x of [-.13,.13])oval(torso,.025,.105,.1,x,.752,.035,hair);
  oval(torso,.035,.057,.044,0,.724,-.141,skin);
  oval(torso,.055,.009,.009,0,.665,-.126,lip);
  for(const x of [-.137,.137])oval(torso,.034,.064,.04,x,.726,.002,skin);
  for(const x of [-.053,.053]){oval(torso,.039,.016,.012,x,.752,-.131,eyeWhite);oval(torso,.014,.014,.009,x,.752,-.139,hair);const brow=box(torso,.041,.008,.008,x,.779,-.125,hair);brow.rotation.z=x<0?-.08:.08;}
  box(torso,.007,.35,.009,0,.24,-.134,trim);
  box(torso,.025,.028,.012,0,.42,-.15,trim);
  for(const x of [-.055,.055]){const collar=box(torso,.073,.042,.025,x,.501,-.066,shirt);collar.rotation.z=x<0?-.4:.4;}
  const legs=[],arms=[];
  for(const side of [-1,1]){const leg=new T.Group();leg.position.set(side*.115,0,0);root.add(leg);const upper=limb(leg,.22,.24,pants),lower=limb(leg,.16,.175,pants),foot=box(leg,.18,.125,.29,0,0,0,shoe);box(foot,.184,.023,.295,0,-.051,0,trim);for(const z of [-.045,-.015,.015])box(foot,.095,.008,.009,0,.06,z,trim);legs.push({upper,lower,foot});
    const upperArm=limb(root,.18,.195,shirt),forearm=limb(root,.125,.145,skin),hand=box(root,.09,.13,.085,0,0,0,skin);oval(hand,.035,.075,.038,-side*.045,.006,-.012,skin);hand.name=side<0?'hand-left':'hand-right';arms.push({upperArm,forearm,hand,side});
  }
  scene.add(root);root.visible=false;let phase=0,custom=null,rig=null;
  const bodyParts=[...root.children],vehicleClip=createVehicleAvatarClip(root);
  function setModel(model,clips=[],runtime=null){vehicleClip.clear();rig?.dispose();rig=null;const old=custom;if(old)root.remove(old);custom=model;if(model){const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3()),scale=1.8/size.y;const holder=new T.Group();holder.add(model);model.position.sub(new T.Vector3(center.x,bounds.min.y,center.z));holder.scale.setScalar(scale);custom=holder;root.add(holder);rig=runtime||createRiggedAvatar(model,clips);}return old;}
  function segment(mesh,a,b){mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.scale.y=a.distanceTo(b);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());}
  return {root,setModel,setVehicleClip:vehicleClip.update,update({position,yaw,visible,moving,seated,climbing=false,dt,running=false,vehicleType,firstPerson=false,crankPhase=0,pitch=0,roll=0}){root.visible=visible;root.position.copy(position);root.rotation.set(pitch,yaw,roll,'YXZ');for(const part of bodyParts)part.visible=!custom&&!firstPerson;for(const arm of arms)for(const part of [arm.upperArm,arm.forearm,arm.hand])part.visible=firstPerson||!custom;if(custom){rig?.update({moving,running,seated,climbing,vehicleType,crankPhase,dt});custom.visible=!firstPerson;if(!firstPerson)return;}torso.rotation.x=vehicleType==='bike'?-.55:0;if(moving)phase+=dt*9;for(let i=0;i<2;i++){
    const swing=moving?Math.sin(phase+i*Math.PI)*.5:0,hip=new T.Vector3(0,.87,0);let knee,foot;
    if(vehicleType==='bike')({knee,foot}=cyclingLeg(crankPhase+i*Math.PI));
    else if(climbing){knee=new T.Vector3(0,.57,-.28);foot=new T.Vector3(0,.17+Math.sin(phase+i*Math.PI)*.1,-.24);}
    else if(seated){knee=new T.Vector3(0,.83,-.4);foot=new T.Vector3(0,.43,-.4);}
    else{knee=new T.Vector3(0,-.4,0).applyAxisAngle(new T.Vector3(1,0,0),swing).add(hip);foot=new T.Vector3(0,-.79,0).applyAxisAngle(new T.Vector3(1,0,0),swing).add(hip);}
    segment(legs[i].upper,hip,knee);segment(legs[i].lower,knee,foot);legs[i].foot.position.copy(foot).add(new T.Vector3(0,0,-.07));
    const arm=arms[i];let shoulder,elbow,hand;
    if(vehicleType==='bike')({shoulder,elbow,hand}=cyclingArm(arm.side));
    else if(climbing){shoulder=new T.Vector3(arm.side*.245,1.3,0);elbow=new T.Vector3(arm.side*.3,1.48,-.18);hand=new T.Vector3(arm.side*.25,1.72+Math.sin(phase+i*Math.PI)*.1,-.33);}
    else{shoulder=new T.Vector3(arm.side*.245,1.30,0);const axis=new T.Vector3(1,0,0),angle=seated?.7:-swing;elbow=new T.Vector3(arm.side*.032,-.29,-.015).applyAxisAngle(axis,angle).add(shoulder);hand=new T.Vector3(arm.side*.035,-.56,-.035).applyAxisAngle(axis,angle).add(shoulder);}
    segment(arm.upperArm,shoulder,elbow);segment(arm.forearm,elbow,hand);arm.hand.position.copy(hand);
  }}};
}

export function chasePosition(eye,direction,distance=4){return eye.clone().addScaledVector(direction,-distance).add(new T.Vector3(0,.8,0));}
