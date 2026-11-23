import {
 DT,
 FIA_MIN_FUEL_KG,
 FUEL_IDLE_BURN,
 FUEL_THROTTLE_BURN,
 TYRES,
 aero,
 createRace,
 damageRepairSeconds,
 dryCompoundRuleSatisfied,
 event,
 grip,
 pathCurvature,
 racingSpeed,
 steeringTo,
 tyreWearScale,
} from './physics';
import {VEHICLE, brakeCapacity, drivetrain, forces} from './vehicle';
import {applyImpact, damageLevel, hitBarrier, longitudinalImpulse, trafficImpact, type Impact} from './crashes';
import {advanceField, trafficAhead} from './field-physics';
import {FIELD_STEP_TICKS, grid, gridSlot, opponents, playerEntry, type FieldCar} from './grid';
import {pitBox, pitRoute, STACK_GAP, teammateInBox} from './pit-service';
import {
 applyHazard,
 followNeutralisedQueue,
 neutralisedQueue,
 sectorWetnessOf,
 speedRestriction,
 stepRaceControl,
 type RainLevel,
} from './race-control';
import {getTrack, type CircuitId, type Track} from './track';
import {mockDriver, mockEngineer} from './brains';
import type {Car, Compound, Race, Team} from './types';
import type {RacingLineMode} from './racing-line';

export type DriveSessionType = 'race' | 'time-trial';
export type DriveDifficulty = 'rookie' | 'pro' | 'legend';
export type TractionControl = 'full' | 'medium' | 'off';
export type GearboxMode = 'auto' | 'manual';
export type DriveErsMode = 'none' | 'medium' | 'hotlap' | 'overtake';

export interface DriveAssists {
 gearbox: GearboxMode;
 tractionControl: TractionControl;
 abs: boolean;
 racingLine: RacingLineMode;
 pitAssist: boolean;
 launchAssist: boolean;
}

export interface DriveConfig {
 session: DriveSessionType;
 circuit: CircuitId;
 seat: Team;
 laps: number;
 weather: RainLevel;
 difficulty: DriveDifficulty;
 gridPosition: number; // 1..20 (ignored in time-trial)
 assists: DriveAssists;
}

export interface PlayerInputs {
 throttle: number; // 0..1
 brake: number; // 0..1
 steer: number; // -1 (right) .. +1 (left)
 ersOvertake: boolean;
 drsToggle: boolean;
 shiftUp: boolean;
 shiftDown: boolean;
 analogSteer?: boolean;
}

export interface DriveMfdState {
 ersMode: DriveErsMode;
 brakeBias: number; // 50..62 (% front)
 boxRequested: boolean;
 nextCompound: Compound;
}

export interface DriveAlert {
 text: string;
 tone: 'info' | 'green' | 'amber' | 'red' | 'purple';
 until: number;
}

export interface DriveTelemetryExtras {
 displayGear: number; // -1=R, 0=N, 1..8
 wheelspin: number; // 0..1
 lockup: number; // 0..1
 drsAvailable: boolean;
 drsZone: boolean;
 drsJustAvailable: boolean;
 lightCount: number; // 0..5 during start sequence
 lightsOutJustFired: boolean;
 lightBeepTick: number; // increments when each red light turns on
 launchRpm: number;
 launchOptimal: boolean;
 jumpStart: boolean;
 deltaSeconds: number | null; // live delta vs session PB trace
 lapInvalid: boolean;
 offTrack: boolean;
 onRevLimiter: boolean;
 revRatio: number; // 0..1
 shiftFlash: boolean;
 fuelLapsRemaining: number;
 ersLapBudgetPct: number; // remaining FIA 4 MJ/lap deployment %
 alert: DriveAlert | null;
 flashbackCount: number;
 flashbackAvailable: boolean;
}

interface Snapshot {
 race: Race;
 displayGear: number;
 lapInvalid: boolean;
 lapTrace: number[];
 mfd: DriveMfdState;
 reverseSpeed: number;
}

