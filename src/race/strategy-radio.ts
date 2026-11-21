import type {Car} from './types';
import type {Track} from './track';

export type Priority = 'attack' | 'defend' | 'save' | 'yield' | 'push' | 'manage' | 'box' | 'extend' | 'cover' | 'slicks' | 'intermediates' | 'swap' | 'swap-back' | 'hold';

export interface RadioCall {
 priority: Priority;
 message: string;
 issuedLap: number;
 expiresLap: number;
 revisit: string;
 sector?: number;
 energy?: number;
}

export interface DriverObservation {
 speed: number;
 distance: number;
 heading: number;
 grip: number;
 curvature: number[];
 rivalGap: number;
 closingSpeed: number;
}

export function radioActive(call: RadioCall, lap: number) {
 return lap >= call.issuedLap && lap < call.expiresLap;
}

export function strategistDue(previous: {lap: number; change: string} | undefined, lap: number, change: string) {
 return !previous || previous.lap !== lap || previous.change !== change;
}

export function boostRequested(call: RadioCall, lap: number, sector: number, available: number, opportunity: boolean) {
 return radioActive(call, lap) && call.sector === sector && (call.energy ?? 0) > 0 && available > 0 && opportunity;
}

export type EnergyPriority = 'attack' | 'defend';
export interface EnergyOrder {
 priority: EnergyPriority;
 budgetKJ: number;
 expiresLap: number;
 startJoules: number;
}

export function boostZone(track: Track, priority: EnergyPriority) {
 return priority==='defend'?track.DRS_ZONES[1]:track.DRS_ZONES[0];
}

export function remainingOrderJoules(car: Car, order: EnergyOrder) {
 return car.lap<order.expiresLap
  ? Math.max(0,order.budgetKJ*1000-((car.ersDeployed??0)-order.startJoules)) : 0;
}

export function boostJoulesLeft(car: Car, track: Track) {
 const order = car.instruction.energy;
 if (!order) return Infinity;
 const zone = boostZone(track,order.priority);
 return track.inZone(car.distance,zone.start,zone.end) ? remainingOrderJoules(car,order) : 0;
}
