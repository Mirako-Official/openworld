const DEAD_ZONE=.28;

export function joystickCodes(x,y){
  const codes=[];
  if(y<-DEAD_ZONE)codes.push('KeyW');else if(y>DEAD_ZONE)codes.push('KeyS');
  if(x<-DEAD_ZONE)codes.push('KeyA');else if(x>DEAD_ZONE)codes.push('KeyD');
  return codes;
}

export function createMobileControls(world){
  const root=document.createElement('section');root.id='mobile-controls';root.setAttribute('aria-label','手机游戏控制');
  const stick=document.createElement('div');stick.className='mobile-stick';stick.setAttribute('aria-label','移动摇杆');stick.setAttribute('role','application');
  const knob=document.createElement('span');knob.className='mobile-stick-knob';stick.append(knob);
  const actions=document.createElement('div');actions.className='mobile-actions';
  const buttons=[['KeyF','交互','F','primary interact'],['Space','跳跃 / 刹车','⇧','primary action'],['ShiftLeft','奔跑 / 手刹','»','boost'],['KeyO','切换视角','◉','view'],['KeyP','载具','◇','vehicle'],['KeyE','抬头','↑','flight pitch up'],['KeyQ','低头','↓','flight pitch down']];
  for(const [code,label,icon,className] of buttons){const button=document.createElement('button');button.type='button';button.dataset.code=code;button.className=className;button.setAttribute('aria-label',label);button.innerHTML=`<strong>${icon}</strong><span>${label}</span>`;actions.append(button);}
  root.append(stick,actions);document.body.append(root);
  let flightState=null;function syncContext(){const next=!!world.mobileFlightActive;if(next!==flightState){flightState=next;root.dataset.flight=String(next);}requestAnimationFrame(syncContext);}syncContext();
  let pointer=null,active=new Set();
  function setCodes(next){for(const code of active)if(!next.has(code))world.mobileKey(code,false);for(const code of next)if(!active.has(code))world.mobileKey(code,true);active=next;}
  function move(event){if(event.pointerId!==pointer)return;const rect=stick.getBoundingClientRect(),radius=rect.width*.38,dx=event.clientX-(rect.left+rect.width/2),dy=event.clientY-(rect.top+rect.height/2),length=Math.hypot(dx,dy),scale=length>radius?radius/length:1,x=dx*scale/radius,y=dy*scale/radius;knob.style.transform=`translate(${x*radius}px,${y*radius}px)`;setCodes(new Set(joystickCodes(x,y)));}
  function release(event){if(pointer===null||event&&event.pointerId!==pointer)return;pointer=null;knob.style.transform='';setCodes(new Set());stick.classList.remove('pressed');}
  stick.addEventListener('pointerdown',event=>{if(pointer!==null)return;pointer=event.pointerId;stick.setPointerCapture(pointer);stick.classList.add('pressed');move(event);event.preventDefault();});
  stick.addEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(type,release);
  for(const button of actions.querySelectorAll('button')){let held=null;const up=event=>{if(held===null||event&&event.pointerId!==held)return;world.mobileKey(button.dataset.code,false);button.classList.remove('pressed');held=null;};button.addEventListener('pointerdown',event=>{held=event.pointerId;button.setPointerCapture(held);button.classList.add('pressed');world.mobileKey(button.dataset.code,true);event.preventDefault();});for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,up);}
  root.addEventListener('contextmenu',event=>event.preventDefault());window.addEventListener('blur',()=>{release();for(const button of actions.querySelectorAll('.pressed'))button.classList.remove('pressed');});
  return root;
}
