import {boostZone,remainingOrderJoules} from './strategy-radio';
import {other} from './physics';
import {getTrack} from './track';
import {VEHICLE} from './vehicle';
import type {Race,Team} from './types';
import {classification,type FieldCar} from './grid';
import {raceControlTelemetry,weatherTyre,wetGrip} from './race-control';

export function strategyRivals(race: Race, team: Team) {
 const car=race.cars[team];
 let ahead:FieldCar|undefined, behind:FieldCar|undefined;
 for(const rival of [race.cars[other(team)],...race.field]){
  if(rival.finishTime!==null||(rival.pit && rival.pit!=='none'))continue;
  if(rival.distance>=car.distance){
   if(!ahead||rival.distance<ahead.distance)ahead=rival;
  }else if(!behind||rival.distance>behind.distance)behind=rival;
 }
 return {ahead,behind};
}

export function sectorGaps(race: Race, team: Team) {
 const car=race.cars[team],{ahead,behind}=strategyRivals(race,team);
 const speed=Math.max(25,car.speed);
 return {lap:car.lap,sector:car.sector,ahead:ahead?(ahead.distance-car.distance)/speed:null,
  behind:behind?(car.distance-behind.distance)/speed:null,
  closingBehind:behind?behind.speed-car.speed:null};
}

export function projectFuelAtFlag(race:Race,team:Team){
 const car=race.cars[team],{LENGTH}=getTrack(race.circuit);
 const remainingMetres=Math.max(0,race.laps*LENGTH-car.distance);
 const remainingSeconds=remainingMetres/LENGTH*(car.lastLap||LENGTH/55);
 return car.fuel-remainingSeconds*(.004+.023*.65);
}

export function observeStrategy(race: Race, team: Team, gapHistory: ReturnType<typeof sectorGaps>[] = []) {
 const car=race.cars[team],track=getTrack(race.circuit);
 const lapsRemaining=Math.max(0,race.laps-car.lap);
 const chargeKJ=car.ers/100*VEHICLE.batteryJoules/1000;
 const order=car.instruction.energy;
 const allocatedRemainingKJ=order?remainingOrderJoules(car,order)/1000:null;
 const {ahead,behind}=strategyRivals(race,team);
 const laneLength=track.wrap(track.PIT_EXIT-track.PIT_ENTRY);
 const raceControl=raceControlTelemetry(race);
 const racePace=race.control?.safetyCar?.speed??(raceControl.speedLimitKph??216)/3.6;
 const pitLossSeconds=laneLength*(1/track.PIT_LIMIT-1/racePace)+track.PIT_STOP_SECONDS;
 let estimatedRejoinGapSeconds:number|null=null;
 for(const rival of [race.cars[other(team)],...race.field]){
  if(rival.finishTime!==null||(rival.pit&&rival.pit!=='none'))continue;
  const gap=(car.distance-rival.distance)/Math.max(35,car.speed)-pitLossSeconds;
  if(estimatedRejoinGapSeconds===null||Math.abs(gap)<Math.abs(estimatedRejoinGapSeconds))estimatedRejoinGapSeconds=gap;
 }
 const remainingRecoveryKJ=Math.max(0,2000-car.ersRecovered/1000)+Math.max(0,lapsRemaining-1)*2000;
 return {
  circuit:race.circuit,team,elapsed:race.time,lapsRemaining,
  telemetry:{lap:car.lap+1,sector:car.sector+1,speedKph:Math.round(car.speed*3.6),
   position:classification(race).findIndex(entry=>entry.car===car)+1,stops:car.stops},lapTimes:car.lapTimes,sectorTimes:car.splits,
  gaps:sectorGaps(race,team),sectorGapHistory:gapHistory,
  tyres:{compound:car.compound,age:car.tyreAge,wear:car.wear,temperatureC:car.temperature,aheadAge:ahead&&'tyreAge' in ahead?ahead.tyreAge:null,behindAge:behind&&'tyreAge' in behind?behind.tyreAge:null},
  energy:{chargeKJ,maximumRecoveryKJ:remainingRecoveryKJ,currentOrder:order,allocatedRemainingKJ,zones:{attack:boostZone(track,'attack'),defend:boostZone(track,'defend')}},
  fuel:{remainingKg:car.fuel,projectedAtFlagKg:projectFuelAtFlag(race,team)},
  traffic:race.field.filter(rival=>Math.abs(rival.distance-car.distance)<120)
   .map(rival=>({metres:rival.distance-car.distance,speed:rival.speed,pit:rival.pit??'none'})),
  pit:{phase:car.pit,plannedCompound:car.instruction.box?car.instruction.tyre:null,stops:car.stops,
   commitment:track.PIT_ENTRY-120,pitLossSeconds,estimatedRejoinGapSeconds,rival:race.cars[other(team)].pit},
  raceControl,
  damage:car.damage,weather:{outlook:race.control?.rain??'dry',temperatureC:track.temperature,
   wetness:Math.round((race.control?.wetness??0)*100)/100,
   currentTyreGrip:Math.round(wetGrip(car.compound,race.control?.wetness??0)*100)/100,
   recommendedCompound:weatherTyre(race.control,car.compound)},
 };
}
