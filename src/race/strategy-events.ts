import type {RainLevel} from './race-control';
import type {Compound} from './types';

export const STRATEGY_EVENT='grand_prix.strategy_required';
export const STRATEGY_RESPONSE_MS=20_000;
export const WEBHOOK_STRATEGY_RESPONSE_MS=120_000;
export type LiveStrategist='provider'|'chatgpt';
export type StrategyWebhookStatus='waiting'|'connected'|'delivered'|'failed';

export interface StrategyEventNotice {
 room:string;
 team:'a'|'b';
 lap:number;
 reasons:string[];
 expiresAt:number;
 summary:{
  speedKph:number;position:number;tyreWear:number;chargeKJ:number;projectedFuelKg:number;
  marginAboveFuelSampleKg:number;distanceToPitCommitmentM:number;dryCompoundRuleSatisfied:boolean;
  flag:'green'|'yellow'|'safety-car';speedLimitKph:number|null;
  safetyCarScheduledLap:number|null;safetyCarInLap:number|null;
  rain:RainLevel;wetness:number;sectorWetness:[number,number,number];
  wetGripByCompound:Record<Compound,number>;
 };
}
