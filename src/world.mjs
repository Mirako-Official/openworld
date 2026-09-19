import {cityHeight as heightAt} from '../shared/city-plan.mjs';
import {loadModelAsset,modelBytes,setModelLoadedHook} from './model-cache.mjs';
import {createModelLodManager,releaseModelLods} from './model-lod.mjs';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createBuildingMotion} from './building-motion.mjs';
import {createClimbing} from './climbing.mjs';
import {loadAvatar} from './native-avatar.mjs';
import {createAtmosphere} from './atmosphere.mjs';
import {CharacterShadowAdapter} from './lighting/shadow/CharacterShadowAdapter.js';
import {createCyberpunk} from './cyberpunk.mjs';
import {createTerrain} from './terrain-view.mjs';
import {createGroundNavigation} from './navigation-ground.mjs';
import {SHOW_DEMO_CONTENT} from './demo-content.mjs';
import {PLOT,plotTerrain,MAX_COORDINATE,validCoordinate} from '../shared/terrain.mjs';
import {plotPolygon} from '../shared/polygon-land.mjs';
import {createBuildingCollision} from './building-collision.mjs';
import {collectInteractions,findInteraction,seatPosition} from './interactions.mjs';
import {createMouseLook} from './mouse-look.mjs';
import {createVehicles,VEHICLES} from './vehicles.mjs';
import {createAvatar,chasePosition} from './avatar.mjs';
import {walkFacing} from './walk-facing.mjs';
let avatarYaw=0,walkMoved=false;
import {createCockpit} from './cockpit.mjs';
import {carSeatPose,carSeats} from '../shared/car-seats.mjs';
import {createMultiplayer} from './multiplayer.mjs';
import {prepareCarModel,releaseCar} from './custom-car.mjs';
import {capturePlayerAnchor,localPlayerAnchor} from './overview-player.mjs';
import {createWorldAudio} from './world-audio.mjs';

