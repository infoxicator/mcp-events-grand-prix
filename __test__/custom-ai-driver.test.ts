import {describe,expect,it,vi} from 'vitest';
import {RaceRoom} from '../server/race-room';
import {createRaceMcp} from '../server/race-mcp';
import {LUNA_MODEL} from '../server/luna';

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
