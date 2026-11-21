import type {FieldCar} from './grid';
import type {Track} from './track';
import type {Compound,Race} from './types';

export const compounds=['soft','medium','hard','intermediate','wet'] as const;
export const rainLevels=['dry','light','moderate','heavy'] as const;
export type RainLevel=typeof rainLevels[number];
export type Hazard={kind:'safety-car';when:'now'|'next-lap'}|{kind:'safety-car-in'}|{kind:'yellow';active:boolean}|{kind:'rain';level:RainLevel};
export interface RaceControl {
 revision:number;
 change:string;
 rain:RainLevel;
 wetness:number;
 yellowUntil?:number;
 safetyCar?:{distance:number;speed:number;offset:number;releaseDistance:number};
 queuedSafetyCarLap?:number;
 safetyCarInLap?:number;
}

const safetyPace=110/3.6, safetyLimit=145/3.6, yellowLimit=160/3.6;
const rainWetness={dry:0,light:.24,moderate:.58,heavy:.94};
export const rainLabel=(level:RainLevel)=>level==='dry'?'Dry':`${level[0].toUpperCase()}${level.slice(1)} rain`;

export function parseHazard(value:unknown):Hazard|undefined{
 if(!value||typeof value!=='object')return;
 const hazard=value as Partial<Record<'kind'|'when'|'active'|'level',unknown>>;
 if(hazard.kind==='safety-car'&&(hazard.when==='now'||hazard.when==='next-lap'))return {kind:hazard.kind,when:hazard.when};
 if(hazard.kind==='safety-car-in')return {kind:hazard.kind};
 if(hazard.kind==='yellow'&&typeof hazard.active==='boolean')return {kind:hazard.kind,active:hazard.active};
 if(hazard.kind==='rain'&&rainLevels.includes(hazard.level as RainLevel))return {kind:hazard.kind,level:hazard.level as RainLevel};
}

function record(control:RaceControl,change:string){
 control.revision++;
 control.change=change;
}

function leaderDistance(race:Race){
 return Math.max(0,race.cars.a.distance,race.cars.b.distance,...race.field.map(car=>car.distance));
}

export const nextSafetyCarLap=(race:Race,track:Track)=>Math.floor(leaderDistance(race)/track.LENGTH)+2;

function deploy(control:RaceControl,leader:number,track:Track){
 const distance=leader+65;
 control.safetyCar={distance,speed:safetyPace,offset:Math.min(5,track.trackHalfWidth(distance)-1),releaseDistance:leader+track.LENGTH};
 record(control,'Safety car deployed');
}

export function applyHazard(race:Race,track:Track,hazard:Hazard){
 if(race.phase!=='racing')return false;
 const control=race.control??={revision:0,change:'',rain:'dry',wetness:0};
 switch(hazard.kind){
  case 'safety-car':{
   const leader=leaderDistance(race);
   if(hazard.when==='now'){
    if(control.safetyCar)return false;
    deploy(control,leader,track);
   }else{
    const nextLap=nextSafetyCarLap(race,track);
    if(nextLap>race.laps||control.queuedSafetyCarLap||control.safetyCarInLap)return false;
    control.queuedSafetyCarLap=nextLap;
    record(control,`Safety car scheduled for lap ${nextLap}`);
   }
   return true;
  }
  case 'safety-car-in':{
   const nextLap=nextSafetyCarLap(race,track);
   if(!control.safetyCar||control.safetyCarInLap||nextLap>race.laps)return false;
   control.safetyCarInLap=nextLap;
   delete control.queuedSafetyCarLap;
   record(control,`Safety car in at start of lap ${nextLap}`);
   return true;
  }
  case 'yellow':
   if(Boolean(control.yellowUntil)===hazard.active)return false;
   if(hazard.active)control.yellowUntil=race.time+30;
   else delete control.yellowUntil;
   record(control,hazard.active?'Full-course yellow':'Yellow flags cleared');
   return true;
  case 'rain':
   if(control.rain===hazard.level)return false;
   control.rain=hazard.level;
   record(control,hazard.level==='dry'?'Rain stopped. Track drying':`${rainLabel(hazard.level)} started`);
   return true;
 }
}

