import {FIELD_STEP_TICKS} from './grid';
import type {Race,RaceState} from './types';

const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
function angle(a=0,b=0,t:number){
 return a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
}
function fieldTime(r:Race,hz:number){
 return r.field?.length?r.time-(r.tick%FIELD_STEP_TICKS)/hz:r.time;
}

function blendField(a:Race,b:Race,t:number){
 if(t<=0||a===b)return a.field;
 if(t>=1)return b.field;
 return a.field?.map((x,i)=>{
  const y=b.field?.[i];if(!y)return x;
  return {...x,service:x.pit==='stopped'&&y.pit==='stopped'?lerp(x.service,y.service,t):x.service,
   distance:lerp(x.distance,y.distance,t),offset:lerp(x.offset,y.offset,t),
   speed:lerp(x.speed,y.speed,t),pitHeading:angle(x.pitHeading,y.pitHeading,t)};
 });
}

/** Keep discrete events on their recorded frame, including impacts and pit releases. */
export function blendRace(a:Race,b:Race,t:number,field?:Race['field']):Race{
 if(a.phase!==b.phase||a.circuit!==b.circuit)return t<1?a:b;
 if(t>=1)return b;
 if(t<=0||a===b)return field&&field!==a.field?{...a,field}:a;
 const cars={...a.cars};
 for(const seat of ['a','b'] as const){
  const x=a.cars[seat],y=b.cars[seat];
  cars[seat]={...x,distance:lerp(x.distance,y.distance,t),offset:lerp(x.offset,y.offset,t),
   speed:lerp(x.speed,y.speed,t),heading:angle(x.heading,y.heading,t),steering:lerp(x.steering,y.steering,t),
   acceleration:lerp(x.acceleration,y.acceleration,t),lateralG:lerp(x.lateralG,y.lateralG,t),rpm:lerp(x.rpm,y.rpm,t),
   pitTime:x.pit===y.pit?lerp(x.pitTime,y.pitTime,t):x.pitTime};
 }
 let control=a.control;
 const safety=a.control?.safetyCar,nextSafety=b.control?.safetyCar;
 if(control&&safety&&nextSafety&&safety.releaseDistance===nextSafety.releaseDistance){
  control={...control,safetyCar:{...safety,distance:lerp(safety.distance,nextSafety.distance,t),offset:lerp(safety.offset,nextSafety.offset,t)}};
 }
 return {...a,time:lerp(a.time,b.time,t),control,cars,field:field??blendField(a,b,t)};
}

/** Buffer roughly three to four 30 Hz packets. The lens follows simulation time,
 * even when several packets are dispatched together between display frames. */
