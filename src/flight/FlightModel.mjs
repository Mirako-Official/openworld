/**
 * Point-mass aerodynamics for the plane — the half of the flight code that is
 * pure arithmetic and can therefore be pinned down by unit tests in Node.
 *
 * `FlightAdapter.mjs` sits next to it and owns the other half: how often to
 * integrate, how to ask the world whether a move is legal, and how to publish
 * the attitude for rendering. Splitting them the same way the character shadow
 * splits `CharacterShadow` from `CharacterShadowAdapter` keeps this file free of
 * three.js, of the collision grid and of the frame loop, so a stall or an energy
 * exchange can be asserted directly instead of inferred from a rendered frame.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 *
 * The old plane moved vertically on the frame a key was pressed: lift was a
 * hard-coded `speed > 12` gate, the climb rate was capped at 9 m/s independently
 * of airspeed, and a fixed -3 sink applied whenever the aircraft was airborne
 * and slow. Nothing conserved energy, so a dive could not be traded for speed
 * and a climb cost nothing.
 *
 * This is a point mass instead. Two angles carry inertia — the flight path
 * `gamma` and the bank `bank` — and the nose attitude `theta` is what the
 * elevator actually commands, so the nose leads the trajectory rather than
 * dragging it. The gaps between them are the physics:
 *
 *   alpha = theta - gamma      angle of attack, the only thing that makes lift
 *   CL    = clAlpha * alpha    linear below the stall angle, then collapsing
 *   L     = LIFT_K * V^2 * CL  lift, quadratic in airspeed like the real thing
 *   D     = V^2 * (cd0 + induced * CL^2)
 *   dV/dt = thrust - D - g*sin(gamma)          energy, not a script
 *   dgamma/dt = (L - g*cos(gamma)) / inertia
 *   dpsi/dt    = rudder deflection * airspeed  the original yaw law, kept
 *
 * Roll is an attitude, not a force. An earlier revision derived the turn from
 * the bank angle and scaled lift by cos(bank), which is the more faithful model
 * but changed how the aircraft handles; the brief was to keep the existing yaw
 * handling and add roll on top of it, so bank drives nothing but the rendered
 * attitude. Re-coupling it is a two-line change if that is wanted later.
 *
 * ── Two calibrations, not two magic numbers ─────────────────────────────────
 *
 * `LIFT_K` is derived, not tuned: it is whatever makes CLMAX at `stallSpeed`
 * produce exactly one gravity. The 12 m/s takeoff threshold the old code
 * hard-coded is therefore emergent — the aircraft simply stops out-lifting its
 * own weight below the reference speed. Retune `stallSpeed` and the threshold
 * moves with it.
 *
 * Note the practical climb threshold sits higher, around 14 m/s. Holding full
 * up elevator drives alpha past `alphaStall`, where CL collapses to the
 * `stallFloor` residual, so between roughly 12 and 14 m/s the aircraft is behind
 * the power curve: the harder you pull, the faster it sinks. With full throttle
 * on the runway that never binds, because thrust keeps accelerating the aircraft
 * through the band — which is why a rotation at 12 m/s still gets airborne.
 *
 * `cd0` is likewise set so that full thrust balances drag at
 * `VEHICLE_TYPES.plane.max`, which is what stops level flight from running away
 * to the overspeed cap. The consequence worth knowing is that this airframe is
 * thrust-limited, not drag-limited: thrust/weight is 0.612 (accel 6 / g 9.8) and
 * the pitch limit caps the dive angle at 21.77 degrees, so `g*sin(21.77deg)` =
 * 3.64 < 6 and the aircraft cannot overspeed in a dive. That is a property of the calibration,
 * not an oversight — raise `thetaMax` or `accel` and it changes.
 *
 * ── What the pose publishes ─────────────────────────────────────────────────
 *
 * `roll` is `-bank` because the renderer builds the rotation as
 * `rotation.set(pitch, heading, roll, 'YXZ')` with the nose along -Z, where a
 * positive z-rotation is a left bank. Both `pitch` and `roll` are kept inside
 * the clamps `shared/player-state.mjs` applies to the network pose, so attitude
 * never gets silently flattened between the sim and a remote observer.
 */

import {VEHICLE_TYPES} from '../../shared/vehicle-types.mjs';

export const FLIGHT={
  gravity:9.8,
  stallSpeed:12,        // reference speed the lift constant is calibrated against
  clAlpha:1.6,          // lift-curve slope, per radian
  alphaStall:.28,       // 16 deg
  stallDecay:4,
  stallFloor:.25,       // residual lift once fully stalled
  cd0:2.58e-3,          // parasitic drag, calibrated so full thrust balances drag at VEHICLE_TYPES.plane.max
  induced:.026,         // induced drag
  thetaMax:.38,         // 21.8 deg; stays under the .4 pose clamp in shared/player-state.mjs
  pitchRate:4.5,
  steerMax:.3,          // rudder authority, carried over from the original yaw law
  steerRate:4,
  bankMax:1.22,         // 70 deg
  bankRate:2.2,
  bankReturn:1.4,       // wings level themselves when the stick is centred
  airbrake:14,
  overspeed:1.25,       // diving may exceed the level maximum
  groundFriction:.6,
  ceiling:600,
};
export const CLMAX=FLIGHT.clAlpha*FLIGHT.alphaStall;
// Chosen so that CLMAX at stallSpeed produces exactly one gravity of lift; the
// 12 m/s takeoff threshold is therefore emergent rather than hard-coded.
const LIFT_K=FLIGHT.gravity/(FLIGHT.stallSpeed**2*CLMAX);
const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
const approach=(from,to,rate,dt)=>from+(to-from)*(1-Math.exp(-rate*dt));

