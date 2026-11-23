import {boostJoulesLeft,boostZone,remainingOrderJoules} from '../src/race/strategy-radio';
import {observeStrategy,sectorGaps,strategyRivals} from '../src/race/strategy-observation';
import {pitCommitmentPoint} from '../src/race/strategy-calls';
import {engineerProvider} from './engineer-provider';
import {damageLevel} from '../src/race/crashes';
import {drsAllowed,grip} from '../src/race/physics';
import {compounds,raceControlTelemetry,sectorWetnessOf} from '../src/race/race-control';
import {CIRCUITS,getTrack,type Track} from '../src/race/track';
import {choice,TypeSafeClient,APIError,APIConnectionError,APITimeoutError,APIUserAbortError,type TypeSafeClientConfig} from '@typesafe-ai/sdk';
import {z} from 'zod';
import {providerConfig,type ProviderConfig} from './provider';
import {mockDriver,mockEngineer} from '../src/race/brains';
import {nearbyRival,opponents,playerEntry} from '../src/race/grid';
import {type Car,type Race,type Team,type DriverIntent,type Instruction,type Decision} from '../src/race/types';
export {providerConfig};

const instructionSchema=z.object({
 pace:z.enum(['push','balanced','manage']),
 ers:z.enum(['deploy','balanced','harvest']),
 box:z.boolean(),
 tyre:z.enum(compounds),
 tactic:z.enum(['attack','defend','hold']),
 line:z.string().min(1).max(180),
 energy:z.object({
  priority:z.enum(['attack','defend']),
  zone:z.enum(['attack','defend','any']).optional(),
  budgetKJ:z.number().int().positive().max(4000),
  laps:z.number().int().min(1).max(3),
  releaseAttackIfBehindGtS:z.number().positive().max(10).optional(),
 }).optional(),
 fuelSave:z.object({
  sector:z.number().int().min(1).max(3),
  laps:z.number().int().min(1).max(3).default(1),
 }).optional(),
 yieldCar:z.boolean().optional(),
});

const REPLY_KEYS=['copy','attack','tyres','graining','wet','traffic','overheating'] as const;
type ReplyKey=typeof REPLY_KEYS[number];

function replyChoices(team:Team,fallbackReply:string):Record<ReplyKey,string>{
 return {
  copy:fallbackReply,
  attack:team==='a'?'Copy. Setting up the pass.':'I’m sending it. Watch this.',
  tyres:'The rears are going. Need a new set.',
  graining:'Fronts are graining through the medium-speed corners.',
  wet:'Track is too wet for these tyres — struggling for traction.',
  traffic:'Stuck in dirty air behind traffic — losing time in the corners.',
  overheating:'Tyres are overheating — need clean air or a cooler pace.',
 };
}

export function nearbyTrafficState(s:Race,team:Team){
 const c=s.cars[team],otherTeam:Team=team==='a'?'b':'a';
 const candidates=[
  {code:playerEntry(otherTeam).code,car:s.cars[otherTeam]},
  ...s.field.map((car,i)=>({code:opponents[i]?.code??`C${i}`,car})),
 ];
 return candidates
  .filter(({car})=>car.finishTime===null&&Math.abs(car.distance-c.distance)<=60)
  .map(({code,car})=>{
   const metres=Math.round(car.distance-c.distance);
   return {
    code,
    metres,
    offset:Math.round(car.offset*10)/10,
    closingMps:Math.round((c.speed-car.speed)*10)/10,
    alongside:Math.abs(metres)<8&&Math.abs(car.offset-c.offset)<4,
   };
  })
  .sort((a,b)=>Math.abs(a.metres)-Math.abs(b.metres))
  .slice(0,4);
}

