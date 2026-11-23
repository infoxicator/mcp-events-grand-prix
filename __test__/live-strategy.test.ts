import {expect,test,vi} from 'vitest';
import {createCornerProvider,runLiveBattery,runLiveCorner,runLivePit,strategyModels} from '../server/strategy-benchmarks';
import {engineerProvider} from '../server/engineer-provider';
import {steeringTo} from '../src/race/physics';
import {getTrack} from '../src/race/track';
import {batteryState,cornerDriver,cornerSession} from '../src/race/strategy-benchmarks';
import {pitReplayState,pitStrategyReplay} from '../src/race/pit-strategy-replay';

const env={ENGINEER_PROVIDER:'openrouter',OPENROUTER_API_KEY:'fixture-only',ENGINEER_MODEL:'fixture-chatgpt'};
const answer=(choice:string)=>({type:'choice',choice,confidence:.95,probabilities:{[choice]:1}});

test('live Jev receives geometry and chooses controls independently of the local brake planner', async()=>{
 const transport=vi.fn<typeof fetch>(async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  expect(body.model).toBe('fixture-jev');
  expect(body.state).toMatchObject({speed:65,curvatureSamplesAhead:[0,20,50,100],rivalLateral:-2.6});
  expect(body.state.curvature).toHaveLength(4);
  return Response.json({model:'fixture-jev',answers:{
   line:answer('right'),throttle:answer('full'),brake:answer('firm'),
  },usage:{input_tokens:100,output_tokens:10}});
 });
 const choose=createCornerProvider({mock:false,provider:'typesafe',apiKey:'fixture-only',baseURL:'https://api.typesafe.ai',model:'fixture-jev'},transport);
 const snapshot=cornerSession(true,'adaptive').next().value;
 if(!('speed' in snapshot))throw Error('Missing initial observation');
 const control=await choose(snapshot,new AbortController().signal);
 expect(control).toMatchObject({throttle:0,brake:.9});
 const track=getTrack();
 const lookahead=snapshot.speed*.25;
 expect(control.steering).toBe(steeringTo(track,snapshot.distance,snapshot.lateral,snapshot.heading,lookahead,3));
 expect(transport).toHaveBeenCalledTimes(1);
});

test('late and unavailable Jev decisions are counted separately and usable controls drive the rest',async()=>{
 let calls=0;
 const run=await runLiveCorner(true,async(input)=>{
  calls++;
  if(calls===1)await new Promise<void>(()=>{});
  if(calls===2)throw Error('Fixture provider error');
  return cornerDriver(input);
 },new AbortController().signal,async()=>{});
 expect(run.finished).toBe(true);
 expect(run.missed).toBeGreaterThanOrEqual(1);
 expect(run.unavailable).toBe(1);
 expect(run.applied+run.missed+run.unavailable).toBe(calls);
 expect(run.applied).toBeGreaterThan(0);
});

test('ChatGPT sees each original battery state and the resulting decision is replayed on every matched seed',async()=>{
 const observed: unknown[]=[];
 const transport:typeof fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  observed.push(JSON.parse(body.messages[1].content));
  const call=observed.length===1?'defend':'attack';
  return Response.json({choices:[{message:{content:JSON.stringify({priority:call,radio:'Fixture '+call})}}]});
 };
 const result=await runLiveBattery(engineerProvider(env,transport)!,new AbortController().signal);
 expect(observed).toEqual([batteryState(1),batteryState(8)]);
 for(const variant of result.variants)for(const [selected,alternative] of variant.pairs){
  expect(selected.seed).toBe(alternative.seed);
  expect(selected.call.message).toBe(variant.closing===1?'Fixture defend':'Fixture attack');
  expect(selected.call.priority).not.toBe(alternative.call.priority);
  expect(selected.gaps.slice(0,3)).toEqual(alternative.gaps.slice(0,3));
 }
});

test('ChatGPT gets matched pit observations and selected calls use the measured delivery position',async()=>{
 const observed:unknown[]=[];
 const transport:typeof fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  observed.push(JSON.parse(body.messages[1].content));
  return Response.json({choices:[{message:{content:JSON.stringify({priority:observed.length===1?'box':'extend',radio:'Fixture radio'})}}]});
 };
 const result=await runLivePit(engineerProvider(env,transport)!,new AbortController().signal);
 expect(observed).toEqual([pitReplayState(26),pitReplayState(15)]);
 expect(result.variants.map(v=>v.run.stopLap)).toEqual([1,2]);
 const {run}=result.variants[0];
 expect(pitStrategyReplay(26,'box',false,run.entry.commitment+1).stopLap).toBe(2);
});

test('mock mode never exposes live models and malformed ChatGPT calls fail the benchmark',async()=>{
 expect(strategyModels({...env,JEV_MOCK:'1'})).toEqual({jev:null,chatgpt:null});
 const malformed=engineerProvider(env,async()=>Response.json({choices:[{message:{content:'{"priority":"both"}'}}]}))!;
 await expect(runLiveBattery(malformed,new AbortController().signal)).rejects.toThrow();
});