export function liftCoefficient(alpha){
  const magnitude=Math.abs(alpha);
  if(magnitude<=FLIGHT.alphaStall)return FLIGHT.clAlpha*alpha;
  return Math.sign(alpha)*CLMAX*Math.max(FLIGHT.stallFloor,1-(magnitude-FLIGHT.alphaStall)*FLIGHT.stallDecay);
}

// v.speed is total airspeed, v.gamma the flight-path angle, v.theta the nose
// attitude and v.bank the roll angle (positive rolls right). surfaceY is the
// surface height under the aircraft, or null when the caller has none.
export function stepFlight(v,input,dt,surfaceY){
  const spec=VEHICLE_TYPES.plane,ground=surfaceY==null?-Infinity:surfaceY;
  v.speed??=0;v.gamma??=0;v.theta??=0;v.bank??=0;
  const elevator=Number(!!input.up)-Number(!!input.down);
  const aileron=Number(!!input.right)-Number(!!input.left);
  const throttle=Number(!!input.forward)-Number(!!input.back);
  const onGround=v.y<=ground+.02;

  // The elevator holds the nose attitude, the rudder yaws the nose at the rate
  // the original handling used, and the ailerons roll the wings and nothing
  // else. Roll is deliberately not what turns the aircraft: keeping the original
  // yaw law meant adding roll did not have to change how the plane flies.
  v.theta=approach(v.theta,elevator*FLIGHT.thetaMax,FLIGHT.pitchRate,dt);
  const rudder=Number(!!input.left)-Number(!!input.right);
  v.steerAngle=approach(v.steerAngle||0,rudder*FLIGHT.steerMax,FLIGHT.steerRate,dt);
  v.heading+=v.steerAngle*Math.min(1.5,Math.abs(v.speed)*.15)*Math.sign(v.speed)*dt;
  v.bank=onGround?approach(v.bank,0,FLIGHT.bankRate,dt):approach(v.bank,aileron*FLIGHT.bankMax,aileron?FLIGHT.bankRate:FLIGHT.bankReturn,dt);

  // Angle of attack is the nose attitude measured against the trajectory, so a
  // climbing aircraft settles at a small alpha while a slow one stalls.
  const alpha=clamp(v.theta-v.gamma,-1.2,1.2),cl=liftCoefficient(alpha);
  const airspeed2=v.speed*v.speed,lift=LIFT_K*airspeed2*cl;
  const drag=airspeed2*(FLIGHT.cd0+FLIGHT.induced*cl*cl)+(input.brake?FLIGHT.airbrake:0)+(onGround?FLIGHT.groundFriction:0);
  const thrust=throttle&&!input.brake?throttle*spec.accel:0;
  // Gravity acts whenever the aircraft is off the ground. Gating this on
  // airspeed instead — as an earlier revision did, to stop a parked aircraft
  // creeping forward along the gravity term — left an aircraft that had lost its
  // airspeed hanging motionless in mid-air. Nothing else could move it: with no
  // airspeed there is no trajectory to pitch, so a collision that zeroed the
  // airspeed froze the plane against the building permanently. The ground clamp
  // below prevents the creep on its own, without needing the airspeed gate.
  const alongPath=onGround?0:FLIGHT.gravity*Math.sin(v.gamma);
  v.speed=clamp(v.speed+(thrust-drag-alongPath)*dt,0,spec.max*FLIGHT.overspeed);
  // Rolling to a halt must not undo the first increment of a standing start.
  if(onGround&&!thrust&&v.speed<.5)v.speed=0;

  // On the ground the surface carries the weight, so only excess lift can pitch
  // the flight path up — gravity must not pull the nose down through the
  // runway, but it must still be possible to rotate and take off. Off the ground
  // the full lift-minus-weight acts, which is what makes a stalled aircraft fall.
  const inertia=Math.max(4,v.speed),net=lift-FLIGHT.gravity*Math.cos(v.gamma);
  v.gamma=clamp(v.gamma+(onGround?Math.max(0,net):net)/inertia*dt,-1.4,1.4);
  if(onGround&&v.gamma<0)v.gamma=0;

  v.pitch=v.theta;v.roll=-v.bank;
  const forward=v.speed*Math.cos(v.gamma)*dt;
  let y=v.y+v.speed*Math.sin(v.gamma)*dt;
  if(y<=ground){y=ground;if(v.gamma<0)v.gamma=0;}
  return {x:v.x-Math.sin(v.heading)*forward,y:Math.min(FLIGHT.ceiling,y),z:v.z-Math.cos(v.heading)*forward};
}