export function dispose(object){releaseModelLods(object);const geometries=new Set(),materials=new Set(),textures=new Set();object.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}
export function createWorld({onSelect,onRegion,onError,onLandPoint,onLandMove}){
  const canvas=document.querySelector('#world'),renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.localClippingEnabled=true;renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,1,.1,1200);camera.position.set(155,125,195);camera.rotation.order='YXZ';
  const cyberpunk=createCyberpunk(renderer,scene,camera);
  const controls=new OrbitControls(camera,canvas);controls.target.set(0,0,0);controls.enableDamping=true;controls.minDistance=20;controls.maxDistance=310;controls.maxPolarAngle=Math.PI/2-.08;
  const sky=new THREE.HemisphereLight('#e9f1e4','#91a777',2),sun=new THREE.DirectionalLight('#fff0da',3);sun.position.set(-30,60,40);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-150,right:150,top:150,bottom:-150,near:.1,far:220});sun.shadow.normalBias=.15;scene.add(sky,sun);
  const characterShadow=new URLSearchParams(location.search).get('characterShadow')==='0'?null:new CharacterShadowAdapter({renderer,scene,sun,getGroundHeight:root=>root?floorAt(root.position.x,root.position.z):undefined});
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(1500,1500),new THREE.MeshStandardMaterial({color:'#afc797',roughness:1}));ground.rotation.x=-Math.PI/2;scene.add(ground);
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const atmosphere=createAtmosphere({scene,sun,sky,ground,renderer,reducedMotion,invalidate(){}}),audio=createWorldAudio();atmosphere.setWorldOrigin(0,0);ground.position.y=-.15;
  const overviewFog=new THREE.Fog('#d6eef4',260,470);ground.visible=false;const terrain=createTerrain(scene,()=>{renderer.shadowMap.needsUpdate=true;characterShadow?.markWorldDirty();}),models=new THREE.Group();scene.add(models);let origin={x:0,z:0},rows=[],planning=null,selected=null,town=null,walking=false,yaw=0,pitch=-.1,velocity=0,lastTime=0,lastRefresh=0,pointerStart=null,paused=false;
  const groundNavigation=createGroundNavigation(scene,()=>origin);
  const loaded=new Map(),pending=new Set(),loader=new GLTFLoader(),keys=new Set(),box=new THREE.Box3(),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let desired=new Map(),lastTelemetry=0,ready=false,focusElevation=true;
  const outline=new THREE.LineLoop(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#406b48'}));outline.visible=false;scene.add(outline);
  let landDrawing=false,draftPoints=[],draftColor='#d95b56',draftElevation,vertexDrag=null;
  const draftGroup=new THREE.Group();scene.add(draftGroup);
  let landView=null;
  function syncLandView(){
    if(landDrawing&&!landView){
      landView={offset:camera.position.clone().sub(controls.target),minPolar:controls.minPolarAngle,maxPolar:controls.maxPolarAngle,minAzimuth:controls.minAzimuthAngle,maxAzimuth:controls.maxAzimuthAngle,screenSpacePanning:controls.screenSpacePanning};
      controls.minPolarAngle=controls.maxPolarAngle=0;controls.minAzimuthAngle=controls.maxAzimuthAngle=0;controls.screenSpacePanning=true;
      camera.position.copy(controls.target).add(new THREE.Vector3(0,landView.offset.length(),0));
      const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;
    }else if(!landDrawing&&landView){
      endVertexDrag();controls.minPolarAngle=landView.minPolar;controls.maxPolarAngle=landView.maxPolar;controls.minAzimuthAngle=landView.minAzimuth;controls.maxAzimuthAngle=landView.maxAzimuth;controls.screenSpacePanning=landView.screenSpacePanning;
      if(!walking){camera.position.copy(controls.target).add(landView.offset);controls.update();}landView=null;
    }
  }
  function updateDraft(){for(const child of [...draftGroup.children]){draftGroup.remove(child);dispose(child);}if(!draftPoints.length)return;const y=draftElevation??Math.max(...draftPoints.map(([x,z])=>terrain.ground(x,z)))+.15;
    const points=draftPoints.map(([x,z])=>new THREE.Vector3(x-origin.x*70,y+.12,z-origin.z*70));
    draftGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:draftColor,depthTest:false})));
    if(points.length>=3){const shape=new THREE.Shape(draftPoints.map(([x,z])=>new THREE.Vector2(x-origin.x*70,origin.z*70-z))),g=new THREE.ShapeGeometry(shape);g.rotateX(-Math.PI/2);const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:draftColor,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide}));mesh.position.y=y+.06;draftGroup.add(mesh);}
    for(const p of points){const marker=new THREE.Mesh(new THREE.SphereGeometry(1.2,8,6),new THREE.MeshBasicMaterial({color:draftColor,depthTest:false}));marker.position.copy(p);draftGroup.add(marker);}
  }
  function updateOutline(){const lot=selected&&terrain.lotInfo(selected.x,selected.z);outline.visible=!!lot;if(lot){outline.geometry.dispose();outline.geometry=new THREE.BufferGeometry().setFromPoints(plotPolygon(lot).map(([x,z])=>new THREE.Vector3(x-origin.x*70,lot.elevation+.15,z-origin.z*70)));}updateDraft();}

  function renderGrid(){
    terrain.rebuild(origin.x,origin.z,rows,planning);
    updateOutline();sun.shadow.needsUpdate=true;renderer.shadowMap.needsUpdate=true;
  }
  function place(object,row,metrics){object.position.set((row.cx-origin.x*PLOT.cell)-(metrics.min[0]+metrics.max[0])/2,row.elevation-metrics.min[1],(row.cz-origin.z*PLOT.cell)-(metrics.min[2]+metrics.max[2])/2);object.updateMatrixWorld(true);}
  function moveOrigin(x,z,reset,notify=true){
    x=Math.max(-MAX_COORDINATE,Math.min(MAX_COORDINATE,x));z=Math.max(-MAX_COORDINATE,Math.min(MAX_COORDINATE,z));
    const dx=(x-origin.x)*PLOT.cell,dz=(z-origin.z)*PLOT.cell;origin={x,z};
    atmosphere.setWorldOrigin(x*PLOT.cell,z*PLOT.cell);
    camera.position.x-=dx;camera.position.z-=dz;controls.target.x-=dx;controls.target.z-=dz;
    vehicles.rebase();groundNavigation.rebase();
    if(reset){focusElevation=true;const h=heightAt(x*PLOT.cell,z*PLOT.cell);camera.position.set(130,h+150,170);controls.target.set(0,h,0);controls.update();}
    for(const {object,row,metrics} of loaded.values())place(object,row,metrics);
    if(town)town.position.set(-x*PLOT.cell,town.position.y,-z*PLOT.cell);
    renderGrid();if(notify)onRegion({...origin});
  }
  const modelLods=createModelLodManager({load:(url,options)=>loadModelAsset(loader,url,{...options,track:false})});setModelLoadedHook((gltf,url)=>modelLods.register(gltf,url));
  function refreshBuildings(){
    desired=new Map(rows.filter(r=>r.published).sort((a,b)=>Math.hypot(a.x-origin.x,a.z-origin.z)-Math.hypot(b.x-origin.x,b.z-origin.z)).slice(0,16).map(r=>[r.published,r]));
    for(const [id,value] of loaded)if(!desired.has(id)){models.remove(value.object);dispose(value.object);loaded.delete(id);}
    for(const [id,row] of desired){
      if(loaded.has(id)||pending.has(id))continue;pending.add(id);
      modelBytes('/assets/'+id+'.glb').then(async bytes=>{const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');return {gltf:await loader.parseAsync(bytes,''),hash};}).then(({gltf,hash})=>{
        if(!desired.has(id)){dispose(gltf.scene);return;}
        modelLods.register(gltf,'/assets/'+id+'.glb');const object=gltf.scene,metrics=JSON.parse(row.metrics);object.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});place(object,row,metrics);models.add(object);loaded.set(id,{object,row,metrics,motion:createBuildingMotion(object),collision:createBuildingCollision(object),interactions:collectInteractions(object,hash)});characterShadow?.markWorldDirty();renderer.shadowMap.needsUpdate=true;
      }).catch(()=>onError('一栋建筑加载失败，将在下次刷新时重试')).finally(()=>pending.delete(id));
    }
  }
  if(SHOW_DEMO_CONTENT)loader.loadAsync('/demo-town.glb').then(gltf=>{town=gltf.scene;town.scale.setScalar(1.35);town.updateMatrixWorld(true);box.setFromObject(town);const y=4.15-box.min.y;town.position.set(-origin.x*PLOT.cell,y,-origin.z*PLOT.cell);town.traverse(o=>{if(o.isLight)o.visible=false;if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(town);atmosphere.registerTown(town);terrain.registerTown(town);}).catch(()=>onError('公共示范小镇未能载入，地块功能仍可使用'));
  function floorAt(x,z){let h=terrain.surface(origin.x*PLOT.cell+x,origin.z*PLOT.cell+z);const limit=walking?camera.position.y-1.7+.8:h+.8;for(const {collision} of loaded.values())h=Math.max(h,collision.surface(x,z,limit));return h;}
  function blocked(x,z,y){const h=floorAt(x,z);if(terrain.blocked(origin.x*70+x,origin.z*70+z,y-1.7)||h>y-1.7+.8||vehicles.blocks(origin.x*70+x,origin.z*70+z,.35,y-1.7))return true;for(const {collision} of loaded.values())if(collision.blocked(x,z,y-1.7))return true;return false;}
  const climbing=createClimbing({probe(position,direction,reach){let best=null;for(const {collision} of loaded.values()){const hit=collision.wall(position,direction,reach);if(hit&&(!best||hit.distance<best.distance))best=hit;}return best;},blocked:p=>blocked(p.x,p.z,p.y),surface(x,z,limit){let height=terrain.surface(origin.x*70+x,origin.z*70+z);for(const {collision} of loaded.values())height=Math.max(height,collision.surface(x,z,limit));return height;}});
  const climbHud=document.createElement('div');climbHud.style.cssText='position:fixed;left:50%;bottom:90px;transform:translateX(-50%);padding:10px 16px;background:#172a30dd;color:white;border-radius:12px;text-align:center';climbHud.innerHTML='<div id="climb-help"></div>';document.querySelector('#walk-hud').append(climbHud);climbHud.hidden=true;
  const vehicles=createVehicles(scene,{origin:()=>origin,traffic:()=>multiplayer.trafficVehicles,ground:(x,z)=>terrain.ground(x,z),surface:(x,z)=>{let h=terrain.surface(x,z);const limit=h+.45;for(const v of loaded.values())h=Math.max(h,v.collision.surface(x-origin.x*70,z-origin.z*70,limit));return h;},obstacle:(x,z,h,r)=>terrain.blocked(x,z,h,r)||[...loaded.values()].some(v=>v.collision.blocked(x-origin.x*70,z-origin.z*70,h,r)),
      // `surface` above clamps buildings to a 0.45 m step so pedestrians cannot
      // walk onto a roof; an aircraft descending onto one should land on it, so
      // it gets the unclamped surface instead.
      roofAt:(x,z)=>{let h=terrain.surface(x,z);for(const v of loaded.values())h=Math.max(h,v.collision.surface(x-origin.x*70,z-origin.z*70));return h;}});
  function look(dx,dy){if(vehicles.active){vehicles.look(dx,dy,!thirdPerson&&vehicles.active.type!=='bike');return;}yaw-=dx*.0025;pitch=THREE.MathUtils.clamp(pitch-dy*.0025,-1.4,1.4);camera.rotation.set(pitch,yaw,0);}
  const mouseLook=createMouseLook(look);
  const avatar=createAvatar(scene),cockpit=createCockpit(),viewCamera=camera.clone(),viewRay=new THREE.Raycaster();let thirdPerson=false;
  characterShadow?.attachCharacter(avatar.root);characterShadow?.attachScene(scene);
  let savedSpawn=null,playerAnchor=null;
  const multiplayer=createMultiplayer(scene,{origin:()=>origin,localVehicle:()=>vehicles.personal,onError,onDisconnect:recallPersonal,onRideStart(ride){boardingPosition={x:origin.x*70+camera.position.x,y:camera.position.y,z:origin.z*70+camera.position.z};recallPersonal();keys.clear();velocity=0;yaw=ride.pose.yaw;pitch=-.08;camera.rotation.set(pitch,yaw,0);lastRideYaw=yaw;},onRideEnd:leavePassenger,onRestore(position){if(walking){savedSpawn=position;setWalk(true,{lockPointer:false});}else{playerAnchor={x:position.x,y:position.y,z:position.z,yaw:position.yaw,avatarYaw:position.yaw};savedSpawn=null;}}});
  let vehicleType='car',carRequest=0,carLoading=false,carModelId=null,lastCarSync=0;
  let lastRideYaw=0,boardingPosition=null;
  function passengerExit(position){
    for(const radius of [1.8,2.5,4,6])for(let i=0;i<8;i++){const angle=position.yaw+i*Math.PI/4,x=position.x+Math.cos(angle)*radius-origin.x*70,z=position.z+Math.sin(angle)*radius-origin.z*70,y=floorAt(x,z)+1.7;if(Math.abs(y-1.7-position.y)<(position.ridingType==='boat'?6:3)&&!blocked(x,z,y))return {x,y,z};}return null;
  }
  function leavePassenger(position){const exit=passengerExit(position);if(exit)camera.position.set(exit.x,exit.y,exit.z);else if(boardingPosition)camera.position.set(boardingPosition.x-origin.x*70,boardingPosition.y,boardingPosition.z-origin.z*70);else camera.position.set(position.x-origin.x*70,floorAt(position.x-origin.x*70,position.z-origin.z*70)+1.7,position.z-origin.z*70);boardingPosition=null;keys.clear();velocity=0;mouseLook.reset();}
  function recallPersonal(){carRequest++;carLoading=false;const v=vehicles.personal;if(!v)return;const driving=vehicles.active===v,safe=driving?vehicles.exit():null,position=safe||(v.type==='car'?{x:v.x,y:v.y+1.7,z:v.z}:v.returnPosition);vehicles.recall();if(driving){camera.position.set(position.x-origin.x*70,position.y,position.z-origin.z*70);yaw=v.heading;pitch=-.08;camera.rotation.set(pitch,yaw,0);velocity=0;keys.clear();mouseLook.reset();}canvas.dataset.personalCar='false';}
  async function personalModel(){const response=await fetch('/api/vehicle?category='+vehicleType);if(!response.ok)throw new Error('无法读取载具模型');const row=await response.json();return {id:row.id,model:row.url?prepareCarModel((await loadModelAsset(loader,row.url,{priority:1})).scene,row.category):null};}
  async function togglePersonal(){
    if(vehicles.personal){if(vehicles.active===vehicles.personal&&!vehicles.canExit()){onError('请先停稳并降落或靠岸，再收回载具');return;}recallPersonal();onError('个人载具已收回');return;}
    if(multiplayer.ride)return onError('请先下车');if(carLoading)return;if(canvas.dataset.multiplayer!=='online'){onError('连接服务器后才能召唤载具');return;}
    if(vehicles.active){onError('请先下车再召唤个人载具');return;}
    carLoading=true;const request=++carRequest;
    try{const {id,model}=await personalModel();if(request!==carRequest||!walking){if(model)releaseCar(model.group);return;}const ok=vehicles.summon(origin.x*70+camera.position.x,origin.z*70+camera.position.z,yaw,model,vehicleType);if(!ok){if(model)releaseCar(model.group);onError(vehicleType==='boat'?'请靠近岸边，附近需要足够宽且深的水面':'附近没有足够的安全空间，请移到平坦空地');return;}carModelId=id;canvas.dataset.personalCar='true';onError(VEHICLES[vehicleType].name+'已召唤 · F 驾驶 · P 收回');}
    catch(error){onError(error.message||'载具加载失败');}finally{if(request===carRequest)carLoading=false;}
  }
  document.addEventListener('keydown',e=>{if(e.code!=='KeyP'||e.repeat||!walking||mapOpen||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable||document.querySelector('dialog[open]'))return;e.preventDefault();void togglePersonal();});
  async function syncPersonalCar(){if(!vehicles.personal||carLoading)return;const request=carRequest;carLoading=true;try{const response=await fetch('/api/vehicle?category='+vehicleType);if(!response.ok)return;const row=await response.json();if(row.id===carModelId)return;const model=row.url?prepareCarModel((await loadModelAsset(loader,row.url,{priority:1})).scene,row.category):null;if(request!==carRequest){if(model)releaseCar(model.group);return;}if(model)vehicles.replacePersonal(model);else recallPersonal();carModelId=row.id;}catch{}finally{if(request===carRequest)carLoading=false;}}
  let avatarUrl=null,avatarLoading=false,lastAvatarSync=-15000;
  async function syncAvatar(){if(avatarLoading)return;avatarLoading=true;try{const response=await fetch('/api/avatar');if(!response.ok)return;const {url,development}=await response.json();if(url===avatarUrl)return;const gltf=url?await loadAvatar(loader,url,{priority:2}):null,model=gltf?.scene||null;if(model)model.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true;});const old=avatar.setModel(model,gltf?.animations||[],gltf?.runtime);if(old)dispose(old);characterShadow?.attachCharacter(avatar.root);avatarUrl=url;canvas.dataset.avatar=gltf?.name||'default';canvas.dataset.avatarStatus='loaded';if(development){thirdPerson=true;canvas.dataset.perspective='third';}renderer.shadowMap.needsUpdate=true;}catch{canvas.dataset.avatarStatus='error';}finally{avatarLoading=false;}}
  document.addEventListener('keydown',e=>{if(e.code!=='KeyO'||e.repeat||!walking||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable||document.querySelector('dialog[open]'))return;e.preventDefault();thirdPerson=!thirdPerson;mouseLook.reset();canvas.dataset.perspective=thirdPerson?'third':'first';});
  function playerState(){
    const ride=multiplayer.ride,v=vehicles.active;
    if(!walking&&playerAnchor){const p=localPlayerAnchor(origin,playerAnchor);return {position:new THREE.Vector3(p.x,p.y,p.z),poseYaw:p.avatarYaw};}
    const position=camera.position.clone();
    if(v){const offset=v.type==='bike'?.35:0;position.set(v.group.position.x+Math.sin(v.heading)*offset,v.y+(v.type==='bike'?.24:-.2),v.group.position.z+Math.cos(v.heading)*offset);}else position.y-=seated?1.85:1.7;
    if(v&&v.type!=='bike'){const p=carSeatPose({x:v.x,y:v.y,z:v.z,yaw:v.heading,pitch:v.pitch||0},(v.seats||carSeats())[0]);position.set(p.x-origin.x*70,p.y,p.z-origin.z*70);}
    if(ride)position.set(ride.pose.x-origin.x*70,ride.pose.y,ride.pose.z-origin.z*70);
    return {position,poseYaw:ride?ride.pose.yaw:v?v.heading:seated?yaw:avatarYaw};
  }
  function renderView(dt){
    const now=performance.now();if(now-lastAvatarSync>15000){lastAvatarSync=now;void syncAvatar();}
    if(now-lastCarSync>15000){lastCarSync=now;void syncPersonalCar();}
    if(vehicles.active)vehicles.active.autodriveStatus=vehicles.autopilot.status;
    cockpit.update(vehicles.active,walking&&!thirdPerson,keys,paused,dt,walking);
    const ride=multiplayer.ride,v=vehicles.active,{position,poseYaw}=playerState();
    multiplayer.update({x:origin.x*70+position.x,y:position.y,z:origin.z*70+position.z,yaw:poseYaw,active:walking||!!playerAnchor,climbing:walking&&climbing.active,moving:walking&&!paused&&!ride&&!seated&&!v&&walkMoved,running:walking&&(keys.has('ShiftLeft')||keys.has('ShiftRight')),seated:!!ride||!!seated||!!v,vehicleType:v?.type||null,crankPhase:v?.crankPhase||0,personalCar:vehicles.personal?{type:vehicles.personal.type,pitch:vehicles.personal.pitch||0,roll:vehicles.personal.roll||0,x:vehicles.personal.x,y:vehicles.personal.y,z:vehicles.personal.z,yaw:vehicles.personal.heading,phase:vehicles.personal.crankPhase,speed:vehicles.personal.speed,steer:vehicles.personal.steerAngle||0,driving:v===vehicles.personal}:null},dt);
    if(ride){const p=multiplayer.ride.pose;position.set(p.x-origin.x*70,p.y,p.z-origin.z*70);yaw+=Math.atan2(Math.sin(p.yaw-lastRideYaw),Math.cos(p.yaw-lastRideYaw));lastRideYaw=p.yaw;camera.position.copy(position).add(new THREE.Vector3(0,1.62,0));camera.rotation.set(pitch,yaw,0);}
    const planeAttitude=v?.type==='plane'?{pitch:v.pitch||0,roll:v.roll||0}:null;
    avatar.update({position,climbing:walking&&climbing.active,running:walking&&(keys.has('ShiftLeft')||keys.has('ShiftRight')),yaw:poseYaw,pitch:planeAttitude?.pitch||0,roll:planeAttitude?.roll||0,visible:walking?(thirdPerson||v?.type==='bike'):!!playerAnchor,firstPerson:walking&&!thirdPerson&&v?.type==='bike',moving:walking&&!paused&&!ride&&!seated&&!v&&walkMoved,seated:!!ride||!!seated||!!v,vehicleType:v?.type,crankPhase:v?.crankPhase||0,dt});
    avatar.setVehicleClip(v||(ride?multiplayer.vehicleForOwner(ride.owner):null));
    if(!walking)return camera;
    viewCamera.copy(camera);viewCamera.aspect=camera.aspect;viewCamera.updateProjectionMatrix();
    if(v&&!thirdPerson){viewCamera.position.set(v.group.position.x+(v.type==='bike'?Math.sin(v.heading)*.1:0),v.y+(v.type==='bike'?1.8:1.25),v.group.position.z+(v.type==='bike'?Math.cos(v.heading)*.1:0));viewCamera.rotation.copy(camera.rotation);if(v.type!=='bike'){const look=vehicles.firstPersonLook;viewCamera.position.copy(position).add(new THREE.Vector3(0,1.62,0));viewCamera.rotation.set(look.pitch+(v.pitch||0),v.heading+look.yaw,0,'YXZ');}}
    else if(thirdPerson&&!v){const target=camera.position.clone(),desired=chasePosition(target,camera.getWorldDirection(new THREE.Vector3())),delta=desired.clone().sub(target);viewRay.set(target,delta.clone().normalize());viewRay.far=delta.length();const hit=viewRay.intersectObjects(models.children,true)[0];if(hit)desired.copy(target).addScaledVector(viewRay.ray.direction,Math.max(.1,hit.distance-.25));desired.y=Math.max(desired.y,terrain.surface(origin.x*70+desired.x,origin.z*70+desired.z)+.3);viewCamera.position.copy(desired);viewCamera.lookAt(target.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()),1).add(new THREE.Vector3(0,-.5,0)));}
    if(!thirdPerson&&(v?.type==='car'||ride)){viewCamera.near=.03;viewCamera.fov=70;viewCamera.updateProjectionMatrix();}
    return viewCamera;
  }
  window.addEventListener('blur',()=>mouseLook.reset());
  document.addEventListener('visibilitychange',()=>mouseLook.reset());
  const interactionHint=document.createElement('div');interactionHint.id='interaction-hint';interactionHint.hidden=true;interactionHint.style.cssText='position:fixed;left:50%;top:60%;transform:translateX(-50%);padding:12px 20px;border:1px solid #ffffff55;border-radius:8px;background:#18312ce6;color:white;pointer-events:none;font-size:15px';document.querySelector('#walk-hud').append(interactionHint);
  let seated=null,standPosition=null,lastInteraction=0,interactionTarget=null;
  const interactionRay=new THREE.Raycaster();
  function standUp(){if(!seated)return;if(walking&&standPosition)camera.position.set(standPosition.x-origin.x*70,standPosition.y,standPosition.z-origin.z*70);seated=null;standPosition=null;velocity=0;keys.clear();interactionTarget=null;}
  function updateInteraction(now){
    if(multiplayer.ride){interactionHint.textContent='F · 下车';interactionHint.hidden=!walking||paused;return;}
    if(vehicles.active){interactionHint.hidden=true;return;}
    if(seated&&(!walking||!seated.root.parent))standUp();
    if(seated){camera.position.copy(seatPosition(seated)).add(new THREE.Vector3(0,.95,0));interactionHint.textContent='F · 起身';interactionHint.hidden=!walking||paused;return;}
    if(!walking||paused){interactionHint.hidden=true;interactionTarget=null;return;}
    if(now-lastInteraction<100)return;lastInteraction=now;
    const direction=camera.getWorldDirection(new THREE.Vector3());
    interactionTarget=findInteraction([...loaded.values()].flatMap(v=>v.interactions).concat(vehicles.targets(),multiplayer.rideTargets()),camera.position,direction,(target,distance)=>{interactionRay.set(camera.position,target.clone().sub(camera.position).normalize());interactionRay.far=Math.max(0,distance-.65);return !interactionRay.intersectObjects(models.children,true).length;});
    interactionHint.hidden=!interactionTarget;interactionHint.textContent=interactionTarget?.rideOwner?'F · 乘坐':interactionTarget?.vehicle?`F · 驾驶${VEHICLES[interactionTarget.vehicle.type].name}`:'F · 坐下';
  }
  document.addEventListener('keydown',e=>{
    if(!walking||paused||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable||document.querySelector('dialog[open]'))return;
    if(climbing.active&&['Space','KeyX','KeyF'].includes(e.code)){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat&&e.code!=='KeyF')velocity=climbing.release(camera.position,e.code==='Space')??0;return;}
    if((seated||vehicles.active||multiplayer.ride)&&e.code==='Space'){if(vehicles.active)keys.add('Space');e.preventDefault();e.stopImmediatePropagation();return;}
    if(e.code==='KeyR'&&!e.repeat){e.preventDefault();vehicles.autopilot.toggle(vehicles.active);onError(vehicles.autopilot.status);return;}
    if(e.code!=='KeyF'||e.repeat)return;e.preventDefault();
    if(multiplayer.ride){if(!passengerExit(multiplayer.ride.pose)){onError('附近没有安全下车位置，请稍后再试');return;}multiplayer.exitRide();return;}
    if(vehicles.active){const exit=vehicles.exit();if(!exit){onError('周围没有安全下车位置，请把车移到空地');return;}camera.position.set(exit.x-origin.x*70,exit.y,exit.z-origin.z*70);yaw=exit.heading;pitch=-.08;camera.rotation.set(pitch,yaw,0);velocity=0;keys.clear();mouseLook.reset();interactionTarget=null;return;}
    if(seated){standUp();return;}lastInteraction=0;updateInteraction(performance.now());if(!interactionTarget)return;
    if(interactionTarget.rideOwner){multiplayer.enterRide(interactionTarget.rideOwner);return;}
    if(interactionTarget.vehicle){vehicles.enter(interactionTarget.vehicle);keys.clear();velocity=0;mouseLook.reset();return;}
    standPosition={x:origin.x*70+camera.position.x,y:camera.position.y,z:origin.z*70+camera.position.z};seated=interactionTarget;velocity=0;keys.clear();
    const forward=new THREE.Vector3(-Math.sin(seated.yaw),0,-Math.cos(seated.yaw)).transformDirection(seated.node.matrixWorld);yaw=Math.atan2(-forward.x,-forward.z);pitch=-.08;camera.rotation.set(pitch,yaw,0);updateInteraction(performance.now());
  },true);
  function lock(){mouseLook.reset();paused=false;try{const result=canvas.requestPointerLock?.();result?.catch(()=>mouseLook.reset());}catch{mouseLook.reset();}canvas.focus();}
  function dragHit(e,y){const rect=canvas.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-y),new THREE.Vector3());}
  function endVertexDrag(){if(!vertexDrag)return;const id=vertexDrag.id;vertexDrag=null;pointerStart=null;controls.enabled=!walking;canvas.style.cursor='';if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}
  canvas.addEventListener('pointerdown',e=>{
    if(!landDrawing||walking||e.button!==0||vertexDrag)return;
    const rect=canvas.getBoundingClientRect();let index=-1,best=16;
    draftGroup.updateMatrixWorld(true);
    draftGroup.children.filter(v=>v.geometry?.type==='SphereGeometry').forEach((marker,i)=>{const p=marker.position.clone().project(camera),d=Math.hypot(rect.left+(p.x+1)*rect.width/2-e.clientX,rect.top+(1-p.y)*rect.height/2-e.clientY);if(p.z>=-1&&p.z<=1&&d<best){best=d;index=i;}});
    if(index<0)return;
    const y=draftElevation??Math.max(...draftPoints.map(([x,z])=>terrain.ground(x,z)))+.15,hit=dragHit(e,y+.12);if(!hit)return;
    vertexDrag={id:e.pointerId,index,y:y+.12,offset:[draftPoints[index][0]-origin.x*70-hit.x,draftPoints[index][1]-origin.z*70-hit.z]};
    controls.enabled=false;keys.clear();pointerStart=null;canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';e.preventDefault();e.stopImmediatePropagation();
  },true);
  canvas.addEventListener('pointermove',e=>{
    if(!vertexDrag||e.pointerId!==vertexDrag.id)return;
    const hit=dragHit(e,vertexDrag.y);if(hit)onLandMove?.(vertexDrag.index,[Math.round((origin.x*70+hit.x+vertexDrag.offset[0])/2)*2,Math.round((origin.z*70+hit.z+vertexDrag.offset[1])/2)*2]);
    e.preventDefault();e.stopImmediatePropagation();
  },true);
  for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,e=>{if(!vertexDrag||e.pointerId!==vertexDrag.id)return;endVertexDrag();e.preventDefault();e.stopImmediatePropagation();},true);
  canvas.addEventListener('lostpointercapture',endVertexDrag);window.addEventListener('blur',endVertexDrag);
  canvas.addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY};if(walking&&paused)lock();});
  canvas.addEventListener('pointerup',e=>{if(walking){if(!paused&&e.button===0){pointer.set(0,0);raycaster.setFromCamera(pointer,camera);if(terrain.interact(raycaster))canvas.dataset.waterInteraction=String(Date.now());}return;}if(!pointerStart||Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>5)return;const rect=canvas.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);if(landDrawing){const hit=terrain.pick(raycaster);if(hit)onLandPoint?.([Math.round((origin.x*70+hit.x)/2)*2,Math.round((origin.z*70+hit.z)/2)*2]);return;}if(terrain.interact(raycaster)){canvas.dataset.waterInteraction=String(Date.now());return;}const hit=terrain.pick(raycaster);if(!hit)return;const lot=terrain.lotAt(origin.x*70+hit.x,origin.z*70+hit.z);if(!lot)return;selected={x:lot.x,z:lot.z};updateOutline();onSelect(selected);});
  document.addEventListener('mousemove',e=>{if(walking&&!paused&&document.pointerLockElement===canvas)mouseLook.locked(e.movementX,e.movementY);});
  canvas.addEventListener('pointermove',e=>{if(walking&&!paused&&!document.pointerLockElement)mouseLook.absolute(e.clientX,e.clientY);});
  canvas.addEventListener('pointerleave',()=>mouseLook.reset());
  document.addEventListener('pointerlockchange',()=>{mouseLook.reset();if(walking&&!document.pointerLockElement){paused=true;keys.clear();}});
  document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable||document.querySelector('dialog[open]'))return;if(!walking&&['Space','Escape'].includes(e.code))return;if(e.code==='Escape'){paused=true;keys.clear();document.exitPointerLock?.();}if(['KeyW','KeyA','KeyS','KeyD','KeyE','KeyQ','ShiftLeft','ShiftRight','Space'].includes(e.code)){e.preventDefault();if(walking&&e.code==='Space'&&!e.repeat&&camera.position.y<=floorAt(camera.position.x,camera.position.z)+1.71&&!paused)velocity=6;keys.add(e.code);}});
  document.addEventListener('focusin',()=>keys.clear());document.addEventListener('visibilitychange',()=>keys.clear());
  document.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();paused=true;});
  function mobileKey(code,down){if(!down){document.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));return true;}if(!walking||mapOpen||document.querySelector('dialog[open]'))return false;paused=false;canvas.focus({preventScroll:true});document.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,cancelable:true}));return true;}
  let teleporting=false;
  async function teleport(destination,data){
    if(teleporting)throw new Error('传送正在进行');
    if(!multiplayer.ready)throw new Error('请等待世界连接完成');
    if(![destination.x,destination.z].every(Number.isFinite)||Math.max(Math.abs(destination.x),Math.abs(destination.z))>MAX_COORDINATE*70)throw new Error('传送目的地无效');
    teleporting=true;const previous={origin:{...origin},rows,planning,position:camera.position.clone(),target:controls.target.clone()};
    try{
      rows=data.plots;planning=data.planning;moveOrigin(Math.round(destination.x/70),Math.round(destination.z/70),false,false);refreshBuildings();
      const required=rows.filter(r=>r.published&&desired.has(r.published)&&Math.hypot(r.cx-destination.x,r.cz-destination.z)<100).map(r=>r.published),deadline=performance.now()+12000;
      while(required.some(id=>!loaded.has(id))){if(performance.now()>deadline)throw new Error('目的地建筑加载超时，请稍后重试');await new Promise(r=>setTimeout(r,100));}
      let point=null;const radiusLimit=destination.code==='spawn'?1024:32;
      search:for(const radius of [0,2,4,8,16,32,64,128,256,512,1024].filter(r=>r<=radiusLimit))for(let i=0;i<(radius?32:1);i++){
        const x=destination.x+Math.cos(i*Math.PI/16)*radius-origin.x*70,z=destination.z+Math.sin(i*Math.PI/16)*radius-origin.z*70,y=terrain.surface(origin.x*70+x,origin.z*70+z)+1.7;
        camera.position.y=y;if(!blocked(x,z,y)){point={x,y,z};break search;}
      }
      if(!point)throw new Error('目的地附近没有安全落点，请联系领地主人');
      await multiplayer.leaveForTeleport();
      boardingPosition=null;standUp();recallPersonal();vehicles.stop();avatar.setVehicleClip(null);savedSpawn=null;enterWalk(true,{lockPointer:false});
      climbing.reset();camera.position.set(point.x,point.y,point.z);yaw=destination.yaw||0;avatarYaw=yaw;playerAnchor=null;pitch=-.08;camera.rotation.set(pitch,yaw,0);keys.clear();velocity=0;mouseLook.reset();focusElevation=false;
    }catch(error){rows=previous.rows;planning=previous.planning;moveOrigin(previous.origin.x,previous.origin.z,false,false);camera.position.copy(previous.position);controls.target.copy(previous.target);refreshBuildings();throw error;}
    finally{teleporting=false;}
  }
  function setWalk(value,options={}){
    if(multiplayer.ride){onError('请先下车再切换视角模式');return;}
    if(!value){if(walking){const state=playerState();playerAnchor=capturePlayerAnchor(origin,state.position,yaw,state.poseYaw);}enterWalk(false,options);return;}
    if(playerAnchor&&!savedSpawn){const p=playerAnchor;moveOrigin(Math.round(p.x/PLOT.cell),Math.round(p.z/PLOT.cell),false);enterWalk(true,options);const local=localPlayerAnchor(origin,p);camera.position.set(local.x,local.y+1.7,local.z);yaw=p.yaw;avatarYaw=p.avatarYaw;playerAnchor=null;pitch=-.08;camera.rotation.set(pitch,yaw,0);velocity=0;keys.clear();mouseLook.reset();return;}
    enterWalk(value,options);
    if(!value||!walking||!savedSpawn)return;
    const p=savedSpawn;savedSpawn=null;
    standUp();vehicles.stop();
    moveOrigin(Math.round(p.x/PLOT.cell),Math.round(p.z/PLOT.cell),false);
    let x=p.x-origin.x*PLOT.cell,z=p.z-origin.z*PLOT.cell;
    camera.position.set(x,terrain.surface(p.x,p.z)+1.7,z);
    if(blocked(x,z,camera.position.y)){
      let found=false;
      search:for(let radius=2;radius<=1024;radius*=2)for(let i=0;i<32;i++){
        const sx=x+Math.cos(i*Math.PI/16)*radius,sz=z+Math.sin(i*Math.PI/16)*radius,h=terrain.surface(origin.x*PLOT.cell+sx,origin.z*PLOT.cell+sz);
        if(!blocked(sx,sz,h+1.7)){x=sx;z=sz;found=true;break search;}
      }
      if(!found){onError('上次位置暂时无法站立，已返回默认出生点');moveOrigin(0,0,false);enterWalk(true,options);return;}
    }
    camera.position.set(x,floorAt(x,z)+1.7,z);yaw=p.yaw;avatarYaw=p.yaw;pitch=-.08;camera.rotation.set(pitch,yaw,0);velocity=0;keys.clear();mouseLook.reset();
  }
  function enterWalk(value,{lockPointer=true}={}){climbing.reset();if(value){thirdPerson=false;landDrawing=false;document.body.dataset.land='false';controls.enableRotate=true;}walking=value;controls.enabled=!value;keys.clear();velocity=0;atmosphere.setWalking(value);document.body.dataset.walk=String(value);document.querySelector('#walk-hud').hidden=!value;if(value){let z=origin.x===0&&origin.z===0?48:18,x=0;if(floorAt(x,z)<.5){let shore;search:for(let radius=16;radius<=1024;radius+=16)for(let i=0;i<16;i++){const sx=Math.cos(i*Math.PI/8)*radius,sz=z+Math.sin(i*Math.PI/8)*radius;if(floorAt(sx,sz)>=.5){shore={x:sx,z:sz};break search;}}if(!shore){setWalk(false);onError('这里是开阔海面，请先把地图移到岸边再开始散步');return;}x=shore.x;z=shore.z;}camera.position.set(x,floorAt(x,z)+1.7,z);yaw=0;pitch=-.08;camera.rotation.set(pitch,yaw,0);if(lockPointer)lock();else{paused=true;mouseLook.reset();}}else{document.exitPointerLock?.();const h=terrain.surface(origin.x*PLOT.cell,origin.z*PLOT.cell);camera.position.set(130,h+150,170);controls.target.set(0,h,0);controls.update();}}
  let mapOpen=false;
  function frame(now){requestAnimationFrame(frame);if(document.hidden||!ready||mapOpen||teleporting){lastTime=now;return;}syncLandView();const dt=Math.min((now-lastTime)/1000||.016,.05);lastTime=now;
    if(!walking&&vehicles.active)vehicles.stop();vehicles.update(dt,keys,walking&&!paused,camera);
    const grounded=camera.position.y<=floorAt(camera.position.x,camera.position.z)+1.72,climbState=climbing.update(dt,{position:camera.position,yaw,forward:Number(keys.has('KeyW'))-Number(keys.has('KeyS')),right:Number(keys.has('KeyD'))-Number(keys.has('KeyA')),enabled:walking&&!seated&&!vehicles.active&&!multiplayer.ride,paused,grounded});
    walkMoved=climbState.moving;if(climbState.handled){velocity=0;if(climbing.yaw!==null)avatarYaw=climbing.yaw;}climbHud.hidden=!walking||paused||!climbing.active;climbHud.querySelector('#climb-help').textContent='W/S 上下 · A/D 横移 · Space 蹬墙跳 · X 松手';
    if(walking){if(!paused&&!seated&&!vehicles.active&&!multiplayer.ride&&!climbState.handled){let forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),right=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));const norm=Math.hypot(forward,right)||1,speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')?10:5)*dt;forward/=norm;right/=norm;const dx=(right*Math.cos(yaw)-forward*Math.sin(yaw))*speed,dz=(-right*Math.sin(yaw)-forward*Math.cos(yaw))*speed;
      const beforeX=camera.position.x,beforeZ=camera.position.z;
      if(!blocked(camera.position.x+dx,camera.position.z,camera.position.y))camera.position.x+=dx;if(!blocked(camera.position.x,camera.position.z+dz,camera.position.y))camera.position.z+=dz;
      const movedX=camera.position.x-beforeX,movedZ=camera.position.z-beforeZ;walkMoved=Math.hypot(movedX,movedZ)>1e-6;avatarYaw=walkFacing(avatarYaw,movedX,movedZ,dt);
      const floor=floorAt(camera.position.x,camera.position.z)+1.7;velocity-=16*dt;camera.position.y=Math.max(floor,camera.position.y+velocity*dt);if(camera.position.y<=floor)velocity=0;
    }}else{
      if(!document.querySelector('dialog[open]')){const forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),right=Number(keys.has('KeyD'))-Number(keys.has('KeyA')),norm=Math.hypot(forward,right)||1;
        const fx=landDrawing?0:controls.target.x-camera.position.x,fz=landDrawing?-1:controls.target.z-camera.position.z,length=Math.hypot(fx,fz)||1,speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')?120:60)*dt/norm,dx=(fx/length*forward-fz/length*right)*speed,dz=(fz/length*forward+fx/length*right)*speed;
        camera.position.x+=dx;camera.position.z+=dz;controls.target.x+=dx;controls.target.z+=dz;
      }controls.update();
    }
    if(multiplayer.ride){const p=multiplayer.ride.pose;yaw+=Math.atan2(Math.sin(p.yaw-lastRideYaw),Math.cos(p.yaw-lastRideYaw));lastRideYaw=p.yaw;camera.rotation.set(pitch,yaw,0);camera.position.set(p.x-origin.x*70,p.y+1.62,p.z-origin.z*70);}
    const center=walking?camera.position:controls.target,dx=Math.round(center.x/PLOT.cell),dz=Math.round(center.z/PLOT.cell);if((dx||dz)&&now-lastRefresh>350){lastRefresh=now;moveOrigin(origin.x+dx,origin.z+dz,false);}
    if(town)town.visible=Math.abs(origin.x)<=5&&Math.abs(origin.z)<=5;
    if(walking&&now-lastTelemetry>100){lastTelemetry=now;canvas.dataset.walkPosition=JSON.stringify({x:origin.x*PLOT.cell+camera.position.x,y:camera.position.y,z:origin.z*PLOT.cell+camera.position.z,ground:floorAt(camera.position.x,camera.position.z),climbing:climbing.active,paused});canvas.dataset.characterShadow=characterShadow?JSON.stringify(characterShadow.stats()):'off';}
    if(!walking)canvas.dataset.mapPosition=JSON.stringify({x:origin.x*70+controls.target.x,z:origin.z*70+controls.target.z});
    for(const value of loaded.values())value.motion.update(Date.now()/1000);
    updateInteraction(now);const renderCamera=renderView(dt);atmosphere.update(dt,renderCamera,walking&&paused);audio.update(dt,{moving:walking&&!paused&&grounded&&!climbing.active&&!seated&&!vehicles.active&&!multiplayer.ride&&walkMoved,running:keys.has('ShiftLeft')||keys.has('ShiftRight'),rain:atmosphere.rain});if(!walking){atmosphere.applyOverviewFog(overviewFog);scene.fog=overviewFog;}terrain.update(dt,sun,reducedMotion||(walking&&paused),renderCamera);modelLods.update(renderCamera,now);characterShadow?.update();cyberpunk.render(renderCamera,dt);
  }
  function resize(){renderer.setSize(innerWidth,innerHeight,false);cyberpunk.resize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}window.addEventListener('resize',resize);resize();renderGrid();requestAnimationFrame(frame);
  return {mobileKey,get mobileFlightActive(){return vehicles.active?.type==='plane';},setNavigationRoute(points,drivingPoints=[]){groundNavigation.setRoute(vehicles.active?.type==='car'?drivingPoints:points);vehicles.autopilot.setRoute(drivingPoints);},setVehicleCategory(type){if(!['car','plane','boat'].includes(type))return false;if(vehicles.active||multiplayer.ride){onError('请先下车再切换载具类别');return false;}recallPersonal();vehicleType=type;return true;},teleport,get canTeleport(){return multiplayer.ready&&!teleporting;},recallVehicle:recallPersonal,setPlayerIdentity:value=>multiplayer.setIdentity(value),setMapOpen(value){mapOpen=value;keys.clear();mouseLook.reset();controls.enabled=!value&&!walking;if(value){paused=true;document.exitPointerLock?.();}},get mapPlayers(){return multiplayer.mapPlayers;},get mapPose(){if(!walking&&playerAnchor)return {x:playerAnchor.x,y:playerAnchor.y,z:playerAnchor.z,heading:-playerAnchor.yaw};const v=vehicles.active,p=camera.position;return {vehicleType:v?.type,y:v?v.y:p.y-1.7,x:v?v.x:origin.x*70+p.x,z:v?v.z:origin.z*70+p.z,heading:v?-v.heading:-yaw};},setLandDrawing(value){if(value&&walking)setWalk(false);landDrawing=value;document.body.dataset.land=String(value);controls.enableRotate=!value;},setLandDraft(points,color,elevation){draftPoints=points;draftColor=color;draftElevation=elevation;updateDraft();},focusPlot(plot){if(walking)setWalk(false);moveOrigin(Math.round(plot.cx/70),Math.round(plot.cz/70),true);selected={x:plot.x,z:plot.z};onSelect(selected);},findWater(){let best=null,distance=Infinity;const wx=origin.x*70,wz=origin.z*70;for(let x=-800;x<=800;x+=16)for(let z=-800;z<=800;z+=16){const d=x*x+z*z;if(d<distance&&terrain.ground(wx+x,wz+z)<-.2){best={x:Math.round((wx+x)/70),z:Math.round((wz+z)/70)};distance=d;}}return best;},setRows(values,plan){rows=values;planning=plan;renderGrid();if(focusElevation&&!walking){const h=terrain.surface(origin.x*70+controls.target.x,origin.z*70+controls.target.z);camera.position.y+=h-controls.target.y;controls.target.y=h;controls.update();focusElevation=false;}refreshBuildings();ready=true;},focus(x,z){if(walking)setWalk(false);selected={x,z};const lot=terrain.lotInfo(x,z);moveOrigin(lot?Math.round(lot.cx/70):x,lot?Math.round(lot.cz/70):z,true);onSelect(selected);},setWalk,get origin(){return {...origin};},get walking(){return walking;}};
}

