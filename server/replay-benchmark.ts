import {z} from 'zod';
import {isLiveKey,newLiveKey} from '../src/race/live';
import {STRATEGY_EVENT,WEBHOOK_STRATEGY_RESPONSE_MS} from '../src/race/strategy-events';
import {isReplayId,replayDecisions,replayHistoricalCall,replayObservation,replayRaceName,type ReplayDecision,type ReplayDriver,type ReplayRace,type ReplayTiming} from '../src/race/replay';
import type {Compound} from '../src/race/types';
import {eventInput,radioInput,type RadioInput} from './strategy-events';
import {postSepStrategyEvent,postStrategyEvent,subscribeInput,unsubscribeInput,verifyStrategyWebhook,webhookId,subscriptionId,type CallbackFailure,type StrategyWebhook} from '../worker/strategy-webhook';
import type {SepSubscribe,SepUnsubscribe} from '../worker/sep-events';
import {json} from '../worker/http';

const REPLAY_TTL_MS=2*60*60_000;
const REPLAY_KIND='historical-replay';

export const startReplayInput=z.object({race:z.string().refine(isReplayId).describe('Historical race ID from list_grand_prix_replays'),driver:z.number().int().positive().optional()});
export type StartReplayInput=z.infer<typeof startReplayInput>;

interface Window {
 index:number;
 id:string;
 issuedAt:number;
 expiresAt:number;
 delivery:'sending'|'delivered'|'failed';
}

interface Result {
 index:number;
 action:RadioInput['action']|null;
 radio:string|null;
 boxThisLap:boolean|null;
 tyre:Compound|null;
 responseMs:number|null;
 historical:ReturnType<typeof replayHistoricalCall>;
 timingMatch:boolean|null;
 compoundMatch:boolean|null;
}

export interface SavedReplay {
 room:string;
 origin?:string;
 race:string;
 driver:number;
 sep:boolean;
 key:string;
 subscriptionKey:string;
 expiresAt:number;
 webhook?:StrategyWebhook;
 window?:Window;
 results:Result[];
}

export interface ReplayBenchmarkAccess {
 room:string;
 race:ReplayRace;
 driver:{number:number;code:string;name:string};
 url:string;
 event_filter:{room:string;team:'a'}|{room:string;subscription_key:string};
 checkpoints:number;
}

export interface ReplayBenchmarkState {
 race:string;
 driver:number;
 connected:boolean;
 time:number;
 total:number;
 done:boolean;
 window?:{lap:number;reasons:string[];expiresAt:number;delivery:Window['delivery']};
 results:(Result&{lap:number;time:number;reasons:string[]})[];
}

interface Transport {
 save:(state:SavedReplay)=>Promise<unknown>;
 defer:(promise:Promise<unknown>)=>void;
 outbound:typeof fetch;
 outboundSep?:typeof fetch;
 authorizeSep?:(request:Request)=>boolean;
 verifySep?:(request:Request,subscription:StrategyWebhook)=>Promise<{failure:CallbackFailure|null}|{error:object}>;
}

export class ReplayBenchmark {
 private readonly driver:ReplayDriver;
 private readonly decisions:ReplayDecision[];
 private queue=Promise.resolve<unknown>(undefined);
 private deliveryAbort?:AbortController;

 static create(room:string,input:StartReplayInput,race:ReplayTiming,sep:boolean,transport:Transport){
  const driver=input.driver===undefined
   ?race.drivers.find(driver=>driver.finish===1)??race.drivers[0]
   :race.drivers.find(driver=>driver.number===input.driver);
  if(!driver||replayDecisions(race,driver).length===0)throw new Error('Choose a driver with recorded strategy checkpoints in this race.');
  return new ReplayBenchmark({
   room,race:race.id,driver:driver.number,sep,key:newLiveKey(),subscriptionKey:newLiveKey(),expiresAt:Date.now()+REPLAY_TTL_MS,results:[],
  },race,transport);
 }

 constructor(readonly state:SavedReplay,private readonly race:ReplayTiming,private readonly transport:Transport){
  this.driver=race.drivers.find(driver=>driver.number===state.driver)!;
  this.decisions=replayDecisions(race,this.driver);
 }

 get expired(){return this.state.expiresAt<=Date.now();}

 access(origin:string):ReplayBenchmarkAccess{
  const {room,sep,key,subscriptionKey}=this.state;
  const {id,name,circuit,year,laps,date}=this.race;
  const {number,code,name:driverName}=this.driver;
  const url=new URL('/',origin);
  url.search=new URLSearchParams({replay:id,benchmark:room}).toString();
  url.hash=new URLSearchParams({key}).toString();
  return {room,race:{id,name,circuit,year,laps,date},driver:{number,code,name:driverName},url:url.href,
   event_filter:sep?{room,team:'a'}:{room,subscription_key:subscriptionKey},checkpoints:this.decisions.length};
 }

