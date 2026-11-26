import {z} from 'zod';
import {observeStrategy} from '../src/race/strategy-observation';
import {DRIVER_RADIO_TEXT_LIMIT,STRATEGY_EVENT,STRATEGY_RESPONSE_MS,type DriverQuestion,type StrategyEventNotice} from '../src/race/strategy-events';
import {VEHICLE} from '../src/race/vehicle';
import {compounds,rainLevels} from '../src/race/race-control';
import type {Car,Compound,Instruction,Race} from '../src/race/types';

const eventNoticeBase=z.object({room:z.string().uuid(),event_id:z.string().uuid()});
export const eventInput=z.object({
 room:z.string().uuid(),
 event_id:z.string().uuid().optional().describe('Event ID from the webhook notification. Omit to read live telemetry for the active race.'),
 team:z.enum(['a','b']).optional().describe('Assigned seat (optional in solo races; required only when omitting event_id in a two-strategist race).'),
});
const driverRadioText=z.string().trim().min(1).max(DRIVER_RADIO_TEXT_LIMIT);
export const driverQuestionInput=eventInput.extend({
 event_id:z.string().uuid().describe('Event ID of the driver question notification.'),
});
export const driverAnswerInput=driverQuestionInput.extend({
 reply:driverRadioText.optional().describe('Short radio reply to the driver. Omit if the reply is declined or cancelled.'),
});
export type DriverAnswerInput=z.infer<typeof driverAnswerInput>;
export const strategyFilter=z.object({room:z.string().uuid(),subscription_key:z.string().regex(/^[a-f0-9]{64}$/)});
export const radioInput=eventInput.extend({
 action:z.enum(['hold','attack','defend','save-fuel','yield','push','manage','box','extend','cover','harvest','swap','swap-back']),
 radio:z.string().trim().min(1).max(180).describe('Short radio instruction for this driver.'),
 budget_kj:z.number().int().positive().max(4000).optional().describe('Allocate ERS boost budget (kJ) for attack, defence, or an in-lap push. Omit to conserve energy.'),
 sector:z.number().int().min(1).max(3).optional().describe('One-based lift-and-coast fuel-saving sector (required for save-fuel; optional composable override on other actions).'),
 laps:z.number().int().min(1).max(3).optional().describe('Valid for one lap by default. Can extend fuel, energy, or team orders up to three laps.'),
 tyre:z.enum(compounds).optional().describe('Required when boxing, covering, or setting box=true. Must have at least 1 set remaining in tyres.availableSets.'),
 pace:z.enum(['push','balanced','manage']).optional().describe('Optional composable pace override (e.g., push on an in-lap while boxing, or manage while extending).'),
 ers:z.enum(['deploy','balanced','harvest']).optional().describe('Optional composable ERS mode override.'),
 zone:z.enum(['attack','defend','any']).optional().describe('ERS deployment zone: attack (back straight), defend (main straight), or any (full lap).'),
 box:z.boolean().optional().describe('Optional composable pit call override (requires tyre when true).'),
 box_lap:z.enum(['this-lap','next-lap']).optional().describe('Queue a pit stop for next-lap instead of boxing immediately this lap.'),
 target_car:z.string().trim().min(2).max(5).optional().describe('Optional 3-letter car code to yield cleanly to (e.g., LEC) when action is yield.'),
 release_attack_if_behind_gt_s:z.number().positive().max(10).optional().describe('Optional conditional release: switch defensive ERS to attack if gap behind exceeds this threshold (seconds).'),
 revisit_condition:z.string().trim().min(1).max(120).optional().describe('Optional strategic note recording when to revisit this call.'),
});
export type RadioInput=z.infer<typeof radioInput>;

const compoundNumberSchema=z.object({
 soft:z.number(),medium:z.number(),hard:z.number(),intermediate:z.number(),wet:z.number(),
});

const replayNotice=eventNoticeBase.extend({
 mode:z.literal('historical-replay'),team:z.literal('a'),lap:z.number().int(),reasons:z.array(z.string()),expiresAt:z.number(),
 summary:z.object({
  race:z.string(),driver:z.string(),timeMs:z.number(),lapsRemaining:z.number(),position:z.number().nullable(),
  interval:z.union([z.number(),z.string()]).nullable(),compound:z.enum(compounds).nullable(),tyreAge:z.number().nullable(),
  flag:z.string(),rain:z.boolean().nullable(),question:z.string(),
 }),
});