export function stepRaceControl(race:Race,track:Track,dt:number){
 const control=race.control;
 if(!control)return;
 const target=rainWetness[control.rain];
 control.wetness+=(target-control.wetness)*Math.min(1,dt/(target>control.wetness?16:32));
 if(Math.abs(target-control.wetness)<.001)control.wetness=target;
 if(control.yellowUntil&&race.time>=control.yellowUntil){
  delete control.yellowUntil;
  record(control,'Yellow flags cleared');
 }
 if(!control.safetyCar&&!control.queuedSafetyCarLap)return;
 const leader=leaderDistance(race);
 const restartLine=control.safetyCarInLap===undefined?undefined:(control.safetyCarInLap-1)*track.LENGTH;
 const releaseDistance=restartLine??control.safetyCar?.releaseDistance;
 if(control.queuedSafetyCarLap&&leader>=(control.queuedSafetyCarLap-1)*track.LENGTH){
  delete control.queuedSafetyCarLap;
  deploy(control,leader,track);
 }else if(releaseDistance!==undefined&&leader>=releaseDistance){
  delete control.safetyCar;
  delete control.safetyCarInLap;
  record(control,'Safety car in');
 }
 const safety=control.safetyCar;
 if(safety){
  safety.distance+=safety.speed*dt;
  const enteringPits=restartLine!==undefined&&
   safety.distance>=restartLine-track.LENGTH+track.PIT_ENTRY&&safety.distance<restartLine+track.PIT_EXIT;
  const targetOffset=enteringPits?track.pitOffset(safety.distance):track.racingLineOffset(safety.distance);
  safety.offset+=(targetOffset-safety.offset)*Math.min(1,dt*.8);
 }
}

export function speedRestriction(control:RaceControl|undefined){
 return control?.safetyCar?safetyLimit:control?.yellowUntil?yellowLimit:Infinity;
}

type QueueEntry={distance:number;speed:number;clearance:number};
export function neutralisedQueue(race:Race){
 if(!Number.isFinite(speedRestriction(race.control)))return;
 const order=[race.cars.a,race.cars.b,...race.field].filter(onTrack).sort((a,b)=>b.distance-a.distance);
 const queue=new Map<FieldCar,QueueEntry>();
 for(let index=0;index<order.length;index++){
  const car=order[index],ahead=index?order[index-1]:race.control?.safetyCar;
  if(ahead)queue.set(car,{distance:ahead.distance,speed:ahead.speed,clearance:Math.min(8,Math.max(0,ahead.distance-car.distance))});
 }
 return queue;
}

const onTrack=(car:FieldCar)=>car.finishTime===null&&(!car.pit||car.pit==='none');
export function followNeutralisedQueue(car:FieldCar,priorDistance:number,ahead:QueueEntry|undefined){
 if(!ahead)return;
 const limit=Math.max(priorDistance,ahead.distance-ahead.clearance);
 if(car.distance>limit){
  car.distance=limit;
  car.speed=Math.min(car.speed,ahead.speed);
 }
}

export function wetGrip(compound:Compound,wetness:number){
 if(compound==='wet')return .60+.36*wetness;
 if(compound==='intermediate')return .71+.32*wetness-.42*Math.max(0,wetness-.53);
 return 1-.70*wetness;
}

export function weatherTyre(control:RaceControl|undefined,current:Compound){
 if(!control)return current;
 const wetness=control.wetness;
 // Sample the conditions the driver is likely to see around pit entry.
 const expected=wetness+(rainWetness[control.rain]-wetness)*.88;
 const target=expected>=.81?'wet':expected>=.34?'intermediate':'medium';
 return target==='medium'&&current!=='wet'&&current!=='intermediate'?current:target;
}

export function raceControlTelemetry(race:Race){
 const control=race.control,restriction=speedRestriction(control);
 return {revision:control?.revision??0,change:control?.change??null,
  flag:control?.safetyCar?'safety-car' as const:control?.yellowUntil?'yellow' as const:'green' as const,
  yellow:Boolean(control?.yellowUntil),speedLimitKph:Number.isFinite(restriction)?Math.round(restriction*3.6):null,
  safetyCarScheduledLap:control?.queuedSafetyCarLap??null,safetyCarInLap:control?.safetyCarInLap??null,
  safetyCarDistance:control?.safetyCar?.distance??null};
}
