import {ARCHIVE_WINDOW_NS,isArchiveReplay,type ReplayDriver,type ReplayPoint,type ReplayTiming} from '../src/race/replay';
import type {Compound} from '../src/race/types';

const base='https://f1archive.org/api/v1/sessions/';
const NS_PER_MS=1_000_000;
const NS_PER_SECOND=1_000_000_000;
interface ArchiveSession {
 key:string;year:number;event_name:string;circuit:string;start_utc:string;stream_start_utc?:string;
 total_laps:number;has_telemetry:boolean;status:string;
 drivers:{number:string;abbreviation:string;full_name:string;team_name:string;team_colour:string}[];
}
interface ArchiveLap {
 driver:string;lap:number;start_ns:number|null;end_ns:number|null;lap_time_ns:number|null;
 s1_ns:number|null;s2_ns:number|null;s3_ns:number|null;pit_in_ns:number|null;pit_out_ns:number|null;
 compound:string|null;tyre_age:number|null;position:number|null;
}
type ArchiveResult={driver_number:string;position:number|null;position_text:string;grid_position:number|null;laps:number|null;status:string};
type ArchiveControl={ts_ns:number;message:string;flag:string;scope:string;category:string;driver_number:string};
type ArchiveWeather={ts_ns:number;rainfall:boolean;air_temp_c:number|null;track_temp_c:number|null};
type ArchiveIntervals={drivers:Record<string,IntervalSeries>};
type IntervalSeries={ts_ns:number[];position:(number|null)[];gap_to_leader:string[];gap_to_car_ahead:string[]};
type Interval=ReplayDriver['gaps'][number][1];
type Fetcher=(url:string)=>Promise<Response>;
const tyres=new Set(['soft','medium','hard','intermediate','wet']);
const compound=(value:string|null)=>value&&tyres.has(value.toLowerCase())?value.toLowerCase() as Compound:null;
const seconds=(ns:number|null)=>ns===null?null:ns/NS_PER_SECOND;
const interval=(raw:string|undefined):Interval=>!raw?null:Number.isFinite(Number(raw))?Number(raw):raw;

function sessionURL(id:string){
 if(!isArchiveReplay(id))throw new Error('Invalid archived race ID.');
 return base+id.slice(0,4)+'/'+id.slice(5,-5)+'/race';
}

const fetchArchive:Fetcher=url=>fetch(url,{redirect:'error',signal:AbortSignal.timeout(22_000)});
async function data<T>(url:string,fetcher:Fetcher){
 const response=await fetcher(url);
 if(!response.ok)throw new Error('The race archive returned HTTP '+response.status+'.');
 return response.json() as Promise<T>;
}

function raceStart(session:ArchiveSession,laps:ArchiveLap[]){
 const starts=laps.filter(lap=>lap.lap===1&&lap.start_ns!==null&&lap.start_ns>=0)
  .map(lap=>lap.start_ns!).sort((a,b)=>a-b);
 if(starts.length)return starts[starts.length>>>1];
 return Math.max(0,(Date.parse(session.start_utc)-Date.parse(session.stream_start_utc??session.start_utc))*NS_PER_MS);
}

