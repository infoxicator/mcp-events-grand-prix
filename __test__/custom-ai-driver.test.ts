import {describe,expect,it,vi} from 'vitest';
import {RaceRoom} from '../server/race-room';
import {createRaceMcp} from '../server/race-mcp';
import {LUNA_MODEL} from '../server/luna';
import {DT,racingSpeed,steeringTo,stepRace} from '../src/race/physics';
import {getTrack} from '../src/race/track';
import {clearRacingLine} from '../src/race/field-physics';
import type {RaceLogEntry} from '../src/race/event-log';

describe('In-memory Jev System 1 and Luna AI driver keys',()=>{
 it('drives Team A with a session-only Jev System 1 API key and never exposes it in state',async()=>{
  const room=new RaceRoom(crypto.randomUUID(),'https://race.example',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'monza',true,5,false);
  room.strategyPractice=true;
  room.live='running';
  room.driverMode={a:'jev',b:'autopilot'};

  const calls:{url:string;auth:string|null;body:string}[]=[];
  const transport:typeof fetch=async(input,init)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   const headers=new Headers(init?.headers);
   calls.push({url,auth:headers.get('authorization'),body:String(init?.body??'')});
   return new Response(JSON.stringify({
    answers:{
     line:{choice:'left',confidence:0.9},
     pace:{choice:'attack',confidence:0.85},
     brake:{choice:'late',confidence:0.8},
     ers:{choice:'yes',confidence:0.95},
     drs:{choice:'yes',confidence:0.9},
     reply:{choice:'attack',confidence:0.9},
    },
   }),{status:200,headers:{'content-type':'application/json'}});
  };

  const secretKey='ts_secret_in_memory_only_12345';
  const configured=room.setCustomDriver('a',{engine:'jev',provider:'typesafe',apiKey:secretKey,intervalMs:200},transport);
  expect(configured).toEqual({engine:'jev',provider:'typesafe',model:'jev-latest'});
  expect(room.hasCustomDriver('a')).toBe(true);
  expect(room.state().players.a.mock).toBe(false);
  expect(room.state().aiControlStyle?.a).toBe('tactical');
  expect(room.state().mode).toBe('live');
  expect(JSON.stringify(room.state())).not.toContain(secretKey);

  room.race.phase='racing';
  room.driveLive(Date.now());
  await vi.waitFor(()=>expect(room.intents.a).toBeGreaterThan(0));

  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0].url).toContain('https://api.typesafe.ai');
  expect(calls[0].auth).toBe(`Bearer ${secretKey}`);
  expect(room.decisions.a?.source).toBe('jev');
  expect(room.race.cars.a.intent.side).toBe('left');
  expect(JSON.stringify(room.state())).not.toContain(secretKey);

  // Finishing the race immediately clears the in-memory driver closure.
  room.finishLive('stopped');
  expect(room.hasCustomDriver('a')).toBe(false);
 });

 it('drives Team A with Luna (gpt-6-luna) and supports independent Team B key in multiplayer',async()=>{
  const room=new RaceRoom(crypto.randomUUID(),'https://race.example',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'las-vegas',true,5,false);
  room.strategyPractice=true;
  room.live='running';
  room.driverMode={a:'luna',b:'jev'};

  const lunaCalls:{url:string;auth:string|null}[]=[];
  const lunaTransport:typeof fetch=async(input,init)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   const headers=new Headers(init?.headers);
   lunaCalls.push({url,auth:headers.get('authorization')});
   return new Response(JSON.stringify({
    model:LUNA_MODEL,
    answers:[
     {name:'line',type:'choice',choice:'right',confidence:0.9},
     {name:'pace',type:'choice',choice:'normal',confidence:0.85},
     {name:'brake',type:'choice',choice:'normal',confidence:0.85},
     {name:'ers',type:'choice',choice:'yes',confidence:0.9},
     {name:'drs',type:'choice',choice:'no',confidence:0.8},
     {name:'reply',type:'choice',choice:'attack',confidence:0.9},
    ],
    usage:{input_tokens:300},
   }),{status:200,headers:{'content-type':'application/json'}});
  };

  const jevCalls:{url:string;auth:string|null}[]=[];
  const jevTransport:typeof fetch=async(input,init)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   const headers=new Headers(init?.headers);
   jevCalls.push({url,auth:headers.get('authorization')});
   return new Response(JSON.stringify({
    answers:{
     line:{choice:'hold',confidence:0.9},
     pace:{choice:'cautious',confidence:0.8},
     brake:{choice:'early',confidence:0.8},
     ers:{choice:'no',confidence:0.9},
     drs:{choice:'no',confidence:0.9},
     reply:{choice:'copy',confidence:0.9},
    },
   }),{status:200,headers:{'content-type':'application/json'}});
  };

  const openaiKey='sk-luna-memory-key-999';
  const openrouterKey='sk-or-jev-memory-key-888';
  room.setCustomDriver('a',{engine:'luna',apiKey:openaiKey,intervalMs:200},lunaTransport);
  room.setCustomDriver('b',{engine:'jev',provider:'openrouter',apiKey:openrouterKey,intervalMs:200},jevTransport);

  expect(room.players.a).toMatchObject({engine:'luna',name:'LUNA',model:LUNA_MODEL,provider:'openai',mock:false});
  expect(room.players.b).toMatchObject({engine:'jev',name:'JEV',model:'jev-1.13',provider:'openrouter',mock:false});

  room.race.phase='racing';
  room.driveLive(Date.now());
  await vi.waitFor(()=>{
   expect(room.intents.a).toBeGreaterThan(0);
   expect(room.intents.b).toBeGreaterThan(0);
  });

  expect(lunaCalls[0]).toEqual({url:'https://api.openai.com/v1/decisions',auth:`Bearer ${openaiKey}`});
  expect(jevCalls[0].url).toContain('https://openrouter.ai/api');
  expect(jevCalls[0].auth).toBe(`Bearer ${openrouterKey}`);
  expect(room.decisions.a?.source).toBe('luna');
  expect(room.decisions.b?.source).toBe('jev');
  expect(room.race.radio.some(r=>r.team==='a'&&r.speaker==='LUNA')).toBe(true);
  expect(room.race.radio.some(r=>r.team==='b'&&r.speaker==='JEV')).toBe(true);

  const serialized=JSON.stringify(room.state());
  expect(serialized).not.toContain(openaiKey);
  expect(serialized).not.toContain(openrouterKey);

  // Switching lobby back to autopilot drops the key from memory.
  room.race.phase='lobby';
  expect(room.configureStrategyLobby('monza',5,'autopilot')).toBe(true);
  expect(room.hasCustomDriver('a')).toBe(false);
  expect(room.players.a.mock).toBe(true);
 });

 it('MCP tool schema accepts jev and luna driver modes without accepting API keys',()=>{
  const server=createRaceMcp('https://race.example',{
   create:async()=>{throw new Error('unused');},
   get:async()=>null,
   html:async()=>'',
   startChatPractice:async(circuit,laps,driver)=>({
    room:crypto.randomUUID(),
    key:'a'.repeat(64),
    phase:'running',
    strategyKey:'b'.repeat(64),
    laps:laps??5,
    driver:driver??'autopilot',
   }),
  });
  expect(server).toBeDefined();
 });
});