export interface DriveSession {
 config: DriveConfig;
 race: Race;
 mfd: DriveMfdState;
 telemetry: DriveTelemetryExtras;
 // Internal simulation state
 startHoldSeconds: number;
 lightsElapsed: number;
 lastLightCount: number;
 reverseSpeed: number; // >= 0 when reversing in gear -1
 reverseHold: number;
 manualGear: number; // -1, 0, 1..8
 shiftCooldown: number;
 drsWasAvailable: boolean;
 drsArmed: boolean;
 lapInvalid: boolean;
 lapTrace: number[];
 bestLapTrace: number[] | null;
 bestValidLap: number;
 snapshots: Snapshot[];
 lastSnapshotTick: number;
 alert: DriveAlert | null;
 alertClock: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const other = (t: Team): Team => (t === 'a' ? 'b' : 'a');

// Authentic 8-speed F1 gear ratios (speed in m/s -> wheel RPM * ratio/10 -> engine RPM)
export const GEAR_RATIOS = [0, 138, 104, 83, 69, 59, 51.5, 45.5, 40.5] as const;
const AUTO_UP_SPEED = [0, 29, 40, 50, 60, 70, 80, 89, 999] as const;
const AUTO_DOWN_SPEED = [0, 0, 22, 33, 43, 53, 63, 73, 82] as const;
const GEAR_MAX_SPEED = [0, 33.5, 44.5, 55.5, 66.5, 78, 89, 100, 114] as const;
const TRACE_STEP_M = 10;

const DIFFICULTY_PACE: Record<DriveDifficulty, number> = {
 rookie: 0.85,
 pro: 0.945,
 legend: 1.01,
};

export function defaultDriveConfig(): DriveConfig {
 return {
  session: 'race',
  circuit: 'monza',
  seat: 'a',
  laps: 5,
  weather: 'dry',
  difficulty: 'pro',
  gridPosition: 1,
  assists: {
   gearbox: 'auto',
   tractionControl: 'medium',
   abs: true,
   racingLine: 'full',
   pitAssist: true,
   launchAssist: true,
  },
 };
}

function startingCompoundForWeather(weather: RainLevel, seat: Team): Compound {
 if (weather === 'heavy') return 'wet';
 if (weather === 'moderate' || weather === 'light') return 'intermediate';
 return seat === 'a' ? 'soft' : 'medium';
}

function nextDryCompound(current: Compound): Compound {
 return current === 'soft' ? 'medium' : current === 'medium' ? 'hard' : 'soft';
}

export function createDriveSession(config: DriveConfig): DriveSession {
 const track = getTrack(config.circuit);
 const laps = config.session === 'time-trial' ? 99 : config.laps;
 const race = createRace(laps, config.circuit);
 const seat = config.seat;
 const aiSeat = other(seat);

 // Weather setup
 if (config.weather !== 'dry') {
  applyHazard(race, track, {kind: 'rain', level: config.weather});
  if (race.control) {
   race.control.wetness = config.weather === 'heavy' ? 0.92 : config.weather === 'moderate' ? 0.58 : 0.28;
   race.control.sectorWetness = [race.control.wetness, race.control.wetness, race.control.wetness];
  }
  race.wetRace = true;
 }

 const playerCar = race.cars[seat];
 const aiCar = race.cars[aiSeat];
 const startCompound = startingCompoundForWeather(config.weather, seat);
 playerCar.compound = startCompound;
 playerCar.compoundsUsed = [startCompound];
 if (config.weather !== 'dry') {
  aiCar.compound = startCompound;
  aiCar.compoundsUsed = [startCompound];
  for (const opp of race.field) opp.compound = startCompound;
 }

 playerCar.lastLimit = -10;
 if (config.session === 'time-trial') {
  // Clean track, qualifying fuel load, fresh tyres, rolling or standing start at P1
  race.field = [];
  playerCar.distance = -11;
  playerCar.offset = 0;
  playerCar.fuel = 12;
  playerCar.ers = 100;
  playerCar.temperature = TYRES[startCompound].optimalTemp;
  // Park rival far off-track (hidden by scene.setHideCar)
  aiCar.distance = -500;
  aiCar.finishTime = 0;
 } else {
  // Place player at requested starting grid slot (1..20) by swapping slots cleanly
  const desiredSlotIdx = clamp(Math.round(config.gridPosition) - 1, 0, grid.length - 1);
  const playerSlotIdx = grid.findIndex(e => e.seat === seat);
  if (desiredSlotIdx !== playerSlotIdx) {
   const targetEntry = grid[desiredSlotIdx];
   const targetPos = gridSlot(targetEntry);
   const origPlayerPos = {distance: playerCar.distance, offset: playerCar.offset};
   playerCar.distance = targetPos.distance;
   playerCar.offset = targetPos.offset;
   if (targetEntry.seat) {
    const otherPlayer = race.cars[targetEntry.seat];
    otherPlayer.distance = origPlayerPos.distance;
    otherPlayer.offset = origPlayerPos.offset;
   } else {
    const oppIdx = opponents.indexOf(targetEntry);
    if (oppIdx >= 0 && race.field[oppIdx]) {
     race.field[oppIdx].distance = origPlayerPos.distance;
     race.field[oppIdx].offset = origPlayerPos.offset;
    }
   }
  }
 }

 const traceLen = Math.ceil(track.LENGTH / TRACE_STEP_M) + 2;
 const mfd: DriveMfdState = {
  ersMode: config.session === 'time-trial' ? 'hotlap' : 'medium',
  brakeBias: 56,
  boxRequested: false,
  nextCompound: config.weather !== 'dry' ? startCompound : nextDryCompound(startCompound),
 };

 // Deterministic-feeling slight random hold after 5th red light (0.45..1.05s)
 const startHoldSeconds = 0.5 + (Math.random() * 0.55);

 const session: DriveSession = {
  config: {...config, assists: {...config.assists}},
  race,
  mfd,
  telemetry: {
   displayGear: 1,
   wheelspin: 0,
   lockup: 0,
   drsAvailable: false,
   drsZone: false,
   drsJustAvailable: false,
   lightCount: 0,
   lightsOutJustFired: false,
   lightBeepTick: 0,
   launchRpm: 4500,
   launchOptimal: false,
   jumpStart: false,
   deltaSeconds: null,
   lapInvalid: false,
   offTrack: false,
   onRevLimiter: false,
   revRatio: 0,
   shiftFlash: false,
   fuelLapsRemaining: 5,
   ersLapBudgetPct: 100,
   alert: null,
   flashbackCount: 0,
   flashbackAvailable: false,
  },
  startHoldSeconds,
  lightsElapsed: 0,
  lastLightCount: 0,
  reverseSpeed: 0,
  reverseHold: 0,
  manualGear: 1,
  shiftCooldown: 0,
  drsWasAvailable: false,
  drsArmed: false,
  lapInvalid: false,
  lapTrace: new Array<number>(traceLen).fill(NaN),
  bestLapTrace: null,
  bestValidLap: 0,
  snapshots: [],
  lastSnapshotTick: -999,
  alert: null,
  alertClock: 0,
 };
 return session;
}

export function startDriveLights(session: DriveSession) {
 if (session.race.phase !== 'lobby') return;
 session.race.phase = 'lights';
 session.lightsElapsed = 0;
 session.lastLightCount = 0;
 session.telemetry.lightCount = 0;
 session.telemetry.jumpStart = false;
}

export function pushDriveAlert(session: DriveSession, text: string, tone: DriveAlert['tone'], duration = 2.6) {
 session.alert = {text, tone, until: session.alertClock + duration};
 session.telemetry.alert = session.alert;
}

export function cycleErsMode(session: DriveSession, dir: 1 | -1 = 1) {
 const order: DriveErsMode[] = ['none', 'medium', 'hotlap', 'overtake'];
 const idx = (order.indexOf(session.mfd.ersMode) + dir + order.length) % order.length;
 session.mfd.ersMode = order[idx];
 const labels: Record<DriveErsMode, string> = {
  none: 'ERS · NONE (HARVEST)',
  medium: 'ERS · MEDIUM',
  hotlap: 'ERS · HOTLAP',
  overtake: 'ERS · OVERTAKE',
 };
 pushDriveAlert(session, labels[session.mfd.ersMode], session.mfd.ersMode === 'overtake' ? 'green' : 'info', 1.8);
}

export function adjustBrakeBias(session: DriveSession, delta: number) {
 session.mfd.brakeBias = clamp(session.mfd.brakeBias + delta, 50, 62);
 pushDriveAlert(session, `BRAKE BIAS · ${session.mfd.brakeBias}% FRONT`, 'info', 1.5);
}

export function toggleBoxRequest(session: DriveSession) {
 if (session.config.session === 'time-trial') {
  pushDriveAlert(session, 'PIT LANE CLOSED IN TIME TRIAL', 'amber', 1.8);
  return;
 }
 session.mfd.boxRequested = !session.mfd.boxRequested;
 session.race.cars[session.config.seat].instruction.box = session.mfd.boxRequested;
 session.race.cars[session.config.seat].instruction.tyre = session.mfd.nextCompound;
 pushDriveAlert(
  session,
  session.mfd.boxRequested
   ? `BOX THIS LAP · ${session.mfd.nextCompound.toUpperCase()} TYRES`
   : 'STAY OUT · PIT CALL CANCELLED',
  session.mfd.boxRequested ? 'amber' : 'info',
  2.4,
 );
}

export function setNextCompound(session: DriveSession, compound: Compound) {
 session.mfd.nextCompound = compound;
 session.race.cars[session.config.seat].instruction.tyre = compound;
 pushDriveAlert(session, `NEXT TYRE · ${compound.toUpperCase()}`, 'info', 1.6);
}

export function triggerFlashback(session: DriveSession): boolean {
 if (session.race.phase !== 'racing' || session.snapshots.length < 2) return false;
 // Jump back ~4 seconds (16 snapshots @ 0.25s) or to earliest available snapshot
 const targetIdx = Math.max(0, session.snapshots.length - 16);
 const snap = session.snapshots[targetIdx];
 session.snapshots.length = targetIdx + 1;
 session.race = structuredClone(snap.race);
 session.manualGear = snap.displayGear;
 session.telemetry.displayGear = snap.displayGear;
 session.lapInvalid = snap.lapInvalid;
 session.lapTrace = [...snap.lapTrace];
 session.mfd = {...snap.mfd};
 session.reverseSpeed = snap.reverseSpeed;
 session.drsArmed = session.race.cars[session.config.seat].drs;
 session.telemetry.flashbackCount++;
 session.telemetry.flashbackAvailable = session.snapshots.length > 1;
 pushDriveAlert(session, 'FLASHBACK · -4.0s REWIND', 'purple', 2.2);
 return true;
}

function crossedLine(before: number, after: number, mark: number, length: number) {
 return Math.floor((before - mark) / length) < Math.floor((after - mark) / length);
}

function speedSensitiveMaxSteer(speed: number, analog: boolean): number {
 // At low speed (hairpins/chicanes), full 0.42 rad lock is available.
 // At high speed (250-350 km/h), progressively narrow max lock so keyboard and
 // gamepad feel crisp, planted, and controllable like EA F1.
 const gripScale = analog ? 1.65 : 1.38;
 return Math.min(0.42, Math.atan((VEHICLE.wheelbase * 60) / Math.max(170, speed * speed)) * gripScale);
}

function engineTorqueFactor(rpm: number, gear: number): number {
 // Reward keeping the V6 hybrid in the 9,000-12,500 RPM powerband in Manual mode.
 if (gear <= 0) return 0;
 if (rpm >= 12950) return 0.45; // Rev limiter bounce
 if (rpm < 6000) return 0.62 + (rpm / 6000) * 0.25;
 if (rpm < 9200) return 0.87 + ((rpm - 6000) / 3200) * 0.13;
 return 1.0;
}

function ersTargetPowerKw(mode: DriveErsMode, overtakeHeld: boolean, speed: number, throttle: number): number {
 if (throttle <= 0.15) return 0;
 if (overtakeHeld || mode === 'overtake') return 120;
 if (mode === 'hotlap') return 92;
 if (mode === 'medium') return speed > 42 && throttle > 0.7 ? 45 : 0;
 return 0;
}

function stepAiCar(
 s: Race,
 aiSeat: Team,
 playerCar: Car,
 track: Track,
 paceScale: number,
 restriction: number,
 neutralised: boolean,
 queue: ReturnType<typeof neutralisedQueue>,
 wearScale: number,
) {
 const c = s.cars[aiSeat];
 if (c.finishTime !== null) return;
 if (s.tick % 24 === 0) {
  if (s.tick % 1440 === 0) c.instruction = mockEngineer(s, aiSeat);
  c.intent = mockDriver(s, aiSeat);
 }
 const {LENGTH, wrap, SECTORS, DRS_ZONES, PIT_ENTRY, PIT_EXIT, PIT_LIMIT, PIT_STOP_SECONDS, SPEED_TRAP, racingLineOffset, signedCurvatureAt, trackHalfWidth} = track;
 const crossed = (before: number, after: number, mark: number) => crossedLine(before, after, mark, LENGTH);
 const before = c.distance;
 const PIT_STOP = pitBox(track, aiSeat);
 const sectorWet = sectorWetnessOf(s.control, c.sector);

 if (c.pit === 'stopped') {
  c.pitTime += DT;
  c.speed = 0;
  c.throttle = 0;
  c.brake = 1;
  c.drs = false;
  const totalStop = PIT_STOP_SECONDS + damageRepairSeconds(c.damage);
  if (c.pitTime + 1e-8 >= totalStop) {
   delete c.damage;
   delete c.lastImpact;
   c.compound = c.instruction.tyre;
   const used = (c.compoundsUsed ??= [c.compound]);
   if (!used.includes(c.compound)) used.push(c.compound);
   c.wear = 0;
   c.temperature = 75;
   c.tyreAge = 0;
   c.stops++;
   c.instruction.box = false;
   c.pit = 'exit';
  }
  return;
 }

 const traffic = trafficAhead(c, s.field, 110);
 const wake = traffic && (playerCar.distance <= c.distance || traffic.distance < playerCar.distance) ? traffic : playerCar;
 const air = aero(c, wake);
 const mass = VEHICLE.dryMass + c.fuel;
 const g = grip(c, sectorWet);
 const damage = damageLevel(c.damage);
 c.drs = !neutralised && sectorWet < 0.3 && c.intent.drs && c.pit === 'none' && c.eligible.some((ok, i) => ok && track.inZone(c.distance, DRS_ZONES[i].start, DRS_ZONES[i].end)) && s.time > 20 && Math.abs(pathCurvature(c.distance, track)) < 0.004;

 const boostRequested = !neutralised && c.intent.ers && c.pit === 'none' && c.ers > 2 && c.instruction.ers !== 'harvest';
 const boostPower = boostRequested && c.ersUsed < 4_000_000 ? VEHICLE.ersPower : 0;

 let target = racingSpeed({...c, distance: c.distance + c.speed * 0.18}, wake, track, sectorWet) * paceScale;
 const neutralisedLeader = queue?.get(c);
 target = Math.min(target, restriction);
 if (neutralisedLeader) target = Math.min(target, neutralisedLeader.speed + Math.max(0, neutralisedLeader.distance - before - 9) * 0.8);
 target *= 1 - 0.23 * damage;
 if (c.pit !== 'none') target = Math.min(target, PIT_LIMIT);
 const toEntry = wrap(PIT_ENTRY - c.distance);
 if (c.instruction.box && c.pit === 'none' && toEntry < 260) target = Math.min(target, Math.sqrt(PIT_LIMIT ** 2 + 2 * 28 * toEntry));
 const waiting = c.pit === 'entry' && teammateInBox(s, track, playerEntry(aiSeat), before, PIT_STOP);
 const remaining = wrap(PIT_STOP - before);
 if (c.pit === 'entry') {
  const toBox = Math.max(0, remaining - (waiting ? STACK_GAP : 0));
  if (toBox < 35) target = Math.min(target, Math.sqrt(2 * 7 * toBox));
 }

 const lookahead = clamp(c.speed * 0.25, 7, 24);
 const base = c.pit !== 'none' ? pitRoute(track, c.distance + lookahead, PIT_STOP) : racingLineOffset(c.distance + lookahead);
 const margin = trackHalfWidth(c.distance) - 1.05;
 const desired = c.pit !== 'none' || neutralised ? base : clamp(base + c.intent.offset * 0.45, -margin, margin);
 const steerTarget = steeringTo(track, c.distance, c.offset, c.heading, lookahead, desired);
 c.steering += clamp(steerTarget - c.steering, -1.5 * DT, 1.5 * DT);

 const demandedYaw = (c.speed / VEHICLE.wheelbase) * Math.tan(c.steering);
 const lateralAccel = Math.min(5.5 * 9.81, Math.abs(demandedYaw * c.speed));
 const drive = drivetrain(c.speed, mass, g, boostPower, c.drs, air.slipstream, air.dirtyAir, lateralAccel, damage);
 const brakeMax = brakeCapacity(c.speed, mass, g, Math.min(lateralAccel, (drive.tyreForce / mass) * 0.5), air.dirtyAir, damage);

 const gapToPlayer = playerCar.distance - c.distance;
 if (playerCar.finishTime === null && gapToPlayer > 0 && gapToPlayer < 25 && Math.abs(c.offset - playerCar.offset) < 2.2) {
  target = Math.min(target, Math.sqrt(playerCar.speed ** 2 + 2 * 14 * Math.max(0, gapToPlayer - 6.5)));
 }
 if (traffic && traffic.distance - before < 28) {
  target = Math.min(target, traffic.speed + Math.max(0, traffic.distance - before - 6.5) * 0.9);
 }

 const dv = target - c.speed;
 const reqThr = dv > 0 ? clamp(dv * 0.65, 0, 1) : 0;
 const reqBrk = dv < 0 ? clamp((-dv * 3.5) / Math.max(5, brakeMax), 0, 1) : 0;
 c.throttle += clamp(reqThr - c.throttle, -12 * DT, 5 * DT);
 c.brake += clamp(reqBrk - c.brake, -12 * DT, 12 * DT);
 if (c.brake > 0.05) {
  c.throttle = 0;
  c.drs = false;
 }

 const accel = (drive.maxDrive * c.throttle - drive.drag - drive.rolling) / mass - c.brake * Math.max(0, brakeMax - (drive.drag + drive.rolling) / mass);
 c.acceleration = accel;
 c.speed = Math.max(0, c.speed + accel * DT);
 if (c.pit !== 'none') c.speed = Math.min(PIT_LIMIT, c.speed);

 const tyreLong = mass * accel + drive.drag + drive.rolling;
 const availLat = Math.sqrt(Math.max(0, drive.tyreForce ** 2 - tyreLong ** 2)) / mass;
 const yawLimit = Math.min(5.5 * 9.81, availLat) / Math.max(2, c.speed);
 const actualYaw = clamp(demandedYaw, -yawLimit, yawLimit);
 c.lateralG = (-actualYaw * c.speed) / 9.81;

 const roadCurve = signedCurvatureAt(c.distance);
 const pathScale = Math.max(0.65, 1 - roadCurve * c.offset);
 const progress = (c.speed * Math.cos(c.heading)) / pathScale;
 c.heading = clamp(c.heading + (actualYaw + roadCurve * progress) * DT, -0.6, 0.6);
 c.lateralVelocity = -c.speed * Math.sin(c.heading);
 c.offset += c.lateralVelocity * DT;
 c.distance += Math.max(0, progress) * DT;
 followNeutralisedQueue(c, before, neutralisedLeader);

 const wall = hitBarrier(c, track, before);
 if (wall) applyImpact(c, wall, s.time);

 const thresholds = [26, 36, 46, 56, 66, 76, 86];
 let gear = 1;
 for (const th of thresholds) if (c.speed > th) gear++;
 c.gear = gear;
 c.rpm = clamp((c.speed / (2 * Math.PI * 0.36)) * 60 * GEAR_RATIOS[gear] / 10, 4000, 13000);

 const chargeBefore = c.ers;
 if (boostPower > 0 && c.throttle > 0) {
  const used = boostPower * DT * c.throttle;
  c.ersUsed += used;
  c.ers = clamp(c.ers - (used / VEHICLE.batteryJoules) * 100, 0, 100);
 } else {
  const rec = Math.min(120_000 * c.brake + 6000, Math.max(0, (2_000_000 - c.ersRecovered) / DT)) * DT;
  c.ersRecovered += rec;
  c.ers = clamp(c.ers + (rec / VEHICLE.batteryJoules) * 100, 0, 100);
 }
 c.ersPowerKw = Math.round(((chargeBefore - c.ers) * VEHICLE.batteryJoules) / (100 * 1000 * DT));

 const travelled = c.distance - before;
 c.wear = clamp(c.wear + travelled * TYRES[c.compound].wear * wearScale, 0, 1);
 c.tyreAge += travelled / LENGTH;
 c.fuel = Math.max(0, c.fuel - (FUEL_IDLE_BURN + FUEL_THROTTLE_BURN * c.throttle) * DT);
 if (crossed(before, c.distance, SPEED_TRAP)) c.speedTrap = c.speed * 3.6;
 if (c.instruction.box && c.pit === 'none' && crossed(before, c.distance, PIT_ENTRY)) c.pit = 'entry';
 if (c.pit === 'entry' && !waiting && crossed(before, c.distance, PIT_STOP)) {
  c.distance = Math.floor((c.distance - PIT_STOP) / LENGTH) * LENGTH + PIT_STOP;
  c.pit = 'stopped';
  c.pitTime = 0;
  c.speed = 0;
 }
 if (c.pit === 'exit' && crossed(before, c.distance, PIT_EXIT)) c.pit = 'none';
 for (let i = 0; i < DRS_ZONES.length; i++) {
  if (crossed(before, c.distance, DRS_ZONES[i].detection)) {
   const delta = wake.distance - c.distance;
   c.eligible[i] = delta > 0 && delta / Math.max(wake.speed, 25) <= 1;
  }
 }
 const lap = Math.max(0, Math.floor(c.distance / LENGTH));
 const sec = wrap(c.distance) < SECTORS[1] ? 0 : wrap(c.distance) < SECTORS[2] ? 1 : 2;
 if (sec !== c.sector && c.distance > 0) {
  const split = s.time - c.sectorStart;
  const old = c.bestSectors[c.sector];
  c.splits[c.sector] = split;
  c.splitColours[c.sector] = !old || split <= old ? 'green' : 'yellow';
  c.bestSectors[c.sector] = old ? Math.min(old, split) : split;
  c.sectorStart = s.time;
  c.sector = sec;
 }
 if (lap > c.lap) {
  const time = s.time - c.lapStart;
  c.lastLap = time;
  c.lapTimes.push(time);
  c.bestLap = c.bestLap ? Math.min(time, c.bestLap) : time;
  c.lapStart = s.time;
  c.lap = lap;
  c.ersUsed = 0;
  c.ersRecovered = 0;
  if (lap >= s.laps) c.finishTime = s.time + c.penalty;
 }
}

/** Advance the player-driven F1 session by one 120 Hz physics step (DT = 1/120 s). */
export function stepDriveSession(session: DriveSession, raw: PlayerInputs) {
 const s = session.race;
 const track = getTrack(s.circuit);
 const seat = session.config.seat;
 const aiSeat = other(seat);
 const c = s.cars[seat];
 const ai = s.cars[aiSeat];
 const assists = session.config.assists;
 const tel = session.telemetry;
 const {LENGTH, wrap, SECTORS, DRS_ZONES, PIT_ENTRY, PIT_EXIT, PIT_LIMIT, PIT_STOP_SECONDS, SPEED_TRAP, signedCurvatureAt, trackHalfWidth} = track;
 const crossed = (before: number, after: number, mark: number) => crossedLine(before, after, mark, LENGTH);

 session.alertClock += DT;
 if (session.alert && session.alertClock >= session.alert.until) {
  session.alert = null;
  tel.alert = null;
 }
 tel.drsJustAvailable = false;
 tel.lightsOutJustFired = false;

 if (s.phase === 'lobby' || s.phase === 'finished') {
  c.rpm = 4200 + raw.throttle * 6800;
  tel.revRatio = clamp((c.rpm - 4000) / 9000, 0, 1);
  return;
 }

 s.tick++;

 // === 5 RED LIGHTS F1 START PROCEDURE ===
 if (s.phase === 'lights') {
  session.lightsElapsed += DT;
  const lightsOn = Math.min(5, Math.floor(session.lightsElapsed / 0.85));
  if (lightsOn > session.lastLightCount) {
   session.lastLightCount = lightsOn;
   tel.lightBeepTick++;
  }
  tel.lightCount = lightsOn;

  // Player revs the engine on the grid in the optimal launch window (9,500–11,500 RPM)
  const targetLaunchRpm = 4200 + clamp(raw.throttle, 0, 1) * 8600;
  c.rpm += (targetLaunchRpm - c.rpm) * clamp(10 * DT, 0, 1);
  c.throttle = clamp(raw.throttle, 0, 1);
  c.brake = clamp(raw.brake, 0, 1);
  tel.launchRpm = c.rpm;
  tel.launchOptimal = c.rpm >= 9200 && c.rpm <= 11600;
  tel.revRatio = clamp((c.rpm - 4000) / 9000, 0, 1);
  tel.displayGear = 1;
  c.gear = 1;

  // Jump start check when Launch Assist is OFF and player floors full throttle during late lights without holding brake
  if (!assists.launchAssist && lightsOn >= 2 && raw.throttle > 0.96 && raw.brake < 0.1 && !tel.jumpStart) {
   tel.jumpStart = true;
   c.penalty += 5;
   event(s, 'limits', seat, 'JUMP START · +5s FIA PENALTY');
   pushDriveAlert(session, 'JUMP START · +5s PENALTY', 'red', 3.5);
  }

  const totalLightsTime = 5 * 0.85 + session.startHoldSeconds;
  s.countdown = Math.max(0, totalLightsTime - session.lightsElapsed);
  if (session.lightsElapsed >= totalLightsTime) {
   s.phase = 'racing';
   s.countdown = 0;
   tel.lightCount = 0;
   tel.lightsOutJustFired = true;
   // Optimal launch RPM gives a snappy initial bite off the clutch
   if (tel.launchOptimal && raw.throttle > 0.35) {
    c.speed = 4.5;
    pushDriveAlert(session, 'OPTIMAL LAUNCH!', 'green', 1.8);
   } else {
    pushDriveAlert(session, 'LIGHTS OUT AND AWAY WE GO!', 'green', 2.0);
   }
   event(s, 'start', seat, 'LIGHTS OUT — RACE UNDERWAY');
  }
  return;
 }

 // === RACING PHYSICS (120 HZ) ===
 s.time += DT;
 stepRaceControl(s, track, DT);
 const restriction = speedRestriction(s.control);
 const neutralised = Number.isFinite(restriction);
 const queue = neutralisedQueue(s);
 const wearScale = session.config.session === 'time-trial' ? 0 : tyreWearScale(s.laps);
 const paceScale = DIFFICULTY_PACE[session.config.difficulty];

 // Snapshot ring buffer for Flashback every 30 ticks (0.25s)
 if (s.tick - session.lastSnapshotTick >= 30 && c.finishTime === null) {
  session.lastSnapshotTick = s.tick;
  session.snapshots.push({
   race: structuredClone(s),
   displayGear: session.manualGear,
   lapInvalid: session.lapInvalid,
   lapTrace: [...session.lapTrace],
   mfd: {...session.mfd},
   reverseSpeed: session.reverseSpeed,
  });
  if (session.snapshots.length > 64) session.snapshots.shift();
  tel.flashbackAvailable = session.snapshots.length > 1;
 }

 // Traffic collisions involving player & AI
 const priorPlayer = {...c};
 const priorAi = {...ai};
 const crash = (car: Car, hit: Impact) => {
  const applied = applyImpact(car, hit, s.time);
  if (applied) {
   event(s, 'collision', car.team, `${playerEntry(car.team).code} · ${hit.source} CONTACT · ${Math.round(damageLevel(car.damage) * 100)}% DAMAGE`);
   if (car.team === seat) {
    pushDriveAlert(session, `CONTACT · ${Math.round(damageLevel(car.damage) * 100)}% DAMAGE`, 'red', 2.4);
   }
  }
  return applied;
 };

 if (session.config.session === 'race' && c.finishTime === null && c.pit === 'none') {
  let hit = trafficImpact(priorPlayer, priorAi, track, DT, playerEntry(aiSeat).code);
  let fieldIdx = -1;
  for (let i = 0; i < s.field.length; i++) {
   const contact = trafficImpact(priorPlayer, s.field[i], track, DT, opponents[i].code, ((s.tick - 1) % FIELD_STEP_TICKS) * DT);
   if (contact && (!hit || contact.closing > hit.closing)) {
    hit = contact;
    fieldIdx = i;
   }
  }
  if (hit && crash(c, hit)) {
   if (fieldIdx >= 0 && s.field[fieldIdx].service <= 0) {
    const f = s.field[fieldIdx];
    f.speed = Math.max(0, f.speed + (hit.lateralRate ? -0.06 * hit.closing : -longitudinalImpulse(hit)));
    if (hit.lateralRate) f.impactSideSpeed = (f.impactSideSpeed ?? 0) + hit.side * hit.lateralRate * 0.53;
   }
  }
 }

 // === PLAYER CAR INTEGRATION ===
 if (c.finishTime === null) {
  const before = c.distance;
  const PIT_STOP = pitBox(track, seat);
  const sectorWet = sectorWetnessOf(s.control, c.sector);

  if (c.pit === 'stopped') {
   c.pitTime += DT;
   c.speed = 0;
   c.throttle = 0;
   c.brake = 1;
   c.drs = false;
   tel.wheelspin = 0;
   tel.lockup = 0;
   const repairExtra = damageRepairSeconds(c.damage);
   const totalStop = PIT_STOP_SECONDS + repairExtra;
   if (c.pitTime + 1e-8 >= totalStop) {
    const repaired = !!c.damage;
    delete c.damage;
    delete c.lastImpact;
    c.compound = session.mfd.nextCompound;
    const used = (c.compoundsUsed ??= [c.compound]);
    if (!used.includes(c.compound)) used.push(c.compound);
    c.wear = 0;
    c.temperature = 78;
    c.tyreAge = 0;
    c.stops++;
    session.mfd.boxRequested = false;
    c.instruction.box = false;
    c.pit = 'exit';
    event(s, 'pit', seat, `${totalStop.toFixed(1)}s STOP · ${c.compound.toUpperCase()}${repaired ? ' · REPAIRED' : ''}`);
    pushDriveAlert(session, `${totalStop.toFixed(1)}s PIT STOP · ${c.compound.toUpperCase()} FITTED`, 'green', 2.8);
   }
  } else {
   // Nearest car ahead for slipstream / dirty air / DRS detection
   const traffic = session.config.session === 'race' ? trafficAhead(c, s.field, 110) : undefined;
   const rivalCar: FieldCar = session.config.session === 'race'
    ? (traffic && (priorAi.distance <= c.distance || traffic.distance < priorAi.distance) ? traffic : priorAi)
    : {distance: -9999, offset: 0, speed: 0, finishTime: 0};
   const air = session.config.session === 'race' ? aero(c, rivalCar) : {slipstream: 0, dirtyAir: 0};
   const mass = VEHICLE.dryMass + c.fuel;
   const g = grip(c, sectorWet);
   const damage = damageLevel(c.damage);

   // DRS availability & manual activation
   const inDrsZone = c.pit === 'none' && track.isDrsZone(c.distance);
   const drsEligibleNow = session.config.session === 'time-trial'
    ? true
    : c.lap >= 1 && c.eligible.some((ok, i) => ok && track.inZone(c.distance, DRS_ZONES[i].start, DRS_ZONES[i].end));
   const drsAvailable = !neutralised && sectorWet < 0.3 && inDrsZone && drsEligibleNow && c.brake < 0.08 && Math.abs(c.steering) < 0.14;
   if (drsAvailable && !session.drsWasAvailable) {
    tel.drsJustAvailable = true;
   }
   session.drsWasAvailable = drsAvailable;
   if (raw.drsToggle) {
    if (drsAvailable) {
     session.drsArmed = !session.drsArmed;
     if (session.drsArmed) pushDriveAlert(session, 'DRS OPEN', 'green', 1.2);
    } else if (inDrsZone && !drsEligibleNow && session.config.session === 'race') {
     pushDriveAlert(session, 'DRS NOT ELIGIBLE (>1.0s AT DETECTION)', 'amber', 1.5);
    }
   }
   if (!drsAvailable || raw.brake > 0.08) session.drsArmed = false;
   c.drs = session.drsArmed;
   tel.drsZone = inDrsZone;
   tel.drsAvailable = drsAvailable;

   // Gearbox (Auto or Manual with paddle override + Reverse)
   session.shiftCooldown = Math.max(0, session.shiftCooldown - DT);
   const canReverse = c.pit === 'none' && c.speed < 0.8 && session.reverseSpeed < 16;

   if (assists.gearbox === 'manual') {
    if (raw.shiftUp && session.shiftCooldown <= 0) {
     if (session.manualGear < 8) {
      session.manualGear = session.manualGear === -1 ? 1 : session.manualGear + 1;
      session.shiftCooldown = 0.08;
     }
    }
    if (raw.shiftDown && session.shiftCooldown <= 0) {
     if (session.manualGear > 1) {
      // Downshift protection: avoid over-revving > 13,500 RPM
      const nextGear = session.manualGear - 1;
      const projectedRpm = (c.speed / (2 * Math.PI * 0.36)) * 60 * GEAR_RATIOS[nextGear] / 10;
      if (projectedRpm < 13_400) {
       session.manualGear = nextGear;
       session.shiftCooldown = 0.08;
      }
     } else if (session.manualGear === 1 && c.speed < 1.2) {
      session.manualGear = -1;
      session.shiftCooldown = 0.12;
     }
    }
   } else {
    // Auto gearbox with paddle override + reverse when holding brake at standstill
    if (raw.shiftUp && session.manualGear < 8 && session.shiftCooldown <= 0) {
     session.manualGear = Math.max(1, session.manualGear + 1);
     session.shiftCooldown = 0.25;
    } else if (raw.shiftDown && session.manualGear > 1 && session.shiftCooldown <= 0) {
     session.manualGear = session.manualGear - 1;
     session.shiftCooldown = 0.25;
    } else if (session.manualGear === -1) {
     if (raw.throttle > 0.15) {
      session.manualGear = 1;
      session.reverseSpeed = 0;
     }
    } else if (canReverse && raw.brake > 0.5 && raw.throttle < 0.05) {
     session.reverseHold += DT;
     if (session.reverseHold >= 0.35) session.manualGear = -1;
    } else {
     session.reverseHold = 0;
     let gAuto = clamp(session.manualGear, 1, 8);
     while (gAuto < 8 && c.speed > AUTO_UP_SPEED[gAuto]) gAuto++;
     while (gAuto > 1 && c.speed < AUTO_DOWN_SPEED[gAuto]) gAuto--;
     session.manualGear = gAuto;
    }
   }

   // Reverse driving to recover cleanly if stuck against a barrier
   if (session.manualGear === -1) {
    const revInput = assists.gearbox === 'auto' ? raw.brake : raw.throttle;
    const stopInput = assists.gearbox === 'auto' ? raw.throttle : raw.brake;
    c.throttle = revInput;
    c.brake = stopInput;
    session.reverseSpeed = clamp(session.reverseSpeed + (revInput * 8 - stopInput * 16 - 2) * DT, 0, 14);
    c.speed = session.reverseSpeed;
    const revSteer = raw.steer * 0.36;
    c.steering += clamp(revSteer - c.steering, -2.5 * DT, 2.5 * DT);
    const revYaw = -(session.reverseSpeed / VEHICLE.wheelbase) * Math.tan(c.steering);
    const roadCurve = signedCurvatureAt(c.distance);
    const pathScale = Math.max(0.65, 1 - roadCurve * c.offset);
    const progress = (-session.reverseSpeed * Math.cos(c.heading)) / pathScale;
    c.heading = clamp(c.heading + (revYaw + roadCurve * progress) * DT, -0.75, 0.75);
    c.lateralVelocity = session.reverseSpeed * Math.sin(c.heading);
    c.offset += c.lateralVelocity * DT;
    c.distance = Math.max(-180, c.distance + progress * DT);
    c.gear = 1;
    c.rpm = clamp(4200 + session.reverseSpeed * 380, 4200, 10500);
    tel.displayGear = -1;
    tel.wheelspin = 0;
    tel.lockup = 0;
    tel.revRatio = clamp((c.rpm - 4000) / 9000, 0, 1);
    tel.shiftFlash = false;
    tel.onRevLimiter = false;
    const wall = hitBarrier(c, track, before);
    if (wall) {
     session.reverseSpeed *= 0.2;
     c.speed = session.reverseSpeed;
    }
   } else {
    session.reverseSpeed = 0;
    const activeGear = clamp(session.manualGear, 1, 8);
    c.gear = activeGear;
    tel.displayGear = activeGear;

    // Pedals (crisp F1 response)
    const reqThr = clamp(raw.throttle, 0, 1);
    const reqBrk = clamp(raw.brake, 0, 1);
    c.throttle += clamp(reqThr - c.throttle, -16 * DT, 11 * DT);
    c.brake += clamp(reqBrk - c.brake, -18 * DT, 18 * DT);
    if (c.brake > 0.12) c.drs = false;

    // Steering: Pit Assist steers automatically inside pit lane; otherwise player has direct crisp control!
    if (c.pit !== 'none' && assists.pitAssist) {
     const lookahead = clamp(c.speed * 0.25, 6, 18);
     const desiredPit = pitRoute(track, c.distance + lookahead, PIT_STOP);
     const pitSteer = steeringTo(track, c.distance, c.offset, c.heading, lookahead, desiredPit);
     c.steering += clamp(pitSteer - c.steering, -2.0 * DT, 2.0 * DT);
    } else {
     const maxLock = speedSensitiveMaxSteer(c.speed, Boolean(raw.analogSteer));
     const steerInput = raw.analogSteer
      ? Math.sign(raw.steer) * Math.pow(Math.abs(raw.steer), 1.35)
      : raw.steer;
     const steerTarget = clamp(steerInput * maxLock, -maxLock, maxLock);
     const returning = steerTarget === 0 || Math.sign(steerTarget) !== Math.sign(c.steering);
     const baseRate = raw.analogSteer ? 4.4 : 3.2;
     const speedRate = baseRate * clamp(maxLock / 0.34, 0.35, 1.0) * (returning ? 2.1 : 1.0);
     c.steering += clamp(steerTarget - c.steering, -speedRate * DT, speedRate * DT);
    }

    // ERS Deployment & Harvest
    const desiredKw = c.pit !== 'none' ? 0 : ersTargetPowerKw(session.mfd.ersMode, raw.ersOvertake, c.speed, c.throttle);
    const lapCapLeft = session.config.session === 'time-trial' ? 4_000_000 : Math.max(0, 4_000_000 - c.ersUsed);
    const boostAvailJ = desiredKw > 0 && c.ers > 1
     ? Math.min(desiredKw * 1000 * DT, ((c.ers - 1) * VEHICLE.batteryJoules) / 100, lapCapLeft)
     : 0;
    const boostPower = boostAvailJ > 1 ? boostAvailJ / DT : 0;
    const harvestDragW = boostPower === 0 && session.mfd.ersMode === 'none' && c.speed > 65 ? -18_000 : 0;

    // Aerodynamic & tyre grip forces
    const demandedYaw = (c.speed / VEHICLE.wheelbase) * Math.tan(c.steering);
    const lateralAccel = Math.min(5.5 * 9.81, Math.abs(demandedYaw * c.speed));
    const drive = drivetrain(c.speed, mass, g, boostPower + harvestDragW, c.drs, air.slipstream, air.dirtyAir, lateralAccel, damage);
    const f = forces(c.speed, mass, g, c.drs, air.slipstream, air.dirtyAir, damage);

    // Gear RPM & torque curve
    const rawRpm = (c.speed / (2 * Math.PI * VEHICLE.tyreRadius)) * 60 * GEAR_RATIOS[activeGear] / 10;
    const rpm = clamp(Math.max(rawRpm, 4200 + c.throttle * 1800), 4000, 13_050);
    const torqueMul = assists.gearbox === 'manual' ? engineTorqueFactor(rpm, activeGear) : 1.0;
    const gearCapPenalty = c.speed > GEAR_MAX_SPEED[activeGear] ? Math.max(0, 1 - (c.speed - GEAR_MAX_SPEED[activeGear]) * 0.18) : 1;

    // Traction Control & Wheelspin
    const powerForce = ((VEHICLE.enginePower * torqueMul * gearCapPenalty) + boostPower) / Math.max(10, c.speed);
    const rearLimit = drive.maxDrive;
    let wheelspin = 0;
    let effectiveDrive = Math.min(powerForce, rearLimit) * c.throttle;
    if (c.pit === 'none' && c.throttle > 0.45 && c.speed < 54 && powerForce * c.throttle > rearLimit * 0.92) {
     const excess = clamp((powerForce * c.throttle) / Math.max(1, rearLimit) - 0.92, 0, 1.2);
     const steerFactor = 1 + Math.abs(c.steering) * 3.5 + sectorWet * 1.4;
     if (assists.tractionControl === 'full') {
      wheelspin = 0;
     } else if (assists.tractionControl === 'medium') {
      wheelspin = clamp((excess * steerFactor - 0.25) * 0.55, 0, 0.55);
      effectiveDrive *= 1 - wheelspin * 0.14;
     } else {
      // TC OFF: genuine wheelspin & rear step-out!
      wheelspin = clamp(excess * steerFactor * 0.85, 0, 1);
      effectiveDrive *= 1 - wheelspin * 0.28;
     }
    }
    tel.wheelspin = wheelspin;

    // Brake capacity, Brake Bias, and ABS / Front Lockup
    const biasOffset = (session.mfd.brakeBias - 56) / 6; // -1 (rearward) .. +1 (frontward)
    const brakeMax = brakeCapacity(c.speed, mass, g, Math.min(lateralAccel, (f.tyreForce / mass) * 0.5), air.dirtyAir, damage);
    let lockup = 0;
    if (!assists.abs && c.pit === 'none' && c.brake > 0.78 && c.speed > 26) {
     const threshold = clamp(0.88 - biasOffset * 0.08 - sectorWet * 0.16 - c.wear * 0.12, 0.58, 0.94);
     if (c.brake > threshold) {
      lockup = clamp((c.brake - threshold) / (1 - threshold + 0.08), 0, 1);
     }
    }
    c.lockup = lockup;
    tel.lockup = lockup;
    const effectiveBrakeMax = brakeMax * (1 - lockup * 0.18);

    // Off-track drag (grass/gravel slows you noticeably, just like real F1!)
    const halfW = trackHalfWidth(c.distance);
    const offTrack = c.pit === 'none' && Math.abs(c.offset) > halfW + 0.85;
    tel.offTrack = offTrack;
    const offTrackDrag = offTrack ? (6.5 + c.speed * 0.14) : 0;

    // Out of fuel limp
    const outOfFuel = session.config.session === 'race' && c.fuel <= 0.01;
    const netDriveForce = outOfFuel ? effectiveDrive * 0.18 : effectiveDrive;
    const aeroDragDecel = (drive.drag + drive.rolling) / mass;
    let accel = (netDriveForce - drive.drag - drive.rolling) / mass - c.brake * Math.max(0, effectiveBrakeMax - aeroDragDecel) - offTrackDrag;

    // Pit limiter & pit stop braking assist
    const waiting = c.pit === 'entry' && teammateInBox(s, track, playerEntry(seat), before, PIT_STOP);
    if (c.pit === 'entry' && assists.pitAssist) {
     const remaining = wrap(PIT_STOP - before);
     const toBox = Math.max(0, remaining - (waiting ? STACK_GAP : 0));
     const pitTarget = toBox < 38 ? Math.sqrt(2 * 8 * toBox) : PIT_LIMIT;
     if (c.speed > pitTarget) accel = Math.min(accel, clamp((pitTarget - c.speed) * 4, -18, 0));
     else if (c.speed < pitTarget - 0.5) accel = Math.max(accel, clamp((pitTarget - c.speed) * 3, 0, 8));
    }

    c.acceleration = accel;
    c.speed = Math.max(0, c.speed + accel * DT);
    if (c.pit !== 'none') c.speed = Math.min(PIT_LIMIT, c.speed);

    // Friction-ellipse yaw & oversteer/understeer dynamics
    const tyreLong = mass * accel + drive.drag + drive.rolling;
    const availLat = Math.sqrt(Math.max(0, drive.tyreForce ** 2 - tyreLong ** 2)) / mass;
    // Front lockup induces understeer; rear brake bias aids turn-in rotation slightly
    const lockUndersteer = 1 - lockup * 0.28;
    const biasTurnIn = 1 - biasOffset * 0.05 * c.brake;
    const offTrackGrip = offTrack ? 0.68 : 1;
    const yawLimit = (Math.min(5.5 * 9.81, availLat * lockUndersteer * biasTurnIn * offTrackGrip)) / Math.max(2, c.speed);
    // Oversteer kick from TC-off wheelspin when cornering
    const oversteerYaw = wheelspin > 0.18 && Math.abs(c.steering) > 0.015
     ? Math.sign(c.steering) * wheelspin * 0.42
     : 0;
    let actualYaw = clamp(demandedYaw + oversteerYaw, -yawLimit, yawLimit);

    // Subtle straight-line stability damping when driver isn't steering (prevents annoying keyboard drift)
    if (c.pit === 'none' && Math.abs(raw.steer) < 0.02 && wheelspin < 0.1 && c.speed > 18) {
     actualYaw += clamp(-c.heading * 1.4, -0.35, 0.35);
    }

    c.lateralG = (-actualYaw * c.speed) / 9.81;

    const roadCurve = signedCurvatureAt(c.distance);
    const pathScale = Math.max(0.65, 1 - roadCurve * c.offset);
    const progress = (c.speed * Math.cos(c.heading)) / pathScale;
    c.heading = clamp(c.heading + (actualYaw + roadCurve * progress) * DT, -0.72, 0.72);
    c.lateralVelocity = -c.speed * Math.sin(c.heading);
    c.offset += c.lateralVelocity * DT;
    c.distance += Math.max(0, progress) * DT;

    // Prevent ghosting through cars ahead on the exact same line
    if (session.config.session === 'race' && c.pit === 'none') {
     for (const otherCar of [ai, ...s.field]) {
      if (otherCar.finishTime !== null || otherCar.pit !== 'none') continue;
      const aheadGap = otherCar.distance - before;
      if (aheadGap >= 5.2 && c.distance > otherCar.distance - 5.2 && Math.abs(c.offset - otherCar.offset) < 1.75) {
       c.distance = otherCar.distance - 5.2;
       c.speed = Math.min(c.speed, otherCar.speed);
      }
     }
    }

    const preBarrierOffset = c.offset;
    // Barrier collision (also invalidates Time Trial laps just like EA F1)
    const wall = hitBarrier(c, track, before);
    if (wall) {
     crash(c, wall);
     if (session.config.session === 'time-trial' && !session.lapInvalid) {
      session.lapInvalid = true;
      tel.lapInvalid = true;
      pushDriveAlert(session, 'LAP INVALIDATED · WALL CONTACT', 'red', 2.6);
     }
    }

    // RPM display (includes wheelspin spike!)
    c.rpm = clamp(rpm + wheelspin * 1400, 4000, 13_050);
    tel.revRatio = clamp((c.rpm - 4000) / 9000, 0, 1);
    tel.shiftFlash = c.rpm >= 11_750 && activeGear < 8;
    tel.onRevLimiter = c.rpm >= 12_900;

    // ERS battery accounting
    const chargeBefore = c.ers;
    if (boostPower > 0 && c.throttle > 0.1) {
     const used = boostPower * DT * c.throttle;
     c.ersUsed += used;
     c.ersDeployed = (c.ersDeployed ?? 0) + used;
     c.ers = clamp(c.ers - (used / VEHICLE.batteryJoules) * 100, 0, 100);
    } else {
     const harvestBase = session.mfd.ersMode === 'none' ? 24_000 : session.mfd.ersMode === 'medium' ? 7_500 : 4_000;
     const capLeft = session.config.session === 'time-trial' ? 2_000_000 : Math.max(0, 2_000_000 - c.ersRecovered);
     const rec = Math.min(120_000 * c.brake + harvestBase, capLeft / DT) * DT;
     c.ersRecovered += rec;
     c.ers = clamp(c.ers + (rec / VEHICLE.batteryJoules) * 100, 0, 100);
    }
    c.ersPowerKw = Math.round(((chargeBefore - c.ers) * VEHICLE.batteryJoules) / (100 * 1000 * DT));
    tel.ersLapBudgetPct = session.config.session === 'time-trial' ? 100 : clamp(Math.round((1 - c.ersUsed / 4_000_000) * 100), 0, 100);

    // Tyre wear, temperature, fuel
    const travelled = Math.max(0, c.distance - before);
    const lockWear = lockup * 0.0014 * DT * wearScale;
    const spinWear = wheelspin * 0.0009 * DT * wearScale;
    c.wear = clamp(c.wear + travelled * TYRES[c.compound].wear * wearScale + lockWear + spinWear + (offTrack ? 0.0015 * DT * wearScale : 0), 0, 1);
    c.tyreAge += travelled / LENGTH;
    const baseTemp = c.speed < 45 ? track.temperature + 30 : (track.night ? 82 : 88);
    c.temperature += (baseTemp + c.throttle * 8 + c.brake * 13 + Math.abs(c.lateralG) * 2.4 + wheelspin * 12 + lockup * 15 - c.temperature) * DT * 0.09;
    if (session.config.session === 'race') {
     c.fuel = Math.max(0, c.fuel - (FUEL_IDLE_BURN + FUEL_THROTTLE_BURN * c.throttle) * DT);
    }
    const avgFuelPerLap = (LENGTH / 65) * (FUEL_IDLE_BURN + FUEL_THROTTLE_BURN * 0.78);
    tel.fuelLapsRemaining = c.fuel / Math.max(0.5, avgFuelPerLap);

    // Speed trap
    if (crossed(before, c.distance, SPEED_TRAP)) c.speedTrap = c.speed * 3.6;

    // Pit entry / stop / exit
    if (session.config.session === 'race') {
     const manualPitEntry = !assists.pitAssist && c.pit === 'none' && c.offset < -halfW - 1.5 && crossed(before, c.distance, PIT_ENTRY);
     if ((session.mfd.boxRequested || manualPitEntry) && c.pit === 'none' && crossed(before, c.distance, PIT_ENTRY)) {
      c.pit = 'entry';
      event(s, 'pit', seat, 'BOX BOX · PIT LIMITER ON');
      pushDriveAlert(session, 'PIT LIMITER ENGAGED · 80 KM/H', 'amber', 2.4);
     }
     if (c.pit === 'entry' && !waiting && crossed(before, c.distance, PIT_STOP)) {
      c.distance = Math.floor((c.distance - PIT_STOP) / LENGTH) * LENGTH + PIT_STOP;
      c.pit = 'stopped';
      c.pitTime = 0;
      c.speed = 0;
     }
     if (c.pit === 'exit' && crossed(before, c.distance, PIT_EXIT)) {
      c.pit = 'none';
      event(s, 'pit', seat, 'PIT EXIT CLEAR');
      pushDriveAlert(session, 'PIT EXIT CLEAR · PUSH NOW', 'green', 2.0);
     }
    }

    // Track limits warnings & Time Trial lap invalidation
    if (c.pit === 'none' && Math.max(Math.abs(c.offset), Math.abs(preBarrierOffset)) > halfW + 1.05 && s.time - c.lastLimit > 4.5) {
     c.lastLimit = s.time;
     if (session.config.session === 'time-trial') {
      if (!session.lapInvalid) {
       session.lapInvalid = true;
       tel.lapInvalid = true;
       pushDriveAlert(session, 'LAP INVALIDATED · TRACK LIMITS', 'red', 2.6);
      }
     } else {
      c.warnings++;
      const pen = c.warnings % 3 === 0;
      if (pen) c.penalty += 5;
      event(s, 'limits', seat, `TRACK LIMITS · WARNING ${c.warnings}${pen ? ' / +5s' : ''}`);
      pushDriveAlert(session, pen ? 'TRACK LIMITS · +5s PENALTY' : `TRACK LIMITS WARNING (${c.warnings % 3}/3)`, pen ? 'red' : 'amber', 2.4);
     }
    }

    // DRS detection points (in Race mode)
    if (session.config.session === 'race') {
     for (let i = 0; i < DRS_ZONES.length; i++) {
      if (crossed(before, c.distance, DRS_ZONES[i].detection)) {
       const candidates: FieldCar[] = [priorAi, ...s.field].filter(o => o.finishTime === null && (!o.pit || o.pit === 'none') && o.distance > c.distance);
       const ahead = candidates.sort((a, b) => a.distance - b.distance)[0];
       const gapS = ahead ? (ahead.distance - c.distance) / Math.max(ahead.speed, 25) : Infinity;
       c.eligible[i] = gapS <= 1.0;
      }
     }
    }

    // Record live lap trace & compute real-time Delta vs PB
    if (c.distance > 0) {
     const dWrap = wrap(c.distance);
     const bucket = Math.floor(dWrap / TRACE_STEP_M);
     const lapElapsed = s.time - c.lapStart;
     if (bucket >= 0 && bucket < session.lapTrace.length && Number.isNaN(session.lapTrace[bucket])) {
      session.lapTrace[bucket] = lapElapsed;
     }
     if (session.bestLapTrace) {
      const fIdx = dWrap / TRACE_STEP_M;
      const i0 = Math.floor(fIdx);
      const i1 = Math.min(session.bestLapTrace.length - 1, i0 + 1);
      const t0 = session.bestLapTrace[i0];
      const t1 = session.bestLapTrace[i1];
      if (!Number.isNaN(t0) && !Number.isNaN(t1)) {
       const refT = t0 + (t1 - t0) * (fIdx - i0);
       tel.deltaSeconds = lapElapsed - refT;
      }
     } else {
      tel.deltaSeconds = null;
     }
    }

    // Sector splits & Lap crossing
    const lap = Math.max(0, Math.floor(c.distance / LENGTH));
    const sec = wrap(c.distance) < SECTORS[1] ? 0 : wrap(c.distance) < SECTORS[2] ? 1 : 2;
    if (sec !== c.sector && c.distance > 0) {
     const split = s.time - c.sectorStart;
     const old = c.bestSectors[c.sector];
     const rivalBest = ai.bestSectors[c.sector];
     c.splits[c.sector] = split;
     c.splitColours[c.sector] = (!old || split < old) && (!rivalBest || split < rivalBest) ? 'purple' : !old || split <= old ? 'green' : 'yellow';
     c.bestSectors[c.sector] = old ? Math.min(old, split) : split;
     c.sectorStart = s.time;
     c.sector = sec;
    }

    if (lap > c.lap) {
     const lapTime = s.time - c.lapStart;
     c.lastLap = lapTime;
     c.lapTimes.push(lapTime);
     const validForPb = !session.lapInvalid || session.config.session === 'race';
     if (validForPb && (!c.bestLap || lapTime < c.bestLap)) {
      c.bestLap = lapTime;
      session.bestValidLap = lapTime;
      // Fill any gaps in lapTrace linearly before saving as bestLapTrace
      const filled = [...session.lapTrace];
      let lastKnown = 0;
      for (let i = 0; i < filled.length; i++) {
       if (Number.isNaN(filled[i])) filled[i] = lastKnown;
       else lastKnown = filled[i];
      }
      session.bestLapTrace = filled;
      pushDriveAlert(session, `PERSONAL BEST · ${formatLap(lapTime)}`, 'purple', 3.0);
     } else if (session.lapInvalid) {
      pushDriveAlert(session, `LAP ${lap} INVALIDATED · ${formatLap(lapTime)}`, 'amber', 2.4);
     } else {
      pushDriveAlert(session, `LAP ${lap} · ${formatLap(lapTime)}`, 'info', 2.2);
     }
     c.lapStart = s.time;
     c.lap = lap;
     c.ersUsed = 0;
     c.ersRecovered = 0;
     session.lapInvalid = false;
     tel.lapInvalid = false;
     session.lapTrace.fill(NaN);
     if (!s.fastest || (validForPb && lapTime < s.fastest.time)) s.fastest = {team: seat, time: lapTime};
     event(s, 'lap', seat, `LAP ${lap} · ${formatLap(lapTime)}`);

     if (session.config.session === 'race') {
      if (lap === s.laps - 1) {
       pushDriveAlert(session, 'FINAL LAP!', 'amber', 2.8);
      }
      if (lap >= s.laps) {
       if (!dryCompoundRuleSatisfied(s, c) && !c.compoundPenaltyApplied && s.laps >= 5) {
        c.penalty += 30;
        c.compoundPenaltyApplied = true;
       }
       if (s.laps >= 10 && c.fuel < FIA_MIN_FUEL_KG && !c.fuelPenaltyApplied) {
        c.penalty += 30;
        c.fuelPenaltyApplied = true;
       }
       c.finishTime = s.time + c.penalty;
       s.phase = 'finished';
       s.winner = playerEntry(seat).code;
       event(s, 'finish', seat, `${playerEntry(seat).name.toUpperCase()} FINISHES`);
      }
     }
    }
   }
  }
 }

 // === AI RIVAL & 18-CAR FIELD (RACE MODE ONLY) ===
 if (session.config.session === 'race') {
  stepAiCar(s, aiSeat, priorPlayer, track, paceScale, restriction, neutralised, queue, wearScale);
  if (s.tick % FIELD_STEP_TICKS === 0 && s.field.length) {
   advanceField(s, track, FIELD_STEP_TICKS * DT * paceScale, queue);
  }
  s.leader = s.cars.a.distance >= s.cars.b.distance ? 'a' : 'b';
 }
}

export function formatLap(seconds: number): string {
 if (!seconds || !Number.isFinite(seconds)) return '—:—.———';
 const mins = Math.floor(seconds / 60);
 const rem = seconds - mins * 60;
 return `${mins}:${rem.toFixed(3).padStart(6, '0')}`;
}
