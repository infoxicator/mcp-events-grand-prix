import {boostZone,remainingOrderJoules} from './strategy-radio';
import {clamp,damageRepairSeconds,defaultTyreSets,drsAllowed,dryCompoundRuleSatisfied,FIA_MIN_FUEL_KG,NOMINAL_FUEL_BURN_PER_SEC,nominalRaceSpeed,other,tyreCompoundsMeta} from './physics';
import {pitCommitmentPoint} from './strategy-calls';
import {getTrack,type CircuitId,type Track} from './track';
import {VEHICLE} from './vehicle';
import type {Car,Compound,Race,Team} from './types';
import {classification,opponents,playerEntry,teammateEntry,type FieldCar,type OpponentCar} from './grid';
import {raceControlTelemetry,sectorWetnessOf,wetGrip,wetGripTable} from './race-control';

const r1=(n:number)=>Math.round(n*10)/10;
const r2=(n:number)=>Math.round(n*100)/100;

export function referenceSpeed(car:Car,track:Track){
 return car.lastLap>0?track.LENGTH/car.lastLap:Math.max(25,car.speed);
}

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
 const car=race.cars[team],track=getTrack(race.circuit),{ahead,behind}=strategyRivals(race,team);
 const speed=referenceSpeed(car,track);
 return {lap:car.lap,sector:car.sector,ahead:ahead?(ahead.distance-car.distance)/speed:null,
  behind:behind?(car.distance-behind.distance)/speed:null,
  closingBehind:behind?behind.speed-car.speed:null};
}

export function estimatedFuelLapSeconds(car:Car,circuit:CircuitId){
 const nominal=getTrack(circuit).LENGTH/nominalRaceSpeed(circuit);
 if(car.lastLap<=0||car.lastLap>nominal*1.15)return nominal;
 const clamped=clamp(car.lastLap,nominal*.94,nominal*1.06);
 return clamped*.35+nominal*.65;
}

export function projectFuelAtFlag(race:Race,team:Team){
 const car=race.cars[team],{LENGTH}=getTrack(race.circuit);
 const remainingMetres=Math.max(0,race.laps*LENGTH-Math.max(0,car.distance));
 const remainingSeconds=(remainingMetres/LENGTH)*estimatedFuelLapSeconds(car,race.circuit);
 return car.fuel-remainingSeconds*NOMINAL_FUEL_BURN_PER_SEC;
}

