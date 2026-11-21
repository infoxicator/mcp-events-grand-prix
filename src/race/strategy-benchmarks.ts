import {clamp, createRace, DT, grip, steeringTo, stepRace, type DriverControls} from './physics';
import {getTrack} from './track';
import {boostRequested, boostZone, type EnergyPriority, type DriverObservation, type RadioCall} from './strategy-radio';

export interface CornerInput extends DriverObservation {
 lateral: number;
 rivalLateral: number;
 distanceToTurn: number | null;
}

export const CONTROL_TICKS = 24;
export function cornerDriver(o: CornerInput): DriverControls {
 const occupied = o.rivalGap > -8 && o.rivalGap < 40 && o.rivalLateral < 0;
 const cornerSpeed = occupied ? 23 : 27;
 const distance = o.distanceToTurn ?? Infinity;
 const target = distance < 30 ? cornerSpeed : 82;
 const stoppingDistance = Math.max(0, (o.speed ** 2 - cornerSpeed ** 2) / (2 * 19 * o.grip));
 const brake = (distance <= stoppingDistance || distance < 30) && o.speed > cornerSpeed;
 const track = getTrack();
 const lookahead = clamp(o.speed * .25,7,24);
 const offset = track.racingLineOffset(o.distance + lookahead) + (occupied ? 3 : -1.5);
 return {steering: steeringTo(track,o.distance,o.lateral,o.heading,lookahead,offset), brake: brake ? .88 : 0, throttle: brake ? 0 : o.speed < target ? 1 : .2};
}

export function* cornerSession(inside: boolean, controller: 'adaptive' | 'reference') {
 const track = getTrack();
 const turn = track.CORNERS[0].d - 45;
 const start = turn - 135;
 const finish = turn + 310;
 const race = createRace();
 race.phase = 'racing';
 race.field = [];
 const {a, b} = race.cars;
 Object.assign(a, {distance: start, speed: 65, heading: 0, offset: 0});
 a.instruction.pace = 'push';
 Object.assign(b, {distance: start + 30, speed: 57, offset: inside ? -2.6 : 2.6});
 const path: {distance: number; offset: number}[] = [];
 let firstBrake: {distance:number;offset:number} | null = null, missed = 0, contacts = 0;
 let applied = 0, unavailable = 0;
 let limits = 0, secondsOutside = 0, outside = false, elapsed = 0;
 let control: DriverControls = {steering: 0, throttle: 0, brake: 0};
 while (a.distance < finish && race.time < 40) {
  if (race.tick % CONTROL_TICKS === 0) {
   path.push({distance: a.distance, offset: a.offset});
   if (controller === 'adaptive') {
    const observation: CornerInput = {
     speed: a.speed, distance: a.distance, heading: a.heading, grip: grip(a),
     curvature: [0, 20, 50, 100].map(m => track.signedCurvatureAt(a.distance + m)),
     rivalGap: b.distance - a.distance, closingSpeed: a.speed - b.speed,
     lateral: a.offset, rivalLateral: b.offset, distanceToTurn: a.distance <= turn ? turn - a.distance : a.distance < turn + 125 ? 0 : null,
    };
    const decision: CornerDecision = yield observation;
    if (decision.status === 'late') missed++;
    if (decision.status === 'unavailable') unavailable++;
    if (decision.status === 'applied') applied++;
    if (decision.controls) control = decision.controls;
   }
  }
  // Keep the benchmark rival on the selected side through the approach.
  b.offset = inside ? -2.6 : 2.6;
  b.heading = 0;
  const impact = a.lastImpact, before = a.distance;
  stepRace(race, controller === 'adaptive' ? {a: control} : undefined, controller === 'reference' ? 'a' : undefined);
  if (a.lastImpact && a.lastImpact !== impact) contacts++;
  const beyond = Math.abs(a.offset)>track.trackHalfWidth(a.distance)+.8;
  if (beyond && !outside) limits++;
  if (beyond) secondsOutside += DT;
  outside=beyond;
  elapsed=a.distance>=finish ? race.time-DT+(finish-before)/(a.distance-before)*DT : race.time;
  if (firstBrake === null && a.brake > .05) firstBrake = {distance:a.distance,offset:a.offset};
 }
 path.push({distance:a.distance,offset:a.offset});
 return {inside,controller,path,firstBrake,missed,applied,unavailable,contacts,limits,secondsOutside,time:elapsed,finished:a.distance>=finish};
}

export interface CornerDecision {
 status: 'applied' | 'late' | 'unavailable';
 controls?: DriverControls;
}

export const CORNER_DEADLINE_MS = CONTROL_TICKS * DT * 1000;

export function cornerReplay(inside: boolean, controller: 'adaptive' | 'reference', decide = cornerDriver, clock = () => performance.now()) {
 const session = cornerSession(inside, controller);
 let step = session.next();
 while (!step.done) {
  const before = clock();
  const controls = decide(step.value);
  step = session.next(clock() - before > CORNER_DEADLINE_MS ? {status:'late',controls:cornerDriver(step.value)} : {status:'applied',controls});
 }
 return step.value;
}

export type {EnergyPriority} from './strategy-radio';
export const batterySeeds = [17, 42, 77, 129, 213, 354];

