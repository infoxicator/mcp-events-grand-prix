import {contactNames} from './grid';
import {boostJoulesLeft,remainingOrderJoules} from './strategy-radio';
import {applyImpact,damageLevel,hitBarrier,resolveTraffic,type Impact} from './crashes';
import {FIELD_STEP_TICKS, classification, opponents, gridSlot, playerEntry, startingField, teammateEntry, type FieldCar} from './grid';
import {advanceField,clearRacingLine,trafficAhead} from './field-physics';
import {pitBox,pitRoute,teammateInBox,STACK_GAP} from './pit-service';
import {getTrack,type Track,type CircuitId} from './track';
import {VEHICLE,brakeCapacity,cornerLimit,drivetrain} from './vehicle';
import {dryCompounds,followNeutralisedQueue,neutralisedQueue,sectorWetnessOf,speedRestriction,stepRaceControl,wetGrip} from './race-control';
import { TEAMS,type Team,type Race,type Car,type Instruction,type DriverIntent,type Compound,type PanelDamage,type ErsMode,type HumanControlInput } from './types';
import {AI_LANES,type AiControl,type AiPedal} from './ai-controls';
export const DT=1/120;
export const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export const other=(t:Team):Team=>t==='a'?'b':'a';
export const defaultInstruction=():Instruction=>({pace:'balanced',ers:'balanced',box:false,tyre:'medium',tactic:'hold',line:'Bring the tyres in. Build the rhythm.'});
export const defaultIntent=():DriverIntent=>({offset:0,speedBias:0,brakeAggression:.5,side:'hold',ers:false,drs:true,reply:'Radio check. Ready to race.'});
export const TYRES={
 soft:{grip:1.08,wear:.000105,optimalTemp:98},
 medium:{grip:1,wear:.000068,optimalTemp:95},
 hard:{grip:.96,wear:.000044,optimalTemp:92},
 intermediate:{grip:1,wear:.000070,optimalTemp:82},
 wet:{grip:1,wear:.000062,optimalTemp:72},
} as const;
export const FUEL_IDLE_BURN=.004,FUEL_THROTTLE_BURN=.023,FIA_MIN_FUEL_KG=1.0;
export const NOMINAL_FUEL_BURN_PER_SEC=FUEL_IDLE_BURN+FUEL_THROTTLE_BURN*.71;
export function nominalRaceSpeed(circuit:CircuitId){return circuit==='las-vegas'?58:61.5;}
export function nominalFuelPerLap(circuit:CircuitId){const track=getTrack(circuit);return (track.LENGTH/nominalRaceSpeed(circuit))*NOMINAL_FUEL_BURN_PER_SEC;}

/** Scale tyre wear with race distance so 3-lap sprints retain fast degradation
 * while 20-lap strategy races have realistic 1-stop / 2-stop stint lengths. */
export const tyreWearScale=(laps:number)=>laps<=4?1:4/laps;

export function tyreCompoundsMeta(laps:number,trackLength:number){
 const scale=tyreWearScale(laps);
 const r=(n:number,d=2)=>Math.round(n*10**d)/10**d;
 const entry=(compound:Compound)=>{
  const wearPerLap=TYRES[compound].wear*trackLength*scale;
  return {grip:TYRES[compound].grip,wearPerLap:r(wearPerLap,3),lapsToCliff:r(.65/wearPerLap,1),optimalTempC:TYRES[compound].optimalTemp};
 };
 return {soft:entry('soft'),medium:entry('medium'),hard:entry('hard'),intermediate:entry('intermediate'),wet:entry('wet')};
}

/** Heavy wing/body damage requires extra pit box time (up to +8 s) to repair. */
export function damageRepairSeconds(damage?:PanelDamage){
 const level=damageLevel(damage);
 return level<=.15?0:Math.round(level*8*10)/10;
}

export function defaultTyreSets(starting:Compound):Record<Compound,number>{
 const sets:Record<Compound,number>={soft:3,medium:2,hard:2,intermediate:3,wet:2};
 sets[starting]=Math.max(0,sets[starting]-1);
 return sets;
}

export function dryCompoundRuleSatisfied(race:Race,car:Car){
 if(race.wetRace||race.laps<3)return true;
 const used=new Set((car.compoundsUsed??[car.compound]).filter(c=>(dryCompounds as readonly string[]).includes(c)));
 return used.size>=2;
}

