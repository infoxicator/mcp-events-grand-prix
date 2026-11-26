import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {isReplayId,replayCatalog,replayCarTelemetry,replayDecisions,replayDriverAt,replayHistoricalCall,replayObservation,replayPoint,type ReplayPositions,type ReplayRace,type ReplayTiming} from '../src/race/replay';
import {ReplayBenchmark} from '../server/replay-benchmark';
import {STRATEGY_EVENT} from '../src/race/strategy-events';

const load=<T>(file:string)=>JSON.parse(readFileSync(new URL('../public/replays/'+file+'.json',import.meta.url),'utf8')) as T;
const monza=load<ReplayTiming>('9590');
const silverstone=load<ReplayTiming>('9558');

describe('historical race replay',()=>{
 it('combines archived seasons and bundled races with valid unique IDs',()=>{
  const catalog=replayCatalog(load<ReplayRace[]>('index'),load<ReplayRace[]>('archive'));
  expect(catalog.length).toBeGreaterThanOrEqual(193);
  expect(new Set(catalog.map(race=>race.id)).size).toBe(catalog.length);
  expect(catalog.every(race=>isReplayId(race.id))).toBe(true);
  expect(catalog).toContainEqual(expect.objectContaining({id:'2018-australian-race'}));
  expect(catalog).toContainEqual(expect.objectContaining({id:'2021-abu-dhabi-race'}));
  expect(catalog.filter(race=>race.year===2024&&race.name==='British Grand Prix')).toMatchObject([{id:'9558'}]);
 });
 it('preserves recorded driver movement, telemetry and the finishing classification',()=>{
  const positions=load<ReplayPositions>('9590-positions');
  const driver=monza.drivers.find(d=>d.number===16)!;
  expect(monza).toMatchObject({laps:53,year:2024});
  expect(monza.drivers).toHaveLength(20);
  expect(positions.track.length).toBeGreaterThan(100);
  expect(replayPoint(positions,16,10_000)).not.toEqual(replayPoint(positions,16,0));
  expect(replayCarTelemetry(positions,16,20_000)?.speed).toBeGreaterThan(0);
  expect(replayDriverAt(driver,monza.duration)).toMatchObject({lap:53,position:1,compound:'hard',status:'finished'});
 });

 it('issues actionable checkpoints before the recorded box and wet-to-dry calls',()=>{
  for(const [race,number,lap,tyre] of [[monza,16,15,'hard'],[silverstone,44,27,'intermediate'],[silverstone,44,38,'soft']] as const){
   const driver=race.drivers.find(d=>d.number===number)!;
   const decision=replayDecisions(race,driver).find(checkpoint=>checkpoint.lap===lap&&replayHistoricalCall(driver,checkpoint).action==='box')!;
   expect(decision).toBeDefined();
   const observation=replayObservation(race,driver,decision);
   expect(observation.driver.compound).not.toBe(tyre);
   expect(observation.driver.inPit).toBe(false);
   expect(observation.recentLaps.every(entry=>entry.lap<lap)).toBe(true);
   expect(observation.raceControl.every(entry=>entry.ms<=decision.time)).toBe(true);
   expect(observation).not.toHaveProperty('historical');
   expect(replayHistoricalCall(driver,decision)).toEqual({action:'box',compound:tyre});
  }
 });

 it('expires an unanswered checkpoint and resumes at the next one after restore',async()=>{
  const room=crypto.randomUUID();
  const sent:{data?:{event_id:string}}[]=[];
  let saved:typeof replay.state|undefined;
  const transport:ConstructorParameters<typeof ReplayBenchmark>[2]={
   save:async state=>{saved=structuredClone(state);},
   defer:()=>{},
   outbound:async(_,init)=>{
    const event=JSON.parse(String(init?.body));
    if(event.type==='verification')return Response.json({challenge:event.challenge});
    sent.push(event);
    return Response.json({});
   },
  };
  const replay=ReplayBenchmark.create(room,{race:'9590',driver:16},monza,false,transport);
  const request=(path:string,body?:unknown)=>new Request('http://localhost/internal-'+path,{
   method:'POST',headers:{Authorization:'Bearer '+replay.state.key},...(body?{body:JSON.stringify(body)}:{}),
  });
  const subscription={name:STRATEGY_EVENT,arguments:replay.access('http://localhost').event_filter,
   delivery:{mode:'webhook',url:'https://connectors.api.openai.com/webhook/mcp-events/replay-test',secret:'whsec_'+Buffer.alloc(32,7).toString('base64')}};
  expect((await (await replay.handle(request('strategy-subscribe',subscription))).json()).result.id).toMatch(/^sub_/);
  const starts=await Promise.all([replay.handle(request('replay-next')),replay.handle(request('replay-next'))]);
  expect(await starts[0].json()).toMatchObject({window:{lap:3},results:[]});
  expect(await starts[1].json()).toMatchObject({window:{lap:3},results:[]});
  expect(saved?.window?.index).toBe(0);
  const id=saved!.window!.id;
  saved!.window!.expiresAt=Date.now()-1;
  const restored=new ReplayBenchmark(saved!,monza,transport);
  expect((await restored.handle(request('strategy-radio',{room,event_id:id,action:'extend',radio:'Stay out.'}))).status).toBe(409);
  expect(await (await restored.handle(request('replay-status'))).json()).toMatchObject({
   results:[{lap:3,responseMs:null,timingMatch:null,historical:{action:'stay-out'}}],
  });
  expect(await (await restored.handle(request('replay-next'))).json()).toMatchObject({window:{lap:7}});
 });
});
