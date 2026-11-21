import type {Race} from './types';
import {opponents, type FieldCar} from './grid';
import type {Track} from './track';
import {pitBox,pitRoute,teammateInBox,STACK_GAP} from './pit-service';
import {cornerLimit} from './vehicle';
import {followNeutralisedQueue,speedRestriction,weatherTyre,wetGrip,type neutralisedQueue} from './race-control';

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
export function advanceField(race:Race,track:Track,dt:number,queue?:ReturnType<typeof neutralisedQueue>){
 const limits=speeds(track),finish=race.laps*track.LENGTH;
 const restriction=speedRestriction(race.control),wetness=race.control?.wetness??0;
 // Determine who yields from one instant. Front-to-back integration then lets a
 // queue use the actual movement of the car in front, including service stops.
 const order=[...race.field,race.cars.a,race.cars.b]
  .map((car,index)=>({car,index,distance:car.distance-(index>=race.field.length?car.speed*dt:0),offset:car.offset,speed:car.speed,finishTime:car.finishTime}))
  .filter(row=>row.car.finishTime===null)
  .sort((a,b)=>b.distance-a.distance||a.index-b.index);
 let firstNeighbour=0,lastNeighbour=0;
 for(let rank=0;rank<order.length;rank++){
  const row=order[rank],i=row.index;
  while(order[firstNeighbour].distance-row.distance>16)firstNeighbour++;
  while(lastNeighbour<order.length&&row.distance-order[lastNeighbour].distance<=16)lastNeighbour++;
  if(i>=race.field.length)continue; // The player integrator has already advanced both seats.
  const car=race.field[i];
  const entry=opponents[i],station=track.wrap(car.distance),u=station/track.LENGTH*limits.length,index=Math.floor(u);
  const speedLimit=limits[index]+(limits[(index+1)%limits.length]-limits[index])*(u-index);
  const pace=.92+(entry.number*13%23)*.003;
  const current=car.compound??'medium',desiredTyre=weatherTyre(race.control,current);
  let target=Math.min(speedLimit*pace*Math.sqrt(wetGrip(current,wetness)),restriction);
  // Split the field across two pit windows and separate the team boxes.
  const stopLap=race.laps>=3?1+i%2:0;
  const scheduled=stopLap*track.LENGTH-(track.LENGTH-track.PIT_ENTRY);
  if(car.weatherPit!==undefined&&car.weatherPit-car.distance>=120&&desiredTyre===current)delete car.weatherPit;
  if(car.weatherPit===undefined&&desiredTyre!==current&&(!car.pit||car.pit==='none')){
   const distance=track.wrap(track.PIT_ENTRY-car.distance);
   const entry=car.distance+distance+(distance<120?track.LENGTH:0);
   if(entry+track.LENGTH-track.PIT_ENTRY<finish)car.weatherPit=entry;
  }
  const pitEntry=car.weatherPit??scheduled;
  const box=pitEntry-track.PIT_ENTRY+pitBox(track,entry.team);
  const exit=pitEntry+track.wrap(track.PIT_EXIT-track.PIT_ENTRY);
  const stopPlanned=car.weatherPit!==undefined||stopLap>0;
  const pitting=stopPlanned&&car.distance>=pitEntry&&car.distance<exit;
  if(car.weatherPit!==undefined&&car.distance>=exit)delete car.weatherPit;
  if(pitting)car.pit=car.service>0?'stopped':car.distance<box?'entry':'exit';
  else if(car.pit)delete car.pit;
  const waiting=pitting&&car.distance<box&&teammateInBox(race,track,entry,car.distance,box);
  const targetBox=box-(waiting?STACK_GAP:0);
  let desiredOffset=track.racingLineOffset(car.distance+car.speed*.18);
  if(stopPlanned&&car.distance<pitEntry&&pitEntry-car.distance<240)
   target=Math.min(target,Math.sqrt(track.PIT_LIMIT**2+2*23*(pitEntry-car.distance)));
  if(pitting){
   desiredOffset=pitRoute(track,car.distance,box);target=Math.min(target,track.PIT_LIMIT);
   if(car.distance<box)target=Math.min(target,Math.sqrt(14*Math.max(0,targetBox-car.distance)));
  }else{
   const launch=Math.max(0,1-race.time/6);
   const lane=(i%2===0?-1:1)*(1.32+1.68*launch);
   const margin=track.trackHalfWidth(car.distance)-1.15;
   desiredOffset=Math.max(-margin,Math.min(margin,desiredOffset*(1-launch)+lane));
   if(!queue)desiredOffset=clearRacingLine(car,desiredOffset,margin,order,undefined,firstNeighbour,lastNeighbour);
  }
  if(car.service>0){car.lateralVelocity=0;car.service=Math.max(0,car.service-dt);continue;}
  let leader:typeof order[number]|undefined;
  for(let j=rank-1;j>=0;j--){
   const ahead=order[j];
   if(ahead.distance-car.distance>=25)break;
   if(Math.abs(ahead.offset-car.offset)<2.12){leader=ahead;break;}
  }
  if(leader){
   const gap=leader.distance-car.distance;
   target=Math.min(target,leader.speed+Math.max(0,gap-6.6)*.8);
  }
  const neutralisedLeader=!pitting?queue?.get(car):undefined;
  if(neutralisedLeader)target=Math.min(target,neutralisedLeader.speed+Math.max(0,neutralisedLeader.distance-car.distance-9)*.8);
  // In the lane, steer along the painted curve as well as correcting the
  // gap to its centre. A fixed lateral speed alone cuts across the divider.
  const correction=Math.max(-2.4*dt,Math.min(2.4*dt,desiredOffset-car.offset));
  const previousOffset=car.offset;
  car.offset+=correction;
  if(car.impactSideSpeed){
   // Recover lateral grip progressively after a player clips a moving opponent.
   if(!pitting){
    const shoulder=track.trackHalfWidth(car.distance)+.60;
    car.offset=Math.max(-shoulder,Math.min(shoulder,car.offset+car.impactSideSpeed*dt));
    car.impactSideSpeed*=Math.exp(-4.2*dt);
   }
   if(pitting||Math.abs(car.impactSideSpeed)<.03)delete car.impactSideSpeed;
  }
  const acceleration=Math.min(11,530000/(830*Math.max(car.speed,20))-.00075*car.speed**2);
  car.speed=Math.max(0,car.speed+Math.max(-29*dt,Math.min(acceleration*dt,target-car.speed)));
  const before=car.distance;
  car.distance+=car.speed*dt;
  followNeutralisedQueue(car,before,neutralisedLeader);
  if(leader && leader.car.finishTime===null){
   // Open a pre-existing overlap at up to 2 m/s. A stationary queue waits
   // for clearance without moving a car backwards or inventing track distance.
   const clearance=Math.min(5.8,leader.distance-before+2*dt);
   const available=Math.max(0,leader.car.distance-clearance-before);
   if(car.speed*dt>available){car.distance=before+available;car.speed=available/dt;}
  }
  if(pitting){
   if(waiting&&car.distance>=targetBox){car.distance=Math.max(before,targetBox);car.speed=0;}
   const lateral=pitRoute(track,car.distance,box)-desiredOffset;
   car.offset+=lateral;
   if(car.distance>before)car.pitHeading=-Math.atan2(lateral,car.distance-before);
  }else if(car.pitHeading!==undefined)delete car.pitHeading;
  car.lateralVelocity=(car.offset-previousOffset)/dt;
  if(pitting&&!waiting&&before<box&&car.distance>=box){car.pit='stopped';car.distance=box;car.service=track.PIT_STOP_SECONDS;car.speed=0;if(desiredTyre!==current)car.compound=desiredTyre;}
  if(car.distance>=finish){car.finishTime=race.time-dt+(finish-before)/Math.max(.01,car.speed);car.distance=finish;car.speed=0;}
 }
}

// Protect the occupied lane through an overlap. Both controllers use the same
// clearance, so a racing-line change cannot sweep across a car on its flank.
export function clearRacingLine(car:FieldCar,desired:number,margin:number,others:readonly FieldCar[],rival?:FieldCar,first=0,end=others.length){
 let left=-margin,right=margin;
 function reserve(other:FieldCar){
  if(other===car||other.finishTime!==null)return;
  const gap=other.distance-car.distance,delta=other.offset-car.offset;
  if(Math.abs(delta)>5.0||Math.abs(gap)>16)return;
  const future=gap+(other.speed-car.speed)*.30;
  if(Math.abs(gap)>5.9&&Math.abs(future)>6.7)return;
  // Longitudinal queue control handles nose-to-tail running.
  if(Math.abs(delta)<.55)return;
  if(delta>0)right=Math.min(right,other.offset-2.20);
  else left=Math.max(left,other.offset+2.20);
 }
 for(let i=first;i<end;i++)reserve(others[i]);
 if(rival)reserve(rival);
 return left<=right?Math.max(left,Math.min(right,desired)):car.offset;
}