export function createRace(laps=3,circuit:CircuitId='monza'):Race {
 const track=getTrack(circuit);
 // Short races keep generous fuel; long strategy races are budgeted tightly so
 // aggressive pushing creates genuine fuel-saving decisions around the FIA 1 kg sample.
 const fuel=laps<=4
  ? Math.max(34,Math.ceil(laps*track.LENGTH/50*(FUEL_IDLE_BURN+FUEL_THROTTLE_BURN)))
  : Math.ceil((laps*nominalFuelPerLap(circuit)+FIA_MIN_FUEL_KG+Math.max(.8,laps*.06))*10)/10;
 const car=(team:Team):Car=>{
  const starting:Compound=team==='a'?'soft':'medium';
  return {team,...gridSlot(playerEntry(team)),speed:0,speedTrap:0,gear:1,throttle:0,brake:0,steering:0,heading:0,lateralVelocity:0,acceleration:0,lateralG:0,rpm:4000,ersUsed:0,ersRecovered:0,ers:90,drs:false,eligible:[false,false],compound:starting,wear:0,temperature:85,fuel,pit:'none',pitTime:0,stops:0,tyreAge:0,warnings:0,penalty:0,lap:0,lapStart:0,lastLap:0,bestLap:0,lapTimes:[],sector:0,sectorStart:0,splits:[],bestSectors:[0,0,0],splitColours:['yellow','yellow','yellow'],finishTime:null,intent:defaultIntent(),instruction:defaultInstruction(),lastLimit:-100,compoundsUsed:[starting],tyreSets:defaultTyreSets(starting)};
 };
 return {circuit,tick:0,time:0,phase:'lobby',countdown:5,laps,field:startingField(laps),cars:{a:car('a'),b:car('b')},events:[],radio:[],leader:'a',fastest:null,winner:null};
}
export function event(s:Race,kind:Race['events'][number]['kind'],team:Team,message:string){s.events.push({id:Math.max(s.tick*100,(s.events.at(-1)?.id??0)+1),time:s.time,kind,team,message});if(s.events.length>40)s.events.shift();}
export function grip(c:Car,wetness=0){
 const opt=TYRES[c.compound].optimalTemp;
 const thermal=1-Math.min(.26,Math.abs(c.temperature-opt)*.0032);
 return TYRES[c.compound].grip*(1-c.wear*.28-Math.max(0,c.wear-.65)*.8)*thermal*wetGrip(c.compound,wetness);
}
export function aero(c:Car,rival:FieldCar,distance=c.distance){const gap=rival.distance-distance,aligned=Math.abs(c.offset-rival.offset)<2.6;return {slipstream:gap>5&&gap<110&&aligned?(1-gap/110):0,dirtyAir:gap>3&&gap<55&&aligned?.22*(1-gap/55):0};}
export function drsAllowed(c:Car,track:Track=getTrack()){const {inZone,DRS_ZONES,isDrsZone}=track;return c.pit==='none'&&c.eligible.some((ok,i)=>ok&&inZone(c.distance,DRS_ZONES[i].start,DRS_ZONES[i].end))&&isDrsZone(c.distance)&&c.brake<.1;}
function crossedLine(before:number,after:number,mark:number,LENGTH:number){return Math.floor((before-mark)/LENGTH)<Math.floor((after-mark)/LENGTH);}
// Precompute geometry only; grip, fuel, wake and strategy remain dynamic.
const CURVE_STEP=4,curves=new WeakMap<Track,number[]>();
export function pathCurvature(d:number,track:Track=getTrack()){let curveTable=curves.get(track);if(!curveTable){curveTable=Array.from({length:Math.ceil(track.LENGTH/CURVE_STEP)+1},(_,i)=>track.racingCurvature(i*CURVE_STEP));curves.set(track,curveTable);}const u=track.wrap(d)/CURVE_STEP,i=Math.floor(u);return curveTable[i]*(1-u+i)+curveTable[i+1]*(u-i);}
export function racingSpeed(c:Car,rival:FieldCar,track:Track=getTrack(),wetness=0,distance=c.distance,pedal?:AiPedal){
 const g=grip(c,wetness),air=aero(c,rival,distance),mass=VEHICLE.dryMass+c.fuel;
 let limit=105;
 const speedBias=clamp(c.intent.speedBias,-2,2);
 const brakeAgg=pedal==='overdrive'?1:pedal==='push'?.9:clamp(c.intent.brakeAggression,0,1);
 // Backwards velocity envelope: braking capacity grows with aerodynamic load.
 // Driver pace & brake aggression meaningfully shift corner speed and braking points.
 const comfort=c.instruction.pace==='manage'?.91:c.instruction.pace==='push'?.985:.96;
 const cornerScale=pedal==='overdrive'?1.12:pedal==='push'?1.04:Math.min(1,comfort*(1+speedBias*.014));
 for(let ahead=320;ahead>=0;ahead-=8){const curve=pathCurvature(distance+ahead,track),v=cornerLimit(curve,mass,g,air.dirtyAir);
  const corner=v*cornerScale;
  const decel=brakeCapacity(limit,mass,g,Math.min(3*9.81,limit*limit*Math.abs(curve)),air.dirtyAir)*(.69+brakeAgg*.155);
  limit=Math.min(corner,Math.sqrt(limit*limit+2*decel*8));
 }
 return limit;
}
export interface DriverControls {throttle: number; brake: number; steering: number; steerRate?: number; ersOvertake?: boolean; ersMode?: ErsMode; drs?: boolean; brakeBias?: number; gear?: number; tc?: 'off'|'medium'|'full'; abs?: boolean; pitAssist?: boolean}
export function humanInputToControls(c: Car, input: HumanControlInput): DriverControls {
 const speedFactor = clamp(1 - (c.speed / 95) * .78, .16, 1);
 const maxSteer = .36 * speedFactor;
 return {
  throttle: clamp(input.throttle, 0, 1),
  brake: clamp(input.brake, 0, 1),
  steering: clamp(input.steer, -1, 1) * maxSteer,
  steerRate: 2.8,
  ersOvertake: Boolean(input.ersOvertake),
  ersMode: input.ersMode,
  drs: input.drs,
  brakeBias: input.brakeBias,
  gear: input.gear,
  tc: input.tc,
  abs: input.abs,
  pitAssist: input.pitAssist,
 };
}
export function steeringTo(track: Track, distance: number, offset: number, heading: number, ahead: number, targetOffset: number){
 const position=track.pointAt(distance,offset),aim=track.pointAt(distance+ahead,targetOffset),tangent=track.tangentAt(distance);
 const yaw=Math.atan2(tangent.x,tangent.z)+heading,dx=aim.x-position.x,dz=aim.z-position.z;
 const right=dx*Math.cos(yaw)-dz*Math.sin(yaw);
 return clamp(Math.atan2(2*VEHICLE.wheelbase*right,dx*dx+dz*dz),-.42,.42);
}

