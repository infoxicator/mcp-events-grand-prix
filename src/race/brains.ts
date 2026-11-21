import {sectorGaps,strategyRivals} from './strategy-observation';
import {boostJoulesLeft} from './strategy-radio';
import {damageLevel} from './crashes';
import { type Race,type Team,type Instruction,type DriverIntent } from './types';
import {nearbyRival} from './grid';
import {getTrack} from './track';
import {rainLabel,raceControlTelemetry,weatherTyre} from './race-control';
export function mockEngineer(s:Race,team:Team,planAtLapStart=false, history:ReturnType<typeof sectorGaps>[] = []):Instruction{
 const c=s.cars[team],rival=nearbyRival(s,team),gap=(rival.distance-c.distance)/Math.max(30,c.speed);
 if(c.pit!=='none')return {...c.instruction,line:c.pit==='stopped'?'Hold. New tyres going on.':'Limiter on. We need a clean exit.'};
 const track=getTrack(s.circuit),isDrsZone=track.isDrsZone;
 const damage=damageLevel(c.damage);
 // Compare time lost after the next pit entry with the cost of the lane.
 const repairLaps=Math.max(0,s.laps-1-Math.floor((c.distance+track.LENGTH-track.PIT_ENTRY)/track.LENGTH));
 const tyre=weatherTyre(s.control,c.compound),{flag}=raceControlTelemetry(s);
 if(tyre!==c.compound&&repairLaps>0)return {pace:'manage',ers:'harvest',box:true,tyre,tactic:'hold',line:`Box for ${tyre==='medium'?'slicks':tyre==='wet'?'full wets':'intermediates'}. Manage the grip until pit entry.`};
 if(damage>0&&(c.stops===0||damage*repairLaps*40>18))return {...c.instruction,tyre:s.control?.rain&&s.control.rain!=='dry'?tyre:team==='a'?'hard':'soft',box:true,pace:'manage',tactic:'hold',line:'Box for repairs. Bring the car back in one piece.'};
 if(flag!=='green')return {pace:'manage',ers:'harvest',box:c.instruction.box,tyre:c.instruction.box?c.instruction.tyre:c.compound,tactic:'hold',
  line:flag==='yellow'?'Full-course yellow. Slow down and hold position.':s.control?.safetyCarInLap
   ?'Safety car in next lap. Hold position and prepare for the restart.':'Safety car out. Close up to the queue and hold position.'};
 if(s.control&&s.control.rain!=='dry')return {pace:'manage',ers:'harvest',box:false,tyre:c.compound,tactic:'hold',line:`${rainLabel(s.control.rain)}. Stay on these tyres and watch the grip.`};
 const box=c.stops===0&&(planAtLapStart?c.lap>=(team==='a'?0:1):team==='a'?c.distance>track.LENGTH*.725:c.distance>track.LENGTH*1.69||c.wear>.8);
 if(box)return {pace:'push',ers:'harvest',box:true,tyre:team==='a'?'hard':'soft',tactic:'hold',line:team==='a'?'Box, box. Hard tyres. We are going for the undercut.':'Box this lap. Soft tyres. Attack to the flag.'};
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
 return {offset:side==='left'?-3:side==='right'?3:team==='a'?-.6:.6,speedBias:instruction.pace==='manage'?-2:team==='b'?1.6:.3,brakeAggression:instruction.pace==='manage'?.2:team==='a'?.58:.9,side,ers:instruction.ers==='deploy'&&c.ers>8&&opening&&boostJoulesLeft(c,getTrack(s.circuit))>0,drs:true,reply:instruction.box?(team==='a'?'Copy. Box this lap. Let’s make it count.':'Box? Fine. Give me the softs.'):(team==='a'?'Understood. Smooth inputs. On the delta.':attack?'Leave it to me. I’m sending it.':'There’s more in this car. Let me push.')};
}