 async save(){await this.transport.save(this.state);}

 private result(window:Window,radio?:RadioInput,now=Date.now()):Result{
  const decision=this.decisions[window.index];
  const historical=replayHistoricalCall(this.driver,decision);
  const boxThisLap=radio?Boolean((radio.box??(radio.action==='box'||radio.action==='cover'))&&radio.box_lap!=='next-lap'):null;
  return {
   index:window.index,action:radio?.action??null,radio:radio?.radio??null,boxThisLap,tyre:radio?.tyre??null,
   responseMs:radio?now-window.issuedAt:null,historical,
   timingMatch:radio?boxThisLap===(historical.action==='box'):null,
   compoundMatch:boxThisLap&&historical.action==='box'&&historical.compound!==null?radio?.tyre===historical.compound:null,
  };
 }

 private closeWindow(result:Result){
  this.state.results.push(result);
  delete this.state.window;
  this.deliveryAbort?.abort();
 }

 private event(window:Window){
  const {time,lap,reasons}=this.decisions[window.index];
  const observation=replayObservation(this.race,this.driver,this.decisions[window.index]);
  return {
   mode:REPLAY_KIND,room:this.state.room,team:'a' as const,event_id:window.id,lap,reasons,expiresAt:window.expiresAt,issuedAt:window.issuedAt,
   summary:{
    race:replayRaceName(this.race),driver:this.driver.code,timeMs:time,lapsRemaining:observation.lapsRemaining,
    position:observation.driver.position,interval:observation.driver.interval,compound:observation.driver.compound,
    tyreAge:observation.driver.tyreAge,flag:observation.flag,rain:observation.weather?.rain??null,
    question:'Box this lap (choose a tyre compound) or stay out? Use submit_grand_prix_radio with this event_id.',
   },
   observation,
  } as const;
 }

 private deliver(window:Window,subscription:StrategyWebhook){
  this.deliveryAbort?.abort();
  const abort=this.deliveryAbort=new AbortController();
  const {observation,...notice}=this.event(window);
  const result=this.state.sep
   ?postSepStrategyEvent(this.transport.outboundSep!,subscription,notice,window.issuedAt,abort.signal)
   :postStrategyEvent(this.transport.outbound,subscription,notice,abort.signal);
  this.transport.defer(result.then(delivered=>this.serialize(async()=>{
   if(abort.signal.aborted||this.state.window!==window)return;
   window.delivery=delivered===true||delivered==='delivered'?'delivered':'failed';
   await this.save();
  })));
 }

 private async advanceDeadline(now:number){
  const {window}=this.state;
  if(window&&window.expiresAt<=now){this.closeWindow(this.result(window));await this.save();}
 }

 private status(now:number):ReplayBenchmarkState{
  const {window,results,webhook}=this.state;
  const checkpoint=window?this.decisions[window.index]:this.decisions[results.length-1];
  return {
   race:this.race.id,driver:this.driver.number,connected:(webhook?.expiresAt??0)>now,
   time:checkpoint?.time??0,total:this.decisions.length,done:results.length===this.decisions.length,
   ...(window&&checkpoint?{window:{lap:checkpoint.lap,reasons:checkpoint.reasons,expiresAt:window.expiresAt,delivery:window.delivery}}:{}),
   results:results.map(result=>{
    const {lap,time,reasons}=this.decisions[result.index];
    return {...result,lap,time,reasons};
   }),
  };
 }

 private scope(req:Request){
  return this.state.sep===(new URL(req.url).searchParams.get('sep')==='1')&&
   (!this.state.sep||this.transport.authorizeSep?.(req));
 }

