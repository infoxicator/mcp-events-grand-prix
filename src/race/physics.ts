import { LENGTH,wrap,curvatureAt,CORNERS,SECTORS,DRS_ZONES,inZone,isDrsZone,PIT_ENTRY,PIT_STOP,PIT_EXIT,PIT_LIMIT,PIT_STOP_SECONDS,SPEED_TRAP } from './track';
import { TEAMS,type Team,type Race,type Car,type Instruction,type DriverIntent,type Compound } from './types';
export const DT=1/120;
export const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export const other=(t:Team):Team=>t==='a'?'b':'a';
export const defaultInstruction=():Instruction=>({pace:'balanced',ers:'balanced',box:false,tyre:'medium',tactic:'hold',line:'Bring the tyres in. Build the rhythm.'});
export const defaultIntent=():DriverIntent=>({offset:0,speedBias:0,brakeAggression:.5,side:'hold',ers:false,drs:true,reply:'Radio check. Ready to race.'});
const TYRES={soft:{grip:1.08,wear:.000105},medium:{grip:1,wear:.000068},hard:{grip:.96,wear:.000044}};
export function createRace(laps=3):Race {
 const car=(team:Team):Car=>({team,distance:team==='a'?0:-12,speed:0,speedTrap:0,gear:1,throttle:0,brake:0,offset:team==='a'?-2:2,steering:0,ers:90,drs:false,eligible:[false,false],compound:team==='a'?'soft':'medium',wear:0,temperature:85,fuel:34,pit:'none',pitTime:0,stops:0,tyreAge:0,warnings:0,penalty:0,lap:0,lapStart:0,lastLap:0,bestLap:0,lapTimes:[],sector:0,sectorStart:0,splits:[],bestSectors:[0,0,0],splitColours:['yellow','yellow','yellow'],finishTime:null,intent:defaultIntent(),instruction:defaultInstruction(),lastLimit:-100});
 return {tick:0,time:0,phase:'lobby',countdown:5,laps,cars:{a:car('a'),b:car('b')},events:[],radio:[],leader:'a',fastest:null,winner:null};
}
export function event(s:Race,kind:Race['events'][number]['kind'],team:Team,message:string){s.events.push({id:Math.max(s.tick*100,(s.events.at(-1)?.id??0)+1),time:s.time,kind,team,message});if(s.events.length>40)s.events.shift();}
export function grip(c:Car){const thermal=1-Math.min(.2,Math.abs(c.temperature-95)*.002);return TYRES[c.compound].grip*(1-c.wear*.37)*thermal;}
export function aero(c:Car,rival:Car){const gap=rival.distance-c.distance,aligned=Math.abs(c.offset-rival.offset)<2.6;return {slipstream:gap>4&&gap<75&&aligned?(1-gap/85)*5.5:0,dirtyAir:gap>3&&gap<38&&aligned?.12*(1-gap/40):0};}
export function drsAllowed(c:Car){return c.pit==='none'&&c.eligible.some((ok,i)=>ok&&inZone(c.distance,DRS_ZONES[i].start,DRS_ZONES[i].end))&&isDrsZone(c.distance)&&c.brake<.1;}
function crossed(before:number,after:number,mark:number){return Math.floor((before-mark)/LENGTH)<Math.floor((after-mark)/LENGTH);}
export function racingSpeed(c:Car,rival:Car){
 const g=grip(c),air=aero(c,rival);let limit=94;
 for(let ahead=0;ahead<=300;ahead+=20){const d=c.distance+ahead;let curve=Math.min(94,Math.sqrt(38*g*(1-air.dirtyAir)/Math.max(.003,curvatureAt(d))));
  for(const corner of CORNERS){const delta=Math.abs(wrap(d-corner.d+LENGTH/2)-LENGTH/2);if(delta<65)curve=Math.min(curve,corner.speed*Math.sqrt(g)*(1-air.dirtyAir));}
  // v² = u² + 2as: look ahead before the actual corner.
  limit=Math.min(limit,Math.sqrt(curve*curve+2*(19+c.intent.brakeAggression*3)*ahead));
 }
 return limit;
}
export function stepRace(s:Race){
 s.tick++;
 if(s.phase==='lobby'||s.phase==='finished')return;
 if(s.phase==='lights'){s.countdown-=DT;if(s.countdown<=0){s.phase='racing';s.countdown=0;event(s,'start','a','LIGHTS OUT — LET THEM RACE');}return;}
 s.time+=DT;
 // Read a stable pair to prevent team iteration order influencing aerodynamics.
 const prior=structuredClone(s.cars);
 for(const team of TEAMS){const c=s.cars[team],rival=prior[other(team)];if(c.finishTime!==null)continue;
  const before=c.distance;
  if(c.pit==='stopped'){
   c.pitTime+=DT;c.speed=0;c.throttle=0;c.brake=1;c.drs=false;
   if(c.pitTime+1e-8>=PIT_STOP_SECONDS){c.compound=c.instruction.tyre;c.wear=0;c.temperature=75;c.tyreAge=0;c.stops++;c.instruction.box=false;c.pit='exit';event(s,'pit',team,`${team.toUpperCase()} · ${PIT_STOP_SECONDS.toFixed(1)}s STOP · ${c.compound.toUpperCase()}`);}continue;
  }
  const air=aero(c,rival),mode=c.instruction.pace;
  c.drs=c.intent.drs&&drsAllowed(c)&&s.time>20;
  const deploying=c.intent.ers&&c.ers>1&&c.instruction.ers!=='harvest';
  let target=racingSpeed(c,rival)+(mode==='push'?2.5:mode==='manage'?-4:0)+c.intent.speedBias+air.slipstream+(c.drs?7:0)+(deploying?3:0)-(c.fuel/34)*1.8;
  if(c.wear>.65)target-=Math.pow((c.wear-.65)*30,1.25);
  if(c.pit!=='none')target=Math.min(target,PIT_LIMIT);
  // Brake for pit entry before crossing the line.
  const toEntry=wrap(PIT_ENTRY-c.distance);if(c.instruction.box&&c.pit==='none'&&toEntry<240)target=Math.min(target,Math.sqrt(PIT_LIMIT**2+2*22*toEntry));
  const dv=target-c.speed,accel=dv>0?Math.min(12*(1-c.speed/130),dv*2):Math.max(-24,dv*3);
  c.throttle=dv>0?clamp(accel/8,0,1):0;c.brake=dv<0?clamp(-accel/24,0,1):0;
  c.speed=clamp(c.speed+accel*DT,0,c.pit==='none'?102:PIT_LIMIT);
  c.distance+=c.speed*DT;
  const desired=clamp(c.intent.offset,-12,12);c.offset+=clamp(desired-c.offset,-3*DT,3*DT);c.steering=curvatureAt(c.distance)*12+clamp(desired-c.offset,-1,1)*.1;
  c.gear=clamp(Math.floor(c.speed/12)+1,1,8);
  c.ers=clamp(c.ers+(deploying?-1.6:c.brake>.1?2.3:c.instruction.ers==='harvest'?1.2:.25)*DT,0,100);
  if(crossed(before,c.distance,SPEED_TRAP))c.speedTrap=c.speed*3.6;
  const travelled=c.distance-before;c.wear=clamp(c.wear+travelled*TYRES[c.compound].wear*(mode==='manage'?.68:mode==='push'?1.2:1),0,1);
  c.tyreAge+=travelled/LENGTH;c.temperature+=(92+c.throttle*12+c.brake*18-(mode==='manage'?9:0)-c.temperature)*DT*.08;
  c.fuel=Math.max(0,c.fuel-travelled*.0017);
  if(c.instruction.box&&c.pit==='none'&&crossed(before,c.distance,PIT_ENTRY)){c.pit='entry';event(s,'pit',team,'BOX BOX · pit limiter on');}
  if(c.pit==='entry'&&crossed(before,c.distance,PIT_STOP)){c.distance=Math.floor((c.distance-PIT_STOP)/LENGTH)*LENGTH+PIT_STOP;c.pit='stopped';c.pitTime=0;c.speed=0;}
  if(c.pit==='exit'&&crossed(before,c.distance,PIT_EXIT)){c.pit='none';event(s,'pit',team,'Pit exit clear. Push now.');}
  if(Math.abs(c.offset)>9.5&&s.time-c.lastLimit>5){c.lastLimit=s.time;c.warnings++;if(c.warnings%3===0)c.penalty+=5;event(s,'limits',team,`TRACK LIMITS · warning ${c.warnings}${c.warnings%3===0?' / +5s':''}`);}
  for(let i=0;i<DRS_ZONES.length;i++)if(crossed(before,c.distance,DRS_ZONES[i].detection)){const delta=rival.distance-c.distance;c.eligible[i]=delta>0&&delta/Math.max(rival.speed,25)<=1&&rival.pit==='none';}
  const lap=Math.max(0,Math.floor(c.distance/LENGTH));
  const sec=wrap(c.distance)<SECTORS[1]?0:wrap(c.distance)<SECTORS[2]?1:2;
  if(sec!==c.sector&&c.distance>0){const split=s.time-c.sectorStart,old=c.bestSectors[c.sector],rivalBest=rival.bestSectors[c.sector];c.splits[c.sector]=split;c.splitColours[c.sector]=(!old||split<old)&&(!rivalBest||split<rivalBest)?'purple':!old||split<=old?'green':'yellow';c.bestSectors[c.sector]=old?Math.min(old,split):split;c.sectorStart=s.time;c.sector=sec;}
  if(lap>c.lap){const time=s.time-c.lapStart;c.lastLap=time;c.lapTimes.push(time);c.bestLap=c.bestLap?Math.min(time,c.bestLap):time;c.lapStart=s.time;c.lap=lap;
   if(!s.fastest||time<s.fastest.time)s.fastest={team,time};event(s,'lap',team,`LAP ${lap} · ${time.toFixed(3)}s`);
   if(lap>=s.laps){c.finishTime=s.time+c.penalty;event(s,'finish',team,'CHEQUERED FLAG');}
  }
 }
 // Prevent passing through a rival on the same line: fast intent must pick a side.
 const a=s.cars.a,b=s.cars.b;if(a.pit==='none'&&b.pit==='none'&&a.finishTime===null&&b.finishTime===null&&Math.abs(a.distance-b.distance)<5&&Math.abs(a.offset-b.offset)<1.75){const behind=prior.a.distance<prior.b.distance?a:b,ahead=behind===a?b:a;behind.distance=Math.min(behind.distance,ahead.distance-5);behind.speed=Math.min(behind.speed,ahead.speed);}
 const leader=a.distance>=b.distance?'a':'b';if(leader!==s.leader){s.leader=leader;event(s,'overtake',leader,`${leader==='a'?'VECTOR':'CHAOS'} TAKES THE LEAD`);}
 if(TEAMS.every(t=>s.cars[t].finishTime!==null)){s.phase='finished';s.winner=(a.finishTime??Infinity)<=(b.finishTime??Infinity)?'a':'b';}
}