export const strategyEventDefinition={
 name:STRATEGY_EVENT,
 description:'Your strategy seat needs a radio response. Open a seat with open_grand_prix_strategy or open_grand_prix_replay and use its event_filter. If driverQuestion is present, respond using answer_grand_prix_driver. For other events, use submit_grand_prix_radio or read full telemetry with get_grand_prix_strategy_event.',
 delivery:['webhook'],
 inputSchema:z.toJSONSchema(strategyFilter),
 payloadSchema:z.toJSONSchema(z.union([eventNoticeBase.extend({
  team:z.enum(['a','b']),lap:z.number().int(),reasons:z.array(z.string()),expiresAt:z.number(),
  driverQuestion:z.object({text:driverRadioText,source:z.enum(['automatic','driver'])}).optional(),
  summary:z.object({
   speedKph:z.number(),position:z.number(),lapsRemaining:z.number(),
   compound:z.enum(compounds),tyreWear:z.number(),availableSets:compoundNumberSchema,
   chargeKJ:z.number(),projectedFuelKg:z.number(),marginAboveFuelSampleKg:z.number(),
   gapAheadSeconds:z.number().nullable(),gapBehindSeconds:z.number().nullable(),
   damage:z.boolean(),pitPhase:z.enum(['none','entry','stopped','exit']),plannedCompound:z.enum(compounds).nullable(),
   distanceToPitCommitmentM:z.number(),estimatedRejoinPosition:z.number(),teammateInPitLane:z.boolean(),
   dryCompoundRuleSatisfied:z.boolean(),
   flag:z.enum(['green','yellow','safety-car']),speedLimitKph:z.number().nullable(),
   safetyCarScheduledLap:z.number().nullable(),safetyCarInLap:z.number().nullable(),
   rain:z.enum(rainLevels),wetness:z.number(),sectorWetness:z.tuple([z.number(),z.number(),z.number()]),
   wetGripByCompound:compoundNumberSchema,
  }),
 }),replayNotice])),
};

export interface StrategyEvent extends StrategyEventNotice {
 event_id:string;
 observation:ReturnType<typeof observeStrategy>;
 issuedAt:number;
}
export type DriverQuestionEvent=StrategyEvent&{driverQuestion:DriverQuestion};
type DriverConsultation={event:DriverQuestionEvent;consultationId:string};
export type LiveStrategyRead=Omit<StrategyEvent,'event_id'>&{
 event_id?:string;
 superseded?:boolean;
 proactive?:boolean;
};
export type StrategyWindow={lap:number;change:string;revision:number;raceControlChange?:boolean};
export type PendingStrategy={event:StrategyEvent;window:StrategyWindow};

const round2=(n:number|null)=>n===null?null:Math.round(n*100)/100;
const MAX_RECENT_EVENTS=12;
const MAX_CONSUMED_IDS=64;

export function strategySummary(observation:StrategyEvent['observation']):StrategyEventNotice['summary']{
 return {
  speedKph:observation.telemetry.speedKph,
  position:observation.telemetry.position,
  lapsRemaining:observation.lapsRemaining,
  compound:observation.tyres.compound,
  tyreWear:observation.tyres.wear,
  availableSets:{...observation.tyres.availableSets},
  chargeKJ:observation.energy.chargeKJ,
  projectedFuelKg:observation.fuel.projectedAtFlagKg,
  marginAboveFuelSampleKg:observation.fuel.marginAboveSampleKg,
  gapAheadSeconds:round2(observation.gaps.ahead),
  gapBehindSeconds:round2(observation.gaps.behind),
  damage:Boolean(observation.damage),
  pitPhase:observation.pit.phase,
  plannedCompound:observation.pit.plannedCompound,
  distanceToPitCommitmentM:observation.pit.distanceToCommitmentM,
  estimatedRejoinPosition:observation.pit.estimatedRejoinPosition,
  teammateInPitLane:observation.pit.teammateInPitLane,
  dryCompoundRuleSatisfied:observation.tyres.dryCompoundRuleSatisfied,
  flag:observation.raceControl.flag,
  speedLimitKph:observation.raceControl.speedLimitKph,
  safetyCarScheduledLap:observation.raceControl.safetyCarScheduledLap,
  safetyCarInLap:observation.raceControl.safetyCarInLap,
  rain:observation.weather.outlook,
  wetness:observation.weather.wetness,
  sectorWetness:observation.weather.sectorWetness,
  wetGripByCompound:observation.weather.wetGripByCompound,
 };
}

