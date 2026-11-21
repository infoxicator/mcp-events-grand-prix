import {FIELD_STEP_TICKS} from './grid';
import type {Race,RaceState} from './types';

const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
function angle(a=0,b=0,t:number){
 return a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
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
export function createInterpolator(){
 const frames:Race[]=[];
 const delay=.12;
 let latest:Race|undefined,rate=1,anchorTime=0,anchorWall=0,lastAdvance=0,clockScale=1;
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
   if(advance>.6||elapsed-advance>.35){
    if(advance>.6)frames.length=0;
    anchorTime=desired;clockScale=1;
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
  const target=anchorTime+(now-anchorWall)*rate*clockScale/1000;
  while(frames.length>1&&frames[1].time<=target)frames.shift();
  const [a,b]=frames;
  if(!b)return a;
  // Snapshots can be sent between the field's 30 Hz integration steps.
  // Its last solved pose then predates the player pose in the same packet.
  const fieldTime=(r:Race)=>r.time-(r.tick%FIELD_STEP_TICKS)/s.physicsHz;
  let i=0;
  while(i+1<frames.length&&fieldTime(frames[i+1])<=target)i++;
  const left=frames[i],right=frames[i+1];
  const span=right?fieldTime(right)-fieldTime(left):0;
  const field=right&&span>0?blendField(left,right,(target-fieldTime(left))/span):left.field;
  return blendRace(a,b,(target-a.time)/(b.time-a.time),field);
 }
 return Object.assign(sample,{push});
}
