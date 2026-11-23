import {projectFuelAtFlag,sectorGaps,strategyRivals} from './strategy-observation';
import {boostJoulesLeft} from './strategy-radio';
import {damageLevel} from './crashes';
import {dryCompoundRuleSatisfied,FIA_MIN_FUEL_KG} from './physics';
import { type Compound,type Race,type Team,type Instruction,type DriverIntent } from './types';
import {nearbyRival} from './grid';
import {getTrack} from './track';
import {rainLabel,raceControlTelemetry,sectorWetnessOf,weatherTyre} from './race-control';

function pickDryCompound(c:Race['cars'][Team],lapsLeft:number,preferred:Compound):Compound{
 const sets=c.tyreSets;
 const used=new Set(c.compoundsUsed??[c.compound]);
 const candidates:Compound[]=lapsLeft>10?['hard','medium','soft']:lapsLeft>5?['medium','hard','soft']:['soft','medium','hard'];
 // Prefer an unused dry compound when the 2-compound rule is still unsatisfied.
 const ordered=[preferred,...candidates.filter(k=>k!==preferred)];
 const available=(k:Compound)=>!sets||sets[k]>0;
 const unused=ordered.find(k=>!used.has(k)&&available(k));
 return unused??ordered.find(available)??preferred;
}

export function mockEngineer(s:Race,team:Team,planAtLapStart=false, history:ReturnType<typeof sectorGaps>[] = []):Instruction{
 const c=s.cars[team],rival=nearbyRival(s,team),gap=(rival.distance-c.distance)/Math.max(30,c.speed);
 if(c.pit!=='none')return {...c.instruction,line:c.pit==='stopped'?'Hold. New tyres going on.':'Limiter on. We need a clean exit.'};
 const track=getTrack(s.circuit),isDrsZone=track.isDrsZone;
 const damage=damageLevel(c.damage);
 // Compare time lost after the next pit entry with the cost of the lane.
 const repairLaps=Math.max(0,s.laps-1-Math.floor((c.distance+track.LENGTH-track.PIT_ENTRY)/track.LENGTH));
 const tyre=weatherTyre(s.control,c.compound),{flag}=raceControlTelemetry(s);
 if(tyre!==c.compound&&repairLaps>0)return {pace:'manage',ers:'harvest',box:true,tyre,tactic:'hold',line:`Box for ${tyre==='medium'?'slicks':tyre==='wet'?'full wets':'intermediates'}. Manage the grip until pit entry.`};
 if(damage>=.15&&(c.stops===0||damage*repairLaps*40>18)){
  const nextDry=pickDryCompound(c,repairLaps,team==='a'?'hard':'soft');
  return {...c.instruction,tyre:s.control?.rain&&s.control.rain!=='dry'?tyre:nextDry,box:true,pace:'manage',tactic:'hold',line:'Box for repairs. Bring the car back in one piece.'};
 }
 if(flag!=='green'){
  const scCheapStop=flag==='safety-car'&&s.laps>=6&&c.wear>.42&&repairLaps>1;
  if(scCheapStop){
   const nextDry=pickDryCompound(c,repairLaps,team==='a'?'hard':'medium');
   return {pace:'manage',ers:'harvest',box:true,tyre:s.control?.rain&&s.control.rain!=='dry'?tyre:nextDry,tactic:'hold',line:'Safety car out. Box this lap for a cheap stop.'};
  }
  return {pace:'manage',ers:'harvest',box:c.instruction.box,tyre:c.instruction.box?c.instruction.tyre:c.compound,tactic:'hold',
   line:flag==='yellow'?'Full-course yellow. Slow down and hold position.':s.control?.safetyCarInLap
    ?'Safety car in next lap. Hold position and prepare for the restart.':'Safety car out. Close up to the queue and hold position.'};
 }
 if(s.control&&s.control.rain!=='dry')return {pace:'manage',ers:'harvest',box:false,tyre:c.compound,tactic:'hold',line:`${rainLabel(s.control.rain)}. Stay on these tyres and watch the grip.`};
 const lapsLeft=Math.max(0,s.laps-c.lap);
 const sprintBox=s.laps<=4&&c.stops===0&&(planAtLapStart?c.lap>=(team==='a'?0:1):team==='a'?c.distance>track.LENGTH*.725:c.distance>track.LENGTH*1.69||c.wear>.8);
 const longRaceBox=s.laps>4&&repairLaps>0&&(c.wear>.68||(lapsLeft<=2&&!dryCompoundRuleSatisfied(s,c)));
 if(sprintBox||longRaceBox){
  const targetDry=pickDryCompound(c,repairLaps,team==='a'?'hard':'soft');
  return {pace:'push',ers:'harvest',box:true,tyre:targetDry,tactic:'hold',line:team==='a'?`Box, box. ${targetDry[0].toUpperCase()+targetDry.slice(1)} tyres. We are going for the undercut.`:'Box this lap. Fresh tyres. Attack to the flag.'};
 }
 if(s.laps>=10&&projectFuelAtFlag(s,team)<FIA_MIN_FUEL_KG+.3){
  return {pace:'manage',ers:'harvest',box:false,tyre:c.compound,tactic:'hold',fuelSave:{sector:1,expiresLap:Math.min(s.laps,c.lap+2)},line:'Fuel tight for the FIA sample. Lift and coast in sector two.'};
 }
 if(planAtLapStart&&s.laps-c.lap<=2&&c.ers>=8&&c.ers<=38&&history.length>=3){
  const first=history[0],current=sectorGaps(s,team);
  const projectedRear=(current.behind??10)+((current.behind??10)-(first.behind??10))*.5;
  const projectedFront=(current.ahead??10)+((current.ahead??10)-(first.ahead??10))*.5;
  const priority=projectedRear<.7?'defend':projectedFront<1.1?'attack':null;
  if(priority)return {pace:'push',ers:'deploy',box:false,tyre:c.compound,tactic:priority,
   line:priority==='defend'?'Hold the boost for defence on the main straight.':'Use the boost when the gap opens on the back straight.',
   energy:{priority,budgetKJ:Math.min(1000,Math.floor(c.ers*40)),expiresLap:s.laps,startJoules:c.ersDeployed??0}};
 }
 if(c.stops>0&&c.tyreAge<.6)return {pace:'push',ers:'deploy',box:false,tyre:c.compound,tactic:'attack',line:'Pit exit clear. Push now. This is the undercut lap.'};
 if(c.wear>.62)return {pace:'manage',ers:'harvest',box:false,tyre:c.compound,tactic:'hold',line:'Tyres are dropping. Manage the rears. Harvest on entry.'};
 if(gap>0&&gap<1.4)return {pace:'push',ers:'deploy',box:false,tyre:c.compound,tactic:'attack',line:isDrsZone(c.distance)?'DRS zone. Use it if the dash is green. Attack.':'Within one second. Charge the battery. Set up the pass.'};
 if(gap<0&&gap>-1)return {pace:team==='b'?'push':'balanced',ers:'balanced',box:false,tyre:c.compound,tactic:'defend',line:'Car behind is close. Cover the inside. Keep it clean.'};
 return {pace:team==='b'?'push':'balanced',ers:c.ers<30?'harvest':'balanced',box:false,tyre:c.compound,tactic:'hold',line:team==='a'?'Good rhythm. Hit the apexes. Let the strategy come to us.':'You have clear air. Keep the pressure on.'};
}
export function mockDriver(s:Race,team:Team):DriverIntent{
 const c=s.cars[team],rival=nearbyRival(s,team),instruction=c.instruction,gap=rival.distance-c.distance,attack=instruction.tactic==='attack'||gap>0&&gap<70,defend=instruction.tactic==='defend';
 const wet=sectorWetnessOf(s.control,c.sector);
 const caution=instruction.pace==='manage'||wet>.25||damageLevel(c.damage)>.25||c.wear>.65;
 // Commit to the occupied side through a close pass. Crossing the track
 // centreline mid-corner is not a reason to swap sides of another car.
 const alongside=rival.finishTime===null&&Math.abs(rival.offset)<8&&Math.abs(gap)<20&&Math.abs(c.offset-rival.offset)>.9;
 const side=alongside?(c.offset<rival.offset?'left':'right'):attack?(rival.offset>=0?'left':'right'):defend?'right':'hold';
 const order=instruction.energy;
 const rivals=order?strategyRivals(s,team):null;
 const front=rivals?.ahead, rear=rivals?.behind;
 const opening=!order||(order.priority==='attack'
  ? !!front&&front.distance-c.distance>6&&front.distance-c.distance<Math.max(30,c.speed)
  : !!rear&&c.distance-rear.distance<Math.max(30,c.speed)&&rear.speed>=c.speed-1);
 const reply=instruction.box
  ? (team==='a'?'Copy. Box this lap. Let’s make it count.':'Box? Fine. Give me fresh rubber.')
  : wet>.3&&(c.compound!=='intermediate'&&c.compound!=='wet')
   ? 'Track is too wet for slicks — zero traction out of the slow corners.'
   : c.wear>.68
    ? 'Rears are gone, starting to slide on exit.'
    : (team==='a'?'Understood. Smooth inputs. On the delta.':attack?'Leave it to me. I’m sending it.':'There’s more in this car. Let me push.');
 return {
  offset:side==='left'?-3:side==='right'?3:team==='a'?-.6:.6,
  speedBias:caution?-2:team==='b'?1.6:.3,
  brakeAggression:caution?.2:team==='a'?.58:.9,
  side,
  ers:instruction.ers==='deploy'&&c.ers>8&&opening&&boostJoulesLeft(c,getTrack(s.circuit))>0,
  drs:true,
  reply,
 };
}

