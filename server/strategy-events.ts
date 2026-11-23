import {z} from 'zod';
import {observeStrategy} from '../src/race/strategy-observation';
import {STRATEGY_EVENT,STRATEGY_RESPONSE_MS,type StrategyEventNotice} from '../src/race/strategy-events';
import {VEHICLE} from '../src/race/vehicle';
import {compounds,rainLevels} from '../src/race/race-control';
import type {Car,Compound,Instruction,Race} from '../src/race/types';

export const eventInput=z.object({room:z.string().uuid(),event_id:z.string().uuid()});
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

const wetGripSchema=z.object({
 soft:z.number(),medium:z.number(),hard:z.number(),intermediate:z.number(),wet:z.number(),
});

export const strategyEventDefinition={
 name:STRATEGY_EVENT,
 description:'Telemetry for your strategy seat requires a radio decision. Open that seat with open_grand_prix_strategy and use its event_filter. Read each active event and send one order to its assigned car.',
 delivery:['webhook'],
 inputSchema:z.toJSONSchema(strategyFilter),
 payloadSchema:z.toJSONSchema(eventInput.extend({
  team:z.enum(['a','b']),lap:z.number().int(),reasons:z.array(z.string()),expiresAt:z.number(),
  summary:z.object({
   speedKph:z.number(),position:z.number(),tyreWear:z.number(),chargeKJ:z.number(),projectedFuelKg:z.number(),
   marginAboveFuelSampleKg:z.number(),distanceToPitCommitmentM:z.number(),dryCompoundRuleSatisfied:z.boolean(),
   flag:z.enum(['green','yellow','safety-car']),speedLimitKph:z.number().nullable(),
   safetyCarScheduledLap:z.number().nullable(),safetyCarInLap:z.number().nullable(),
   rain:z.enum(rainLevels),wetness:z.number(),sectorWetness:z.tuple([z.number(),z.number(),z.number()]),
   wetGripByCompound:wetGripSchema,
  }),
 })),
};

export interface StrategyEvent extends StrategyEventNotice {
 event_id:string;
 observation:ReturnType<typeof observeStrategy>;
 issuedAt:number;
}
type StrategyWindow={lap:number;change:string;revision:number;raceControlChange?:boolean};

export class StrategyEvents {
 constructor(private readonly responseMs=STRATEGY_RESPONSE_MS){}
 private listeners=new Set<(event:StrategyEventNotice&{event_id:string})=>void>();
 pending?:{event:StrategyEvent;window:StrategyWindow};

 offer(room:string,window:StrategyWindow,reasons:string[],observation:StrategyEvent['observation'],now=Date.now()){
  const summary:StrategyEventNotice['summary']={
   speedKph:observation.telemetry.speedKph,
   position:observation.telemetry.position,
   tyreWear:observation.tyres.wear,
   chargeKJ:observation.energy.chargeKJ,
   projectedFuelKg:observation.fuel.projectedAtFlagKg,
   marginAboveFuelSampleKg:observation.fuel.marginAboveSampleKg,
   distanceToPitCommitmentM:observation.pit.distanceToCommitmentM,
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
  const event={room,team:observation.team,summary,lap:window.lap+1,reasons,observation:structuredClone(observation),issuedAt:now,
   expiresAt:now+this.responseMs,event_id:crypto.randomUUID()};
  this.pending={event,window};
  for(const listener of this.listeners)listener(this.notice(event));
  return event;
 }

 subscribe(listener:(event:StrategyEventNotice&{event_id:string})=>void){
  this.listeners.add(listener);
  if(this.pending&&this.pending.event.expiresAt>Date.now())listener(this.notice(this.pending.event));
  return ()=>{this.listeners.delete(listener);};
 }

 private notice({room,team,lap,reasons,expiresAt,event_id,summary}:StrategyEvent){
  return {room,team,lap,reasons,expiresAt,event_id,summary};
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
