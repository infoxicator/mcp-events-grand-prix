import {it,expect} from 'vitest';
import {createRaceDriver} from '../server/race-brains';
import {createRace} from '../src/race/physics';
const config={mock:false,provider:'typesafe' as const,apiKey:'secret-fixture-key',baseURL:'https://api.typesafe.ai',model:'jev-latest'};
const success=()=>{const answer=(choice:string)=>({type:'choice',choice,confidence:.95,probabilities:{[choice]:1}});return Response.json({model:'jev-latest',answers:Object.fromEntries(Object.entries({line:'left',pace:'attack',brake:'late',ers:'yes',drs:'yes',reply:'copy'}).map(([k,v])=>[k,answer(v)])),usage:{input_tokens:100,output_tokens:10}});};
it('reports HTTP 401 safely and stops provider calls until restart',async()=>{
 let now=1000,calls=0;const driver=createRaceDriver(config,async()=>{calls++;return Response.json({detail:{message:'Rejected secret-fixture-key: raw provider body must stay private'}},{status:401,headers:{'x-typesafe-request-id':'req_fixture_401'}});},()=>now);
 const d=await driver(createRace(),'a',1);expect(d.source).toBe('fallback');expect(d.api).toMatchObject({status:401,code:'authentication',provider:'typesafe',requestId:'req_fixture_401'});expect(d.warning).toContain('API key');expect(d.warning).toContain('restart');expect(d.attempted).toBe(true);expect(JSON.stringify(d)).not.toContain(config.apiKey);expect(JSON.stringify(d)).not.toContain('raw provider body');
 now+=3600000;const next=await driver(createRace(),'b',2);expect(next.attempted).toBe(false);expect(next.retryAfterMs).toBe(60000);expect(calls).toBe(1);
});
it('honors provider Retry-After across teams then recovers to confirmed Jev',async()=>{
 let now=1000,calls=0;const driver=createRaceDriver(config,async()=>++calls===1?Response.json({error:'rate limit'},{status:429,headers:{'retry-after':'30'}}):success(),()=>now);
 const failed=await driver(createRace(),'a',1);expect(failed.retryAfterMs).toBe(30000);expect(failed.api?.code).toBe('rate-limit');now+=29999;expect((await driver(createRace(),'b',2)).attempted).toBe(false);expect(calls).toBe(1);now++;const recovered=await driver(createRace(),'b',3);expect(recovered.source).toBe('jev');expect(recovered.attempted).toBe(true);expect(recovered.warning).toBeUndefined();expect(calls).toBe(2);
});
it('labels malformed decisions and transport failures without leaking provider data',async()=>{
 const malformed=createRaceDriver(config,async()=>Response.json({model:'jev-latest',answers:{}}));expect((await malformed(createRace(),'a',1)).api?.code).toBe('invalid-response');
 const offline=createRaceDriver(config,async()=>{throw new Error('Network failed: secret-fixture-key');});const d=await offline(createRace(),'a',1);expect(d.api?.code).toBe('connection');expect(JSON.stringify(d)).not.toContain(config.apiKey);
});
it('a mock driver never invokes the transport or claims a provider attempt',async()=>{
 let calls=0;const driver=createRaceDriver({...config,mock:true},async()=>{calls++;return success();});const d=await driver(createRace(),'a',1);expect(d.source).toBe('mock');expect(d.attempted).toBe(false);expect(calls).toBe(0);
});
