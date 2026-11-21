import {it,expect,vi} from 'vitest';
import {RaceRoom} from '../server/race-room';
import {LENGTH} from '../src/race/track';
import {createRace,stepRace} from '../src/race/physics';
import {mockDriver,mockEngineer} from '../src/race/brains';
import {createRaceDriver,createRaceEngineer,providerConfig} from '../server/race-brains';
import {parseInvitation,playerURL} from '../src/race/invitation';
import {CHAT_STRATEGY_LAPS,CHAT_STRATEGY_TIME_MS,LIVE_TIME_MS} from '../src/race/live';
it('an early undercut beats staying out on worn soft tyres',()=>{
 const finishes:number[]=[];for(const stop of [true,false]){const s=createRace();s.field=[];Object.assign(s.cars.a,{distance:0,offset:-2});Object.assign(s.cars.b,{distance:-12,offset:2});s.phase='racing';for(let i=0;i<60000&&(s.phase as string)!=='finished';i++){if(i%24===0)for(const t of ['a','b'] as const){if(i%1440===0){s.cars[t].instruction=mockEngineer(s,t);if(t==='a'&&!stop)s.cars[t].instruction.box=false;}s.cars[t].intent=mockDriver(s,t);}stepRace(s);}expect(s.phase).toBe('finished');finishes.push(s.cars.a.finishTime!);}expect(finishes[1]-finishes[0]).toBeGreaterThan(10);
});
it('separate seats, structured engineer radio and signed driver intents share a room',async()=>{
 const r=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'}),a=r.add(()=>{}),b=r.add(()=>{});r.join(a,'a',r.tokens.a);r.join(b,'b',r.tokens.b);r.start();r.advance(720);await Promise.resolve();expect(r.engineerCalls.a).toBeGreaterThan(0);expect(r.race.radio.some(x=>x.speaker==='ENGINEER')).toBe(true);
 r.radio('a',{pace:'manage',ers:'harvest',box:false,tyre:'hard',tactic:'hold',line:'Save the rears.'},'mock');await r.message(a,{type:'decide'});await r.message(a,{type:'intent',sequence:r.decisions.a!.sequence});expect(r.race.cars.a.intent.speedBias).toBe(-2);expect(r.race.cars.a.intent.ers).toBe(false);expect(r.intents.a).toBe(1);await r.message(a,{type:'intent',sequence:r.decisions.a!.sequence});expect(r.intents.a).toBe(1);expect(r.paidCalls).toBe(0);
 const before=r.race.tick;r.remove(b);r.advance(120);expect(r.race.tick).toBe(before);const b2=r.add(()=>{});r.join(b2,'b',r.tokens.b);r.advance(120);expect(r.race.tick).toBeGreaterThan(before);
});
it('keeps a ready grid in the lobby until an authorized start, including after reset',async()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'});
 const owner=room.add(()=>{}),spectator=room.add(()=>{});
 room.join(owner,'a',room.tokens.owner);
 room.join(spectator,null,'');
 await room.message(owner,{type:'start'});
 expect(room.race.phase).toBe('lobby');
 room.join(room.add(()=>{}),'b',room.tokens.b);
 await room.message(spectator,{type:'start'});
 room.advance(720);
 expect(room.race).toMatchObject({phase:'lobby',tick:0,time:0});
 expect(room.engineerCalls).toEqual({a:0,b:0});
 await room.message(owner,{type:'start'});
 expect(room.race.phase).toBe('lights');
 room.advance(120);
 const countdown=room.race.countdown;
 await room.message(owner,{type:'start'});
 expect(room.race.countdown).toBe(countdown);
 await room.message(owner,{type:'reset'});
 room.advance(720);
 expect(room.race).toMatchObject({phase:'lobby',tick:0,time:0});
});
it('invitation grants one team, never the owner or opponent',()=>{const r=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'}),i=parseInvitation(r.invitation('b'),r.origin);expect(parseInvitation(playerURL(r.origin,i),r.origin)).toEqual(i);const p=r.add(()=>{});r.join(p,'a',i.credential);expect(p.team).toBe(null);expect(p.owner).toBe(false);expect(()=>parseInvitation(r.links().spectator,r.origin)).toThrow();});
it('actual TypeSafe SDK serializes racing choices and decodes the driver intent using a fixture',async()=>{
 let calls=0;const driver=createRaceDriver({mock:false,provider:'typesafe',apiKey:'fixture-only',baseURL:'https://api.typesafe.ai',model:'jev-latest'},async(input,init)=>{calls++;expect(String(input)).toBe('https://api.typesafe.ai/v1/systemone');const body=JSON.parse(String(init?.body));expect(body.questions.line.type).toBe('choice');expect(body.state.team).toBe('a');const answer=(choice:string)=>({type:'choice',choice,confidence:.95,probabilities:{[choice]:1}});return new Response(JSON.stringify({model:'jev-latest',answers:Object.fromEntries(Object.entries({line:'left',pace:'attack',brake:'late',ers:'yes',drs:'yes',reply:'copy'}).map(([k,v])=>[k,answer(v)])),usage:{input_tokens:100,output_tokens:10}}),{headers:{'content-type':'application/json'}});});const d=await driver(createRace(),'a',1);expect(d.source).toBe('jev');expect(d.intent.offset).toBe(-3);expect(d.intent.speedBias).toBe(2);expect(calls).toBe(1);
});
it('engineer validates structured strategy, falls back on malformed data, and mock forbids transport',async()=>{
 let calls=0;const transport:typeof fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({pace:'push',ers:'deploy',box:true,tyre:'hard',tactic:'attack',line:'Box box. Undercut now.'})}}]});};const engineer=createRaceEngineer({OPENROUTER_API_KEY:'fixture-only'},transport);expect((await engineer(createRace(),'a')).source).toBe('live');expect(calls).toBe(1);const mock=createRaceEngineer({JEV_MOCK:'1',OPENROUTER_API_KEY:'fixture-only'},transport);expect((await mock(createRace(),'a')).source).toBe('mock');expect(calls).toBe(1);expect(providerConfig({JEV_MOCK:'1',TYPESAFE_API_KEY:'unused'}).mock).toBe(true);const broken=createRaceEngineer({OPENROUTER_API_KEY:'fixture-only'},async()=>Response.json({choices:[]}));expect((await broken(createRace(),'a')).source).toBe('fallback');
});