export class StrategyEvents {
 constructor(private readonly responseMs=STRATEGY_RESPONSE_MS){}
 private listeners=new Set<(event:StrategyEventNotice&{event_id:string},issuedAt:number)=>void>();
 pending?:PendingStrategy;
 private driverConsultation?:DriverConsultation;
 private recent=new Map<string,PendingStrategy>();
 private consumed=new Set<string>();

 offer(room:string,window:StrategyWindow,reasons:string[],observation:StrategyEvent['observation'],now=Date.now()){
  const summary=strategySummary(observation);
  const event:StrategyEvent={room,team:observation.team,summary,lap:window.lap+1,reasons,observation:structuredClone(observation),issuedAt:now,
   expiresAt:now+this.responseMs,event_id:crypto.randomUUID()};
  const entry:PendingStrategy={event,window};
  this.pending=entry;
  this.recent.set(event.event_id,entry);
  while(this.recent.size>MAX_RECENT_EVENTS){
   const oldest=this.recent.keys().next().value;
   if(oldest!==undefined)this.recent.delete(oldest);
  }
  for(const listener of this.listeners)listener(this.notice(event),event.issuedAt);
  return event;
 }

 offerDriverQuestion(room:string,driverQuestion:DriverQuestion,consultationId:string,observation:StrategyEvent['observation'],now=Date.now()){
  const event:DriverQuestionEvent={
   room,team:observation.team,lap:observation.telemetry.lap,reasons:['Driver question'],summary:strategySummary(observation),
   driverQuestion,observation:structuredClone(observation),issuedAt:now,expiresAt:now+this.responseMs,event_id:crypto.randomUUID(),
  };
  this.driverConsultation={event,consultationId};
  return event;
 }

 publishDriverQuestion(){
  const consultation=this.getDriverConsultation();
  if(!consultation)return;
  const {event}=consultation;
  for(const listener of this.listeners)listener(this.notice(event),event.issuedAt);
 }

 getDriverConsultation(now=Date.now()){
  const consultation=this.driverConsultation;
  return consultation&&consultation.event.expiresAt>now?consultation:undefined;
 }

 clearDriverQuestion(){
  delete this.driverConsultation;
 }

 find(eventId:string){
  if(this.pending?.event.event_id===eventId)return this.pending;
  return this.recent.get(eventId);
 }

 has(eventId:string){
  return this.pending?.event.event_id===eventId||this.recent.has(eventId)||this.consumed.has(eventId);
 }

 isConsumed(eventId:string){
  return this.consumed.has(eventId);
 }

 consume(eventId?:string){
  if(eventId){
   this.consumed.add(eventId);
   while(this.consumed.size>MAX_CONSUMED_IDS){
    const oldest=this.consumed.keys().next().value;
    if(oldest!==undefined)this.consumed.delete(oldest);
   }
  }
  delete this.pending;
  this.recent.clear();
 }

 clear(){
  delete this.pending;
  this.recent.clear();
  this.clearDriverQuestion();
 }

 prune(now=Date.now()){
  if(this.driverConsultation&&this.driverConsultation.event.expiresAt<=now)this.clearDriverQuestion();
  for(const [id,entry] of this.recent){
   if(entry.event.expiresAt<=now)this.recent.delete(id);
  }
 }

 subscribe(listener:(event:StrategyEventNotice&{event_id:string},issuedAt:number)=>void){
  this.listeners.add(listener);
  if(this.pending&&this.pending.event.expiresAt>Date.now())listener(this.notice(this.pending.event),this.pending.event.issuedAt);
  const question=this.getDriverConsultation()?.event;
  if(question)listener(this.notice(question),question.issuedAt);
  return ()=>{this.listeners.delete(listener);};
 }

 private notice({room,team,lap,reasons,expiresAt,event_id,summary,driverQuestion}:StrategyEvent){
  return {room,team,lap,reasons,expiresAt,event_id,summary,...(driverQuestion?{driverQuestion}:{})};
 }
}

function hasTyreSet(car:Car,tyre:Compound){
 return !car.tyreSets||car.tyreSets[tyre]>0;
}

