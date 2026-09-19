import * as T from 'three';
export function drivingDisplay(speed,braking){return {speed:Math.round(Math.abs(speed)*3.6),gear:speed<-.05?'R':speed>.05?'D':'N',braking:!!braking};}
export function drawRoundGauge(ctx,state){
  ctx.clearRect(0,0,512,512);ctx.fillStyle='#0b1018';ctx.beginPath();ctx.arc(256,256,256,0,Math.PI*2);ctx.fill();
  ctx.textAlign='center';ctx.textBaseline='middle';
  for(let i=0;i<=40;i++){
    const a=(135+i*6.75)*Math.PI/180,major=i%4===0,r=major?194:207;ctx.strokeStyle=i>=34?'#ff635b':'#d6e2ef';ctx.lineWidth=major?5:2;ctx.beginPath();ctx.moveTo(256+Math.cos(a)*r,256+Math.sin(a)*r);ctx.lineTo(256+Math.cos(a)*225,256+Math.sin(a)*225);ctx.stroke();
    if(major){ctx.fillStyle='#d6e2ef';ctx.font='24px sans-serif';ctx.fillText(String(i*5),256+Math.cos(a)*168,256+Math.sin(a)*168);}
  }
  const angle=(135+Math.min(200,Math.max(0,state.speed))/200*270)*Math.PI/180;
  ctx.strokeStyle='#ff614e';ctx.lineWidth=6;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(256-Math.cos(angle)*24,256-Math.sin(angle)*24);ctx.lineTo(256+Math.cos(angle)*185,256+Math.sin(angle)*185);ctx.stroke();ctx.lineCap='butt';
  ctx.fillStyle='#ced7e0';ctx.beginPath();ctx.arc(256,256,12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#dce8f4';ctx.font='bold 32px monospace';ctx.fillText(String(state.speed),256,325);ctx.font='18px sans-serif';ctx.fillText('km/h',256,357);ctx.fillStyle=state.braking?'#ff765e':'#8fe1ef';ctx.font='bold 30px sans-serif';ctx.fillText(state.gear,256,404);
}
export function createCockpit(){
  const help=document.createElement('section');help.id='driving-help';help.className='driving-keys';help.hidden=true;help.setAttribute('aria-label','驾驶操作提示');
  help.innerHTML='<strong class="driving-summary"></strong><span>鼠标 · 转头观察</span><span><kbd>Space</kbd> 刹车</span><span class="car-handbrake"><kbd>Shift</kbd> 手刹</span><span><kbd>O</kbd> 切换视角</span><span><kbd>F</kbd> 下车</span>';document.body.append(help);
  const summary=help.querySelector('.driving-summary'),handbrakeHelp=help.querySelector('.car-handbrake'),displays=new WeakMap();
  function updateInstruments(vehicle,state,status){
    const wheel=vehicle.group.getObjectByName('steering-wheel'),screen=vehicle.group.getObjectByName('instrument-screen');if(wheel)wheel.rotation.z=(vehicle.steer||0)*1.5;if(!screen)return;
    let display=displays.get(screen);if(!display){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=screen.userData.roundDial?512:256;const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;screen.material.map=texture;screen.material.color.set('#ffffff');screen.material.needsUpdate=true;display={canvas,texture,key:null};displays.set(screen,display);}
    const key=state.speed+':'+state.gear+':'+status;if(display.key===key)return;display.key=key;
    if(screen.userData.roundDial){drawRoundGauge(display.canvas.getContext('2d'),state);display.texture.needsUpdate=true;return;}
    const ctx=display.canvas.getContext('2d');ctx.fillStyle='#101f1b';ctx.fillRect(0,0,512,256);ctx.textAlign='center';ctx.fillStyle='#9baea0';ctx.font='20px sans-serif';ctx.fillText('OPENWORLDCRAFT',256,34);ctx.fillStyle='#e3f1df';ctx.font='100px monospace';ctx.fillText(String(state.speed),230,143);ctx.fillStyle='#d4b46c';ctx.font='42px monospace';ctx.fillText(state.gear,405,130);ctx.font='22px sans-serif';ctx.fillText('km/h',256,177);ctx.fillStyle=state.braking?'#ffc28d':'#9baea0';ctx.fillText(status,256,223);display.texture.needsUpdate=true;
  }
  return {update(vehicle,enabled,keys,paused,dt,walking=true){
    const driving=walking&&!!vehicle,car=vehicle?.type==='car';help.hidden=!driving;document.body.dataset.driving=String(driving);document.body.dataset.cockpit=String(enabled&&driving&&car);if(!driving)return;
    const handbrake=keys.has('ShiftLeft')||keys.has('ShiftRight'),state=drivingDisplay(vehicle.speed,keys.has('Space')||handbrake||vehicle.speed>.05&&keys.has('KeyS'));
    summary.textContent=({car:'小汽车',bike:'单车',plane:'飞机',boat:'船'})[vehicle.type]+' · '+state.speed+' km/h';handbrakeHelp.hidden=!car&&vehicle.type!=='plane';handbrakeHelp.innerHTML=vehicle.type==='plane'?'<kbd>E / Q</kbd> 抬头 / 低头 · <kbd>A / D</kbd> 转向 / 滚转':'<kbd>Shift</kbd> 手刹';if(vehicle.type==='plane')summary.textContent+=' · 高度 '+Math.round(vehicle.y)+' m';
    if(car)updateInstruments(vehicle,state,paused?'已暂停':handbrake?'手刹':state.braking?'制动中':state.speed?'行驶中':'就绪');
  }};
}