function carMeta(race:Race,entryCar:FieldCar){
 if(entryCar===race.cars.a||entryCar===race.cars.b){
  const seat:Team=entryCar===race.cars.a?'a':'b';
  const c=race.cars[seat],p=playerEntry(seat);
  return {code:p.code,team:p.team,seat,compound:c.compound,tyreAge:c.tyreAge,wear:c.wear,stops:c.stops,lastLap:c.lastLap||null,pit:c.pit,splits:c.splits};
 }
 const idx=race.field.indexOf(entryCar as OpponentCar);
 const opp=idx>=0?opponents[idx]:undefined;
 return {
  code:opp?.code??`C${idx}`,
  team:opp?.team??'Field',
  seat:null as Team|null,
  compound:(entryCar.compound??'medium') as Compound,
  tyreAge:entryCar.tyreAge??0,
  wear:entryCar.wear??0,
  stops:entryCar.stops??0,
  lastLap:entryCar.lastLap??null,
  pit:entryCar.pit??'none',
  splits:'splits' in entryCar&&Array.isArray(entryCar.splits)?entryCar.splits:[],
 };
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
 const repairSeconds=damageRepairSeconds(car.damage);
 const pitLossSeconds=laneLength*(1/track.PIT_LIMIT-1/racePace)+track.PIT_STOP_SECONDS+repairSeconds;
 const refSpeed=referenceSpeed(car,track);

 // Classification, compact standings tower, and rejoin traffic projection.
 const orderList=classification(race);
 const ourIndex=orderList.findIndex(e=>e.car===car);
 const leaderDistance=orderList[0]?.car.distance??car.distance;
 const mateEntry=teammateEntry(team);
 const rivalSeat=other(team);

 const rejoinDistance=car.distance-pitLossSeconds*refSpeed;
 let estimatedRejoinGapSeconds:number|null=null;
 let estimatedRejoinPosition=1;
 let rejoinTrafficAhead:{code:string;gapSeconds:number}|null=null;
 let rejoinTrafficBehind:{code:string;gapSeconds:number}|null=null;

 for(const entry of orderList){
  const rival=entry.car;
  if(rival===car||rival.finishTime!==null||(rival.pit&&rival.pit!=='none'))continue;
  if(rival.distance>rejoinDistance)estimatedRejoinPosition++;
  const gap=(car.distance-rival.distance)/Math.max(35,refSpeed)-pitLossSeconds;
  if(estimatedRejoinGapSeconds===null||Math.abs(gap)<Math.abs(estimatedRejoinGapSeconds))estimatedRejoinGapSeconds=gap;
  const meta=carMeta(race,rival);
  if(rival.distance>=rejoinDistance){
   const aheadS=r2((rival.distance-rejoinDistance)/refSpeed);
   if(!rejoinTrafficAhead||aheadS<rejoinTrafficAhead.gapSeconds)rejoinTrafficAhead={code:meta.code,gapSeconds:aheadS};
  }else{
   const behindS=r2((rejoinDistance-rival.distance)/refSpeed);
   if(!rejoinTrafficBehind||behindS<rejoinTrafficBehind.gapSeconds)rejoinTrafficBehind={code:meta.code,gapSeconds:behindS};
  }
 }

 const standings=orderList
  .map((entry,idx)=>{
   const meta=carMeta(race,entry.car);
   const isUs=entry.car===car;
   const isTeammate=Boolean(mateEntry&&meta.code===mateEntry.entry.code);
   const isRivalPlayer=meta.seat===rivalSeat;
   return {
    pos:idx+1,
    code:meta.code,
    team:meta.team,
    isUs,
    isTeammate,
    isRivalPlayer,
    gapToUsSeconds:r2((entry.car.distance-car.distance)/refSpeed),
    gapToLeaderSeconds:r2((leaderDistance-entry.car.distance)/refSpeed),
    compound:meta.compound,
    tyreAge:r1(meta.tyreAge),
    wear:r2(meta.wear),
    stops:meta.stops,
    lastLap:meta.lastLap?r2(meta.lastLap):null,
    pit:meta.pit,
   };
  })
  .filter((row,idx)=>idx===0||Math.abs(idx-ourIndex)<=5||row.isTeammate||row.isRivalPlayer);

 const teammateRow=standings.find(s=>s.isTeammate)??null;
 const mateFieldCar=mateEntry?race.field[mateEntry.index]:undefined;
 const teammateInPitLane=Boolean(mateFieldCar?.pit&&mateFieldCar.pit!=='none');

 const remainingRecoveryKJ=Math.max(0,2000-car.ersRecovered/1000)+Math.max(0,lapsRemaining-1)*2000;
 const commitment=pitCommitmentPoint(track.PIT_ENTRY);
 const lapPos=track.wrap(car.distance);
 const pastCommitment=car.distance>=0&&car.pit==='none'&&lapPos>commitment;
 const distanceToCommitmentM=Math.round(track.wrap(commitment-car.distance));
 const secondsToCommitment=r1(distanceToCommitmentM/Math.max(25,refSpeed));

 const compoundLife=tyreCompoundsMeta(race.laps,track.LENGTH);
 const currentMeta=compoundLife[car.compound];
 const estimatedLapsToCliff=r1(Math.max(0,(.72-car.wear)/Math.max(.01,currentMeta.wearPerLap)));
 const aheadMeta=ahead?carMeta(race,ahead):null;
 const behindMeta=behind?carMeta(race,behind):null;

 const projectedAtFlagKg=projectFuelAtFlag(race,team);
 const estLapSec=estimatedFuelLapSeconds(car,race.circuit);
 const burnPerLapKg=r2(estLapSec*NOMINAL_FUEL_BURN_PER_SEC);

 const wetness=race.control?.wetness??0;
 const sectorWetness:[number,number,number]=[
  r2(sectorWetnessOf(race.control,0)),
  r2(sectorWetnessOf(race.control,1)),
  r2(sectorWetnessOf(race.control,2)),
 ];
 const observedWetRivalSplits=orderList
  .map(e=>carMeta(race,e.car))
  .filter(m=>(m.compound==='intermediate'||m.compound==='wet')&&(m.lastLap||m.splits.length>0))
  .slice(0,4)
  .map(m=>({code:m.code,compound:m.compound,lastLap:m.lastLap?r2(m.lastLap):null,splits:m.splits.map(r2)}));

 return {
  circuit:race.circuit,team,elapsed:race.time,lapsRemaining,
  telemetry:{
   lap:car.lap+1,totalLaps:race.laps,sector:car.sector+1,
   lapDistanceM:Math.round(lapPos),trackLengthM:Math.round(track.LENGTH),
   speedKph:Math.round(car.speed*3.6),
   position:ourIndex+1,stops:car.stops,
   warnings:car.warnings,penaltySeconds:car.penalty,
   drsEligible:car.eligible.some(Boolean),inDrsZone:drsAllowed(car,track),
   ersUsedThisLapKJ:Math.round((car.ersUsed??0)/1000),ersLapLimitKJ:4000,
  },
  lapTimes:car.lapTimes,sectorTimes:car.splits,
  gaps:sectorGaps(race,team),sectorGapHistory:gapHistory,
  standings,
  teammate:teammateRow?{
   code:teammateRow.code,pos:teammateRow.pos,gapToUsSeconds:teammateRow.gapToUsSeconds,
   compound:teammateRow.compound,tyreAge:teammateRow.tyreAge,wear:teammateRow.wear,pit:teammateRow.pit,
  }:null,
  tyres:{
   compound:car.compound,age:r1(car.tyreAge),wear:car.wear,temperatureC:Math.round(car.temperature),
   aheadAge:aheadMeta?r1(aheadMeta.tyreAge):null,behindAge:behindMeta?r1(behindMeta.tyreAge):null,
   aheadCompound:aheadMeta?.compound??null,behindCompound:behindMeta?.compound??null,
   aheadStops:aheadMeta?.stops??null,behindStops:behindMeta?.stops??null,
   compoundsUsed:[...(car.compoundsUsed??[car.compound])],
   dryCompoundRuleSatisfied:dryCompoundRuleSatisfied(race,car),
   availableSets:car.tyreSets?{...car.tyreSets}:defaultTyreSets(car.compound),
   compoundLife,
   estimatedLapsToCliff,
  },
  energy:{
   chargeKJ,maximumRecoveryKJ:remainingRecoveryKJ,currentOrder:order,allocatedRemainingKJ,
   ersUsedThisLapKJ:Math.round((car.ersUsed??0)/1000),ersLapLimitKJ:4000,
   zones:{attack:boostZone(track,'attack'),defend:boostZone(track,'defend'),any:'Full lap deployment'},
  },
  fuel:{
   remainingKg:car.fuel,
   projectedAtFlagKg:r2(projectedAtFlagKg),
   fiaMinimumSampleKg:FIA_MIN_FUEL_KG,
   marginAboveSampleKg:r2(projectedAtFlagKg-FIA_MIN_FUEL_KG),
   burnPerLapKg,
   sectorSaveEstimateKgPerLap:r2(burnPerLapKg*.11),
  },
  traffic:race.field.filter(rival=>Math.abs(rival.distance-car.distance)<120)
   .map(rival=>{
    const meta=carMeta(race,rival);
    return {code:meta.code,metres:Math.round(rival.distance-car.distance),speed:r1(rival.speed),pit:rival.pit??'none'};
   }),
  pit:{
   phase:car.pit,plannedCompound:car.instruction.box?car.instruction.tyre:null,stops:car.stops,
   commitment,distanceToCommitmentM,secondsToCommitment,pastCommitment,
   pitLossSeconds:r1(pitLossSeconds),estimatedRepairSeconds:r1(repairSeconds),
   estimatedRejoinGapSeconds:estimatedRejoinGapSeconds!==null?r2(estimatedRejoinGapSeconds):null,
   estimatedRejoinPosition,rejoinTrafficAhead,rejoinTrafficBehind,
   teammateInPitLane,
   rival:race.cars[rivalSeat].pit,
  },
  currentInstruction:{
   pace:car.instruction.pace,ers:car.instruction.ers,box:car.instruction.box,
   tyre:car.instruction.tyre,tactic:car.instruction.tactic,line:car.instruction.line,
   fuelSave:car.instruction.fuelSave?{sector:car.instruction.fuelSave.sector+1,expiresLap:car.instruction.fuelSave.expiresLap}:null,
   yieldUntilLap:car.instruction.yieldUntilLap??null,
   teamOrder:car.instruction.teamOrder??null,
   revisit:car.instruction.revisit??null,
  },
  driverFeedback:car.lastDriverReport??(car.intent.reply||null),
  raceControl,
  damage:car.damage,
  weather:{
   outlook:race.control?.rain??'dry',
   temperatureC:track.temperature,
   wetness:r2(wetness),
   sectorWetness,
   currentTyreGrip:r2(wetGrip(car.compound,sectorWetnessOf(race.control,car.sector))),
   wetGripByCompound:wetGripTable(wetness),
   forecast:race.control?.forecast??null,
   observedWetRivalSplits,
  },
 };
}