function batteryZones() {
 const track = getTrack();
 const sector = (station: number) => station < track.SECTORS[1] ? 0 : station < track.SECTORS[2] ? 1 : 2;
 const zone = ({start,end}: {start:number;end:number}) => ({start,end,sector:sector(start)});
 return {attack:zone(boostZone(track,'attack')),defend:zone(boostZone(track,'defend'))};
}

export function batteryState(closing: number) {
 return {
  closing,
  history: [0, 1, 2].map(i => ({ahead: .88 - .09 * i, behind: .78 + closing * .055 * (2 - i)})),
  charge: 1, recharge: .16, laps: 2, zones: batteryZones(),
 };
}

export function batteryCall(state: ReturnType<typeof batteryState>, priority?: EnergyPriority): RadioCall {
 const first = state.history[0], last = state.history.at(-1)!;
 const projectedRear = last.behind + (last.behind - first.behind) * 1.5;
 const projectedFront = last.ahead + (last.ahead - first.ahead) * 1.5;
 const threatened = projectedRear < .5 && state.charge + state.recharge < 2;
 const selected = priority ?? (threatened || projectedFront > 1.1 ? 'defend' : 'attack');
 return {
  priority: selected, energy:1, sector:state.zones[selected].sector, issuedLap:0, expiresLap:state.laps,
  message: selected === 'defend' ? 'Hold the boost for defence on the main straight. Release it for attack if fourth drops out of range.' : 'Use the boost to attack second on the back straight.',
  revisit: selected==='defend' ? 'Fourth drops out of range' : 'Second drops out of range',
 };
}

export function batteryReleaseState() {
 const state=batteryState(-8);
 state.history=state.history.map(gap=>({...gap,behind:.42}));
 return state;
}

export function batteryReplay(state: ReturnType<typeof batteryState>, seed: number, priority?: EnergyPriority, message?: string, lockCall = false) {
 const call = batteryCall(state,priority);
 if (message !== undefined) call.message = message;
 const calls = [call];
 const gaps = [...state.history];
 let {ahead,behind} = gaps.at(-1)!;
 let available = state.charge;
 let remainingBoost = 0;
 let deployment: {lap:number;sector:number;metres:number;priority:EnergyPriority} | null = null;
 let revision: {lap:number;sector:number;metres:number} | null = null;
 const track = getTrack();
 let random = seed;
 const stintSecs = [30,31,29];
 const boostedMetres = 260;
 let initiallyThreatened = behind - state.closing * .08 < .6;
 for (let lap = 0; lap < state.laps; lap++) {
  for (const sector of [0,1,2]) {
   random = (Math.imul(1664525,random) + 1013904223) >>> 0;
   const variation = (random / 2 ** 32 - .5) * .11;
   const start = track.SECTORS[sector], end = track.SECTORS[sector+1];
   const speed = (end-start) / stintSecs[sector];
   for (let metres = start; metres < end; metres += 10) {
    const length = Math.min(10,end-metres);
    const prior = calls.at(-1)!;
    if (prior.priority==='defend' && !lockCall && !deployment) {
     if (behind<.6) initiallyThreatened=true;
     if (initiallyThreatened && behind>.95 && ahead>0 && ahead<1.1) {
      calls.push({...batteryCall(state,'attack'),issuedLap:lap,message:'Fourth is out of range. Release the boost to attack second.'});
      revision={lap:lap+1,sector:sector+1,metres:Math.round(metres)};
     }
    }
    const active = calls.at(-1)!;
    const target = active.priority === 'attack' ? 'attack' : 'defend';
    const zone = state.zones[target];
    // An attacking driver needs a clear lane to P2. The car that started
    // P4 can fill that lane after passing Jev.
    const opening = target==='attack' ? ahead>0 && ahead<1.35 && (behind>=0||behind<-.27)
     : behind>0 && behind-state.closing*.08<.52;
    if (!deployment && metres>=zone.start && metres+boostedMetres<=zone.end &&
        boostRequested(active,lap,sector,Math.floor(available),opening)) {
     deployment = {lap:lap+1,sector:sector+1,metres:Math.round(metres),priority:target};
     available -= 1;
     remainingBoost = boostedMetres;
    }
    const cleanTime = length/speed;
    const boosted = Math.min(length,remainingBoost);
    // Same speed gain and spend in either zone. Passing and traffic depend
    // on arrival order, rather than the strategist label.
    const gain = boosted * (1/75-1/99);
    remainingBoost -= boosted;
    const main = state.zones.defend;
    const rearInTow = state.closing!==0 && metres>=main.start && metres<main.end && behind>0 && behind<1.1;
    const closure = rearInTow ? state.closing/75 * (lap===0?1:.35) : 0;
    const rearPace = behind<0 ? .003 : .0005;
    const delayed = behind<0 && behind>-.55 && !boosted ? .014 * cleanTime : 0;
    ahead += (.012+variation)*length/(end-start) - gain + delayed;
    behind += (rearPace-closure)*cleanTime + gain - delayed;
    available += state.recharge * length/(state.laps*track.LENGTH);
   }
   gaps.push({ahead,behind});
  }
 }
 return {seed,call,calls,revision,gaps,deployment,place:3-Number(ahead<0)+Number(behind<0),finishGap:ahead,rearGap:behind};
}
