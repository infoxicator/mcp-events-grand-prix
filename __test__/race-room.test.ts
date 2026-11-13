import {it,expect} from 'vitest';
import {RaceRoom} from '../server/race-room';
import {LENGTH} from '../src/race/track';
import {createRace,stepRace} from '../src/race/physics';
import {mockDriver,mockEngineer} from '../src/race/brains';
import {createRaceDriver,createRaceEngineer,providerConfig} from '../server/race-brains';
import {parseInvitation,playerURL} from '../src/race/invitation';
it('an early undercut beats staying out on worn soft tyres',()=>{
 const finishes:number[]=[];for(const stop of [true,false]){const s=createRace();s.phase='racing';for(let i=0;i<60000&&(s.phase as string)!=='finished';i++){if(i%24===0)for(const t of ['a','b'] as const){if(i%1440===0){s.cars[t].instruction=mockEngineer(s,t);if(t==='a'&&!stop)s.cars[t].instruction.box=false;}s.cars[t].intent=mockDriver(s,t);}stepRace(s);}expect(s.phase).toBe('finished');finishes.push(s.cars.a.finishTime!);}expect(finishes[1]-finishes[0]).toBeGreaterThan(10);
});
it('separate seats, structured engineer radio and signed driver intents share a room',async()=>{
 const r=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'}),a=r.add(()=>{}),b=r.add(()=>{});r.join(a,'a',r.tokens.a);r.join(b,'b',r.tokens.b);r.advance(720);await Promise.resolve();expect(r.engineerCalls.a).toBeGreaterThan(0);expect(r.race.radio.some(x=>x.speaker==='ENGINEER')).toBe(true);
 r.radio('a',{pace:'manage',ers:'harvest',box:false,tyre:'hard',tactic:'hold',line:'Save the rears.'},'mock');await r.message(a,{type:'decide'});await r.message(a,{type:'intent',sequence:r.decisions.a!.sequence});expect(r.race.cars.a.intent.speedBias).toBe(-2);expect(r.race.cars.a.intent.ers).toBe(false);expect(r.intents.a).toBe(1);await r.message(a,{type:'intent',sequence:r.decisions.a!.sequence});expect(r.intents.a).toBe(1);expect(r.paidCalls).toBe(0);
 const before=r.race.tick;r.remove(b);r.advance(120);expect(r.race.tick).toBe(before);const b2=r.add(()=>{});r.join(b2,'b',r.tokens.b);r.advance(120);expect(r.race.tick).toBeGreaterThan(before);
});
it('invitation grants one team, never the owner or opponent',()=>{const r=new RaceRoom(crypto.randomUUID(),'http://localhost:5307',{JEV_MOCK:'1'}),i=parseInvitation(r.invitation('b'),r.origin);expect(parseInvitation(playerURL(r.origin,i),r.origin)).toEqual(i);const p=r.add(()=>{});r.join(p,'a',i.credential);expect(p.team).toBe(null);expect(p.owner).toBe(false);expect(()=>parseInvitation(r.links().spectator,r.origin)).toThrow();});
it('actual TypeSafe SDK serializes racing choices and decodes the driver intent using a fixture',async()=>{
 let calls=0;const driver=createRaceDriver({mock:false,provider:'typesafe',apiKey:'fixture-only',baseURL:'https://api.typesafe.ai',model:'jev-latest'},async(input,init)=>{calls++;expect(String(input)).toBe('https://api.typesafe.ai/v1/systemone');const body=JSON.parse(String(init?.body));expect(body.questions.line.type).toBe('choice');expect(body.state.team).toBe('a');const answer=(choice:string)=>({type:'choice',choice,confidence:.95,probabilities:{[choice]:1}});return new Response(JSON.stringify({model:'jev-latest',answers:Object.fromEntries(Object.entries({line:'left',pace:'attack',brake:'late',ers:'yes',drs:'yes',reply:'copy'}).map(([k,v])=>[k,answer(v)])),usage:{input_tokens:100,output_tokens:10}}),{headers:{'content-type':'application/json'}});});const d=await driver(createRace(),'a',1);expect(d.source).toBe('jev');expect(d.intent.offset).toBe(-3);expect(d.intent.speedBias).toBe(2);expect(calls).toBe(1);
});
it('engineer validates structured strategy, falls back on malformed data, and mock forbids transport',async()=>{
 let calls=0;const transport:typeof fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({pace:'push',ers:'deploy',box:true,tyre:'hard',tactic:'attack',line:'Box box. Undercut now.'})}}]});};const engineer=createRaceEngineer({OPENROUTER_API_KEY:'fixture-only'},transport);expect((await engineer(createRace(),'a')).source).toBe('live');expect(calls).toBe(1);const mock=createRaceEngineer({JEV_MOCK:'1',OPENROUTER_API_KEY:'fixture-only'},transport);expect((await mock(createRace(),'a')).source).toBe('mock');expect(calls).toBe(1);expect(providerConfig({JEV_MOCK:'1',TYPESAFE_API_KEY:'unused'}).mock).toBe(true);const broken=createRaceEngineer({OPENROUTER_API_KEY:'fixture-only'},async()=>Response.json({choices:[]}));expect((await broken(createRace(),'a')).source).toBe('fallback');
});

it('finishing-position changes do not replace an overtake replay or grow frozen history',()=>{
 const r=new RaceRoom(crypto.randomUUID(),'http://localhost:5387',{JEV_MOCK:'1'}),a=r.add(()=>{}),b=r.add(()=>{});r.join(a,'a',r.tokens.a);r.join(b,'b',r.tokens.b);r.race.phase='racing';r.race.time=100;r.race.leader='b';r.race.cars.b.finishTime=99;r.race.cars.b.distance=LENGTH*3+.01;r.race.cars.a.distance=LENGTH*3-.1;r.race.cars.a.speed=80;r.replay=[structuredClone(r.race)];r.advance(120);expect(r.race.phase).toBe('finished');expect(r.replay).toHaveLength(1);const tick=r.race.tick,frames=r.history.length;r.advance(1200);expect(r.race.tick).toBe(tick);expect(r.history).toHaveLength(frames);expect(r.replay).toHaveLength(1);
});
