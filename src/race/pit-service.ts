import {grid,opponents,playerEntry,type FieldCar,type GridEntry} from './grid';
import type {Race,Team} from './types';
import type {Track} from './track';

export interface PitTelemetry{distance:number;pit?:string;pitTime?:number;totalStop?:number;offset?:number;heading?:number;compound?:string;instruction?:{tyre?:string}}
export type Constructor=GridEntry['team'];
// Indices of the 28 m garage modules authored in build_circuits.py.
export const garageBay:Record<Constructor,number>={
 McLaren:3,'Red Bull Racing':4,Alpine:5,Mercedes:6,Ferrari:7,Williams:8,
 Haas:9,'Racing Bulls':10,Audi:11,'Aston Martin':12,Cadillac:13,
};
export const BOX_OFFSET=-23;
export function pitBox(track:Pick<Track,'PIT_STOP'>,team:Team|Constructor){
 const name=team==='a'||team==='b'?playerEntry(team).team:team;
 return track.PIT_STOP-200+28*garageBay[name];
}
export function boxGap(track:Track,d:number,box:number){
 return track.wrap(d-box+track.LENGTH/2)-track.LENGTH/2;
}
export function pitRoute(track:Track,d:number,box:number){
 const gap=boxGap(track,d,box);
 return track.pitOffset(d)-5*ramp(gap,-24,-8)*(1-ramp(gap,3,20));
}
const partner=new Map(grid.map(entry=>{
 const mate=grid.find(e=>e!==entry&&e.team===entry.team)!;
 return [entry,{mate,index:opponents.indexOf(mate),priority:grid.indexOf(entry)<grid.indexOf(mate)}] as const;
}));
// Work in the physical pit lane. Teammates may be on different race laps.
export function teammateInBox(race:Race,track:Track,entry:GridEntry,d:number,box:number){
 const own=boxGap(track,d,box);
 if(own < -45 || own>0.01)return false;
 const {mate,index,priority}=partner.get(entry)!;
 const other=mate.seat?race.cars[mate.seat]:race.field[index];
 if(!other||other.finishTime!==null||!other.pit||other.pit==='none')return false;
 const ahead=boxGap(track,other.distance,box);
 return ahead<7 && (other.pit==='stopped'||ahead>own+.00001||(Math.abs(ahead-own)<=.00001&&!priority));
}
export const STACK_GAP=7.5;
export interface GarageVisit{entry:GridEntry;car:PitTelemetry;gap:number}
export function garageVisits(track:Track,cars:Record<Team,PitTelemetry>,field:readonly FieldCar[]=[],visits=new Map<Constructor,GarageVisit>()){
 visits.clear();
 function add(entry:GridEntry,car:PitTelemetry){
  if(!car.pit||car.pit==='none')return;
  const gap=boxGap(track,car.distance,pitBox(track,entry.team));
  if(gap < -135||gap>36)return;
  // A snapshot from an older race may still contain its index-based field stop.
  // Keep the team and its equipment at the assigned garage in that case.
  if(car.pit==='stopped'&&Math.abs(gap)>1)return;
  const previous=visits.get(entry.team);
  // The departing car keeps its release signal until its tail clears.
  const priority=(c:PitTelemetry,g:number)=>c.pit==='stopped'?3:c.pit==='exit'&&g<7?2:c.pit==='entry'?1:0;
  if(previous){
   const rank=priority(car,gap)-priority(previous.car,previous.gap);
   if(rank<0||(rank===0&&previous.gap>=gap))return;
  }
  visits.set(entry.team,{entry,car,gap});
 }
 add(playerEntry('a'),cars.a);add(playerEntry('b'),cars.b);
 for(const [i,c] of field.entries())if(c.pit&&c.pit!=='none'){
  add(opponents[i],{...c,heading:c.pitHeading,pitTime:track.PIT_STOP_SECONDS-(c.service??0)});
 }
 return visits;
}
export function ramp(x:number,start:number,end:number){
 const u=Math.max(0,Math.min(1,(x-start)/(end-start)));return u*u*(3-2*u);
}
// Wheel work finishes before an extended repair. Resume the drop and
// withdrawal cues when the authoritative stop has its last 0.58 s to run.
export function serviceClock(car:PitTelemetry){
 const t=car.pitTime??0;
 return Math.min(t,Math.max(2.02,t-Math.max(0,(car.totalStop??2.6)-2.6)));
}
/** Service seconds are authoritative, including when the viewer joins mid-stop or scrubs a replay. */
export function jackLift(car:PitTelemetry){
 if(car.pit!=='stopped')return 0;
 const t=serviceClock(car);return .086*ramp(t,.08,.34)*(1-ramp(t,2.13,2.40));
}
const cornerOffsets=[.015,.05,.085,0];
export function cornerService(seconds:number,index:number,out={off:false,remove:0,fit:0,gun:0}){
 const t=seconds-cornerOffsets[index];
 out.off=t>=.49&&t<1.66;out.remove=ramp(t,.49,.99);out.fit=ramp(t,1.00,1.66);
 out.gun=ramp(t,-.15,.17)*(1-ramp(t,.44,.69))+ramp(t,1.50,1.71)*(1-ramp(t,1.99,2.23));
 return out;
}

export function frontJackPose(t:number,out={pivot:0,withdraw:0,handleYaw:0,x:0,z:0}){
 // Swing the handle around the loaded head before the operator opens the drop valve.
 const pivot=ramp(t,.74,1.64),withdraw=ramp(t,2.23,2.56);
 out.pivot=pivot;out.withdraw=withdraw;out.handleYaw=.94*pivot-.62*withdraw;out.x=1.38*withdraw;out.z=.30*withdraw;
 return out;
}
export function releaseGreen(t:number){
 // The last torque pulse ends at 2.23 + 0.085 seconds, before the release lamp.
 return t>=2.56;
}

export function canRelease(car:PitTelemetry){
 if(car.pit==='exit')return true;
 if(car.pit!=='stopped')return false;
 if((car.totalStop??2.6)>2.6&&(car.pitTime??0)<car.totalStop!)return false;
 return releaseGreen(serviceClock(car));
}