it('finishing-position changes do not replace an overtake replay or grow frozen history',()=>{
 const r=new RaceRoom(crypto.randomUUID(),'http://localhost:5387',{JEV_MOCK:'1'}),a=r.add(()=>{}),b=r.add(()=>{});r.join(a,'a',r.tokens.a);r.join(b,'b',r.tokens.b);r.race.phase='racing';r.race.time=100;for(const car of r.race.field)car.finishTime=98;r.race.leader='b';r.race.cars.b.finishTime=99;r.race.cars.b.distance=LENGTH*3+.01;r.race.cars.a.distance=LENGTH*3-.1;r.race.cars.a.speed=80;r.replay=[structuredClone(r.race)];r.advance(120);expect(r.race.phase).toBe('finished');expect(r.replay).toHaveLength(1);const tick=r.race.tick,frames=r.history.length;r.advance(1200);expect(r.race.tick).toBe(tick);expect(r.history).toHaveLength(frames);expect(r.replay).toHaveLength(1);
});

it('strategist sends one call on a steady lap and revisits a rival stop',async()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'});
 for(const team of ['a','b'] as const)room.join(room.add(()=>{}),team,room.tokens[team]);
 room.race.phase='racing';
 room.advance(1);
 await Promise.resolve();
 expect(room.engineerCalls.a).toBe(1);
 room.advance(1600);
 await Promise.resolve();
 expect(room.engineerCalls.a).toBe(1);
 room.race.cars.b.stops++;
 room.advance(1);
 await Promise.resolve();
 expect(room.engineerCalls.a).toBe(2);
});

it('a late live box radio takes effect next lap and a committed stop cannot be cancelled',async()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'});
 for(const team of ['a','b'] as const)room.join(room.add(()=>{}),team,room.tokens[team]);
 room.race.phase='racing';
 const car=room.race.cars.a;
 car.distance=LENGTH-500;
 const stop={...car.instruction,box:true,line:'Box now.'};
 room.radio('a',stop,'live');
 expect(car.instruction.box).toBe(false);
 expect(room.race.radio.at(-1)?.text).toContain('Box next lap');
 car.lap=1;
 car.distance=LENGTH+10;
 room.advance(1);
 expect(car.instruction.box).toBe(true);
 car.distance=2*LENGTH-500;
 room.radio('a',{...stop,box:false},'live');
 expect(car.instruction.box).toBe(true);
 expect(room.race.radio.at(-1)?.text).toContain('Continue to the box');
});

