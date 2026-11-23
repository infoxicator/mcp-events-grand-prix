import {setTimeout as sleep} from 'node:timers/promises';
import {APIError,TypeSafeClient,choice,type TypeSafeClientConfig} from '@typesafe-ai/sdk';
import {z} from 'zod';
import {clamp,steeringTo,type DriverControls} from '../src/race/physics';
import {getTrack} from '../src/race/track';
import {batteryReplay,batterySeeds,batteryState,CORNER_DEADLINE_MS,cornerDriver,cornerReplay,cornerSession,type CornerInput} from '../src/race/strategy-benchmarks';
import {pitReplayState,pitStrategyReplay} from '../src/race/pit-strategy-replay';
import {engineerProvider} from './engineer-provider';
import {providerConfig,type ProviderConfig} from './provider';

export const benchmarkNames = ['corner','battery','pit-replay'] as const;
export type BenchmarkName = typeof benchmarkNames[number];
type Env = Record<string,string|undefined>;

export function strategyModels(env: Env) {
 const jev = providerConfig(env);
 return {jev:jev.mock ? null : jev.model, chatgpt:engineerProvider(env)?.model ?? null};
}

type ChooseControls = (input: CornerInput, signal: AbortSignal) => Promise<DriverControls>;
export function createCornerProvider(config: ProviderConfig, transport?: TypeSafeClientConfig['fetch']): ChooseControls {
 const client = new TypeSafeClient({apiKey:config.apiKey,baseURL:config.baseURL,timeout:CORNER_DEADLINE_MS,retry:{maxRetries:0},logLevel:'off',...(transport?{fetch:transport}:{})});
 const track = getTrack();
 return async (input,signal) => {
  const lookahead = clamp(input.speed * .25,7,24);
  const halfWidth = track.trackHalfWidth(input.distance + lookahead) - 1.05;
  const aim = {left:-Math.min(3,halfWidth),centre:0,right:Math.min(3,halfWidth)};
  const steering = Object.fromEntries(Object.entries(aim).map(([lane,offset])=>[
   lane,steeringTo(track,input.distance,input.lateral,input.heading,lookahead,offset),
  ]));
  const {answers} = await client.systemOne({
   model:config.model,
   state:{
    instruction:'Push. Drive the next 200 ms of Monza Rettifilo. Leave room when a rival is alongside and accelerate on exit.',
    units:'Metres, m/s, radians, curvature 1/m. Negative lateral offset is left. Distance to turn is 0 in the corner and null after it.',
    curvatureSamplesAhead:[0,20,50,100],
    ...input,halfWidth,lookahead,
   },
   questions:{
    line:choice('Where should the car aim across the road?',{left:'3 m left',centre:'Centre',right:'3 m right'}),
    throttle:choice('How much throttle now?',{coast:'0%',partial:'35%',full:'100%'}),
    brake:choice('How much brake now?',{none:'0%',partial:'45%',firm:'90%'}),
   },
  },{signal});
  const line=z.enum(['left','centre','right']).parse(answers.line.choice);
  const throttle=z.enum(['coast','partial','full']).parse(answers.throttle.choice);
  const brake=z.enum(['none','partial','firm']).parse(answers.brake.choice);
  return {steering:steering[line],throttle:brake==='none'?{coast:0,partial:.35,full:1}[throttle]:0,brake:{none:0,partial:.45,firm:.9}[brake]};
 };
}

