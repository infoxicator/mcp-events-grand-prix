import {expect,test,vi} from 'vitest';
import {RaceRoom} from '../server/race-room';
import type {RaceLogUpdate} from '../src/race/event-log';
import type {ServerMessage} from '../src/race/types';

function liveDriverResponse(){
 const choices={line:'left',pace:'attack',brake:'late',ers:'yes',drs:'yes',reply:'attack'};
 const answers=Object.fromEntries(Object.entries(choices).map(([key,choice])=>[key,{type:'choice',choice,confidence:.95,probabilities:{[choice]:1}}]));
 return Response.json({model:'jev-latest',answers,usage:{input_tokens:100,output_tokens:10}});
}

function eventPeer(room:RaceRoom){
 const log:RaceLogUpdate[]=[];
 const peer=room.add((message:ServerMessage)=>{
  if(message.type==='event-log')log.push(message);
 });
 const subscribe=(active=true)=>room.message(peer,{type:'event-log',subscribe:active});
 return {peer,log,subscribe,entries:()=>log.flatMap(update=>update.entries)};
}

function liveRoom(){
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'monza',true,20);
 room.live='running';
 room.viewerKey='test-viewer-key';
 room.race.phase='racing';
 room.race.cars.a.distance=10;
 const strategy=room.enableChatStrategy();
 return {room,strategy};
}

test('the event log captures strategist telemetry and leaves out mock driver decisions',async()=>{
 const {room,strategy}=liveRoom(),observer=eventPeer(room);
 await observer.subscribe();
 expect(observer.log).toEqual([]);
 await room.message(observer.peer,{type:'join',team:null,token:'wrong'});
 await observer.subscribe();
 expect(observer.log).toEqual([]);
 await room.message(observer.peer,{type:'join',team:null,token:room.viewerKey!});
 room.advance(1);
 expect(observer.log).toEqual([]);
 await observer.subscribe();
 const event=strategy.pending!.event;
 const ferrari=()=>observer.entries().filter(entry=>entry.team==='a');
 expect(observer.log[0].reset).toBe(true);
 expect(ferrari()).toMatchObject([{data:{
  kind:'strategy',stage:'requested',summary:event.summary,telemetry:event.observation,
 }}]);
 // Telemetry in the log stays at the point where the strategy event was offered.
 room.race.cars.a.lapTimes.push(102);
 const offer=ferrari()[0].data;
 if(offer.kind!=='strategy')throw new Error('Expected strategy telemetry');
 expect(offer.telemetry?.lapTimes).toEqual([]);
 room.logStrategyDelivery(event,true);
 room.readStrategyEvent(event.event_id);
 room.readStrategyEvent(event.event_id);
 const radio='Look after the tyres.';
 room.submitStrategyEvent({room:room.id,event_id:event.event_id,action:'manage',radio});
 room.driveLive(Date.now());
 await vi.waitFor(()=>expect(room.state().latestChatRadio?.a?.reply).toMatchObject({speaker:'JEV',source:'mock'}));
 expect(ferrari().map(entry=>entry.data)).toEqual([
  expect.objectContaining({kind:'strategy',stage:'requested'}),
  expect.objectContaining({kind:'strategy',stage:'delivered'}),
  expect.objectContaining({kind:'strategy',stage:'telemetry-read'}),
  expect.objectContaining({kind:'radio',speaker:'ENGINEER',strategist:'chatgpt',text:radio,instruction:expect.objectContaining({pace:'manage'})}),
 ]);
 expect(observer.entries().some(entry=>entry.data.kind==='radio'&&entry.data.source==='mock')).toBe(false);
 const serialized=JSON.stringify(observer.log);
 expect(serialized).not.toContain(event.event_id);
 expect(serialized).not.toContain(room.viewerKey);
});

test('the event log keeps live decisions while cockpit replies stay in team radio',async()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{TYPESAFE_API_KEY:'fixture-only'},1,'jev-vs-jev',{
  jev:async()=>liveDriverResponse(),
 },'monza',true);
 room.live='running';
 room.viewerKey='test-viewer-key';
 room.race.phase='racing';
 const observer=eventPeer(room);
 await room.message(observer.peer,{type:'join',team:null,token:room.viewerKey});
 await observer.subscribe();
 room.driveLive(Date.now());
 await vi.waitFor(()=>expect(observer.entries()).toMatchObject([
  {team:'a',data:{kind:'driver',source:'jev',controlStyle:'tactical'}},
 ]));
 expect(room.race.radio).toContainEqual(expect.objectContaining({speaker:'JEV',source:'live',text:'Copy. Setting up the pass.'}));
});

test('switching off the event feed stops live messages and a new connection sees recent entries',async()=>{
 const {room}=liveRoom(),first=eventPeer(room);
 await room.message(first.peer,{type:'join',team:null,token:room.viewerKey!});
 await first.subscribe();
 room.advance(1);
 room.radio('a',{...room.race.cars.a.instruction,line:'Radio check.'},'mock');
 const subscribedCount=first.entries().length;
 expect(first.entries().at(-1)).toMatchObject({data:{kind:'radio',text:'Radio check.'}});
 await first.subscribe(false);
 room.advance(24*123);
 room.setCustomDriver('a',{engine:'jev',apiKey:'fixture-only'},async()=>liveDriverResponse());
 const now=Date.now();
 for(let n=1;n<=123;n++){
  await vi.waitFor(()=>{
   room.driveLive(now+n*1000);
   expect(room.driverStats.a.successes).toBe(n);
  },{interval:1});
 }
 expect(first.entries()).toHaveLength(subscribedCount);
 room.remove(first.peer);
 const replayed=eventPeer(room);
 await room.message(replayed.peer,{type:'join',team:null,token:room.viewerKey!});
 await replayed.subscribe();
 const entries=replayed.entries();
 expect(entries.filter(entry=>entry.data.kind==='driver')).toHaveLength(120);
 expect(entries.some(entry=>entry.data.kind==='radio'&&entry.data.speaker==='JEV')).toBe(false);
 expect(entries).toEqual(expect.arrayContaining([
  expect.objectContaining({data:expect.objectContaining({kind:'strategy',stage:'requested'})}),
  expect.objectContaining({data:expect.objectContaining({kind:'radio',text:'Radio check.'})}),
 ]));
 expect(entries.map(entry=>entry.id)).toEqual(entries.map(entry=>entry.id).sort((a,b)=>a-b));
});

test('rejected ChatGPT radio attempts are logged without leaking event IDs',async()=>{
 const {room,strategy}=liveRoom(),observer=eventPeer(room);
 await room.message(observer.peer,{type:'join',team:null,token:room.viewerKey!});
 await observer.subscribe();
 room.advance(1);
 const event=strategy.pending!.event;
 expect(room.submitStrategyEvent({room:room.id,event_id:event.event_id,action:'box',radio:'Box without tyre.'})).toHaveProperty('error');
 expect(room.submitStrategyEvent({room:room.id,event_id:event.event_id,action:'manage',radio:'Valid order.'})).toMatchObject({team:'a'});
 expect(room.submitStrategyEvent({room:room.id,event_id:event.event_id,action:'push',radio:'Duplicate.'})).toHaveProperty('error');
 const rejected=observer.entries().filter(e=>e.data.kind==='strategy'&&e.data.stage==='rejected');
 expect(rejected).toHaveLength(2);
 expect(rejected.map(e=>e.data.kind==='strategy'?e.data.reasons[0]:'')).toEqual(['Invalid strategy order','Duplicate radio call']);
 expect(JSON.stringify(observer.log)).not.toContain(event.event_id);
});