export function createPreview(){
  const canvas=document.querySelector('#preview'),renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#e5ecdf');scene.add(new THREE.HemisphereLight('#fff8ed','#85977d',2.5));const light=new THREE.DirectionalLight('#fff0dc',3);light.position.set(10,25,20);scene.add(light);
  const camera=new THREE.PerspectiveCamera(42,1,.1,500),controls=new OrbitControls(camera,canvas);controls.enableDamping=true;const loader=new GLTFLoader();let object=null,motion=null,revision=0;
  function resize(){const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();}
  new ResizeObserver(resize).observe(canvas);function frame(){requestAnimationFrame(frame);if(!document.querySelector('#workspace').open||document.hidden)return;motion?.update(Date.now()/1000);controls.update();renderer.render(scene,camera);}frame();
  return {async load(url){const token=++revision;if(object){scene.remove(object);dispose(object);object=null;}const gltf=await loader.loadAsync(url);if(token!==revision){dispose(gltf.scene);return;}object=gltf.scene;motion=createBuildingMotion(object);const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());object.position.sub(center);scene.add(object);const span=Math.max(size.x,size.y,size.z,1);camera.position.set(span*1.4,span,span*1.6);controls.target.set(0,0,0);controls.update();resize();},clear(){revision++;motion=null;if(object){scene.remove(object);dispose(object);object=null;}}};
}