function findCarByCode(s:Race,code:string):FieldCar|undefined{
 if(playerEntry('a').code===code)return s.cars.a;
 if(playerEntry('b').code===code)return s.cars.b;
 const idx=opponents.findIndex(e=>e.code===code);
 return idx>=0?s.field[idx]:undefined;
}

function trafficSnapshot(c:Car){
 return {distance:c.distance,offset:c.offset,speed:c.speed,pit:c.pit,lateralVelocity:c.lateralVelocity,
  finishTime:c.finishTime,bestSectors:[...c.bestSectors]};
}
export function stepRace(s:Race, controls?: Partial<Record<Team, DriverControls>>, fixedLine?: Team, aiControls?:Partial<Record<Team,AiControl>>){
 const track=getTrack(s.circuit),{LENGTH,wrap,SECTORS,DRS_ZONES,PIT_ENTRY,PIT_EXIT,PIT_LIMIT,PIT_STOP_SECONDS,SPEED_TRAP,racingLineOffset,signedCurvatureAt,trackHalfWidth}=track;
 const crossed=(before:number,after:number,mark:number)=>crossedLine(before,after,mark,LENGTH);
 const wearScale=tyreWearScale(s.laps);
 s.tick++;
 if(s.phase==='lobby'||s.phase==='finished')return;
 if(s.phase==='lights'){s.countdown-=DT;if(s.countdown<=0){s.phase='racing';s.countdown=0;event(s,'start','a','LIGHTS OUT — LET THEM RACE');}return;}
 s.time+=DT;
 stepRaceControl(s,track,DT);
 const restriction=speedRestriction(s.control),neutralised=Number.isFinite(restriction),queue=neutralisedQueue(s);
 // Read a stable pair to prevent team iteration order influencing aerodynamics.
 const prior={a:trafficSnapshot(s.cars.a),b:trafficSnapshot(s.cars.b)};
 function crash(car:Car,hit:Impact){
  const applied=applyImpact(car,hit,s.time);
  if(applied)event(s,'collision',car.team,`${playerEntry(car.team).code} · ${hit.source} CONTACT · ${Math.round(damageLevel(car.damage)*100)}% DAMAGE`);
  return applied;
 }
 const cars=[s.cars.a,s.cars.b,...s.field];
 const notify=(car:Car,hit:Impact)=>event(s,'collision',car.team,`${playerEntry(car.team).code} · ${hit.source} CONTACT · ${Math.round(damageLevel(car.damage)*100)}% DAMAGE`);
 resolveTraffic(cars,contactNames,track,s.time,DT,notify);
 for(const team of TEAMS){const c=s.cars[team],rival=prior[other(team)];
  c.ersPowerKw=0;
  if(c.finishTime!==null)continue;
  const before=c.distance,PIT_STOP=pitBox(track,team);
  const sectorWet=sectorWetnessOf(s.control,c.sector);
  if(sectorWet>=.25||c.compound==='intermediate'||c.compound==='wet')s.wetRace=true;
  if(c.pit==='stopped'){
   c.pitTime+=DT;c.speed=0;c.throttle=0;c.brake=1;c.drs=false;
   const repairExtra=damageRepairSeconds(c.damage);
   const totalStop=c.totalStop??(PIT_STOP_SECONDS+repairExtra);c.totalStop=totalStop;
   if(c.pitTime+1e-8>=totalStop){
    delete c.totalStop;
    const repaired=!!c.damage;delete c.damage;delete c.lastImpact;
    let fitted:Compound=c.instruction.tyre;
    if(c.tyreSets&&c.tyreSets[fitted]<=0){
     const fallback=(['hard','medium','soft','intermediate','wet'] as Compound[]).find(k=>c.tyreSets![k]>0);
     if(fallback)fitted=fallback;
    }
    c.compound=fitted;
    if(fitted==='intermediate'||fitted==='wet')s.wetRace=true;
    if(c.tyreSets)c.tyreSets[fitted]=Math.max(0,c.tyreSets[fitted]-1);
    const used=c.compoundsUsed??=[fitted];
    if(!used.includes(fitted))used.push(fitted);
    c.wear=0;c.temperature=75;c.tyreAge=0;c.stops++;c.instruction.box=false;c.pit='exit';
    event(s,'pit',team,`${team.toUpperCase()} · ${totalStop.toFixed(1)}s STOP · ${c.compound.toUpperCase()}${repaired?' · DAMAGE REPAIRED':''}`);
   }continue;
  }
  // Conditional boost auto-release (e.g., "Release boost for attack if P4 drops out of range").
  const energyOrder=c.instruction.energy;
  if(energyOrder?.priority==='defend'&&energyOrder.releaseAttackIfBehindGtS!==undefined&&remainingOrderJoules(c,energyOrder)>1000){
   const behindCar=[rival,...s.field].filter(o=>o.finishTime===null&&(!o.pit||o.pit==='none')&&o.distance<c.distance)
    .sort((x,y)=>y.distance-x.distance)[0];
   const refSpeed=c.lastLap>0?LENGTH/c.lastLap:Math.max(35,c.speed);
   const rearGapS=behindCar?(c.distance-behindCar.distance)/refSpeed:Infinity;
   if(rearGapS>energyOrder.releaseAttackIfBehindGtS){
    energyOrder.priority='attack';
    energyOrder.zone='attack';
    delete energyOrder.releaseAttackIfBehindGtS;
    c.instruction.tactic='attack';
    event(s,'radio',team,'Rear gap clear — releasing boost for attack');
   }
  }
  const traffic=trafficAhead(c,s.field,110);
  const wake=traffic&&(rival.distance<=c.distance||traffic.distance<rival.distance)?traffic:rival;
  const air=aero(c,wake),mode=c.instruction.pace,mass=VEHICLE.dryMass+c.fuel,g=grip(c,sectorWet);
  const rawInput=controls?.[team];
  const aiControl=aiControls?.[team],pit=c.pit!=='none';
  const toEntry=wrap(PIT_ENTRY-c.distance),boxing=c.instruction.box&&toEntry<260;
  const aiUnassisted=Boolean(aiControl&&!neutralised&&!pit&&!boxing);
  const hybrid=aiUnassisted&&aiControl?.style==='no-assist'?aiControl:undefined;
  const inputs=!neutralised&&!(pit&&rawInput?.pitAssist!==false)&&!(boxing&&aiControl&&rawInput?.pitAssist)?rawInput:undefined;
  const drsRequested=inputs?.drs!==undefined?inputs.drs:c.intent.drs;
  c.drs=!neutralised&&sectorWet<.3&&drsRequested&&drsAllowed(c,track)&&s.time>20&&Math.abs(pathCurvature(c.distance,track))<.004;
  const fuelOrder=c.instruction.fuelSave;
  const saveFuel=c.pit==='none'&&fuelOrder&&c.lap<fuelOrder.expiresLap&&c.sector===fuelOrder.sector&&!track.isDrsZone(c.distance);
  // Single-car yield (with optional target_car) + teammate swap-back yield.
  let yieldRival:FieldCar|undefined;
  if(c.instruction.yieldUntilLap!==undefined&&c.lap<c.instruction.yieldUntilLap){
   const targeted=c.instruction.yieldTarget?findCarByCode(s,c.instruction.yieldTarget):undefined;
   if(targeted){
    if(targeted.distance>c.distance+3){
     delete c.instruction.yieldUntilLap;
     delete c.instruction.yieldTarget;
    }else if(targeted.finishTime===null&&(!targeted.pit||targeted.pit==='none')&&c.distance-targeted.distance<40){
     yieldRival=targeted;
    }
   }else{
    const candidate=[rival,...s.field].find(o=>o.finishTime===null&&(!o.pit||o.pit==='none')&&o.distance<c.distance&&c.distance-o.distance<35&&o.speed>c.speed-1);
    if(candidate){
     yieldRival=candidate;
     // Latch onto this one car so we don't yield to the entire grid behind.
     const oppIdx=s.field.indexOf(candidate as typeof s.field[number]);
     if(oppIdx>=0)c.instruction.yieldTarget=opponents[oppIdx].code;
     else if(candidate===rival)c.instruction.yieldTarget=playerEntry(other(team)).code;
    }
   }
  }
  // Teammate swap-back: if ordered to give place back, yield cleanly to teammate.
  const teamOrder=c.instruction.teamOrder;
  if(!yieldRival&&teamOrder?.kind==='swap-back'&&!teamOrder.completed&&c.lap<teamOrder.expiresLap){
   const mate=teammateEntry(team);
   const mateCar=mate?s.field[mate.index]:undefined;
   if(mateCar&&mateCar.finishTime===null&&(!mateCar.pit||mateCar.pit==='none')){
    if(mateCar.distance>c.distance+3)teamOrder.completed=true;
    else if(c.distance-mateCar.distance<35)yieldRival=mateCar;
   }
  }
  const effectiveErsMode=inputs?.ersMode??c.instruction.ers;
  const humanErs=inputs&&(inputs.ersOvertake!==undefined||inputs.ersMode!==undefined);
  const boostRequested=humanErs
   ? (!neutralised&&c.pit==='none'&&c.ers>1&&(Boolean(inputs.ersOvertake)||(effectiveErsMode==='deploy'&&inputs.throttle>.7&&c.speed>42)))
   : (!neutralised&&!saveFuel&&!yieldRival&&c.intent.ers&&c.pit==='none'&&c.ers>1&&c.instruction.ers!=='harvest');
  const boostAvailable=boostRequested
   ? Math.min(VEHICLE.ersPower*DT,(c.ers-1)*VEHICLE.batteryJoules/100,4000000-c.ersUsed,boostJoulesLeft(c,track))
   : 0;
  const boostPower=boostAvailable>1?boostAvailable/DT:0;
  // Aggressive ERS harvesting clips top-end straight power slightly in exchange for faster recharge.
  const harvestClipping=boostPower===0&&c.pit==='none'&&effectiveErsMode==='harvest'&&c.speed>72&&c.ersRecovered<2000000;
  const netBoostPower=boostPower>0?boostPower:harvestClipping?-25000:0;
  let target=inputs?0:racingSpeed(c,wake,track,sectorWet,c.distance+c.speed*.18,hybrid?.pedal);
  const neutralisedLeader=queue?.get(c);
  target=Math.min(target,restriction);
  if(neutralisedLeader)target=Math.min(target,neutralisedLeader.speed+Math.max(0,neutralisedLeader.distance-before-9)*.8);
  const damage=damageLevel(c.damage);
  target*=1-.23*damage;
  if(c.wear>.75)target*=1-(c.wear-.75)*.16;
  const outOfFuel=c.fuel<=.01;
  if(outOfFuel)target=Math.min(target,40);
  if(c.pit!=='none')target=Math.min(target,PIT_LIMIT);
  if(boxing&&!pit)target=Math.min(target,Math.sqrt(PIT_LIMIT**2+2*28*toEntry));
  const waiting=c.pit==='entry'&&teammateInBox(s,track,playerEntry(team),before,PIT_STOP);
  const remaining=wrap(PIT_STOP-before);
  if(c.pit==='entry'){const toBox=Math.max(0,remaining-(waiting?STACK_GAP:0));if(toBox<35)target=Math.min(target,Math.sqrt(2*7*toBox));}
  if(yieldRival&&c.pit==='none')target=Math.min(target,Math.max(20,yieldRival.speed-4));
  let steerTarget=inputs?.steering;
  if(steerTarget===undefined){
   const lookahead=clamp(c.speed*.25,7,24);
   const base=pit?pitRoute(track,c.distance+lookahead,PIT_STOP):racingLineOffset(c.distance+lookahead);
   const margin=trackHalfWidth(c.distance)-1.05;
   const yieldOffset=yieldRival&&!pit?(yieldRival.offset>=0?-2.6:2.6):0;
   const desired=pit||fixedLine===team||neutralised?base
    :hybrid?base+AI_LANES[hybrid.lane]
    :yieldRival?clamp(base+yieldOffset,-margin,margin)
    :Math.abs(c.intent.offset)>8?c.intent.offset
    :clearRacingLine(c,clamp(base+c.intent.offset,-margin,margin),margin,s.field,rival);
   steerTarget=steeringTo(track,c.distance,c.offset,c.heading,lookahead,desired);
  }
  const steerRate=inputs?.steerRate??1.1;
  c.steering+=clamp(steerTarget-c.steering,-steerRate*DT,steerRate*DT);
  const demandedYaw=c.speed/VEHICLE.wheelbase*Math.tan(c.steering);
  const lateralAccel=Math.min(5.5*9.81,Math.abs(demandedYaw*c.speed));
  const drive=drivetrain(c.speed,mass,g,netBoostPower,c.drs,air.slipstream,air.dirtyAir,lateralAccel,damage);
  const maxDrive=outOfFuel?drive.maxDrive*.15:drive.maxDrive;
  const brakeMax=brakeCapacity(c.speed,mass,g,Math.min(lateralAccel,drive.tyreForce/mass*.5),air.dirtyAir,damage);
  const gap=rival.distance-c.distance;
  if(!aiUnassisted){
   if(rival.finishTime===null&&gap>0&&gap<35&&Math.abs(c.offset-rival.offset)<2.1)target=Math.min(target,Math.sqrt(rival.speed**2+2*15*Math.max(0,gap-7)));
   if(traffic&&traffic.distance-before<28)target=Math.min(target,traffic.speed+Math.max(0,traffic.distance-before-6.5)*.9);
  }
  const dv=target-c.speed;
  // Lift-and-coast fuel saving: lift early before corners, gentle cap elsewhere in the sector.
  const approachingCorner=saveFuel&&(Math.abs(pathCurvature(c.distance+130,track))>.005||Math.abs(pathCurvature(c.distance+70,track))>.006);
  const throttleCap=saveFuel?(approachingCorner?.14:.82):1;
  const pedal=hybrid?.pedal;
  const directBrake=pedal==='brake-hard'?1:pedal==='brake-light'?.45:pedal==='coast'?0:undefined;
  let requestedThrottle=inputs?.throttle??(directBrake!==undefined?0:dv>0?clamp(dv*.65,0,throttleCap):0);
  if(inputs&&c.pit==='none'&&c.speed<62&&Math.abs(c.lateralG)>1.6){
   if(inputs.tc==='full')requestedThrottle=Math.min(requestedThrottle,clamp(1-(Math.abs(c.lateralG)-1.6)*.18,.38,1));
   else if(inputs.tc==='medium')requestedThrottle=Math.min(requestedThrottle,clamp(1-(Math.abs(c.lateralG)-2.2)*.14,.55,1));
  }
  const requestedBrake=inputs?.brake??directBrake??(dv<0?clamp(-dv*3.5/Math.max(5,brakeMax),0,1):0);
  const throttleUpRate=inputs?.steerRate!==undefined?9*DT:5*DT;
  c.throttle+=clamp(requestedThrottle-c.throttle,-12*DT,throttleUpRate);c.brake+=clamp(requestedBrake-c.brake,-12*DT,12*DT);
  if(c.brake>.05){c.throttle=0;c.drs=false;}
  // Late braking on worn or wet tyres risks a real wheel lockup (reduced decel + flat-spot wear).
  const brakeAgg=pedal==='overdrive'||pedal==='brake-hard'?1:pedal==='push'?.9:clamp(c.intent.brakeAggression,0,1);
  const driverAttack=clamp(c.intent.speedBias,-2,2)/2;
  const biasThreshold=clamp(.88-Math.max(0,((inputs?.brakeBias??56)-56)*.015),.72,.92);
  const humanLockup=Boolean((inputs?.abs===false||pedal==='brake-hard'||pedal==='overdrive')&&!pit&&c.brake>biasThreshold&&c.speed>30&&(c.wear>.35||sectorWet>.2||c.brake>.95));
  const lockedUp=humanLockup||(!inputs&&c.pit==='none'&&c.brake>.68&&brakeAgg>=.85&&(c.wear>.58||sectorWet>.25)&&c.speed>32);
  c.lockup=lockedUp?1:0;
  const effectiveBrakeMax=lockedUp?brakeMax*.82:brakeMax;
  const acceleration=(maxDrive*c.throttle-drive.drag-drive.rolling)/mass-c.brake*Math.max(0,effectiveBrakeMax-(drive.drag+drive.rolling)/mass);
  c.acceleration=acceleration;c.speed=Math.max(0,c.speed+acceleration*DT);
  if(c.pit!=='none')c.speed=Math.min(PIT_LIMIT,c.speed);
  const tyreLong=mass*acceleration+drive.drag+drive.rolling;
  const availableLateral=Math.sqrt(Math.max(0,drive.tyreForce**2-tyreLong**2))/mass;
  const yawLimit=Math.min(5.5*9.81,availableLateral*(lockedUp?.78:1))/Math.max(2,c.speed);
  const actualYaw=clamp(demandedYaw,-yawLimit,yawLimit);
  c.lateralG=-actualYaw*c.speed/9.81;
  const roadCurve=signedCurvatureAt(c.distance),pathScale=Math.max(.65,1-roadCurve*c.offset);
  const progress=c.speed*Math.cos(c.heading)/pathScale;
  c.heading=clamp(c.heading+(actualYaw+roadCurve*progress)*DT,-.6,.6);
  c.lateralVelocity=-c.speed*Math.sin(c.heading);c.offset+=c.lateralVelocity*DT;
  c.distance+=Math.max(0,progress)*DT;
  followNeutralisedQueue(c,before,neutralisedLeader);
  if(traffic&&!aiUnassisted){
   const trafficEnd=traffic.distance+traffic.speed*(((s.tick-1)%FIELD_STEP_TICKS)+1)*DT;
   if(trafficEnd-before>=5.62&&c.distance>trafficEnd-5.62){
    c.distance=trafficEnd-5.62;c.speed=Math.min(c.speed,traffic.speed);
   }
  }
  if(waiting&&c.distance-before>=Math.max(0,remaining-STACK_GAP)){
   c.distance=before+Math.max(0,remaining-STACK_GAP);c.speed=0;
  }
  const wall=hitBarrier(c,track,before);if(wall)crash(c,wall);
  if(c.pit==='none'&&Math.abs(c.offset)>trackHalfWidth(c.distance)+1){c.speed=Math.max(0,c.speed-4*DT);c.wear=clamp(c.wear+.002*DT*wearScale,0,1);}
  const thresholds=[26,36,46,56,66,76,86];let gear=1;for(const threshold of thresholds)if(c.speed>threshold)gear++;
  if(inputs?.gear!==undefined)gear=clamp(Math.round(inputs.gear),1,8);
  c.gear=gear;
  const ratio=[0,135,102,82,69,60,53,47,42][gear];c.rpm=clamp(c.speed/(2*Math.PI*.36)*60*ratio/10,4000,13000);
  if(inputs?.gear!==undefined&&c.rpm>=12950&&c.acceleration>0){c.speed=Math.max(0,c.speed-c.acceleration*DT*.85);}
  const chargeBefore=c.ers;
  if(boostPower>0&&c.throttle>0){const used=boostPower*DT*c.throttle;c.ersUsed+=used;c.ersDeployed=(c.ersDeployed??0)+used;c.ers=clamp(c.ers-used/VEHICLE.batteryJoules*100,0,100);}
  else{const harvestRate=harvestClipping?26000:effectiveErsMode==='harvest'?18000:4000;const recovered=Math.min(120000*c.brake+harvestRate,Math.max(0,(2000000-c.ersRecovered)/DT))*DT;c.ersRecovered+=recovered;c.ers=clamp(c.ers+recovered/VEHICLE.batteryJoules*100,0,100);}
  // Positive power leaves the battery, negative power charges it. Account for clipping at full charge.
  c.ersPowerKw=Math.round((chargeBefore-c.ers)*VEHICLE.batteryJoules/(100*1000*DT));
  if(crossed(before,c.distance,SPEED_TRAP))c.speedTrap=c.speed*3.6;
  const travelled=c.distance-before;
  // Wet/inter tyres shred rapidly on dry asphalt; driver pace & brake aggression meaningfully affect wear.
  const dryShred=c.compound==='wet'&&sectorWet<.45?1+2*(1-sectorWet/.45):c.compound==='intermediate'&&sectorWet<.22?1+1.4*(1-sectorWet/.22):1;
  const driverWearFactor=(1+driverAttack*.14)*(1+(brakeAgg-.55)*.45*c.brake);
  const lockupWear=lockedUp?.0012*DT*wearScale:0;
  c.wear=clamp(c.wear+travelled*TYRES[c.compound].wear*wearScale*(mode==='manage'?.68:mode==='push'?1.2:1)*driverWearFactor*dryShred+lockupWear,0,1);
  c.tyreAge+=travelled/LENGTH;
  const baseTemp=c.speed<45?track.temperature+30:(track.night?81:87);
  const dryOverheat=c.compound==='wet'&&sectorWet<.45?24*(1-sectorWet/.45):c.compound==='intermediate'&&sectorWet<.22?18*(1-sectorWet/.22):0;
  const driverHeat=driverAttack*4.5+(brakeAgg-.55)*8*c.brake;
  c.temperature+=(baseTemp+dryOverheat+driverHeat+c.throttle*9+c.brake*12+Math.abs(c.lateralG)*2-(mode==='manage'?9:0)-c.temperature)*DT*.08;
  const driverFuelFactor=1+driverAttack*.06;
  c.fuel=Math.max(0,c.fuel-(FUEL_IDLE_BURN+FUEL_THROTTLE_BURN*c.throttle)*driverFuelFactor*DT);
  if(c.instruction.box&&c.pit==='none'&&crossed(before,c.distance,PIT_ENTRY)){c.pit='entry';event(s,'pit',team,'BOX BOX · pit limiter on');}
  if(c.pit==='entry'&&!waiting&&crossed(before,c.distance,PIT_STOP)){c.distance=Math.floor((c.distance-PIT_STOP)/LENGTH)*LENGTH+PIT_STOP;c.pit='stopped';c.pitTime=0;c.totalStop=PIT_STOP_SECONDS+damageRepairSeconds(c.damage);c.speed=0;}
  if(c.pit==='exit'&&crossed(before,c.distance,PIT_EXIT)){c.pit='none';event(s,'pit',team,'Pit exit clear. Push now.');}
  if(c.pit==='none'&&Math.abs(c.offset)>trackHalfWidth(c.distance)+.8&&s.time-c.lastLimit>5){c.lastLimit=s.time;c.warnings++;if(c.warnings%3===0)c.penalty+=5;event(s,'limits',team,`TRACK LIMITS · warning ${c.warnings}${c.warnings%3===0?' / +5s':''}`);}
  for(let i=0;i<DRS_ZONES.length;i++)if(crossed(before,c.distance,DRS_ZONES[i].detection)){const delta=wake.distance-c.distance;c.eligible[i]=delta>0&&delta/Math.max(wake.speed,25)<=1&&(wake!==rival||rival.pit==='none');}
  const lap=Math.max(0,Math.floor(c.distance/LENGTH));
  const sec=wrap(c.distance)<SECTORS[1]?0:wrap(c.distance)<SECTORS[2]?1:2;
  if(sec!==c.sector&&c.distance>0){const split=s.time-c.sectorStart,old=c.bestSectors[c.sector],rivalBest=rival.bestSectors[c.sector];c.splits[c.sector]=split;c.splitColours[c.sector]=(!old||split<old)&&(!rivalBest||split<rivalBest)?'purple':!old||split<=old?'green':'yellow';c.bestSectors[c.sector]=old?Math.min(old,split):split;c.sectorStart=s.time;c.sector=sec;}
  if(lap>c.lap){const time=s.time-c.lapStart;c.lastLap=time;c.lapTimes.push(time);c.bestLap=c.bestLap?Math.min(time,c.bestLap):time;c.lapStart=s.time;c.lap=lap;c.ersUsed=0;c.ersRecovered=0;
   if(!s.fastest||time<s.fastest.time)s.fastest={team,time};event(s,'lap',team,`LAP ${lap} · ${time.toFixed(3)}s`);
   if(lap>=s.laps){
    if(!dryCompoundRuleSatisfied(s,c)&&!c.compoundPenaltyApplied){
     c.penalty+=30;c.compoundPenaltyApplied=true;
     event(s,'limits',team,'FIA TYRE RULE · +30s PENALTY (ONLY 1 DRY COMPOUND USED)');
    }
    if(s.laps>=10&&c.fuel<FIA_MIN_FUEL_KG&&!c.fuelPenaltyApplied){
     c.penalty+=30;c.fuelPenaltyApplied=true;
     event(s,'limits',team,'FIA FUEL SAMPLE <1KG · +30s PENALTY');
    }
    c.finishTime=s.time+c.penalty;event(s,'finish',team,playerEntry(team).name.toUpperCase()+' FINISHES');
   }
  }
 }
 const {a,b}=s.cars;
 if(s.tick%FIELD_STEP_TICKS===0&&s.field.length)advanceField(s,track,FIELD_STEP_TICKS*DT,queue);
 resolveTraffic(cars,contactNames,track,s.time,0,notify);
 const leader=a.distance>=b.distance?'a':'b';if(leader!==s.leader){s.leader=leader;if(a.finishTime===null&&b.finishTime===null&&a.pit==='none'&&b.pit==='none')event(s,'overtake',leader,`${playerEntry(leader).name.toUpperCase()} LEADS THE PLAYER DUEL`);}
 if(a.finishTime!==null&&b.finishTime!==null&&s.field.every(c=>c.finishTime!==null)){s.phase='finished';const first=classification(s)[0].entry;s.winner=first.seat??first.code;}
}
