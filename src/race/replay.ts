import type {Compound} from './types';

export interface ReplayRace {
 id:string;
 name:string;
 circuit:string;
 year:number;
 laps?:number;
 date:string;
}

type Lap = [ms:number,lap:number,seconds:number|null,sectors:[number|null,number|null,number|null]];
type Stint = [ms:number,lap:number,compound:Compound|null,age:number|null];
type Pit = [entryMs:number,exitMs:number,lap:number];
type Interval = number|string|null;
type Control = [ms:number,message:string,flag:string|null,scope:string|null,category:string];
type Weather = [ms:number,rain:boolean,airC:number|null,trackC:number|null];
export interface ReplayDriver {
 number:number;
 code:string;
 name:string;
 team:string;
 color:string;
 laps:Lap[];
 stints:Stint[];
 pits:Pit[];
 positions:[ms:number,place:number][];
 gaps:[ms:number,interval:Interval,leader:Interval][];
 end:number;
 out:boolean;
 finish:number|null;
}

export interface ReplayTiming extends ReplayRace {
 laps:number;
 archiveStartNs?:number;
 duration:number;
 drivers:ReplayDriver[];
 control:Control[];
 weather:Weather[];
}

export type ReplayPoint=[x:number,y:number,z:number];
export interface ReplayPositions {
 step:number;
 track:ReplayPoint[];
 cars:Record<string,number[]>;
 telemetry:Record<string,number[]>;
}

export const isArchiveReplay=(id:unknown):id is string=>typeof id==='string'&&/^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*-race$/.test(id)&&id.length<=95;
export const isReplayId=(id:unknown):id is string=>typeof id==='string'&&(/^\d{1,10}$/.test(id)||isArchiveReplay(id));
export const ARCHIVE_WINDOW_NS=120_000_000_000;
export function replayCatalog(bundled:ReplayRace[],archive:ReplayRace[]){
 const local=new Set(bundled.map(race=>race.year+':'+race.name));
 return [...bundled,...archive.filter(race=>!local.has(race.year+':'+race.name))].sort((a,b)=>b.date.localeCompare(a.date));
}
export const replayRaceName=(race:ReplayRace)=>race.year+' '+race.name;

export function replayAt<T extends readonly [number,...unknown[]]>(items:readonly T[],time:number){
 let lo=0,hi=items.length;
 while(lo<hi){
  const mid=(lo+hi)>>>1;
  if(items[mid][0]<=time)lo=mid+1;
  else hi=mid;
 }
 return lo-1;
}

export function replayPoint(positions:ReplayPositions,number:number,time:number):ReplayPoint|null{
 const samples=positions.cars[number];
 if(!samples?.length)return null;
 const sample=Math.max(0,time)/positions.step;
 const low=Math.min(Math.floor(sample)*3,samples.length-3),high=Math.min(low+3,samples.length-3);
 const blend=sample%1;
 const part=(axis:number)=>samples[low+axis]+(samples[high+axis]-samples[low+axis])*blend;
 return [part(0),part(1),part(2)];
}

export function replayCarTelemetry(positions:ReplayPositions,number:number,time:number){
 const samples=positions.telemetry?.[number];
 const index=Math.max(0,Math.floor(time/1000))*4;
 if(!samples||index>=samples.length||samples[index]<0)return null;
 return {speed:samples[index],gear:samples[index+1],throttle:samples[index+2],brake:samples[index+3]};
}

export function replayDriverAt(driver:ReplayDriver,time:number){
 const lapIndex=replayAt(driver.laps,time);
 const lap=driver.laps[lapIndex]?.[1]??1,previous=driver.laps[lapIndex-(time>=driver.end&&!driver.out?0:1)];
 const stint=driver.stints[replayAt(driver.stints,time)];
 const pitIndex=replayAt(driver.pits,time);
 const pit=driver.pits[pitIndex];
 const gaps=driver.gaps[replayAt(driver.gaps,time)];
 return {
  number:driver.number,code:driver.code,name:driver.name,team:driver.team,
  lap,position:(!driver.out&&time>=driver.end?driver.finish:null)??driver.positions[replayAt(driver.positions,time)]?.[1]??null,
  interval:gaps?.[1]??null,gapToLeader:gaps?.[2]??null,
  compound:stint?.[2]??null,tyreAge:stint?.[3]==null?null:stint[3]+Math.max(0,lap-stint[1]),
  stops:pitIndex+1,inPit:Boolean(pit&&time<pit[1]),
  lastLap:previous?.[2]??null,sectors:previous?.[3]??null,
  status:time<driver.end?'running' as const:driver.out?'out' as const:'finished' as const,
 };
}

export function replayStandings(race:ReplayTiming,time:number){
 return race.drivers.map(driver=>replayDriverAt(driver,time)).sort((a,b)=>{
  if((a.status==='out')!==(b.status==='out'))return a.status==='out'?1:-1;
  return (a.position??Infinity)-(b.position??Infinity)||a.number-b.number;
 });
}

