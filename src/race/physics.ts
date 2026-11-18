import {classification, gridSlot, playerEntry, startingField, type FieldCar} from './grid';
import {advanceField,trafficAhead} from './field-physics';
import {pitBox} from './pit-service';
import {getTrack,type Track,type CircuitId} from './track';
import {VEHICLE,brakeCapacity,cornerLimit,drivetrain} from './vehicle';
import { TEAMS,type Team,type Race,type Car,type Instruction,type DriverIntent,type Compound } from './types';
export const DT=1/120;
export const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export const other=(t:Team):Team=>t==='a'?'b':'a';
export const defaultInstruction=():Instruction=>({pace:'balanced',ers:'balanced',box:false,tyre:'medium',tactic:'hold',line:'Bring the tyres in. Build the rhythm.'});
export const defaultIntent=():DriverIntent=>({offset:0,speedBias:0,brakeAggression:.5,side:'hold',ers:false,drs:true,reply:'Radio check. Ready to race.'});
const TYRES={soft:{grip:1.08,wear:.000105},medium:{grip:1,wear:.000068},hard:{grip:.96,wear:.000044}};
export function createRace(laps=3,circuit:CircuitId='monza'):Race {
 const car=(team:Team):Car=>({team,...gridSlot(playerEntry(team)),speed:0,speedTrap:0,gear:1,throttle:0,brake:0,steering:0,heading:0,lateralVelocity:0,acceleration:0,lateralG:0,rpm:4000,ersUsed:0,ersRecovered:0,ers:90,drs:false,eligible:[false,false],compound:team==='a'?'soft':'medium',wear:0,temperature:85,fuel:34,pit:'none',pitTime:0,stops:0,tyreAge:0,warnings:0,penalty:0,lap:0,lapStart:0,lastLap:0,bestLap:0,lapTimes:[],sector:0,sectorStart:0,splits:[],bestSectors:[0,0,0],splitColours:['yellow','yellow','yellow'],finishTime:null,intent:defaultIntent(),instruction:defaultInstruction(),lastLimit:-100});
 return {circuit,tick:0,time:0,phase:'lobby',countdown:5,laps,field:startingField(),cars:{a:car('a'),b:car('b')},events:[],radio:[],leader:'a',fastest:null,winner:null};
}
export function event(s:Race,kind:Race['events'][number]['kind'],team:Team,message:string){s.events.push({id:Math.max(s.tick*100,(s.events.at(-1)?.id??0)+1),time:s.time,kind,team,message});if(s.events.length>40)s.events.shift();}
export function grip(c:Car){const thermal=1-Math.min(.2,Math.abs(c.temperature-95)*.002);return TYRES[c.compound].grip*(1-c.wear*.28-Math.max(0,c.wear-.65)*.8)*thermal;}
export function aero(c:Car,rival:FieldCar){const gap=rival.distance-c.distance,aligned=Math.abs(c.offset-rival.offset)<2.6;return {slipstream:gap>5&&gap<110&&aligned?(1-gap/110):0,dirtyAir:gap>3&&gap<55&&aligned?.22*(1-gap/55):0};}
export function drsAllowed(c:Car,track:Track=getTrack()){const {inZone,DRS_ZONES,isDrsZone}=track;return c.pit==='none'&&c.eligible.some((ok,i)=>ok&&inZone(c.distance,DRS_ZONES[i].start,DRS_ZONES[i].end))&&isDrsZone(c.distance)&&c.brake<.1;}
function crossedLine(before:number,after:number,mark:number,LENGTH:number){return Math.floor((before-mark)/LENGTH)<Math.floor((after-mark)/LENGTH);}
// Precompute geometry only; grip, fuel, wake and strategy remain dynamic.
const CURVE_STEP=4,curves=new WeakMap<Track,number[]>();
export function pathCurvature(d:number,track:Track=getTrack()){let curveTable=curves.get(track);if(!curveTable){curveTable=Array.from({length:Math.ceil(track.LENGTH/CURVE_STEP)+1},(_,i)=>track.racingCurvature(i*CURVE_STEP));curves.set(track,curveTable);}const u=track.wrap(d)/CURVE_STEP,i=Math.floor(u);return curveTable[i]*(1-u+i)+curveTable[i+1]*(u-i);}
export function racingSpeed(c:Car,rival:FieldCar,track:Track=getTrack()){
 const g=grip(c),air=aero(c,rival),mass=VEHICLE.dryMass+c.fuel;
 let limit=105;
 // Backwards velocity envelope: braking capacity grows with aerodynamic load.
 for(let ahead=320;ahead>=0;ahead-=8){const curve=pathCurvature(c.distance+ahead,track),v=cornerLimit(curve,mass,g,air.dirtyAir);
  const comfort=c.instruction.pace==='manage'?.91:c.instruction.pace==='push'?1:.975;
  const corner=v*comfort*(1+Math.min(2,c.intent.speedBias)*.005);
  const decel=brakeCapacity(limit,mass,g,Math.min(3*9.81,limit*limit*Math.abs(curve)),air.dirtyAir)*(.72+c.intent.brakeAggression*.08);
  limit=Math.min(corner,Math.sqrt(limit*limit+2*decel*8));
 }
 return limit;
}
export function stepRace(s:Race){
 const track=getTrack(s.circuit),{LENGTH,wrap,SECTORS,DRS_ZONES,PIT_ENTRY,PIT_EXIT,PIT_LIMIT,PIT_STOP_SECONDS,SPEED_TRAP,racingLineOffset,signedCurvatureAt,trackHalfWidth,pointAt,tangentAt,pitOffset}=track;
 const crossed=(before:number,after:number,mark:number)=>crossedLine(before,after,mark,LENGTH);
 s.tick++;
 if(s.phase==='lobby'||s.phase==='finished')return;
 if(s.phase==='lights'){s.countdown-=DT;if(s.countdown<=0){s.phase='racing';s.countdown=0;event(s,'start','a','LIGHTS OUT — LET THEM RACE');}return;}
 s.time+=DT;
 // Read a stable pair to prevent team iteration order influencing aerodynamics.
 const prior={a:{...s.cars.a,bestSectors:[...s.cars.a.bestSectors]},b:{...s.cars.b,bestSectors:[...s.cars.b.bestSectors]}};
 for(const team of TEAMS){const c=s.cars[team],rival=prior[other(team)];if(c.finishTime!==null)continue;
  const before=c.distance,PIT_STOP=pitBox(track,team);
  if(c.pit==='stopped'){
   c.pitTime+=DT;c.speed=0;c.throttle=0;c.brake=1;c.drs=false;
   if(c.pitTime+1e-8>=PIT_STOP_SECONDS){c.compound=c.instruction.tyre;c.wear=0;c.temperature=75;c.tyreAge=0;c.stops++;c.instruction.box=false;c.pit='exit';event(s,'pit',team,`${team.toUpperCase()} · ${PIT_STOP_SECONDS.toFixed(1)}s STOP · ${c.compound.toUpperCase()}`);}continue;
  }
  const traffic=c.pit==='none'?trafficAhead(c,s.field,110):undefined;
  const wake=traffic&&(rival.distance<=c.distance||traffic.distance<rival.distance)?traffic:rival;
  const air=aero(c,wake),mode=c.instruction.pace,mass=VEHICLE.dryMass+c.fuel,g=grip(c);
  c.drs=c.intent.drs&&drsAllowed(c,track)&&s.time>20&&Math.abs(pathCurvature(c.distance,track))<.004;
  const deploying=c.intent.ers&&c.ers>1&&c.ersUsed<4000000&&c.instruction.ers!=='harvest';
  let target=racingSpeed({...c,distance:c.distance+c.speed*.18},wake,track);
  // Battery and DRS alter available forces; neither adds free cornering speed.
  if(c.wear>.75)target*=1-(c.wear-.75)*.16;
  if(c.pit!=='none')target=Math.min(target,PIT_LIMIT);
  const toEntry=wrap(PIT_ENTRY-c.distance);if(c.instruction.box&&c.pit==='none'&&toEntry<260)target=Math.min(target,Math.sqrt(PIT_LIMIT**2+2*28*toEntry));
  if(c.pit==='entry'){const toBox=wrap(PIT_STOP-c.distance);if(toBox<35)target=Math.min(target,Math.sqrt(2*7*toBox));}
  // Pure pursuit steering in world coordinates. The car has a real heading;
  // available tyre force caps yaw, so excess entry speed creates understeer.
  const lookahead=clamp(c.speed*.25,7,24),pit=c.pit!=='none';
  const base=pit?pitOffset(c.distance+lookahead):racingLineOffset(c.distance+lookahead);
  const margin=trackHalfWidth(c.distance)-1.05;
  const desired=pit?base:Math.abs(c.intent.offset)>8?c.intent.offset:clamp(base+c.intent.offset,-margin,margin);
  const position=pointAt(c.distance,c.offset),aim=pointAt(c.distance+lookahead,desired),tangent=tangentAt(c.distance);
  const yaw=Math.atan2(tangent.x,tangent.z)+c.heading,dx=aim.x-position.x,dz=aim.z-position.z;
  const right=dx*Math.cos(yaw)-dz*Math.sin(yaw);
  const steerTarget=clamp(Math.atan2(2*VEHICLE.wheelbase*right,dx*dx+dz*dz),-.42,.42);
  c.steering+=clamp(steerTarget-c.steering,-1.1*DT,1.1*DT);
  const demandedYaw=c.speed/VEHICLE.wheelbase*Math.tan(c.steering);
  const lateralAccel=Math.min(5.5*9.81,Math.abs(demandedYaw*c.speed));
  const drive=drivetrain(c.speed,mass,g,deploying,c.drs,air.slipstream,air.dirtyAir,lateralAccel);
  const brakeMax=brakeCapacity(c.speed,mass,g,Math.min(lateralAccel,drive.tyreForce/mass*.5),air.dirtyAir);
  const gap=rival.distance-c.distance;
  if(c.pit==='none'&&rival.pit==='none'&&gap>0&&gap<35&&Math.abs(c.offset-rival.offset)<2.1)target=Math.min(target,Math.sqrt(rival.speed**2+2*15*Math.max(0,gap-7)));
  if(traffic&&traffic.distance-before<28)target=Math.min(target,traffic.speed+Math.max(0,traffic.distance-before-6.5)*.9);
  const dv=target-c.speed;
  const requestedThrottle=dv>0?clamp(dv*.65,0,1):0,requestedBrake=dv<0?clamp(-dv*3.5/Math.max(5,brakeMax),0,1):0;
  c.throttle+=clamp(requestedThrottle-c.throttle,-12*DT,5*DT);c.brake+=clamp(requestedBrake-c.brake,-12*DT,12*DT);
  if(c.brake>.05){c.throttle=0;c.drs=false;}
  const acceleration=(drive.maxDrive*c.throttle-drive.drag-drive.rolling)/mass-c.brake*Math.max(0,brakeMax-(drive.drag+drive.rolling)/mass);
  c.acceleration=acceleration;c.speed=Math.max(0,c.speed+acceleration*DT);
  if(c.pit!=='none')c.speed=Math.min(PIT_LIMIT,c.speed);
  const tyreLong=mass*acceleration+drive.drag+drive.rolling;
  const availableLateral=Math.sqrt(Math.max(0,drive.tyreForce**2-tyreLong**2))/mass;
  const actualYaw=clamp(demandedYaw,-Math.min(5.5*9.81,availableLateral)/Math.max(2,c.speed),Math.min(5.5*9.81,availableLateral)/Math.max(2,c.speed));
  c.lateralG=-actualYaw*c.speed/9.81;
  const roadCurve=signedCurvatureAt(c.distance),pathScale=Math.max(.65,1-roadCurve*c.offset);
  const progress=c.speed*Math.cos(c.heading)/pathScale;
  c.heading=clamp(c.heading+(actualYaw+roadCurve*progress)*DT,-.6,.6);
  c.lateralVelocity=-c.speed*Math.sin(c.heading);c.offset+=c.lateralVelocity*DT;
  c.distance+=Math.max(0,progress)*DT;
  if(traffic&&traffic.distance-before>=5.8&&c.distance>traffic.distance-5.8){c.distance=traffic.distance-5.8;c.speed=Math.min(c.speed,traffic.speed);}
  if(c.pit==='none'&&Math.abs(c.offset)>trackHalfWidth(c.distance)+1){c.speed=Math.max(0,c.speed-4*DT);c.wear=clamp(c.wear+.002*DT,0,1);}
  const thresholds=[26,36,46,56,66,76,86];let gear=1;for(const threshold of thresholds)if(c.speed>threshold)gear++;c.gear=gear;
  const ratio=[0,135,102,82,69,60,53,47,42][gear];c.rpm=clamp(c.speed/(2*Math.PI*.36)*60*ratio/10,4000,13000);
  if(deploying&&c.throttle>.5){const used=VEHICLE.ersPower*c.throttle*DT;c.ersUsed+=used;c.ers=clamp(c.ers-used/VEHICLE.batteryJoules*100,0,100);}
  else{const recovered=Math.min(120000*c.brake+(c.instruction.ers==='harvest'?18000:4000),Math.max(0,(2000000-c.ersRecovered)/DT))*DT;c.ersRecovered+=recovered;c.ers=clamp(c.ers+recovered/VEHICLE.batteryJoules*100,0,100);}
  if(crossed(before,c.distance,SPEED_TRAP))c.speedTrap=c.speed*3.6;
  const travelled=c.distance-before;c.wear=clamp(c.wear+travelled*TYRES[c.compound].wear*(mode==='manage'?.68:mode==='push'?1.2:1),0,1);
  c.tyreAge+=travelled/LENGTH;c.temperature+=((track.night?81:87)+c.throttle*9+c.brake*12+Math.abs(c.lateralG)*2-(mode==='manage'?9:0)-c.temperature)*DT*.08;
  c.fuel=Math.max(0,c.fuel-(.004+.023*c.throttle)*DT);
  if(c.instruction.box&&c.pit==='none'&&crossed(before,c.distance,PIT_ENTRY)){c.pit='entry';event(s,'pit',team,'BOX BOX · pit limiter on');}
  if(c.pit==='entry'&&crossed(before,c.distance,PIT_STOP)){c.distance=Math.floor((c.distance-PIT_STOP)/LENGTH)*LENGTH+PIT_STOP;c.pit='stopped';c.pitTime=0;c.speed=0;}
  if(c.pit==='exit'&&crossed(before,c.distance,PIT_EXIT)){c.pit='none';event(s,'pit',team,'Pit exit clear. Push now.');}
  if(c.pit==='none'&&Math.abs(c.offset)>trackHalfWidth(c.distance)+.8&&s.time-c.lastLimit>5){c.lastLimit=s.time;c.warnings++;if(c.warnings%3===0)c.penalty+=5;event(s,'limits',team,`TRACK LIMITS · warning ${c.warnings}${c.warnings%3===0?' / +5s':''}`);}
  for(let i=0;i<DRS_ZONES.length;i++)if(crossed(before,c.distance,DRS_ZONES[i].detection)){const delta=wake.distance-c.distance;c.eligible[i]=delta>0&&delta/Math.max(wake.speed,25)<=1&&(wake!==rival||rival.pit==='none');}
  const lap=Math.max(0,Math.floor(c.distance/LENGTH));
  const sec=wrap(c.distance)<SECTORS[1]?0:wrap(c.distance)<SECTORS[2]?1:2;
  if(sec!==c.sector&&c.distance>0){const split=s.time-c.sectorStart,old=c.bestSectors[c.sector],rivalBest=rival.bestSectors[c.sector];c.splits[c.sector]=split;c.splitColours[c.sector]=(!old||split<old)&&(!rivalBest||split<rivalBest)?'purple':!old||split<=old?'green':'yellow';c.bestSectors[c.sector]=old?Math.min(old,split):split;c.sectorStart=s.time;c.sector=sec;}
  if(lap>c.lap){const time=s.time-c.lapStart;c.lastLap=time;c.lapTimes.push(time);c.bestLap=c.bestLap?Math.min(time,c.bestLap):time;c.lapStart=s.time;c.lap=lap;c.ersUsed=0;c.ersRecovered=0;
   if(!s.fastest||time<s.fastest.time)s.fastest={team,time};event(s,'lap',team,`LAP ${lap} · ${time.toFixed(3)}s`);
   if(lap>=s.laps){c.finishTime=s.time+c.penalty;event(s,'finish',team,'CHEQUERED FLAG');}
  }
 }
 // Prevent passing through a rival on the same line: fast intent must pick a side.
 const a=s.cars.a,b=s.cars.b;if(a.pit==='none'&&b.pit==='none'&&a.finishTime===null&&b.finishTime===null&&Math.abs(a.distance-b.distance)<5&&Math.abs(a.offset-b.offset)<1.75){const behind=prior.a.distance<prior.b.distance?a:b,ahead=behind===a?b:a;behind.distance=Math.min(behind.distance,ahead.distance-5);behind.speed=Math.min(behind.speed,ahead.speed);}
 if(s.tick%4===0&&s.field.length)advanceField(s,track,4*DT);
 const leader=a.distance>=b.distance?'a':'b';if(leader!==s.leader){s.leader=leader;event(s,'overtake',leader,`${playerEntry(leader).name.toUpperCase()} LEADS THE PLAYER DUEL`);}
 if(a.finishTime!==null&&b.finishTime!==null&&s.field.every(c=>c.finishTime!==null)){s.phase='finished';const first=classification(s)[0].entry;s.winner=first.seat??first.code;}
}
