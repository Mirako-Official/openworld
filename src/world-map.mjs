import {mapPoint,zoomMap} from './map-coordinates.mjs';
import {mapBounds,bridgeLabels,plotLabel,riverLabel} from './map-labels.mjs';
import {createWorldHydrology} from '../shared/coastal-hydrology.mjs';
import {plotPolygon} from '../shared/polygon-land.mjs';

export function createWorldMap(world){
  let riverNames=[];
  const mini=document.createElement('button');mini.id='minimap';mini.type='button';mini.setAttribute('aria-label','打开世界地图（M）');mini.innerHTML='<canvas aria-label="附近地图"></canvas><span class="map-north">N ↑</span><span class="mini-route" hidden></span><span class="map-caption">OPENWORLDCRAFT <kbd>M</kbd></span>';document.body.append(mini);
  const dialog=document.createElement('dialog');dialog.id='world-map';dialog.setAttribute('aria-label','世界地图');dialog.innerHTML='<div class="map-heading"><div class="map-brand"><span class="map-monogram">OWC</span><div><small>OPENWORLDCRAFT</small><h2>世界地图</h2></div></div><span class="map-mode">探索 / MAP</span><button data-close aria-label="关闭地图">返回游戏 <kbd>Esc</kbd></button></div><div class="map-stage"><canvas aria-label="世界地图，单击设置导航点，可拖动和缩放"></canvas><span class="map-north">N<br>↑</span><div class="map-tools"><button data-fit>全域</button><button data-center aria-label="定位当前位置">◎</button><span></span><button data-minus aria-label="缩小地图">−</button><button data-plus aria-label="放大地图">＋</button></div><aside class="map-directory" aria-label="地图地点"><div class="map-directory-heading"><small>DISCOVER</small><h3>地点与标记</h3><p>选择地点，在地图上定位</p></div><div class="map-filters"><button data-layer="plots" aria-pressed="true">领地</button><button data-layer="players" aria-pressed="true" title="显示附近玩家（同时控制小地图）">角色</button></div><div class="map-place-list"></div><div class="map-directory-note"><span class="map-live-dot"></span> 当前已载入区域<br><small>放大地图可查看名称</small></div></aside></div><div class="map-footer"><span data-scale></span><div class="map-navigation"><span data-route-status role="status">单击地图设置导航点</span><button data-clear-route hidden>清除导航</button></div><span><kbd>单击</kbd> 导航 <kbd>拖动</kbd> 平移 <kbd>滚轮</kbd> 缩放 <kbd>M</kbd> 返回</span></div>';document.body.append(dialog);
  const small=mini.querySelector('canvas'),large=dialog.querySelector('canvas'),view={x:0,z:0,scale:.18};let plan=null,rows=[],atlas=null,bounds=null,drag=null,waterJob=0;
  let destination=null,route=null,routeWorker=null,routeRequest=0,routeBusy=false,routeTime=0,routeOrigin=null,routeTimer=null,arrived=false;
  const routeStatus=dialog.querySelector('[data-route-status]'),clearRoute=dialog.querySelector('[data-clear-route]'),miniRoute=mini.querySelector('.mini-route');
  const meters=n=>n>=1000?(n/1000).toFixed(1)+' km':Math.round(n)+' m';
  function routeMessage(text){world.setNavigationRoute?.(route?.status==='ok'?route.points:[],route?.status==='ok'?route.drivingPoints:[]);routeStatus.textContent=text;miniRoute.textContent=route?.status==='ok'?meters(route.distance):text.includes('规划')?'规划中…':text==='已到达导航点'?'已到达':'暂无路线';miniRoute.title=text;miniRoute.hidden=!destination;clearRoute.hidden=!destination;}
  function worker(){
    if(routeWorker)return routeWorker;
    routeWorker=new Worker('/navigation-worker.js',{type:'module'});
    const failed=()=>{clearTimeout(routeTimer);routeWorker?.terminate();routeWorker=null;routeBusy=false;route=null;routeMessage('导航暂不可用，请重新设置导航点');draw();};
    routeWorker.onerror=failed;
    routeWorker.onmessage=({data})=>{if(data.id!==routeRequest)return;clearTimeout(routeTimer);routeBusy=false;if(!destination)return;route=data.result;
      const messages={'off-road':'目标或当前位置距道路过远','no-roads':'当前区域尚无道路数据',disconnected:'已载入道路不连通',invalid:'导航点无效',error:'导航计算失败'};
      routeMessage(route.status==='ok'?'道路路线 '+meters(route.distance)+(route.endGap>15?' · 终点距目标 '+meters(route.endGap):''):messages[route.status]||'暂无可用路线');draw();};
    return routeWorker;
  }
  function navigate(force=false){
    if(!destination||!plan||routeBusy)return;const p=world.mapPose,now=performance.now();
    if(Math.hypot(p.x-destination.x,p.z-destination.z)<10){if(!arrived){arrived=true;route=null;routeMessage('已到达导航点');}return;}
    if(arrived){arrived=false;force=true;}
    if(!force&&(!routeWorker||now-routeTime<1200||routeOrigin&&Math.hypot(p.x-routeOrigin.x,p.z-routeOrigin.z)<12))return;
    try{const fresh=!routeWorker,w=worker();if(fresh)w.postMessage({type:'roads',roads:plan.roads||[]});routeBusy=true;routeTime=now;routeOrigin={...p};const id=++routeRequest;w.postMessage({type:'route',id,start:p,target:destination});routeTimer=setTimeout(()=>{if(id!==routeRequest)return;w.terminate();routeWorker=null;routeBusy=false;route=null;routeMessage('导航计算超时，请重新设置导航点');draw();},10000);}catch{routeBusy=false;routeMessage('浏览器无法启动导航');}
  }
  function setDestination(point){destination=point;arrived=false;route=null;routeOrigin=null;routeRequest++;routeBusy=false;clearTimeout(routeTimer);routeMessage(point?'正在规划道路路线…':'单击地图设置导航点');if(point)navigate(true);draw();}
  clearRoute.onclick=()=>setDestination(null);
  window.addEventListener('pagehide',()=>{routeWorker?.terminate();routeWorker=null;clearTimeout(routeTimer);routeBusy=false;});
  window.addEventListener('pageshow',()=>{if(destination)navigate(true);});
  const layers={plots:true,bridges:true,rivers:true,players:true};
  try{layers.players=localStorage.getItem('openworld:map-players')!=='false';}catch{}
  dialog.querySelector('[data-layer="players"]').setAttribute('aria-pressed',String(layers.players));let selectedPlace=null,placeSignature=null,pendingFit=false;
  const places=()=>[...(layers.plots?rows.map(p=>({...plotLabel(p),kind:'plot',symbol:p.published?'⌂':'◇'})):[]),...(layers.bridges?bridgeLabels(plan?.roads||[]).map(p=>({...p,kind:'bridge',symbol:'╫'})):[]),...(layers.rivers?riverNames.map(p=>({...p,kind:'river',symbol:'≈'})):[])];
  function directory(){const list=dialog.querySelector('.map-place-list');const values=places(),signature=JSON.stringify(values);if(signature===placeSignature)return;placeSignature=signature;list.replaceChildren();if(!values.length){const empty=document.createElement('p');empty.className='map-empty';empty.textContent=plan?'此区域暂无所选标记':'正在载入地点…';list.append(empty);}for(const p of values){const button=document.createElement('button');button.className='map-place';button.setAttribute('aria-label','定位 '+p.text);const icon=document.createElement('span');icon.className='map-place-icon';icon.style.color=p.color;icon.textContent=p.symbol;const text=document.createElement('span');text.textContent=p.text;const arrow=document.createElement('span');arrow.className='map-place-arrow';arrow.textContent='↗';button.append(icon,text,arrow);button.onclick=()=>{selectedPlace=p.text;view.x=p.x;view.z=p.z;view.scale=Math.max(view.scale,.32);for(const b of list.children)b.removeAttribute('aria-current');button.setAttribute('aria-current','location');draw();};list.append(button);}}
  for(const button of dialog.querySelectorAll('[data-layer]'))button.onclick=()=>{const key=button.dataset.layer;layers[key]=!layers[key];if(key==='players')try{localStorage.setItem('openworld:map-players',String(layers.players));}catch{}button.setAttribute('aria-pressed',String(layers[key]));directory();draw();};
  function center(){selectedPlace=null;Object.assign(view,world.mapPose,{scale:Math.max(view.scale,.18)});draw();}
  function fit(){if(!bounds){pendingFit=true;return center();}pendingFit=false;selectedPlace=null;view.x=bounds.x+bounds.size/2;view.z=bounds.z+bounds.size/2;view.scale=Math.max(.035,Math.min(large.clientWidth,large.clientHeight)*.94/bounds.size);draw();}
  dialog.querySelector('[data-fit]').onclick=fit;
  function open(){if(document.querySelector('dialog[open]'))return;world.setMapOpen(true);dialog.showModal();fit();}
  mini.onclick=open;dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{drag=null;world.setMapOpen(false);mini.focus({preventScroll:true});});
  document.addEventListener('keydown',e=>{if(e.code!=='KeyM'||e.repeat||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable)return;if(dialog.open){e.preventDefault();dialog.close();}else if(!document.querySelector('dialog[open]')){e.preventDefault();open();}});
  function zoom(factor,x=large.clientWidth/2,y=large.clientHeight/2){Object.assign(view,zoomMap(view,factor,x,y,large.clientWidth,large.clientHeight));draw();}
  dialog.querySelector('[data-plus]').onclick=()=>zoom(1.4);dialog.querySelector('[data-minus]').onclick=()=>zoom(1/1.4);dialog.querySelector('[data-center]').onclick=center;
  large.addEventListener('wheel',e=>{e.preventDefault();const r=large.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  large.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};large.setPointerCapture(e.pointerId);});
  large.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>5)drag.moved=true;if(!drag.moved)return;view.x-=(e.clientX-drag.x)/view.scale;view.z-=(e.clientY-drag.y)/view.scale;drag.x=e.clientX;drag.y=e.clientY;draw();});
  large.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;const clicked=!drag.moved;drag=null;if(clicked){const r=large.getBoundingClientRect();setDestination({x:view.x+(e.clientX-r.left-r.width/2)/view.scale,z:view.z+(e.clientY-r.top-r.height/2)/view.scale});}});
  for(const event of ['pointercancel','lostpointercapture'])large.addEventListener(event,()=>drag=null);
  function render(canvas,v){
    const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;const dpr=Math.min(devicePixelRatio,2);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#181d20';c.fillRect(0,0,w,h);const point=(x,z)=>mapPoint(x,z,v,w,h);
    if(bounds){const [x,y]=point(bounds.x,bounds.z),size=bounds.size*v.scale;c.fillStyle='#272c2d';c.fillRect(x,y,size,size);if(atlas){c.imageSmoothingEnabled=true;c.drawImage(atlas,x,y,size,size);}}
    c.lineCap='round';c.lineJoin='round';
    for(const road of plan?.roads||[]){if(!road.points?.length)continue;c.beginPath();road.points.forEach((p,i)=>{const q=point(p[0],p[2]);i?c.lineTo(...q):c.moveTo(...q);});c.strokeStyle=road.bridge?'#e0e2dc':'#989d9c';c.lineWidth=Math.max(.8,road.width*v.scale*.72);c.stroke();}
    for(const row of layers.plots?rows:[]){const polygon=plotPolygon(row);c.beginPath();polygon.forEach(([x,z],i)=>{const p=point(x,z);i?c.lineTo(...p):c.moveTo(...p);});c.closePath();c.fillStyle=row.published?'#83b5d699':'#d5ad6399';c.fill();const p=point(row.cx,row.cz);c.fillStyle=row.published?'#9dd5ff':'#ecc886';c.fillRect(p[0]-3,p[1]-3,6,6);}
    if(route?.status==='ok'&&route.points.length){
      c.beginPath();(world.mapPose.vehicleType==='car'&&route.drivingPoints?.length?route.drivingPoints:route.points).forEach((p,i)=>{const q=point(p[0],p[2]);i?c.lineTo(...q):c.moveTo(...q);});c.strokeStyle='#20152de6';c.lineWidth=canvas===small?7:9;c.stroke();c.strokeStyle='#bf8cff';c.lineWidth=canvas===small?3.5:5;c.stroke();
    }
    if(destination){const [x,y]=point(destination.x,destination.z);c.save();c.translate(x,y);c.fillStyle='#d7b6ff';c.strokeStyle='#21152c';c.lineWidth=2;c.beginPath();c.moveTo(0,-9);c.lineTo(7,0);c.lineTo(0,9);c.lineTo(-7,0);c.closePath();c.fill();c.stroke();c.restore();}
    const pose=world.mapPose,p=point(pose.x,pose.z),occupied=[[p[0]-14,p[1]-14,p[0]+14,p[1]+14]];
    c.font=`${canvas===small?10:12}px "Microsoft YaHei",sans-serif`;c.textAlign='center';c.textBaseline='middle';
    for(const player of layers.players?world.mapPlayers||[]:[]){
      const [x,y]=point(player.x,player.z);if(x<8||x>w-8||y<8||y>h-8||Math.hypot(x-p[0],y-p[1])<13)continue;
      c.beginPath();c.arc(x,y,canvas===small?3.5:5,0,Math.PI*2);c.fillStyle='#76d8e8';c.fill();c.strokeStyle='#17242b';c.lineWidth=2;c.stroke();
      occupied.push([x-7,y-7,x+7,y+7]);
      if(canvas===small)continue;
      const name=String(player.name||'玩家').slice(0,24),width=c.measureText(name).width+10,box=[x-width/2,y-27,x+width/2,y-11];
      if(box[0]<4||box[2]>w-4||box[1]<4||occupied.some(b=>box[0]<b[2]+3&&box[2]>b[0]-3&&box[1]<b[3]+3&&box[3]>b[1]-3))continue;
      c.lineWidth=4;c.strokeStyle='#161b1de6';c.strokeText(name,x,y-19);c.fillStyle='#b6eef5';c.fillText(name,x,y-19);occupied.push(box);
    }
    for(const label of places()){
      const [x,y]=point(label.x,label.z);if(x<0||x>w||y<0||y>h)continue;
      if(label.kind!=='river'){c.fillStyle='#111619';c.beginPath();c.arc(x,y,8,0,Math.PI*2);c.fill();c.fillStyle=label.color;c.fillText(label.symbol,x,y);}
      if(label.text!==selectedPlace&&label.kind!=='river'&&(canvas===small||v.scale<.2))continue;
      const text=label.text.length>30?label.text.slice(0,29)+'…':label.text,width=c.measureText(text).width+12;
      for(const dy of [-18,20,-36,38]){const box=[x-width/2,y+dy-9,x+width/2,y+dy+9];if(box[0]<8||box[2]>w-8||box[1]<30||box[3]>h-45||occupied.some(b=>box[0]<b[2]+5&&box[2]>b[0]-5&&box[1]<b[3]+4&&box[3]>b[1]-4))continue;if(canvas===small&&[[box[0],box[1]],[box[2],box[3]]].some(([a,b])=>Math.hypot(a-w/2,b-h/2)>w/2-8))continue;
        c.lineWidth=4;c.strokeStyle='#161b1de6';c.strokeText(text,x,y+dy);c.fillStyle=label.text===selectedPlace?'#ffffff':label.color;c.fillText(text,x,y+dy);occupied.push(box);break;
      }
    }
    c.textAlign='start';c.textBaseline='alphabetic';c.save();c.translate(...p);c.rotate(pose.heading);c.shadowColor='#000';c.shadowBlur=4;c.fillStyle='#f4f7f3';c.strokeStyle='#151a1c';c.lineWidth=2;c.beginPath();c.moveTo(0,-10);c.lineTo(7,8);c.lineTo(0,4);c.lineTo(-7,8);c.closePath();c.fill();c.stroke();c.restore();
    if(!plan){c.fillStyle='#cad0cd';c.font='12px sans-serif';c.fillText('正在载入地图…',15,h/2);}else if(bounds&&(v.x<bounds.x||v.x>bounds.x+bounds.size||v.z<bounds.z||v.z>bounds.z+bounds.size)){c.fillStyle='#cad0cd';c.font='14px sans-serif';c.fillText('此区域尚未载入',20,32);}
    if(canvas!==small){c.strokeStyle='#d5dcda';c.lineWidth=2;c.beginPath();c.moveTo(14,h-22);c.lineTo(94,h-22);c.stroke();c.fillStyle='#d5dcda';c.font='10px sans-serif';c.fillText(`${Math.round(80/v.scale)} m`,14,h-28);}
  }
  function draw(){if(document.hidden)return;navigate();render(small,{...world.mapPose,scale:.32});if(dialog.open){render(large,view);const p=world.mapPose;dialog.querySelector('[data-scale]').textContent=`X ${Math.round(p.x)} / Z ${Math.round(p.z)}`;}}
  setInterval(draw,100);new ResizeObserver(draw).observe(mini);
  return {setData(values,planning){rows=values;plan=planning;world.setNavigationRoute?.([]);routeRequest++;routeBusy=false;clearTimeout(routeTimer);route=null;routeOrigin=null;if(destination){try{worker().postMessage({type:'roads',roads:plan?.roads||[]});navigate(true);}catch{routeMessage('浏览器无法启动导航');}}directory();const {x:left,z:top,size}=mapBounds(planning,world.mapPose);if(bounds&&bounds.x===left&&bounds.z===top&&bounds.size===size){draw();return;}atlas=null;riverNames=[];bounds={x:left,z:top,size};if(dialog.open&&pendingFit)fit();const token=++waterJob,area={...bounds},hydro=createWorldHydrology(planning?.hydrology),image=document.createElement('canvas');image.width=image.height=256;const ctx=image.getContext('2d');let row=0;const names=new Map();
    function paint(){if(token!==waterJob)return;for(let end=Math.min(row+8,256);row<end;row++)for(let x=0;x<256;x++){const wx=area.x+(x+.5)*area.size/256,wz=area.z+(row+.5)*area.size/256;ctx.fillStyle=hydro.distance(wx,wz)<14?'#19323e':'#272c2d';ctx.fillRect(x,row,1,1);if(x%12===0&&row%12===0)for(const line of hydro.segments(wx,wz)){const label=riverLabel(line);if(label.x>=area.x&&label.x<=area.x+area.size&&label.z>=area.z&&label.z<=area.z+area.size&&!names.has(label.id))names.set(label.id,label);}}if(row<256)setTimeout(paint,0);else{atlas=image;riverNames=[...names.values()];directory();draw();}}setTimeout(paint,0);draw();}};
}