const rawChoices={steer:'hard-left',throttle:'half',brake:'none',ers:'no',drs:'no'};
const hybridChoices={lane:'far-right',pedal:'overdrive',ers:'no',drs:'no'};
const jevResponse=(choices:Record<string,string>)=>Response.json({
 answers:Object.fromEntries(Object.entries(choices).map(([name,choice])=>[name,{choice,confidence:.9}])),
});
const lunaResponse=(choices:Record<string,string>)=>Response.json({
 model:LUNA_MODEL,answers:Object.entries(choices).map(([name,choice])=>({name,choice,type:'choice',confidence:.9})),
});
function experimentRoom(){
 const room=new RaceRoom(crypto.randomUUID(),'https://race.example',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'monza',true);
 room.live='running';
 room.strategyPractice=true;
 room.viewerKey='viewer';
 room.driverMode.b='autopilot';
 room.engineerMode.a='joined';
 room.race.phase='racing';
 room.race.field=[];
 room.race.cars.b.finishTime=0;
 Object.assign(room.race.cars.a,{distance:100,speed:45,offset:0,heading:0,steering:0});
 return room;
}

describe('AI driving experiments',()=>{
 it.each(['jev','luna'] as const)('%s sends raw controls through the human physics path',async engine=>{
  const room=experimentRoom(),car=room.race.cars.a;
  const entries:RaceLogEntry[]=[];
  const peer=room.add(message=>{if(message.type==='event-log')entries.push(...message.entries);});
  room.join(peer,null,room.viewerKey!);
  await room.message(peer,{type:'event-log',subscribe:true});
  let request=0;
  const transport:typeof fetch=async(_input,init)=>{
   const body=String(init?.body);
   for(const field of ['headingDeg','offsetErrorFromLineM','distToLeftEdgeM','distToRightEdgeM','lateralVelocityMps','upcomingTrack','cornerSpeedKmh','instruction']){
    expect(body).toContain(field);
   }
   const choices=request++?{...rawChoices,steer:'hard-right',throttle:'none',brake:'hard'}:rawChoices;
   return engine==='jev'?jevResponse(choices):lunaResponse(choices);
  };
  room.setCustomDriver('a',{engine,apiKey:'fixture-only',controlStyle:'raw'},transport);
  expect(room.players.a.intervalMs).toBe(engine==='jev'?140:250);
  room.driveLive(Date.now());
  await vi.waitFor(()=>expect(room.decisions.a?.source).toBe(engine));
  expect(room.decisions.a?.control).toEqual({style:'raw',steer:'hard-left',throttle:'half',brake:'none'});
  room.advance(12);
  expect(car.steering).toBeLessThan(-.15);
  expect(car.throttle).toBe(.5);
  expect(car.brake).toBe(0);

  await vi.waitFor(()=>{
   room.driveLive(Date.now());
   expect(room.decisions.a?.control).toMatchObject({steer:'hard-right',throttle:'none',brake:'hard'});
  },{interval:10});
  const initialSpeed=car.speed;
  room.advance(24);
  expect(car.steering).toBeGreaterThan(.15);
  expect(car.throttle).toBe(0);
  expect(car.brake).toBe(1);
  expect(car.speed).toBeLessThan(initialSpeed);
  expect(car.lockup).toBe(1);
  expect(entries.at(-1)?.data).toMatchObject({
   kind:'driver',source:engine,controlStyle:'raw',changed:['Steer → HARD-RIGHT','Thr → NONE','Brk → HARD'],
  });
 });

 it('waits for a fresh decision and advances at most 12 ticks per response',async()=>{
  const room=experimentRoom(),now=Date.now();
  const replies:((response:Response)=>void)[]=[];
  room.setCustomDriver('a',{engine:'luna',apiKey:'fixture-only',controlStyle:'step-locked'},()=>new Promise(resolve=>replies.push(resolve)));
  room.tick(100,now);
  expect(replies).toHaveLength(1);
  expect(room.race.tick).toBe(0);
  expect(room.state()).toMatchObject({aiControlStyle:{a:'step-locked'},stepLockWaiting:true});
  room.tick(100,now+300);
  expect(room.race.tick).toBe(0);

  replies[0](lunaResponse(rawChoices));
  await vi.waitFor(()=>expect(room.state().stepLockWaiting).toBe(false));
  room.tick(4,now+310);
  expect(room.race.tick).toBe(4);
  expect(replies).toHaveLength(1);
  room.tick(100,now+320);
  expect(room.race.tick).toBe(12);
  expect(room.race.time).toBeCloseTo(12*DT);
  expect(room.race.cars.a.throttle).toBe(.5);
  expect(replies).toHaveLength(2);
  expect(room.state().stepLockWaiting).toBe(true);
  room.tick(100,now+500);
  expect(room.race.tick).toBe(12);

  replies[1](lunaResponse({...rawChoices,throttle:'none',brake:'hard'}));
  await vi.waitFor(()=>expect(room.decisions.a?.sequence).toBe(2));
  room.tick(100,now+510);
  expect(room.race.tick).toBe(24);
  expect(room.race.cars.a.brake).toBe(1);
  expect(replies).toHaveLength(3);
  room.finishLive('stopped');
 });

 it('bounds the step-lock wait and ignores a late response after cancellation',async()=>{
  const room=experimentRoom(),now=Date.now();
  const replies:((response:Response)=>void)[]=[];
  const signals:(AbortSignal|null|undefined)[]=[];
  room.setCustomDriver('a',{engine:'luna',apiKey:'fixture-only',controlStyle:'step-locked'},(_input,init)=>{
   signals.push(init?.signal);
   return new Promise(resolve=>replies.push(resolve));
  });
  room.tick(120,now);
  room.tick(120,now+3499);
  expect(room.race.tick).toBe(0);
  room.tick(120,now+3500);
  expect(signals[0]?.aborted).toBe(true);
  expect(replies).toHaveLength(2);
  expect(room.race.tick).toBe(12);
  expect(room.decisions.a?.source).toBe('fallback');
  replies[0](lunaResponse(rawChoices));
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(room.decisions.a?.source).toBe('fallback');
  room.tick(120,now+3501);
  expect(room.race.tick).toBe(12);
  room.finishLive('stopped');
  expect(signals[1]?.aborted).toBe(true);
 });

 it('uses one shared slice when both seats are step-locked',async()=>{
  const room=experimentRoom(),now=Date.now();
  room.race.cars.b.finishTime=null;
  room.engineerMode.b='joined';
  const responses:{a:((response:Response)=>void)[];b:((response:Response)=>void)[]}={a:[],b:[]};
  for(const team of ['a','b'] as const){
   room.setCustomDriver(team,{engine:'luna',apiKey:'fixture-only',controlStyle:'step-locked'},()=>new Promise(resolve=>responses[team].push(resolve)));
  }
  room.tick(120,now);
  responses.a[0](lunaResponse(rawChoices));
  await vi.waitFor(()=>expect(room.decisions.a?.source).toBe('luna'));
  room.tick(120,now+100);
  expect(room.race.tick).toBe(0);
  expect(room.state().stepLockWaiting).toBe(true);
  responses.b[0](lunaResponse(rawChoices));
  await vi.waitFor(()=>expect(room.decisions.b?.source).toBe('luna'));
  room.tick(120,now+200);
  expect(room.race.tick).toBe(12);
  expect(responses.a).toHaveLength(2);
  expect(responses.b).toHaveLength(2);
  room.clearCustomDrivers();
  room.tick(20,now+210);
  expect(room.race.tick).toBe(32);
  expect(room.state().stepLockWaiting).toBe(false);
 });

 it('drops the custom key and aborts its request on the chequered flag',()=>{
  const room=experimentRoom(),now=Date.now();
  const finish=getTrack('monza').LENGTH*room.race.laps;
  room.race.cars.a.distance=finish-.1;
  let signal:AbortSignal|null|undefined;
  room.setCustomDriver('a',{engine:'luna',apiKey:'fixture-only',controlStyle:'raw'},(_input,init)=>{
   signal=init?.signal;
   return new Promise(()=>{});
  });
  room.driveLive(now);
  expect(signal?.aborted).toBe(false);
  room.tick(1,now);
  expect(room.race.phase).toBe('finished');
  expect(room.hasCustomDriver('a')).toBe(false);
  expect(signal?.aborted).toBe(true);
 });

 it('follows the exact hybrid lane beside traffic and relaxes the corner speed envelope',async()=>{
  const room=experimentRoom(),track=getTrack(room.race.circuit),car=room.race.cars.a,rival=room.race.cars.b;
  const distance=Array.from({length:Math.floor(track.LENGTH/4)},(_,i)=>i*4)
   .find(d=>track.racingLineOffset(d+12)>1.3&&track.curvatureAt(d)>.006)!;
  const target=track.racingLineOffset(distance+12)+5;
  Object.assign(car,{distance,speed:48,offset:target,heading:0});
  Object.assign(rival,{distance:distance+11,speed:18,offset:target,finishTime:null});
  const margin=track.trackHalfWidth(distance)-1.05;
  expect(target).toBeGreaterThan(margin);
  expect(clearRacingLine(car,target,margin,[],rival)).not.toBe(target);
  const expected=steeringTo(track,distance,car.offset,0,12,target);
  const baseline=structuredClone(room.race);
  room.setCustomDriver('a',{engine:'jev',apiKey:'fixture-only',controlStyle:'no-assist'},async()=>jevResponse(hybridChoices));
  room.driveLive(Date.now());
  await vi.waitFor(()=>expect(room.decisions.a?.control).toEqual({style:'no-assist',lane:'far-right',pedal:'overdrive'}));
  room.advance(1);
  stepRace(baseline);
  expect(car.steering).toBeCloseTo(Math.max(-1.1*DT,Math.min(1.1*DT,expected)));
  expect(car.steering).not.toBeCloseTo(baseline.cars.a.steering,6);

  const sweep=structuredClone(baseline);
  const testCar=sweep.cars.a;
  sweep.cars.b.finishTime=0;
  const normal=racingSpeed(testCar,sweep.cars.b,track,0,testCar.distance+testCar.speed*.18);
  const overdrive=racingSpeed(testCar,sweep.cars.b,track,0,testCar.distance+testCar.speed*.18,'overdrive');
  expect(overdrive).toBeGreaterThan(normal*1.08);
  testCar.speed=Array.from({length:21},(_,i)=>20+i).find(speed=>{
   const at=testCar.distance+speed*.18;
   return speed>racingSpeed(testCar,sweep.cars.b,track,0,at)&&speed<racingSpeed(testCar,sweep.cars.b,track,0,at,'overdrive');
  })!;
  expect(testCar.speed).toBeDefined();
  testCar.throttle=0;testCar.brake=0;
  const tactical=structuredClone(sweep);
  stepRace(tactical);
  stepRace(sweep,undefined,undefined,{a:{style:'no-assist',lane:'line',pedal:'overdrive'}});
  expect(tactical.cars.a.brake).toBeGreaterThan(0);
  expect(testCar.brake).toBe(0);
  expect(testCar.throttle).toBeGreaterThan(0);
 });
});
