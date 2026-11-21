import {boostJoulesLeft,boostZone} from '../src/race/strategy-radio';
import {observeStrategy,sectorGaps,strategyRivals} from '../src/race/strategy-observation';
import {engineerProvider} from './engineer-provider';
import {damageLevel} from '../src/race/crashes';
import {grip} from '../src/race/physics';
import {compounds,raceControlTelemetry} from '../src/race/race-control';
import {CIRCUITS,getTrack} from '../src/race/track';
import {choice,TypeSafeClient,APIError,APIConnectionError,APITimeoutError,APIUserAbortError,type TypeSafeClientConfig} from '@typesafe-ai/sdk';
import {z} from 'zod';
import {providerConfig,type ProviderConfig} from './provider';
import {mockDriver,mockEngineer} from '../src/race/brains';
import {nearbyRival} from '../src/race/grid';
import {type Race,type Team,type DriverIntent,type Instruction,type Decision} from '../src/race/types';
export {providerConfig};
const instructionSchema=z.object({pace:z.enum(['push','balanced','manage']),ers:z.enum(['deploy','balanced','harvest']),box:z.boolean(),tyre:z.enum(compounds),tactic:z.enum(['attack','defend','hold']),line:z.string().min(1).max(180),energy:z.object({
 priority:z.enum(['attack','defend']),budgetKJ:z.number().int().positive().max(4000),laps:z.number().int().min(1).max(3),
}).optional()});
export function createRaceDriver(config:ProviderConfig,transport?:TypeSafeClientConfig['fetch'],clock:()=>number=Date.now){
 let blockedUntil=0,failures=0,lastFailure:Pick<Decision,'warning'|'api'>|null=null;
 const client=config.mock?null:new TypeSafeClient({apiKey:config.apiKey,baseURL:config.baseURL,compression:false,timeout:1200,retry:{maxRetries:0},logLevel:'off',...(transport?{fetch:transport}:{})});
 return async(s:Race,team:Team,sequence:number):Promise<Decision>=>{
  const start=performance.now(),fallback=mockDriver(s,team),done=(intent:DriverIntent,source:Decision['source']):Decision=>({sequence,intent,source,engine:'jev',responseMs:Math.max(1,Math.round(performance.now()-start))});
  if(!client)return {...done(fallback,'mock'),attempted:false};
  if(lastFailure&&clock()<blockedUntil)return {...done(fallback,'fallback'),...lastFailure,attempted:false,retryAfterMs:Number.isFinite(blockedUntil)?Math.max(1,blockedUntil-clock()):60_000};
  try{const c=s.cars[team],r=nearbyRival(s,team),track=getTrack(s.circuit);
   const {ahead,behind}=strategyRivals(s,team);
   const {energy,...instruction}=c.instruction;
   const nearby=(car:typeof ahead)=>car?{metres:car.distance-c.distance,offset:car.offset,closingMps:c.speed-car.speed}:null;
   const {answers}=await client.systemOne({model:config.model,state:{game:`F1 at ${CIRCUITS[s.circuit??'monza'].name}. Follow engineer strategy. Choose a line and braking aggression from the geometry and nearby traffic. a=calm Ferrari; b=aggressive Mercedes.`,team,tick:s.tick,metres:Math.round(c.distance),speedKmh:Math.round(c.speed*3.6),gapMetres:Math.round(r.distance-c.distance),rivalOffset:r.offset,closingSpeed:c.speed-r.speed,heading:c.heading,offset:c.offset,rivals:{ahead:nearby(ahead),behind:nearby(behind)},grip:grip(c,s.control?.wetness),raceControl:raceControlTelemetry(s),rain:s.control?.rain??'dry',roadAhead:[0,25,50,100,150,225,300].map(m=>({metres:m,curvature:track.signedCurvatureAt(c.distance+m),halfWidth:track.trackHalfWidth(c.distance+m)})),wear:Number(c.wear.toFixed(2)),damagePercent:Math.round(damageLevel(c.damage)*100),battery:Math.round(c.ers),instruction:{...instruction,energy:energy?{...energy,zone:boostZone(track,energy.priority),canDeployHere:boostJoulesLeft(c,track)>0}:null}},questions:{line:choice('Choose racing line; pass beside, not through the rival.',{left:'Offset -3m',hold:'Racing line',right:'Offset +3m'}),pace:choice('Target speed bias in addition to safe local cornering.',{cautious:'-2m/s',normal:'0m/s',attack:'+2m/s'}),brake:choice('Brake point aggression.',{early:'Conserve tyres',normal:'Balanced',late:'Late braking'}),ers:choice('Deploy battery now?',{yes:'Deploy',no:'Harvest or hold'}),drs:choice('Request DRS if eligible?',{yes:'Use eligible DRS zone',no:'Keep closed'}),reply:choice('Reply over team radio.',{copy:fallback.reply,attack:team==='a'?'Copy. Setting up the pass.':'I’m sending it. Watch this.',tyres:'The rears are going. Need a new set.'})}},{signal:AbortSignal.timeout(1400)});
   const line=answers.line.choice,pace=answers.pace.choice,brake=answers.brake.choice,reply=answers.reply.choice;
   if(!['left','hold','right'].includes(line)||!['cautious','normal','attack'].includes(pace)||!['early','normal','late'].includes(brake)||!['copy','attack','tyres'].includes(reply)||!['yes','no'].includes(answers.ers.choice)||!['yes','no'].includes(answers.drs.choice))throw new Error('Invalid Jev choice');
   failures=0;blockedUntil=0;lastFailure=null;
   return {...done({offset:line==='left'?-3:line==='right'?3:0,side:line,speedBias:pace==='attack'?2:pace==='cautious'?-2:0,brakeAggression:brake==='late'?.9:brake==='early'?.2:.55,ers:answers.ers.choice==='yes',drs:answers.drs.choice==='yes',reply:reply==='copy'?fallback.reply:reply==='attack'?(team==='a'?'Copy. Setting up the pass.':'I’m sending it. Watch this.'):'The rears are going. Need a new set.'},'jev'),attempted:true,api:{provider:config.provider,model:config.model}};
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
 return async(s:Race,team:Team,history:ReturnType<typeof sectorGaps>[]=[]):Promise<{instruction:Instruction;source:'mock'|'live'|'fallback';responseMs:number}>=>{
  const start=performance.now(),rule=mockEngineer(s,team,true,history);
  if(!provider)return {instruction:rule,source:'mock',responseMs:1};
  try{
   const observation=observeStrategy(s,team,history);
   const {energy,...call}=instructionSchema.parse(await provider.complete(
    'You are the F1 race strategist. Plan from the gaps, sector trends, resource projections, traffic and laps remaining. The driver controls the car and may leave room or abandon a move. Hold position under safety car or yellow, consider pit loss, and compare wetness and tyre choice in rain. Output JSON with pace (push, balanced, or manage), ers (deploy, balanced, or harvest), box (boolean), tyre (soft, medium, hard, intermediate, or wet), tactic (attack, defend, or hold), and line (short radio). When allocating energy, set ers to deploy and include energy with priority (attack or defend), budgetKJ (positive integer, capped by charge), and laps (integer from 1 to 3). Attack targets the back straight; defend targets the main straight. Existing unexpired orders share their original budget.',
    observation,AbortSignal.timeout(5000),.4,
   ));
   const car=s.cars[team],budgetKJ=Math.min(energy?.budgetKJ??0,Math.floor(observation.energy.chargeKJ));
   const order=energy&&call.ers==='deploy'&&budgetKJ>0?{priority:energy.priority,budgetKJ,expiresLap:Math.min(s.laps,car.lap+energy.laps),startJoules:car.ersDeployed??0}:undefined;
   const instruction:Instruction={...call,ers:call.ers==='deploy'&&!order?'harvest':call.ers,...(order?{energy:order}:{})};
   return {instruction,source:'live',responseMs:Math.round(performance.now()-start)};
  }catch{return {instruction:rule,source:'fallback',responseMs:Math.round(performance.now()-start)};}
 };
}