/**
 * Deterministic on-board autopilot driver.
 * Follows the optimal racing line, cleanly overtakes slower traffic, and strictly
 * obeys Strategy Engineer radio orders and Race Control without calling Jev.
 */
export function autopilotIntent(s:Race,team:Team):DriverIntent{
 const c=s.cars[team],rival=nearbyRival(s,team),instruction=c.instruction;
 const gap=rival.distance-c.distance;
 const wet=sectorWetnessOf(s.control,c.sector);
 const damage=damageLevel(c.damage);
 const caution=instruction.pace==='manage'||wet>.25||damage>.22||c.wear>.7;
 const pushing=instruction.pace==='push'&&!caution;
 const closeAhead=rival.finishTime===null&&(!rival.pit||rival.pit==='none')&&gap>0&&gap<42&&Math.abs(rival.offset)<8;
 const alongside=rival.finishTime===null&&(!rival.pit||rival.pit==='none')&&Math.abs(gap)<18&&Math.abs(c.offset-rival.offset)>.9;
 const defend=instruction.tactic==='defend'&&gap<0&&gap>-32;
 const attack=instruction.tactic==='attack'||closeAhead;
 const side:DriverIntent['side']=alongside
  ? (c.offset<rival.offset?'left':'right')
  : closeAhead
   ? (rival.offset>=0?'left':'right')
   : defend
    ? (rival.offset>=0?'right':'left')
    : 'hold';
 const offset=side==='left'?-2.6:side==='right'?2.6:0;
 const order=instruction.energy;
 const rivals=order?strategyRivals(s,team):null;
 const front=rivals?.ahead,rear=rivals?.behind;
 const opening=!order||(order.priority==='attack'
  ? !!front&&front.distance-c.distance>6&&front.distance-c.distance<Math.max(35,c.speed)
  : !!rear&&c.distance-rear.distance<Math.max(35,c.speed)&&rear.speed>=c.speed-1);
 const ersDeploy=instruction.ers!=='harvest'&&c.ers>10&&opening&&boostJoulesLeft(c,getTrack(s.circuit))>0
  &&(instruction.ers==='deploy'||(attack&&c.ers>28));
 const reply=instruction.box
  ? 'Autopilot: pitting this lap as instructed.'
  : closeAhead
   ? 'Autopilot: clearing traffic on optimal line.'
   : caution
    ? 'Autopilot: managing tyres and delta.'
    : 'Autopilot: holding optimal racing line.';
 return {
  offset,
  speedBias:caution?-1.1:pushing?1.1:.35,
  brakeAggression:caution?.32:pushing?.72:.55,
  side,
  ers:ersDeploy,
  drs:true,
  reply,
 };
}
