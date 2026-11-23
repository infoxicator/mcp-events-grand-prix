import {radioActive, type Priority, type RadioCall} from './strategy-radio';
import {getTrack} from './track';

function radio(priority: Priority, message: string, revisit: string, issuedLap = 0, duration = 1, sector?: number): RadioCall {
 return {priority, message, revisit, issuedLap, expiresLap: issuedLap + duration, sector};
}

export function fuelDecision(projected: number, sectors: {saved: number; lost: number; vulnerable: boolean}[], laps = 2) {
 const affordable = sectors.map((sector,index)=>({...sector,index}))
  .filter(sector=>!sector.vulnerable&&sector.saved>0)
  .sort((a,b)=>a.lost-b.lost);
 const best=affordable.find(sector=>projected+laps*sector.saved>=0)
  ?? affordable.reduce<typeof affordable[number]|undefined>((best,sector)=>!best||sector.saved>best.saved?sector:best,undefined);
 const selected=projected<0&&laps>0?best:undefined;
 const fuelAtFlag=projected+laps*(selected?.saved??0);
 const timeLost=laps*(selected?.lost??0);
 if(selected){
  const window=laps===2?'for the next two laps':laps===1?'this lap':`for the next ${laps} laps`;
  const shortfall=fuelAtFlag<0?' The fuel margin is still negative.':'';
  return {call:radio('save',`Lift early in sector ${selected.index+1} ${window}. Keep full pace on the main straight.${shortfall}`,
   'Fuel projection changes',0,laps,selected.index),fuelAtFlag,timeLost};
 }
 const call=projected<0
  ? radio('save','Fuel is short. No safe sector lift covers the deficit.','A protected lift window opens')
  : radio('push','Fuel is on target. Keep full pace.','Fuel projection changes');
 return {call,fuelAtFlag,timeLost};
}

export function fightDecision(paceAdvantage: number, tyreAgeAdvantage: number, defendingLoss: number, groupGap: number) {
 const yieldCar = paceAdvantage + tyreAgeAdvantage * .08 > .35 && defendingLoss > groupGap * .25;
 const slipstream = yieldCar ? Math.min(.5,Math.max(0,paceAdvantage*.4)) : 0;
 return {
  call: yieldCar ? radio('yield', 'Let the faster car through. Stay close and use its slipstream.', 'Slipstream breaks')
   : radio('defend', 'Keep the position. Cover the inside.', 'Defending costs contact with the group'),
  place: yieldCar ? 4 : 3,
  groupGap: groupGap + (yieldCar ? .2 - slipstream : defendingLoss),
 };
}

export function tyreDecision(gap: number, wear: number, remainingLaps: number) {
 const lateLoss = (remainingLaps - 1) * Math.max(0, wear + .15 - .6) * 2.7;
 const push = gap < 1.1 && .55 > lateLoss;
 return {
  call: push ? radio('push', 'Push for one lap to close the gap. Reassess at the line.', 'Lap completed')
   : radio('manage', 'Manage the tyres. We need pace late in this stint.', 'Gap or tyre wear changes'),
  nextGap: gap + (push ? -.55 : .22), nextWear: Math.min(1,wear + (push ? .15 : .07)), lateLoss: push ? lateLoss : 0,
 };
}

export function pitDecision(pitLoss: number, freshGain: number, trafficLoss: number, rearGap: number, rivalStopped: boolean) {
 const traffic = rearGap < pitLoss && rearGap >= pitLoss-10 ? trafficLoss : 0;
 if (traffic > freshGain) return radio('extend', 'Stay out one more lap. The current pit exit puts us in traffic.', 'Rejoin traffic clears');
 return rivalStopped
  ? radio('cover', 'Box this lap. Cover the rival’s stop.', 'Rejoin or rival pace changes')
  : radio('box', 'Box now. Fresh tyres and clear air on exit.', 'Rejoin traffic changes');
}

export const pitCommitmentPoint = (entry: number) => entry - 120;

export function pitCommitment(call: RadioCall, lap: number, receivedAt: number, entry = getTrack().PIT_ENTRY) {
 const commitment = pitCommitmentPoint(entry);
 const inTime = receivedAt <= commitment;
 const wantsStop = call.priority === 'box' || call.priority === 'cover';
 return {commitment, inTime, beforeEntry:receivedAt<entry, committed: inTime && wantsStop && radioActive(call,lap)};
}

export function weatherDecision(grip: number[], arrival: [number, number], sets: number, intermediateDelta: number | null) {
 const damp = grip.filter(value=>value<.79);
 const wetSoon = arrival[0]<=1;
 const uncertain = arrival[1]-arrival[0]>1;
 const wetEnough = damp.some(value=>value<.72);
 const switchTyres = sets>0&&damp.length>0&&wetSoon&&intermediateDelta!==null&&intermediateDelta<-.35&&(!uncertain||wetEnough);
 const holdReason = sets===0?'No intermediates left. Stay on slicks.'
  : intermediateDelta===null?'Stay on slicks. Reassess when the first car on intermediates completes the damp sector.'
  : 'Stay on slicks. The wet sectors do not yet justify the switch.';
 return {
  call: switchTyres ? radio('intermediates', 'Box for intermediates. They are quicker through the damp sector.', 'Grip recovers')
   : radio('slicks',holdReason,intermediateDelta===null?'Timed intermediate sector arrives':'Grip or available sets change'),
  compound: switchTyres ? 'Intermediates' : 'Slicks',
  setsLeft: sets - Number(switchTyres),
  nextSectorDelta: switchTyres ? intermediateDelta! : 0,
 };
}

export function teamDecision(tyreLifeAdvantage: number, paceAdvantage: number, expectedPointsGain: number, lapsSinceSwap = 0, passed = false) {
 const qualifies=tyreLifeAdvantage>1&&paceAdvantage>.25&&expectedPointsGain>0;
 const swap=qualifies&&lapsSinceSwap===0&&!passed;
 const activeSwap=lapsSinceSwap>0;
 const reverse=activeSwap&&lapsSinceSwap>=2&&!passed;
 const completed=activeSwap&&passed;
 const call=reverse ? radio('swap-back','Swap back. The pass did not happen.','Next timing line',lapsSinceSwap)
  : completed ? radio('hold','Pass complete. Hold position and bring both cars home.','Team points change',lapsSinceSwap)
  : swap ? radio('swap','Let your teammate attack on fresher tyres. Swap back in two laps if they haven’t made the pass.','Pass completed or two laps elapsed',0,2)
  : activeSwap ? radio('hold','Hold the swap. Your teammate still has one lap to make the pass.','Pass completed or deadline reached',lapsSinceSwap)
  : radio('hold','Hold position. Keep both cars in the points.','Projected team points improve',lapsSinceSwap);
 return {
  call,
  order:(swap||activeSwap)&&!reverse?'Teammate ahead':'Jev ahead',
  pointsGain:completed?expectedPointsGain:0,
 };
}