function serializeInstruction(c:Car,track:Track){
 const inst=c.instruction,energy=inst.energy;
 const zoneMode=energy?.zone??energy?.priority??'attack';
 return {
  pace:inst.pace,
  ers:inst.ers,
  box:inst.box,
  tyre:inst.tyre,
  tactic:inst.tactic,
  line:inst.line,
  fuelSave:inst.fuelSave?{sector:inst.fuelSave.sector+1,expiresLap:inst.fuelSave.expiresLap}:null,
  yielding:Boolean((inst.yieldUntilLap&&c.lap<inst.yieldUntilLap)||(inst.teamOrder?.kind==='swap-back'&&!inst.teamOrder.completed&&c.lap<inst.teamOrder.expiresLap)),
  teamOrder:inst.teamOrder?{kind:inst.teamOrder.kind,completed:Boolean(inst.teamOrder.completed),expiresLap:inst.teamOrder.expiresLap}:null,
  energy:energy?{
   priority:energy.priority,
   zone:zoneMode,
   budgetKJ:energy.budgetKJ,
   remainingKJ:Math.round(remainingOrderJoules(c,energy)/1000),
   expiresLap:energy.expiresLap,
   window:zoneMode==='any'?null:boostZone(track,zoneMode),
   canDeployHere:boostJoulesLeft(c,track)>0,
  }:null,
 };
}