 private async subscription(req:Request,sep:boolean,subscribing:boolean){
  const error=(code:number,message:string,data?:object)=>json({error:{code,message,data}});
  if(sep!==this.state.sep||(sep&&!this.transport.authorizeSep?.(req)))return error(-32024,'Invalid replay seat.');
  const payload=await req.json();
  const parsed=sep?{success:true as const,data:payload as SepSubscribe|SepUnsubscribe}:(subscribing?subscribeInput:unsubscribeInput).safeParse(payload);
  if(!parsed.success)return error(-32602,'Invalid replay event subscription.');
  const input=parsed.data;
  if(input.arguments.room!==this.state.room||
     ('team' in input.arguments?input.arguments.team!=='a':input.arguments.subscription_key!==this.state.subscriptionKey))return error(-32024,'Invalid replay seat.');
  const url=new URL(input.delivery.url).href;
  const {webhook}=this.state;
  const active=webhook&&webhook.expiresAt>Date.now()?webhook:undefined;
  if(!subscribing){
   if(active?.url!==url)return sep?error(-32023,'Subscription not found.',{kind:'subscription'}):json({result:{}});
   delete this.state.webhook;
   this.deliveryAbort?.abort();
   if(this.state.window)this.state.window.delivery='failed';
   await this.save();
   return json({result:{}});
  }
  if(active&&active.url!==url)return error(-32025,'This replay already has a strategist.',{limit:'subscriptions',max:1});
  if(this.state.results.length===this.decisions.length)return error(-32024,'This benchmark has ended.');
  const {delivery:{secret},ttlMs}=input as SepSubscribe|z.infer<typeof subscribeInput>;
  const id=active?.id??(sep?await subscriptionId(['configured-client',url,STRATEGY_EVENT,{room:this.state.room,team:'a'}])
   :await webhookId(this.state.room,url,'a'));
  const subscription={id,url,secret,expiresAt:this.state.expiresAt};
  const refreshing=active?.secret===secret;
  if(!refreshing){
   const verified=sep?await this.transport.verifySep!(req,subscription)
    :{failure:await verifyStrategyWebhook(this.transport.outbound,subscription)};
   if('error' in verified)return json(verified);
   if(verified.failure)return error(sep?-32027:-32015,'The callback endpoint did not verify.',{reason:verified.failure});
  }
  const now=Date.now();
  if(this.expired)return error(-32024,'This benchmark has ended.');
  subscription.expiresAt=Math.min(this.state.expiresAt,now+(ttlMs??REPLAY_TTL_MS));
  this.state.webhook=subscription;
  const window=this.state.window;
  const redeliver=window&&window.expiresAt>now&&(!refreshing||window.delivery==='failed');
  if(redeliver)window.delivery='sending';
  await this.save();
  if(redeliver)this.deliver(window,subscription);
  return json({result:{id,refreshBefore:new Date(subscription.expiresAt).toISOString(),cursor:null,truncated:false}});
 }

 handle(req:Request){
  return this.serialize(()=>this.respond(req));
 }

 private serialize<T>(run:()=>Promise<T>){
  const next=this.queue.then(run);
  this.queue=next.catch(()=>{});
  return next;
 }

 private async respond(req:Request){
  const now=Date.now();
  if(this.expired)return json({error:'Replay benchmark expired.'},404);
  const path=new URL(req.url).pathname;
  await this.advanceDeadline(now);
  if(path==='/internal-replay-status'||path==='/internal-replay-next'){
   if(req.headers.get('Authorization')!==`Bearer ${this.state.key}`)return json({error:'Replay controller required.'},403);
   if(path.endsWith('next')){
    if(this.state.window||this.state.results.length===this.decisions.length)return json(this.status(now));
    const subscription=this.state.webhook;
    if(!subscription||subscription.expiresAt<=now)return json({error:'Subscribe a model before advancing the benchmark.'},409);
    const window:Window={index:this.state.results.length,id:crypto.randomUUID(),issuedAt:now,
     expiresAt:Math.min(now+WEBHOOK_STRATEGY_RESPONSE_MS,this.state.expiresAt,subscription.expiresAt),delivery:'sending'};
    this.state.window=window;
    await this.save();
    this.deliver(window,subscription);
   }
   return json(this.status(now));
  }
  if(path==='/internal-strategy-event'&&this.scope(req)){
   const input=eventInput.safeParse(await req.json());
   const {window}=this.state;
   if(input.success&&input.data.room===this.state.room&&input.data.team!=='b'&&window?.id===input.data.event_id&&window){
    return json(this.event(window));
   }
   return json({error:'Use the event_id from an active replay decision.'},410);
  }
  if(path==='/internal-strategy-radio'&&this.scope(req)){
   const input=radioInput.safeParse(await req.json());
   const {window}=this.state;
   if(!input.success||input.data.room!==this.state.room||input.data.team==='b'||!window||input.data.event_id!==window.id){
    return json({error:'Use the event_id from an active replay decision.'},409);
   }
   const radio=input.data;
   const result=this.result(window,radio,now);
   if(result.boxThisLap&&!radio.tyre)return json({error:'Choose a tyre compound when boxing this lap.'},400);
   this.closeWindow(result);
   await this.save();
   return json({team:'a',line:radio.radio,driver:this.driver.name,mode:REPLAY_KIND});
  }
  if(req.method==='POST'&&/^\/internal-(?:sep|strategy)-(?:subscribe|unsubscribe)$/.test(path)){
   return this.subscription(req,path.startsWith('/internal-sep-'),path.endsWith('-subscribe'));
  }
  return json({error:'Invalid replay request.'},404);
 }
}

export type ReplayStrategyEvent=ReturnType<ReplayBenchmark['event']>;
export type ReplayStrategyNotice=Omit<ReplayStrategyEvent,'observation'|'issuedAt'>;
export const isReplayAuthorization=(value:string|null)=>isLiveKey(value?.match(/^Bearer (.+)$/)?.[1]);