it('a one-lap manual override leaves the next pit window available',()=>{
 const race=createRace();
 race.cars.a.lap=1;
 race.cars.a.distance=LENGTH+10;
 expect(mockEngineer(race,'a',true).box).toBe(true);
 race.cars.a.stops=1;
 expect(mockEngineer(race,'a',true).box).toBe(false);
});

it('both multiplayer seats complete their planned stop and reach the flag',async()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'});
 room.race.field=[];
 const teams=['a','b'] as const;
 for(const team of teams)room.join(room.add(()=>{}),team,room.tokens[team]);
 expect(room.start()).toBe(true);
 while(room.race.tick<60000&&room.race.phase!=='finished'){
  for(const team of teams)room.race.cars[team].intent=mockDriver(room.race,team);
  room.advance(24);
  await Promise.resolve();
 }
 expect(room.race.phase).toBe('finished');
 for(const team of teams){
  expect(room.race.cars[team].stops).toBeGreaterThan(0);
  expect(room.race.cars[team].lapTimes).toHaveLength(3);
 }
});

it.each(['monza','las-vegas'] as const)('the public strategy race reaches the 20-lap flag with fuel at %s',async circuit=>{
 const start=Date.now(),now=vi.spyOn(Date,'now');
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'},1,'jev-vs-jev',{},circuit,true,CHAT_STRATEGY_LAPS);
 room.live='running';
 room.expiresAt=start+CHAT_STRATEGY_TIME_MS;
 room.enableChatStrategy();
 const maxTicks=CHAT_STRATEGY_TIME_MS*120/1000;
 try{
  expect(room.start()).toBe(true);
  while(room.race.tick<maxTicks&&room.race.phase!=='finished'){
   const wallTime=start+Math.round(room.race.tick*1000/120);
   now.mockReturnValue(wallTime);
   room.advance(24);
   room.driveLive(wallTime);
   await Promise.resolve();
  }
  expect(room.race.phase).toBe('finished');
  expect(room.race.time*1000).toBeGreaterThan(LIVE_TIME_MS);
  expect(room.race.time*1000).toBeLessThan(CHAT_STRATEGY_TIME_MS);
  for(const car of Object.values(room.race.cars)){
   expect(car.lapTimes).toHaveLength(20);
   expect(car.fuel).toBeGreaterThan(0);
  }
  expect(room.paidCalls).toBe(0);
 }finally{now.mockRestore();}
},30_000);

it('passes the strategist measured front and rear gaps with a bounded energy order',async()=>{
 const race=createRace();
 const car=race.cars.a;
 race.field=[];
 Object.assign(car,{distance:100,speed:50,ers:10,ersDeployed:2100,lap:1,sector:0});
 Object.assign(race.cars.b,{distance:60,speed:54});
 const history=[{lap:0,sector:2,ahead:1.2,behind:.9,closingBehind:4}];
 const transport:typeof fetch=async(_url,options)=>{
  const payload=JSON.parse(String(options?.body));
  const observation=JSON.parse(payload.messages[1].content);
  expect(observation).toMatchObject({sectorGapHistory:history,gaps:{ahead:null,behind:.8,closingBehind:4},energy:{chargeKJ:400}});
  expect(observation.fuel.projectedAtFlagKg).toBeLessThan(car.fuel);
  return Response.json({choices:[{message:{content:JSON.stringify({
   pace:'push',ers:'deploy',box:false,tyre:'soft',tactic:'defend',line:'Reserve for defence.',
   energy:{priority:'defend',budgetKJ:900,laps:3},
  })}}]});
 };
 const decide=createRaceEngineer({OPENROUTER_API_KEY:'fixture-only'},transport);
 const call=await decide(race,'a',history);
 expect(call.source).toBe('live');
 expect(call.instruction.energy).toEqual({priority:'defend',budgetKJ:400,expiresLap:3,startJoules:2100});
});

