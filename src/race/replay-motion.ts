import {ARCHIVE_WINDOW_NS,replayCarTelemetry,replayPoint,type ReplayPoint,type ReplayPositions,type ReplayTiming} from './replay';

export interface ReplayMotion {
 track:ReplayPoint[];
 point(number:number,time:number):ReplayPoint|null;
 telemetry(number:number,time:number):ReturnType<typeof replayCarTelemetry>;
 prepare(time:number,number:number):void;
 dispose():void;
 loading(time:number):string;
}

export function bundledMotion(data:ReplayPositions):ReplayMotion{
 return {
  track:data.track,point:(number,time)=>replayPoint(data,number,time),
  telemetry:(number,time)=>replayCarTelemetry(data,number,time),
  prepare:()=>{},dispose:()=>{},loading:()=>'',
 };
}

type PositionSeries={ts_ns:number[];x:(number|null)[];y:(number|null)[]};
type TelemetrySeries={ts_ns:number[];speed:(number|null)[];gear:(number|null)[];throttle:(number|null)[];brake:(number|null)[]};
type Window<T>={drivers:Record<string,T>};
type Entry<T>={data?:T;retryAt?:number};
const NS_PER_MS=1_000_000;
const NS_PER_SECOND=1_000_000_000;

function findSample(times:number[],time:number){
 let lo=0,hi=times.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(times[mid]<=time)lo=mid+1;else hi=mid;}
 return lo-1;
}

async function get<T>(url:string,signal:AbortSignal){
 const response=await fetch(url,{signal});
 if(!response.ok)throw new Error('Recorded telemetry is unavailable.');
 return response.json() as Promise<T>;
}

export async function archiveMotion(race:ReplayTiming,signal:AbortSignal,redraw:()=>void):Promise<ReplayMotion>{
 const start=race.archiveStartNs!;
 const base='/api/replays/'+encodeURIComponent(race.id)+'/';
 const controller=new AbortController(),active=AbortSignal.any([signal,controller.signal]);
 const track=await get<ReplayPoint[]>(base+'track',active).catch(()=>[]);
 const positions=new Map<number,Entry<Window<PositionSeries>>>();
 const telemetry=new Map<string,Entry<Window<TelemetrySeries>>>();
 const stamp=(time:number)=>start+Math.round(time*NS_PER_MS);
 const windowIndex=(time:number)=>Math.floor(stamp(time)/ARCHIVE_WINDOW_NS);

 function load<K,T>(cache:Map<K,Entry<T>>,key:K,url:string){
  const current=cache.get(key);
  if(current&&(!current.retryAt||current.retryAt>Date.now()))return;
  const pending:Entry<T>={};
  cache.delete(key);cache.set(key,pending);
  if(cache.size>6)cache.delete(cache.keys().next().value!);
  void get<T>(base+url,active).then(data=>{pending.data=data;}).catch(()=>{pending.retryAt=Date.now()+5000;})
   .finally(()=>{if(!active.aborted)redraw();});
 }
 function positionSlice(slice:number){
  load(positions,slice,'positions?slice='+slice);
 }
 function telemetrySlice(slice:number,number:number){
  load(telemetry,slice+':'+number,'telemetry?slice='+slice+'&driver='+number);
 }
 function series<K,T>(cache:Map<K,Entry<Window<T>>>,key:K,number:number){
  return cache.get(key)?.data?.drivers[number];
 }
 function point(number:number,time:number):ReplayPoint|null{
  const now=stamp(time),slice=windowIndex(time);
  const data=series(positions,slice,number);
  if(!data?.ts_ns.length)return null;
  const index=Math.max(0,findSample(data.ts_ns,now)),right=Math.min(index+1,data.ts_ns.length-1);
  const x=data.x[index],y=data.y[index],tx=data.x[right],ty=data.y[right];
  if(x===null||y===null||!Number.isFinite(x)||!Number.isFinite(y)||(x===0&&y===0)||Math.abs(now-data.ts_ns[index])>3*NS_PER_SECOND)return null;
  const span=data.ts_ns[right]-data.ts_ns[index];
  const f=span>0&&span<2*NS_PER_SECOND?Math.max(0,(now-data.ts_ns[index])/span):0;
  return [tx===null?x:x+(tx-x)*f,ty===null?y:y+(ty-y)*f,0];
 }

 // When an outline is absent, retain the archived timing and car telemetry.
 return {
  track,point,
  telemetry(number,time){
   const now=stamp(time),slice=windowIndex(time);
   const data=series(telemetry,slice+':'+number,number);
   if(!data?.ts_ns.length)return null;
   const i=Math.max(0,findSample(data.ts_ns,now)),speed=data.speed[i];
   if(speed===null||!Number.isFinite(speed)||Math.abs(data.ts_ns[i]-now)>3*NS_PER_SECOND)return null;
   return {speed,gear:data.gear[i]??0,throttle:data.throttle[i]??0,brake:data.brake[i]??0};
  },
  prepare(time,number){
   const slice=windowIndex(time);
   if(track.length)positionSlice(slice);
   telemetrySlice(slice,number);
   const cadence=stamp(time)%ARCHIVE_WINDOW_NS;
   if(cadence>ARCHIVE_WINDOW_NS*.68&&windowIndex(race.duration)>slice&&positions.get(slice)?.data){
    if(track.length)positionSlice(slice+1);
    telemetrySlice(slice+1,number);
   }
  },
  loading(time){
   if(!track.length)return 'Archived circuit positions unavailable for this race.';
   const entry=positions.get(windowIndex(time));
   return entry?.data?'':entry?.retryAt?'Car positions unavailable. Play or seek to retry.':'Loading recorded car positions…';
  },
  dispose:()=>controller.abort(),
 };
}