export function createInterpolator(delay=.12){
 const frames:Race[]=[];
 let latest:Race|undefined,rate=1,anchorTime=0,anchorWall=0,lastAdvance=0,clockScale=1;
 // Reusable output buffers for the 60 Hz presentation loop (zero per-frame GC churn).
 let outRace:Race|undefined,outCarA:Race['cars']['a']|undefined,outCarB:Race['cars']['b']|undefined;
 let outCars:Race['cars']|undefined;
 let outControl:NonNullable<Race['control']>|undefined,outSafety:NonNullable<NonNullable<Race['control']>['safetyCar']>|undefined;
 const outField:NonNullable<Race['field']>=[];
 function blendFieldInto(a:Race,b:Race,t:number){
  if(t<=0||a===b)return a.field;
  if(t>=1)return b.field;
  const src=a.field,dst=b.field;
  if(!src)return src;
  outField.length=src.length;
  for(let i=0;i<src.length;i++){
   const x=src[i],y=dst?.[i];
   if(!y){outField[i]=x;continue;}
   let slot=outField[i];
   if(!slot||slot===x)slot=outField[i]={...x};
   else Object.assign(slot,x);
   slot.service=x.pit==='stopped'&&y.pit==='stopped'?lerp(x.service,y.service,t):x.service;
   slot.distance=lerp(x.distance,y.distance,t);
   slot.offset=lerp(x.offset,y.offset,t);
   slot.speed=lerp(x.speed,y.speed,t);
   slot.pitHeading=angle(x.pitHeading,y.pitHeading,t);
  }
  return outField;
 }
 function blendRaceInto(a:Race,b:Race,t:number,field:Race['field']):Race{
  if(a.phase!==b.phase||a.circuit!==b.circuit)return t<1?a:b;
  if(t>=1)return b;
  if(t<=0||a===b){
   if(!field||field===a.field)return a;
   if(!outRace)outRace={...a,field};
   else{Object.assign(outRace,a);outRace.field=field;}
   return outRace;
  }
  const xa=a.cars.a,ya=b.cars.a,xb=a.cars.b,yb=b.cars.b;
  if(!outCarA)outCarA={...xa};else Object.assign(outCarA,xa);
  outCarA.distance=lerp(xa.distance,ya.distance,t);outCarA.offset=lerp(xa.offset,ya.offset,t);
  outCarA.speed=lerp(xa.speed,ya.speed,t);outCarA.heading=angle(xa.heading,ya.heading,t);
  outCarA.steering=lerp(xa.steering,ya.steering,t);outCarA.acceleration=lerp(xa.acceleration,ya.acceleration,t);
  outCarA.lateralG=lerp(xa.lateralG,ya.lateralG,t);outCarA.rpm=lerp(xa.rpm,ya.rpm,t);
  outCarA.pitTime=xa.pit===ya.pit?lerp(xa.pitTime,ya.pitTime,t):xa.pitTime;
  if(!outCarB)outCarB={...xb};else Object.assign(outCarB,xb);
  outCarB.distance=lerp(xb.distance,yb.distance,t);outCarB.offset=lerp(xb.offset,yb.offset,t);
  outCarB.speed=lerp(xb.speed,yb.speed,t);outCarB.heading=angle(xb.heading,yb.heading,t);
  outCarB.steering=lerp(xb.steering,yb.steering,t);outCarB.acceleration=lerp(xb.acceleration,yb.acceleration,t);
  outCarB.lateralG=lerp(xb.lateralG,yb.lateralG,t);outCarB.rpm=lerp(xb.rpm,yb.rpm,t);
  outCarB.pitTime=xb.pit===yb.pit?lerp(xb.pitTime,yb.pitTime,t):xb.pitTime;
  let control=a.control;
  const safety=a.control?.safetyCar,nextSafety=b.control?.safetyCar;
  if(control&&safety&&nextSafety&&safety.releaseDistance===nextSafety.releaseDistance){
   if(!outSafety)outSafety={...safety};else Object.assign(outSafety,safety);
   outSafety.distance=lerp(safety.distance,nextSafety.distance,t);
   outSafety.offset=lerp(safety.offset,nextSafety.offset,t);
   if(!outControl)outControl={...control,safetyCar:outSafety};
   else{Object.assign(outControl,control);outControl.safetyCar=outSafety;}
   control=outControl;
  }
  // Exact player ticks can use the packet's cars with a separately timed field.
  // Keep the writable car pair independent of whichever packet was last shown.
  outCars??={a:outCarA,b:outCarB};
  if(!outRace)outRace={...a,time:lerp(a.time,b.time,t),control,cars:outCars,field};
  else{
   Object.assign(outRace,a);
   outRace.time=lerp(a.time,b.time,t);
   outRace.control=control;
   outRace.cars=outCars;
   outRace.field=field;
  }
  return outRace;
 }
 function push(s:RaceState,received:number){
  const r=s.race;
  if(latest===r)return;
  const reset=!latest||r.phase!=='racing'||r.phase!==latest.phase||r.circuit!==latest.circuit||
   r.tick<latest.tick||r.time<latest.time||s.speed!==rate;
  const elapsed=(received-lastAdvance)/1000;
  if(reset||!latest){
   frames.length=0;rate=s.speed;anchorTime=r.time-delay*rate;anchorWall=received;clockScale=1;
  }else if(r.time===latest.time){
   frames[frames.length-1]=latest=r;return;
  }else{
   const advance=(r.time-latest.time)/rate;
   const desired=r.time-delay*rate;
   const estimated=anchorTime+(received-anchorWall)*rate*clockScale/1000;
   // A suspended tab, stopped race clock or genuinely missing stretch of
   // snapshots is a discontinuity. Never invent the intervening race path.
   if(advance>.6){
    frames.length=0;anchorTime=desired;clockScale=1;
   }else if(elapsed-advance>.35&&estimated>r.time){
    // The wall clock kept running while both rendering and simulation paused.
    // Resume from the previous packet or later, even mid-field-step.
    anchorTime=Math.max(fieldTime(latest,s.physicsHz),desired);
    clockScale=1;
   }else{
    const error=(desired-estimated)/rate;
    // Correct sustained clock drift by changing slope, never position. A
    // delayed packet followed by an on-time packet leaves the trajectory intact.
    anchorTime=estimated;
    clockScale=1+(Math.abs(error)>.065?Math.max(-.025,Math.min(.025,error*.25)):0);
   }
   anchorWall=received;
  }
  lastAdvance=received;latest=r;frames.push(r);
  if(frames.length>48)frames.shift();
 }
 function sample(s:RaceState,received:number,now:number){
  push(s,received);
  const available=fieldTime(frames[frames.length-1],s.physicsHz);
  let target=anchorTime+(now-anchorWall)*rate*clockScale/1000;
  if(target>available){
   // Hold the clock with the cars when the network buffer runs dry. Otherwise
   // the first packet after a stall plays the missed travel in a single frame.
   target=available;anchorTime=target;anchorWall=now;
  }
  while(frames.length>1&&frames[1].time<=target)frames.shift();
  const [a,b]=frames;
  if(!b)return a;
  // Snapshots can be sent between the field's 30 Hz integration steps.
  // Its last solved pose then predates the player pose in the same packet.
  let i=0;
  while(i+1<frames.length&&fieldTime(frames[i+1],s.physicsHz)<=target)i++;
  const left=frames[i],right=frames[i+1];
  const start=fieldTime(left,s.physicsHz),span=right?fieldTime(right,s.physicsHz)-start:0;
  const field=right&&span>0?blendFieldInto(left,right,(target-start)/span):left.field;
  return blendRaceInto(a,b,(target-a.time)/(b.time-a.time),field);
 }
 return Object.assign(sample,{push});
}