export function radioInstruction(race:Race,car:Car,input:RadioInput):Instruction|null{
 const expiresLap=Math.min(race.laps,car.lap+(input.laps??1));
 const committed=car.pit==='entry'||car.pit==='stopped';
 const availableKJ=Math.floor(car.ers*VEHICLE.batteryJoules/100_000);
 const instruction:Instruction=input.action==='hold'
  ? {...structuredClone(car.instruction),line:input.radio}
  : {
     pace:'balanced',ers:'balanced',
     box:committed&&car.instruction.box,
     tyre:committed?car.instruction.tyre:car.compound,
     tactic:'hold',line:input.radio,
    };

 const attachEnergy=(priority:'attack'|'defend',requestedKJ:number,defaultZone?:'attack'|'defend'|'any')=>{
  const budgetKJ=Math.min(requestedKJ,availableKJ);
  if(budgetKJ<1)return false;
  instruction.ers='deploy';
  instruction.energy={
   priority,
   ...(input.zone?{zone:input.zone}:defaultZone?{zone:defaultZone}:{}),
   ...(input.release_attack_if_behind_gt_s?{releaseAttackIfBehindGtS:input.release_attack_if_behind_gt_s}:{}),
   budgetKJ,
   expiresLap,
   startJoules:car.ersDeployed??0,
  };
  return true;
 };

 switch(input.action){
  case 'attack':
  case 'defend':{
   instruction.tactic=input.action;
   if(input.budget_kj){
    if(!attachEnergy(input.action,input.budget_kj))return null;
   }else{
    instruction.ers='harvest';
   }
   break;
  }
  case 'harvest':
   instruction.ers='harvest';
   instruction.tactic='hold';
   delete instruction.energy;
   break;
  case 'save-fuel':
   if(!input.sector)return null;
   instruction.pace='manage';
   instruction.fuelSave={sector:input.sector-1,expiresLap};
   break;
  case 'yield':
   instruction.yieldUntilLap=car.lap+1;
   if(input.target_car)instruction.yieldTarget=input.target_car.toUpperCase();
   break;
  case 'swap':
   instruction.tactic='attack';
   instruction.teamOrder={kind:'swap',issuedLap:car.lap,expiresLap:Math.min(race.laps,car.lap+(input.laps??2))};
   break;
  case 'swap-back':
   instruction.tactic='hold';
   instruction.teamOrder={kind:'swap-back',issuedLap:car.lap,expiresLap:Math.min(race.laps,car.lap+(input.laps??2))};
   break;
  case 'push':
  case 'manage':
   instruction.pace=input.action;
   break;
  case 'extend':
   if(!committed)instruction.box=false;
   instruction.pace='manage';
   instruction.ers='harvest';
   instruction.tactic='hold';
   break;
  case 'box':
   if(!input.tyre||!hasTyreSet(car,input.tyre))return null;
   instruction.box=input.box_lap!=='next-lap';
   instruction.tyre=input.tyre;
   break;
  case 'cover':
   if(!input.tyre||!hasTyreSet(car,input.tyre))return null;
   instruction.box=input.box_lap!=='next-lap';
   instruction.tyre=input.tyre;
   instruction.pace='push';
   if(input.budget_kj){
    if(!attachEnergy('attack',input.budget_kj,'any'))return null;
   }else if(availableKJ>=200){
    attachEnergy('attack',Math.min(800,availableKJ),'any');
   }
   break;
  case 'hold':
   break;
 }

 // Apply orthogonal composable overrides.
 if(input.pace)instruction.pace=input.pace;
 if(input.ers){
  instruction.ers=input.ers;
  if(input.ers==='harvest')delete instruction.energy;
 }
 if(input.box===true){
  if(!input.tyre||!hasTyreSet(car,input.tyre))return null;
  instruction.box=input.box_lap!=='next-lap';
  instruction.tyre=input.tyre;
 }else if(input.box===false&&!committed){
  instruction.box=false;
 }
 if(input.sector&&input.action!=='save-fuel'){
  instruction.fuelSave={sector:input.sector-1,expiresLap};
 }
 if(input.budget_kj&&input.action!=='attack'&&input.action!=='defend'&&input.action!=='cover'){
  if(!attachEnergy(instruction.tactic==='defend'?'defend':'attack',input.budget_kj,input.zone??'any'))return null;
 }
 if(input.revisit_condition)instruction.revisit=input.revisit_condition;
 return instruction;
}