async function loadTiming(id:string,fetcher:Fetcher):Promise<ReplayTiming>{
 const url=sessionURL(id);
 const [session,allLaps,results,weather,control,intervals]=await Promise.all([
  data<ArchiveSession>(url,fetcher),
  data<ArchiveLap[]>(url+'/laps',fetcher),
  data<ArchiveResult[]>(url+'/results',fetcher),
  data<ArchiveWeather[]>(url+'/weather',fetcher).catch(()=>[]),
  data<ArchiveControl[]>(url+'/race-control',fetcher).catch(()=>[]),
  data<ArchiveIntervals>(url+'/intervals',fetcher).catch(():ArchiveIntervals=>({drivers:{}})),
 ]);
 if(session.status!=='archived'||!session.has_telemetry||!results.length)throw new Error('This race is unavailable in the archive.');
 const driverLaps=new Map<string,ArchiveLap[]>();
 for(const lap of allLaps){
  const laps=driverLaps.get(lap.driver)??[];
  laps.push(lap);
  driverLaps.set(lap.driver,laps);
 }
 // The unfiltered endpoint caps the response at 1,000 lap records.
 if(allLaps.length>=1000){
  const truncated=results.filter(result=>(result.laps??0)>1&&!driverLaps.get(result.driver_number)?.some(lap=>lap.lap>=result.laps!));
  await Promise.all(truncated.map(async({driver_number})=>{
   const laps=await data<ArchiveLap[]>(url+'/laps?driver='+encodeURIComponent(driver_number),fetcher);
   driverLaps.set(driver_number,laps);
  }));
 }
 const start=raceStart(session,[...driverLaps.values()].flat());
 const ms=(ns:number)=>Math.round((ns-start)/NS_PER_MS);
 const resultsByNumber=new Map(results.map(result=>[result.driver_number,result]));
 const winnerRows=driverLaps.get(results.find(result=>result.position===1)?.driver_number??'')??[];
 const winnerFinish=Math.max(0,...winnerRows.map(lap=>lap.end_ns??0));
 const drivers:ReplayDriver[]=[];
 for(const source of session.drivers){
  const result=resultsByNumber.get(source.number);
  const rows=(driverLaps.get(source.number)??[]).filter(lap=>lap.start_ns!==null).sort((a,b)=>a.lap-b.lap);
  if(!rows.length)continue;
  const laps:ReplayDriver['laps']=rows.map(lap=>[Math.max(0,ms(lap.start_ns!)),lap.lap,seconds(lap.lap_time_ns),
   [seconds(lap.s1_ns),seconds(lap.s2_ns),seconds(lap.s3_ns)]]);
  const pits:ReplayDriver['pits']=[];
  const stints:ReplayDriver['stints']=[];
  let lastCompound:Compound|null=null;
  for(const [index,lap] of rows.entries()){
   const entry=lap.pit_in_ns,next=rows[index+1];
   if(entry!==null&&entry>=start){
    const exit=next?.pit_out_ns??lap.end_ns??entry;
    pits.push([ms(entry),ms(Math.max(entry,exit)),lap.lap]);
   }
   const current=compound(lap.compound);
   const changedAt=index===0?0:lap.pit_out_ns??lap.start_ns!;
   if(current&&(stints.length===0||current!==lastCompound||(index>0&&lap.pit_out_ns!==null))){
    stints.push([index===0?0:Math.max(0,ms(changedAt)),lap.lap,current,lap.tyre_age]);
    lastCompound=current;
   }
  }
  const series=intervals.drivers[source.number];
  const positions:ReplayDriver['positions']=result?.grid_position?[[-1,result.grid_position]]:[];
  const gaps:ReplayDriver['gaps']=[];
  let lead:Interval=null,ahead:Interval=null;
  for(const [index,ns] of (series?.ts_ns??[]).entries()){
   const time=ms(ns);
   if(time<0)continue;
   const place=series.position[index];
   if(place&&positions.at(-1)?.[1]!==place)positions.push([time,place]);
   const nextLead:Interval=interval(series.gap_to_leader[index])??lead;
   const nextAhead:Interval=interval(series.gap_to_car_ahead[index])??ahead;
   if(lead!==nextLead||ahead!==nextAhead){lead=nextLead;ahead=nextAhead;gaps.push([time,ahead,lead]);}
  }
  if(!series?.ts_ns.length){
   for(const lap of rows)if(lap.position&&lap.end_ns!==null)positions.push([ms(lap.end_ns),lap.position]);
  }
  const last=rows.at(-1)!;
  const finishNs=last.end_ns??last.start_ns!+(last.lap_time_ns??0);
  const raceStatus=result?.status.trim()??'';
  const out=raceStatus?!(/^(Finished|\+\s*\d+\s*Laps?)$/i.test(raceStatus))
   :!result?.position||(/^[A-Z]+$/i.test(result.position_text))||finishNs<winnerFinish-125*NS_PER_SECOND;
  const retired=out?control.find(row=>row.driver_number===source.number&&row.ts_ns>=last.start_ns!&&/RETIRED|STOPPED/.test(row.message)):undefined;
  drivers.push({
   number:Number(source.number),code:source.abbreviation,name:source.full_name,team:source.team_name,
   color:/^#?[0-9a-f]{6}$/i.test(source.team_colour)?'#'+source.team_colour.slice(-6):'#a0a0a0',
   laps,stints:stints.sort((a,b)=>a[0]-b[0]),pits:pits.sort((a,b)=>a[0]-b[0]),gaps,positions,
   end:Math.max(0,ms(retired?.ts_ns??finishNs)),out,finish:result?.position??null,
  });
 }
 const duration=Math.max(...drivers.map(driver=>driver.end));
 if(!Number.isFinite(duration)||duration<60_000)throw new Error('This race has insufficient timing data.');
 return {
  id,name:session.event_name,circuit:session.circuit,year:session.year,date:session.start_utc.slice(0,10),
  archiveStartNs:start,duration,drivers,laps:session.total_laps||Math.max(...drivers.map(driver=>driver.laps.at(-1)![1])),
  control:control.filter(row=>row.ts_ns>=start).map(row=>[ms(row.ts_ns),row.message,row.flag||null,row.scope||null,row.category]).sort((a,b)=>Number(a[0])-Number(b[0])) as ReplayTiming['control'],
  weather:weather.filter(row=>row.ts_ns>=start-120*NS_PER_SECOND).map(row=>[ms(row.ts_ns),row.rainfall,row.air_temp_c,row.track_temp_c]).sort((a,b)=>Number(a[0])-Number(b[0])) as ReplayTiming['weather'],
 };
}

