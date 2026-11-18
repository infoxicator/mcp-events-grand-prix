import type {Race} from './types';
import {opponents, type FieldCar} from './grid';
import type {Track} from './track';
import {cornerLimit} from './vehicle';

// Static corner and braking envelope. Every driver samples the same road, with
// individual pace, launch and lane choice; network clients only interpolate.
const envelopes=new WeakMap<Track, Float32Array>();
function speeds(track:Track){
 let limits=envelopes.get(track);
 if(limits)return limits;
 const count=Math.ceil(track.LENGTH/6),step=track.LENGTH/count;
 limits=Float32Array.from({length:count},(_,i)=>Math.min(94,cornerLimit(track.racingCurvature(i*step),830,1)*.96));
 for(let i=count*2-1;i>=0;i--){
  const next=limits[(i+1)%count];
  limits[i%count]=Math.min(limits[i%count],Math.sqrt(next*next+2*24*step));
 }
 envelopes.set(track,limits);return limits;
}
export function trafficAhead(car:FieldCar,others:readonly FieldCar[],range:number){
 let closest:FieldCar|undefined;
 for(const other of others){
  const gap=other.distance-car.distance;
  if(other.finishTime===null&&gap>0&&gap<range&&Math.abs(car.offset-other.offset)<2.12){
   range=gap;closest=other;
  }
 }
 return closest;
}
export function advanceField(race:Race,track:Track,dt:number){
 const limits=speeds(track),finish=race.laps*track.LENGTH;
 const participants=[...race.field,race.cars.a,race.cars.b];
 for(let i=0;i<race.field.length;i++){
  const car=race.field[i];if(car.finishTime!==null)continue;
  const entry=opponents[i],station=track.wrap(car.distance),u=station/track.LENGTH*limits.length,index=Math.floor(u);
  const speedLimit=limits[index]+(limits[(index+1)%limits.length]-limits[index])*(u-index);
  const pace=.92+(entry.number*13%23)*.003;
  let target=speedLimit*pace;
  // Split the field across two pit windows and separate the team boxes.
  const stopLap=race.laps>=3?1+i%2:0;
  const pitEntry=stopLap*track.LENGTH- (track.LENGTH-track.PIT_ENTRY);
  const box=pitEntry+125+(i%10)*13;
  const exit=stopLap*track.LENGTH+track.PIT_EXIT;
  const pitting=stopLap>0&&car.distance>=pitEntry&&car.distance<exit;
  let desiredOffset=track.racingLineOffset(car.distance+car.speed*.18);
  if(stopLap>0&&car.distance<pitEntry&&pitEntry-car.distance<240)
   target=Math.min(target,Math.sqrt(track.PIT_LIMIT**2+2*23*(pitEntry-car.distance)));
  if(pitting){
   desiredOffset=track.pitOffset(car.distance);target=Math.min(target,track.PIT_LIMIT);
   if(car.distance<box)target=Math.min(target,Math.sqrt(14*(box-car.distance)));
  }else{
   const launch=Math.max(0,1-race.time/6);
   const lane=(i%2===0?-1:1)*(1.32+1.68*launch);
   const margin=track.trackHalfWidth(car.distance)-1.15;
   desiredOffset=Math.max(-margin,Math.min(margin,desiredOffset*(1-launch)+lane));
  }
  if(car.service>0){car.service=Math.max(0,car.service-dt);continue;}
  const leader=trafficAhead(car,participants,25);
  if(leader){
   const gap=leader.distance-car.distance;
   target=Math.min(target,leader.speed+Math.max(0,gap-6.6)*.8);
  }
  car.offset+=Math.max(-2.4*dt,Math.min(2.4*dt,desiredOffset-car.offset));
  const acceleration=Math.min(11,530000/(830*Math.max(car.speed,20))-.00075*car.speed**2);
  car.speed=Math.max(0,car.speed+Math.max(-29*dt,Math.min(acceleration*dt,target-car.speed)));
  const before=car.distance;
  car.distance+=car.speed*dt;
  if(leader&&leader.distance-before>=5.8&&car.distance>leader.distance-5.8){
   car.distance=leader.distance-5.8;car.speed=Math.min(car.speed,leader.speed);
  }
  if(pitting&&before<box&&car.distance>=box){car.distance=box;car.service=track.PIT_STOP_SECONDS;car.speed=0;}
  if(car.distance>=finish){car.finishTime=race.time-dt+(finish-before)/Math.max(.01,car.speed);car.distance=finish;car.speed=0;}
 }
}