export async function runLiveCorner(inside: boolean, choose: ChooseControls, signal: AbortSignal, pace: (ms:number,signal:AbortSignal)=>Promise<void> = (ms,abort)=>sleep(ms,undefined,{signal:abort})) {
 const session = cornerSession(inside,'adaptive');
 let step = session.next();
 let unavailable = false;
 while (!step.done) {
  signal.throwIfAborted();
  const input = step.value;
  const start = performance.now();
  const deadline = AbortSignal.timeout(CORNER_DEADLINE_MS);
  let controls: DriverControls | undefined;
  if (!unavailable) {
   const requestSignal=AbortSignal.any([signal,deadline]);
   const expired=new Promise<undefined>(resolve=>{
    requestSignal.addEventListener('abort',()=>resolve(undefined),{once:true});
   });
   try {controls = await Promise.race([choose(input,requestSignal),expired]);}
   catch (error) {
    if (error instanceof APIError && [400,401,403,404,422,429].includes(error.status ?? 0)) unavailable=true;
   }
  }
  signal.throwIfAborted();
  const elapsed = performance.now() - start;
  const status = deadline.aborted || elapsed >= CORNER_DEADLINE_MS ? 'late' : controls ? 'applied' : 'unavailable';
  step = session.next({status,controls:status==='applied'?controls:cornerDriver(input)});
  if (!step.done && !unavailable && elapsed < CORNER_DEADLINE_MS) await pace(CORNER_DEADLINE_MS-elapsed,signal);
 }
 return step.value;
}

const radio = z.string().trim().min(1).max(180);
const energyCall = z.object({priority:z.enum(['attack','defend']),radio});
const pitCall = z.object({priority:z.enum(['box','extend']),radio});
type Strategist = NonNullable<ReturnType<typeof engineerProvider>>;

export async function runLiveBattery(strategist: Strategist, signal: AbortSignal) {
 const variants = [];
 for (const closing of [1,8]) {
  const state = batteryState(closing);
  const start = performance.now();
  const call = energyCall.parse(await strategist.complete(
   'You are ChatGPT on the F1 pit wall. Jev is P3 with two laps to go. Gaps are in seconds, histories oldest first and each zone gives its start and end in metres and zero-based sector index. Allocate the single boost to attack P2 or defend from P4. Compare gap trends, closing speed, zone and expected recharge. The driver decides whether there is an opening. Return JSON with priority (attack or defend) and radio (one brief instruction).',
   state,signal,
  ));
  const responseMs = Math.round(performance.now()-start);
  const alternative = call.priority==='attack'?'defend':'attack';
  const pairs = batterySeeds.map(seed=>[
   batteryReplay(state,seed,call.priority,call.radio,true),
   batteryReplay(state,seed,alternative,undefined,true),
  ] as const);
  variants.push({closing,responseMs,pairs});
 }
 return {model:strategist.model,variants};
}

export async function runLivePit(strategist: Strategist, signal: AbortSignal) {
 const variants = [];
 for (const rearGap of [26,15]) {
  const state=pitReplayState(rearGap);
  const start = performance.now();
  const call = pitCall.parse(await strategist.complete(
   'You are ChatGPT on the F1 pit wall. Compare boxing now against extending one lap on the current tyres. The following traffic stops on the second lap. Gap, pit loss, traffic loss and fresh tyre gain are in seconds. Both alternatives must complete one stop. Return JSON with priority (box or extend) and radio (one brief instruction).',
   state,signal,
  ));
  const elapsedMs=performance.now()-start;
  const receivedAt=state.observationAt+elapsedMs/1000*state.approachSpeed;
  variants.push({rearGap,call,responseMs:Math.round(elapsedMs),run:pitStrategyReplay(rearGap,call.priority,false,receivedAt)});
 }
 return {model:strategist.model,variants};
}

export async function runLiveStrategy(name: BenchmarkName, env: Env, signal: AbortSignal) {
 if (name==='corner') {
  const config = providerConfig(env);
  if (config.mock) throw new Error('Configure a live Jev provider to run the corner benchmark.');
  const choose = createCornerProvider(config);
  const runs = [];
  for (const inside of [false,true]) runs.push(await runLiveCorner(inside,choose,signal));
  for (const inside of [false,true]) runs.push(cornerReplay(inside,'reference'));
  return {model:config.model,runs};
 }
 const strategist = engineerProvider(env);
 if (!strategist) throw new Error('Configure a live ChatGPT provider to run strategy benchmarks.');
 return name==='battery'?runLiveBattery(strategist,signal):runLivePit(strategist,signal);
}
