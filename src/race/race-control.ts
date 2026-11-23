import type {FieldCar} from './grid';
import type {Track} from './track';
import type {Compound,Race} from './types';

export const compounds=['soft','medium','hard','intermediate','wet'] as const;
export const dryCompounds=['soft','medium','hard'] as const;
export const rainLevels=['dry','light','moderate','heavy'] as const;
export type RainLevel=typeof rainLevels[number];
export type Hazard={kind:'safety-car';when:'now'|'next-lap'}|{kind:'safety-car-in'}|{kind:'yellow';active:boolean}|{kind:'rain';level:RainLevel};
export interface WeatherForecast {
 nextRain:RainLevel;
 arrivalLaps:[number,number];
 trend:'drying'|'steady'|'worsening';
}
export interface RaceControl {
 revision:number;
 change:string;
 rain:RainLevel;
 wetness:number;
 sectorWetness?:[number,number,number];
 forecast?:WeatherForecast;
 yellowUntil?:number;
 safetyCar?:{distance:number;speed:number;offset:number;releaseDistance:number};
 queuedSafetyCarLap?:number;
 safetyCarInLap?:number;
}

const safetyPace=110/3.6, safetyLimit=145/3.6, yellowLimit=160/3.6;
export const rainWetness={dry:0,light:.24,moderate:.58,heavy:.94} as const;
// Sector 2 damps/dries fastest (exposed section), Sector 1 slowest, creating real crossover gradients.
const sectorRate:[number,number,number]=[.86,1.18,.98];
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

function computeForecast(control:RaceControl):WeatherForecast{
 const target=rainWetness[control.rain];
 if(target>control.wetness+.03)return {nextRain:control.rain,arrivalLaps:[0,1],trend:'worsening'};
 if(target<control.wetness-.03)return {nextRain:control.rain,arrivalLaps:[0,2],trend:'drying'};
 return {nextRain:control.rain,arrivalLaps:control.rain==='dry'?[2,5]:[0,1],trend:'steady'};
}

function deploy(control:RaceControl,leader:number,track:Track){
 const distance=leader+65;
 control.safetyCar={distance,speed:safetyPace,offset:Math.min(5,track.trackHalfWidth(distance)-1),releaseDistance:leader+track.LENGTH};
 record(control,'Safety car deployed');
}

export function applyHazard(race:Race,track:Track,hazard:Hazard){
 if(race.phase!=='racing')return false;
 const control=race.control??={revision:0,change:'',rain:'dry',wetness:0,sectorWetness:[0,0,0],forecast:{nextRain:'dry',arrivalLaps:[2,5],trend:'steady'}};
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
   control.forecast=computeForecast(control);
   record(control,hazard.level==='dry'?'Rain stopped. Track drying':`${rainLabel(hazard.level)} started`);
   return true;
 }
}

export function sectorWetnessOf(control:RaceControl|undefined,sector:number){
 if(!control)return 0;
 return control.sectorWetness?.[sector]??control.wetness;
}

export function wetnessBand(wetness:number){
 return wetness>=.75?3:wetness>=.34?2:wetness>=.22?1:0;
}

export function stepRaceControl(race:Race,track:Track,dt:number){
 const control=race.control;
 if(!control)return;
 const target=rainWetness[control.rain];
 const sectors: [number,number,number]=control.sectorWetness??[control.wetness,control.wetness,control.wetness];
 const baseTau=target>control.wetness?16:32;
 for(let i=0;i<3;i++){
  const tau=baseTau/sectorRate[i];
  sectors[i]+=(target-sectors[i])*Math.min(1,dt/tau);
  if(Math.abs(target-sectors[i])<.001)sectors[i]=target;
 }
 control.sectorWetness=sectors;
 control.wetness=(sectors[0]+sectors[1]+sectors[2])/3;
 if(Math.abs(target-control.wetness)<.001)control.wetness=target;
 control.forecast=computeForecast(control);
 if(control.wetness>=.25)race.wetRace=true;
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

export function wetGripTable(wetness:number):Record<Compound,number>{
 const r=(c:Compound)=>Math.round(wetGrip(c,wetness)*100)/100;
 return {soft:r('soft'),medium:r('medium'),hard:r('hard'),intermediate:r('intermediate'),wet:r('wet')};
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