export function replayWeather(race:ReplayTiming,time:number){
 const sample=race.weather[replayAt(race.weather,time)];
 return sample?{rain:sample[1],airC:sample[2],trackC:sample[3]}:null;
}

function controlFlag([,message,flag,scope,category]:Control){
 if(category==='SafetyCar'){
  if(message.includes('DEPLOYED'))return message.includes('VIRTUAL')?'Virtual safety car':'Safety car';
  if(message.includes('IN THIS LAP')||message.includes('ENDING'))return 'Safety car ending';
 }
 if(category==='SessionStatus'&&message==='SESSION STARTED')return 'Green';
 if(scope!=='Track')return null;
 return flag==='GREEN'?'Green':flag==='RED'?'Red flag':flag==='CHEQUERED'?'Chequered':null;
}

export function replayFlag(race:ReplayTiming,time:number){
 for(let i=replayAt(race.control,time);i>=0;i--){
  const flag=controlFlag(race.control[i]);
  if(flag)return flag;
 }
 return 'Green';
}

export interface ReplayDecision {
 time:number;
 lap:number;
 reasons:string[];
}

export function replayDecisions(race:ReplayTiming,driver:ReplayDriver){
 const candidates:ReplayDecision[]=[];
 const add=(time:number,reason:string)=>{
  const index=replayAt(driver.laps,time);
  const lap=driver.laps[index]?.[1];
  if(!lap||lap<2||time>=driver.end||replayDriverAt(driver,time).inPit)return;
  candidates.push({time,lap,reasons:[reason]});
 };
 for(const [index,[start,lap]] of driver.laps.entries()){
  if(lap>=3&&(lap-3)%4===0)add(start+12_000,'Scheduled pit strategy check');
  const compound=replayDriverAt(driver,start).compound;
  if(compound==='intermediate'||compound==='wet'){
   const last=driver.laps[index-1]?.[2],before=driver.laps[index-2]?.[2],baseline=driver.laps[index-3]?.[2];
   if(last&&before&&baseline&&last<before&&before<baseline&&baseline-last>=2){
    add(start+5000,'Recent lap times are improving on wet tyres');
   }
  }
 }
 for(const [index,weather] of race.weather.entries()){
  if(index&&weather[0]>=0&&weather[1]!==race.weather[index-1][1]){
   add(weather[0],weather[1]?'Rain detected':'Rainfall ceased');
  }
 }
 for(const control of race.control){
  const flag=controlFlag(control);
  if(flag==='Safety car'||flag==='Virtual safety car'||flag==='Safety car ending')add(control[0],flag);
 }
 // Keep checkpoints independent of the selected driver's future pit decisions.
 for(const rival of race.drivers){
  if(rival===driver)continue;
  for(const [entry] of rival.pits){
   const ours=replayDriverAt(driver,entry),theirs=replayDriverAt(rival,entry);
   if(ours.position!==null&&theirs.position!==null&&Math.abs(ours.position-theirs.position)<=2){
    add(entry,`${rival.code} entered the pits`);
   }
  }
 }
 const decisions:ReplayDecision[]=[];
 for(const candidate of candidates.sort((a,b)=>a.time-b.time)){
  const last=decisions.at(-1);
  if(last?.lap===candidate.lap){
   // Events later in the lap belong to their own observation.
   if(last.time===candidate.time)last.reasons.push(...candidate.reasons);
   else if(candidate.time-last.time>=24_000&&candidate.reasons.some(reason=>/rain|safety car/i.test(reason)))decisions.push(candidate);
  }else if(!last||candidate.time-last.time>=10_000)decisions.push(candidate);
 }
 return decisions;
}

export function replayObservation(race:ReplayTiming,driver:ReplayDriver,decision:ReplayDecision){
 const {time,lap}=decision;
 return {
  race:replayRaceName(race),circuit:race.circuit,timeMs:time,lapsRemaining:race.laps-lap,
  driver:replayDriverAt(driver,time),weather:replayWeather(race,time),flag:replayFlag(race,time),
  raceControl:race.control.slice(0,replayAt(race.control,time)+1).slice(-4).map(([ms,message])=>({ms,message})),
  standings:replayStandings(race,time),
  recentLaps:driver.laps.slice(0,replayAt(driver.laps,time)).slice(-4)
   .map(([,lap,seconds,sectors])=>({lap,seconds,sectors})),
 };
}

export type ReplayObservation=ReturnType<typeof replayObservation>;

export function replayHistoricalCall(driver:ReplayDriver,decision:ReplayDecision){
 const stop=driver.pits.find(([ms,,lap])=>ms>=decision.time&&lap===decision.lap);
 const compound=stop?driver.stints.find(([ms])=>ms===stop[1])?.[2]??null:null;
 return {action:stop?'box' as const:'stay-out' as const,compound};
}