const timings=new Map<string,Promise<ReplayTiming>>();
export function archivedTiming(id:string){
 const cached=timings.get(id);
 if(cached){timings.delete(id);timings.set(id,cached);return cached;}
 const pending=loadTiming(id,fetchArchive).catch(error=>{if(timings.get(id)===pending)timings.delete(id);throw error;});
 timings.set(id,pending);
 if(timings.size>8)timings.delete(timings.keys().next().value!);
 return pending;
}

export function archiveRequest(path:string){
 const match=path.match(/^\/api\/replays\/([^/]+)\/(timing|track|positions|telemetry)$/);
 if(!match||!isArchiveReplay(match[1]))return null;
 return {id:match[1],kind:match[2]};
}

const archiveHeaders={'Cache-Control':'public, max-age=86400'};
export async function serveArchive(request:URL,route:NonNullable<ReturnType<typeof archiveRequest>>){
 try{
  const {id,kind}=route,url=sessionURL(id);
  if(kind==='timing')return Response.json(await archivedTiming(id),{headers:archiveHeaders});
  if(kind==='track'){
   const track=await data<{x:number[];y:number[]}>(url+'/track',fetchArchive);
   const points:ReplayPoint[]=track.x.map((x,index)=>[x,track.y[index],0]);
   if(points.length>=3)return Response.json(points,{headers:archiveHeaders});
   return Response.json([], {headers:archiveHeaders});
  }
  const slice=Number(request.searchParams.get('slice'));
  const driver=request.searchParams.get('driver');
  if(!request.searchParams.has('slice')||!Number.isInteger(slice)||slice<0||slice>=360||
    (kind==='telemetry'&&(!driver||!/^\d{1,5}$/.test(driver))))return Response.json({error:'Invalid telemetry window.'},{status:400});
  const search=new URLSearchParams({from_ns:String(slice*ARCHIVE_WINDOW_NS),to_ns:String((slice+1)*ARCHIVE_WINDOW_NS)});
  if(kind==='telemetry'){
   search.set('drivers',driver!);
   search.set('channels','speed,gear,throttle,brake');
  }
  const response=await fetchArchive(url+'/'+kind+'?'+search);
  if(!response.ok)throw new Error('The telemetry archive returned HTTP '+response.status+'.');
  return new Response(response.body,{headers:{...archiveHeaders,'Content-Type':'application/json'}});
 }catch{
  return Response.json({error:'The race archive is unavailable. Try loading this race again.'},{status:502});
 }
}