it('a renewed order cannot refill the budget, and a driver intent from before the radio cannot be applied',async()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'});
 const peer=room.add(()=>{});
 room.join(peer,'a',room.tokens.a);
 room.race.phase='racing';
 const car=room.race.cars.a;
 const energy={priority:'defend' as const,budgetKJ:500,expiresLap:2,startJoules:0};
 const instruction={...car.instruction,ers:'deploy' as const,energy};
 room.radio('a',instruction,'live');
 await room.message(peer,{type:'decide'});
 const sequence=room.decisions.a!.sequence;
 car.ersDeployed=300000;
 room.radio('a',{...instruction,energy:{...energy,priority:'attack',budgetKJ:800,startJoules:300000}},'live');
 expect(car.instruction.energy).toEqual({...energy,priority:'attack'});
 await room.message(peer,{type:'intent',sequence});
 expect(room.intents.a).toBe(0);
});

it('a final-lap instruction after commitment stays out to the flag',()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'});
 room.race.phase='racing';
 const car=room.race.cars.a;
 car.lap=2;
 car.distance=3*LENGTH-500;
 room.radio('a',{...car.instruction,box:true},'live');
 expect(car.instruction.box).toBe(false);
 expect(car.instruction.line).toContain('Stay out to the flag');
});

it('discards a strategist response if a rival stops while it is pending',async()=>{
 let reply!:(response:Response)=>void;
 const pending=new Promise<Response>(resolve=>{reply=resolve;});
 let requestsForA=0;
 const orders=(line:string)=>Response.json({choices:[{message:{content:JSON.stringify({
  pace:'manage',ers:'harvest',box:false,tyre:'medium',tactic:'hold',line,
 })}}]});
 const transport:typeof fetch=async(_url,options)=>{
  const request=JSON.parse(String(options?.body));
  const {team}=JSON.parse(request.messages[1].content);
  if(team==='b')return orders('B holds.');
  if(++requestsForA===1)return pending;
  return orders('Rival stopped. Stay out.');
 };
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{OPENROUTER_API_KEY:'fixture-only'},4,'jev-vs-jev',{engineer:transport});
 for(const team of ['a','b'] as const)room.join(room.add(()=>{}),team,room.tokens[team]);
 room.race.phase='racing';
 room.advance(1);
 room.race.cars.b.stops++;
 reply(orders('Original call.'));
 await vi.waitFor(()=>expect(room.paidCalls).toBe(2));
 expect(room.race.radio.some(message=>message.text==='Original call.')).toBe(false);
 room.advance(1);
 await vi.waitFor(()=>expect(room.race.cars.a.instruction.line).toBe('Rival stopped. Stay out.'));
});

it('records one material change for a nearby field stop as the car comes into and out of range',async()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'});
 for(const team of ['a','b'] as const)room.join(room.add(()=>{}),team,room.tokens[team]);
 room.race.phase='racing';
 const car=room.race.cars.a;
 const rival=room.race.field[0];
 rival.pit='stopped';
 rival.distance=car.distance+180;
 room.advance(1);
 await Promise.resolve();
 rival.distance=car.distance+80;
 room.advance(1);
 await Promise.resolve();
 expect(room.engineerCalls.a).toBe(2);
 rival.distance=car.distance+180;
 room.advance(1);
 await Promise.resolve();
 rival.distance=car.distance+100;
 room.advance(1);
 await Promise.resolve();
 expect(room.engineerCalls.a).toBe(2);
});

it('runs the full solo grid with Mercedes driving itself and pauses when Ferrari disconnects',async()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'},4,'jev-vs-jev',{},'monza',true);
 const aiSeat=room.add(()=>{});
 room.join(aiSeat,'b',room.tokens.b);
 expect(aiSeat.team).toBeNull();
 expect(room.links().b).toBe('');
 room.advance(700);
 expect(room.race.phase).toBe('lobby');
 const ferrari=room.add(()=>{});
 room.join(ferrari,'a',room.tokens.a);
 room.advance(720);
 expect(room.race.phase).toBe('lobby');
 await room.message(ferrari,{type:'start'});
 room.advance(720);
 await Promise.resolve();
 expect(room.race.phase).toBe('racing');
 expect(room.intents.b).toBeGreaterThan(0);
 expect(room.race.field).toHaveLength(20);
 const tick=room.race.tick,mercedes=room.race.cars.b.distance;
 room.remove(ferrari);
 room.advance(240);
 expect(room.race.tick).toBe(tick);
 room.join(room.add(()=>{}),'a',room.tokens.a);
 room.advance(240);
 expect(room.race.cars.b.distance).toBeGreaterThan(mercedes);
 expect(room.paidCalls).toBe(0);
});
