import {z} from 'zod';
import {observeStrategy} from '../src/race/strategy-observation';
import {STRATEGY_EVENT,STRATEGY_RESPONSE_MS,type StrategyEventNotice} from '../src/race/strategy-events';
import {VEHICLE} from '../src/race/vehicle';
import {compounds,rainLevels} from '../src/race/race-control';
import type {Car,Instruction,Race} from '../src/race/types';

export const eventInput=z.object({room:z.string().uuid(),event_id:z.string().uuid()});
export const strategyFilter=z.object({room:z.string().uuid(),subscription_key:z.string().regex(/^[a-f0-9]{64}$/)});
export const radioInput=eventInput.extend({
 action:z.enum(['hold','attack','defend','save-fuel','yield','push','manage','box','extend','cover']),
 radio:z.string().trim().min(1).max(180).describe('Short radio instruction for this driver.'),
 budget_kj:z.number().int().positive().max(4000).optional().describe('Required to allocate boost for attack or defence. Omit to hold energy.'),
 sector:z.number().int().min(1).max(3).optional().describe('Required for save-fuel. Use the one-based sector number.'),
 laps:z.number().int().min(1).max(2).optional().describe('Valid for one lap by default. Can extend a fuel or energy order to two laps.'),
 tyre:z.enum(compounds).optional().describe('Required when boxing or covering. Intermediate and wet are available for rain.'),
});
export type RadioInput=z.infer<typeof radioInput>;
export const strategyEventDefinition={
 name:STRATEGY_EVENT,
 description:'Telemetry for your strategy seat requires a radio decision. Open that seat with open_grand_prix_strategy and use its event_filter. Read each active event and send one order to its assigned car.',
 delivery:['webhook'],
 inputSchema:z.toJSONSchema(strategyFilter),
 payloadSchema:z.toJSONSchema(eventInput.extend({
  team:z.enum(['a','b']),lap:z.number().int(),reasons:z.array(z.string()),expiresAt:z.number(),
  summary:z.object({speedKph:z.number(),position:z.number(),tyreWear:z.number(),chargeKJ:z.number(),projectedFuelKg:z.number(),
   flag:z.enum(['green','yellow','safety-car']),speedLimitKph:z.number().nullable(),safetyCarScheduledLap:z.number().nullable(),safetyCarInLap:z.number().nullable(),
   rain:z.enum(rainLevels),wetness:z.number(),recommendedCompound:z.enum(compounds)}),
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
  const summary={speedKph:observation.telemetry.speedKph,position:observation.telemetry.position,
   tyreWear:observation.tyres.wear,chargeKJ:observation.energy.chargeKJ,projectedFuelKg:observation.fuel.projectedAtFlagKg,
   flag:observation.raceControl.flag,speedLimitKph:observation.raceControl.speedLimitKph,
   safetyCarScheduledLap:observation.raceControl.safetyCarScheduledLap,safetyCarInLap:observation.raceControl.safetyCarInLap,rain:observation.weather.outlook,
   wetness:observation.weather.wetness,recommendedCompound:observation.weather.recommendedCompound};
  const event={room,team:observation.team,summary,lap:window.lap+1,reasons,observation:structuredClone(observation),issuedAt:now,
   expiresAt:now+this.responseMs,event_id:crypto.randomUUID()};
  this.pending={event,window};
  for(const listener of this.listeners)listener(this.notice(event));
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

export function radioInstruction(race:Race,car:Car,input:RadioInput):Instruction|null{
 const expiresLap=Math.min(race.laps,car.lap+(input.laps??1));
 const committed=car.pit==='entry'||car.pit==='stopped';
 const instruction:Instruction={pace:'balanced',ers:'balanced',box:committed&&car.instruction.box,
  tyre:committed?car.instruction.tyre:car.compound,tactic:'hold',line:input.radio};
 switch(input.action){
  case 'attack':
  case 'defend':{
   instruction.tactic=input.action;
   const budgetKJ=Math.min(input.budget_kj??0,Math.floor(car.ers*VEHICLE.batteryJoules/100_000));
   if(input.budget_kj&&budgetKJ<1)return null;
   instruction.ers=budgetKJ?'deploy':'harvest';
   if(budgetKJ)instruction.energy={priority:input.action,budgetKJ,expiresLap,startJoules:car.ersDeployed??0};
   break;
  }
  case 'save-fuel':
   if(!input.sector)return null;
   instruction.fuelSave={sector:input.sector-1,expiresLap};
   break;
  case 'yield':
   instruction.yieldUntilLap=car.lap+1;
   break;
  case 'push':
  case 'manage':
   instruction.pace=input.action;
   break;
  case 'box':
  case 'cover':
   if(!input.tyre)return null;
   instruction.box=true;
   instruction.tyre=input.tyre;
   break;
  case 'hold':
   // Holding the current strategy leaves previously allocated energy and any
   // pit commitment intact.
   return {...car.instruction,line:input.radio};
 }
 return instruction;
}