export function createRaceDriver(config:ProviderConfig,transport?:TypeSafeClientConfig['fetch'],clock:()=>number=Date.now){
 let blockedUntil=0,failures=0,lastFailure:Pick<Decision,'warning'|'api'>|null=null;
 const client=config.mock?null:new TypeSafeClient({apiKey:config.apiKey,baseURL:config.baseURL,compression:false,timeout:1200,retry:{maxRetries:0},logLevel:'off',...(transport?{fetch:transport}:{})});
 return async(s:Race,team:Team,sequence:number):Promise<Decision>=>{
  const start=performance.now(),fallback=mockDriver(s,team),done=(intent:DriverIntent,source:Decision['source']):Decision=>({sequence,intent,source,engine:'jev',responseMs:Math.max(1,Math.round(performance.now()-start))});
  if(!client)return {...done(fallback,'mock'),attempted:false};
  if(lastFailure&&clock()<blockedUntil)return {...done(fallback,'fallback'),...lastFailure,attempted:false,retryAfterMs:Number.isFinite(blockedUntil)?Math.max(1,blockedUntil-clock()):60_000};
  try{const c=s.cars[team],r=nearbyRival(s,team),track=getTrack(s.circuit);
   const {ahead,behind}=strategyRivals(s,team);
   const nearby=(car:typeof ahead)=>car?{metres:Math.round(car.distance-c.distance),offset:Math.round(car.offset*10)/10,closingMps:Math.round((c.speed-car.speed)*10)/10}:null;
   const replies=replyChoices(team,fallback.reply);
   const sectorWet=sectorWetnessOf(s.control,c.sector);
   const distanceToPitCommitment=Math.round(track.wrap(pitCommitmentPoint(track.PIT_ENTRY)-c.distance));
   const {answers}=await client.systemOne({model:config.model,state:{
    game:`F1 at ${CIRCUITS[s.circuit??'monza'].name}. Follow engineer strategy. Choose racing line, pace bias, braking aggression, ERS, DRS and cockpit feedback from road geometry, grip, tyre state, and nearby traffic. a=calm Ferrari; b=aggressive Mercedes.`,
    team,tick:s.tick,lap:c.lap+1,totalLaps:s.laps,sector:c.sector+1,
    metres:Math.round(c.distance),speedKmh:Math.round(c.speed*3.6),
    gapMetres:Math.round(r.distance-c.distance),rivalOffset:Math.round(r.offset*10)/10,closingSpeed:Math.round((c.speed-r.speed)*10)/10,
    heading:Math.round(c.heading*1000)/1000,offset:Math.round(c.offset*10)/10,
    racingLineOffset:Math.round(track.racingLineOffset(c.distance)*10)/10,
    rivals:{ahead:nearby(ahead),behind:nearby(behind)},
    nearbyTraffic:nearbyTrafficState(s,team),
    compound:c.compound,wear:Number(c.wear.toFixed(2)),tyreTempC:Math.round(c.temperature),lockup:Boolean(c.lockup),
    grip:Math.round(grip(c,sectorWet)*100)/100,damagePercent:Math.round(damageLevel(c.damage)*100),
    fuelKg:Math.round(c.fuel*100)/100,
    battery:Math.round(c.ers),ersUsedThisLapKJ:Math.round((c.ersUsed??0)/1000),ersLapLimitKJ:4000,
    drsEligible:c.eligible.some(Boolean),inDrsZone:drsAllowed(c,track),
    pitPhase:c.pit,distanceToPitCommitment,
    raceControl:raceControlTelemetry(s),rain:s.control?.rain??'dry',sectorWetness:Math.round(sectorWet*100)/100,
    roadAhead:[0,25,50,100,150,225,300].map(m=>({metres:m,curvature:track.signedCurvatureAt(c.distance+m),halfWidth:track.trackHalfWidth(c.distance+m)})),
    instruction:serializeInstruction(c,track),
   },questions:{
    line:choice('Choose racing line offset; pass beside traffic, never through it.',{left:'Offset -3m',hold:'Racing line',right:'Offset +3m'}),
    pace:choice('Cornering speed bias and tyre/fuel tradeoff.',{cautious:'-2.8% corner speed; saves tyres, heat and fuel',normal:'Balanced cornering speed and wear',attack:'+2.8% corner speed; +14% tyre wear, higher heat and fuel burn'}),
    brake:choice('Braking aggression and lockup risk.',{early:'Early smooth braking; conserves tyres and avoids lockups',normal:'Balanced braking',late:'Late threshold braking; faster entry, higher wear and lockup risk on worn or wet tyres'}),
    ers:choice('Deploy battery now?',{yes:'Deploy if charge and strategy order permit',no:'Harvest or hold'}),
    drs:choice('Request DRS if eligible?',{yes:'Open DRS in eligible zone',no:'Keep closed'}),
    reply:choice('Short cockpit feedback for the race engineer over team radio.',replies),
   }},{signal:AbortSignal.timeout(1400)});
   const line=answers.line.choice,pace=answers.pace.choice,brake=answers.brake.choice,reply=answers.reply.choice;
   if(!['left','hold','right'].includes(line)||!['cautious','normal','attack'].includes(pace)||!['early','normal','late'].includes(brake)||!(REPLY_KEYS as readonly string[]).includes(reply)||!['yes','no'].includes(answers.ers.choice)||!['yes','no'].includes(answers.drs.choice))throw new Error('Invalid Jev choice');
   failures=0;blockedUntil=0;lastFailure=null;
   return {...done({offset:line==='left'?-3:line==='right'?3:0,side:line,speedBias:pace==='attack'?2:pace==='cautious'?-2:0,brakeAggression:brake==='late'?.9:brake==='early'?.2:.55,ers:answers.ers.choice==='yes',drs:answers.drs.choice==='yes',reply:replies[reply as ReplyKey]},'jev'),attempted:true,api:{provider:config.provider,model:config.model}};
   }catch(error){
   failures++;
   const status=error instanceof APIError?error.status:undefined;
   const timeout=error instanceof APITimeoutError||error instanceof APIUserAbortError;
   const code=status===401?'authentication':status===403?'permission':status===429?'rate-limit':status===400||status===404||status===422?'request':status&&status>=500?'provider':timeout?'timeout':error instanceof APIConnectionError?'connection':'invalid-response';
   const warning=code==='authentication'?`${config.provider} rejected the API key (HTTP 401). Check the key and provider, then restart the server.`:code==='permission'?`${config.provider} denied access (HTTP 403). Check model permissions, then restart the server.`:code==='rate-limit'?`${config.provider} rate limit reached (HTTP 429). Waiting before another request.`:code==='request'?`${config.provider} rejected the request (HTTP ${status}). Check the selected Jev model.`:code==='provider'?`${config.provider} is unavailable (HTTP ${status}). Using local fallback temporarily.`:code==='timeout'?'Jev request timed out. Using local fallback temporarily.':code==='connection'?'Cannot reach Jev. Check server network access.':'Jev returned an invalid driving decision. Using local fallback.';
   const retryHeader=error instanceof APIError?error.headers.get('retry-after'):null;
   const headerDelay=retryHeader===null?0:/^\d+(?:\.\d+)?$/.test(retryHeader)?Number(retryHeader)*1000:Math.max(0,Date.parse(retryHeader)-clock())||0;
   const delay=Math.max(headerDelay,Math.min(60_000,1000*2**Math.min(6,failures-1)));
   blockedUntil=status===401||status===403?Infinity:Math.max(blockedUntil,clock()+(code==='request'?60_000:delay));
   const id=error instanceof APIError?error.requestId??error.headers.get('x-request-id'):null;
   const requestId=id&&/^[a-zA-Z0-9._:-]{1,160}$/.test(id)&&(!config.apiKey||!id.includes(config.apiKey))?id:undefined;
   lastFailure={warning,api:{provider:config.provider,model:config.model,status,code,...(requestId?{requestId}:{})}};
   return {...done(fallback,'fallback'),...lastFailure,attempted:true,retryAfterMs:Number.isFinite(blockedUntil)?Math.max(1,blockedUntil-clock()):60_000};
  }
 };
}
export function createRaceEngineer(env:Record<string,string|undefined>,transport:typeof fetch=fetch){
 const provider=engineerProvider(env,transport);
 return async(s:Race,team:Team,history:ReturnType<typeof sectorGaps>[]=[],onTelemetry?:(telemetry:ReturnType<typeof observeStrategy>)=>void)
 :Promise<{instruction:Instruction;source:'mock'|'live'|'fallback';responseMs:number}>=>{
  const start=performance.now(),rule=mockEngineer(s,team,true,history);
  if(!provider){
   onTelemetry?.(observeStrategy(s,team,history));
   return {instruction:rule,source:'mock',responseMs:1};
  }
  try{
   const observation=observeStrategy(s,team,history);
   onTelemetry?.(observation);
   const {energy,fuelSave,yieldCar,...call}=instructionSchema.parse(await provider.complete(
    'You are the F1 race strategist. Plan from standings, gaps, sector trends, compound life, fuel margin above the 1.0 kg FIA sample, mandatory two-dry-compound rule, pit rejoin traffic, weather sector wetness and laps remaining. The driver controls the car and may leave room or abandon a move. Hold position under safety car or yellow, weigh cheap SC stops and damage repair time, and compare wetness and wet grip across sectors in rain. Output JSON with pace (push, balanced, or manage), ers (deploy, balanced, or harvest), box (boolean), tyre (soft, medium, hard, intermediate, or wet), tactic (attack, defend, or hold), and line (short radio). Optional fields: energy ({priority: attack|defend, zone?: attack|defend|any, budgetKJ, laps: 1..3, releaseAttackIfBehindGtS?}), fuelSave ({sector: 1..3, laps: 1..3}), yieldCar (boolean). Existing unexpired energy orders share their original budget.',
    observation,AbortSignal.timeout(5000),.4,
   ));
   const car=s.cars[team],budgetKJ=Math.min(energy?.budgetKJ??0,Math.floor(observation.energy.chargeKJ));
   const order=energy&&call.ers==='deploy'&&budgetKJ>0?{priority:energy.priority,...(energy.zone?{zone:energy.zone}:{}),...(energy.releaseAttackIfBehindGtS?{releaseAttackIfBehindGtS:energy.releaseAttackIfBehindGtS}:{}),budgetKJ,expiresLap:Math.min(s.laps,car.lap+energy.laps),startJoules:car.ersDeployed??0}:undefined;
   const instruction:Instruction={
    ...call,
    ers:call.ers==='deploy'&&!order?'harvest':call.ers,
    ...(order?{energy:order}:{}),
    ...(fuelSave?{fuelSave:{sector:fuelSave.sector-1,expiresLap:Math.min(s.laps,car.lap+fuelSave.laps)}}:{}),
    ...(yieldCar?{yieldUntilLap:car.lap+1}:{}),
   };
   return {instruction,source:'live',responseMs:Math.round(performance.now()-start)};
  }catch{return {instruction:rule,source:'fallback',responseMs:Math.round(performance.now()-start)};}
 };
}
