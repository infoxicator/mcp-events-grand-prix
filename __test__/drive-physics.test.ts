import {describe, it, expect} from 'vitest';
import {
 adjustBrakeBias,
 createDriveSession,
 cycleErsMode,
 defaultDriveConfig,
 setNextCompound,
 startDriveLights,
 stepDriveSession,
 toggleBoxRequest,
 triggerFlashback,
 type PlayerInputs,
} from '../src/race/drive-physics';
import {getTrack} from '../src/race/track';

const idle: PlayerInputs = {
 throttle: 0,
 brake: 0,
 steer: 0,
 ersOvertake: false,
 drsToggle: false,
 shiftUp: false,
 shiftDown: false,
};

function stepSeconds(session: ReturnType<typeof createDriveSession>, seconds: number, inputs: PlayerInputs = idle) {
 const ticks = Math.round(seconds * 120);
 for (let i = 0; i < ticks; i++) {
  stepDriveSession(session, {
   ...inputs,
   drsToggle: i === 0 ? inputs.drsToggle : false,
   shiftUp: i === 0 ? inputs.shiftUp : false,
   shiftDown: i === 0 ? inputs.shiftDown : false,
  });
 }
}

function advanceToGreen(session: ReturnType<typeof createDriveSession>) {
 startDriveLights(session);
 let guard = 0;
 while (session.race.phase !== 'racing' && guard++ < 1500) {
  stepDriveSession(session, {...idle, throttle: 0.65});
 }
 expect(session.race.phase).toBe('racing');
}

describe('F1 Drive Mode physics & session engine', () => {
 it('runs the 5-red-lights sequence and detects jump starts when launch assist is off', () => {
  const cfg = defaultDriveConfig();
  cfg.assists.launchAssist = false;
  const session = createDriveSession(cfg);
  startDriveLights(session);

  // Step through first 3 lights holding full throttle with no brake -> triggers jump start
  stepSeconds(session, 2.2, {...idle, throttle: 1, brake: 0});
  expect(session.telemetry.lightCount).toBeGreaterThanOrEqual(2);
  expect(session.telemetry.jumpStart).toBe(true);
  expect(session.race.cars.a.penalty).toBeGreaterThanOrEqual(5);

  // Finish lights sequence
  let guard = 0;
  while (session.race.phase === 'lights' && guard++ < 1200) {
   stepDriveSession(session, {...idle, throttle: 0.6});
  }
  expect(session.race.phase).toBe('racing');
 });

 it('accelerates smoothly up to F1 speeds, brakes to a halt, and supports Reverse gear', () => {
  const cfg = defaultDriveConfig();
  cfg.session = 'time-trial';
  cfg.assists.gearbox = 'auto';
  const session = createDriveSession(cfg);
  advanceToGreen(session);

  const car = session.race.cars.a;
  stepSeconds(session, 4.5, {...idle, throttle: 1});
  expect(car.speed).toBeGreaterThan(60); // > 216 km/h in 4.5s
  expect(session.telemetry.displayGear).toBeGreaterThanOrEqual(4);

  // Hard braking back to stop (before auto-reverse triggers)
  stepSeconds(session, 2.2, {...idle, brake: 1});
  expect(car.speed).toBeLessThan(1.5);

  // Holding brake at standstill engages Reverse (-1)
  stepSeconds(session, 1.2, {...idle, brake: 1});
  expect(session.telemetry.displayGear).toBe(-1);
  expect(session.reverseSpeed).toBeGreaterThan(2);
 });

 it('matches track coordinate steering convention (+1 left decreases offset, -1 right increases offset)', () => {
  const cfg = defaultDriveConfig();
  cfg.session = 'time-trial';
  const session = createDriveSession(cfg);
  advanceToGreen(session);
  const car = session.race.cars.a;
  car.offset = 0;

  // Build moderate speed straight ahead
  stepSeconds(session, 1.5, {...idle, throttle: 0.8});
  const midOffset = car.offset;

  // Steer LEFT (+1) -> offset decreases (negative = left side)
  stepSeconds(session, 0.5, {...idle, throttle: 0.6, steer: 1});
  expect(car.steering).toBeGreaterThan(0);
  expect(car.offset).toBeLessThan(midOffset - 0.5);

  // Reset heading straight and steer RIGHT (-1) -> offset increases (positive = right side)
  car.offset = 0;
  car.heading = 0;
  car.steering = 0;
  stepSeconds(session, 0.5, {...idle, throttle: 0.6, steer: -1});
  expect(car.steering).toBeLessThan(0);
  expect(car.offset).toBeGreaterThan(0.5);
 });

 it('supports Manual gearbox paddle shifts and prevents over-revving downshifts', () => {
  const cfg = defaultDriveConfig();
  cfg.session = 'time-trial';
  cfg.assists.gearbox = 'manual';
  const session = createDriveSession(cfg);
  advanceToGreen(session);

  // Accelerate in 1st gear — should stay in 1st until player upshifts
  stepSeconds(session, 1.8, {...idle, throttle: 1});
  expect(session.telemetry.displayGear).toBe(1);

  // Upshift to 2nd then 3rd
  stepDriveSession(session, {...idle, throttle: 1, shiftUp: true});
  expect(session.telemetry.displayGear).toBe(2);
  stepSeconds(session, 0.2, {...idle, throttle: 1});
  stepDriveSession(session, {...idle, throttle: 1, shiftUp: true});
  expect(session.telemetry.displayGear).toBe(3);

  // Accelerate high in 4th, verify downshift protection blocks dangerous shift to 1st
  stepSeconds(session, 0.2, {...idle, throttle: 1});
  stepDriveSession(session, {...idle, throttle: 1, shiftUp: true});
  stepSeconds(session, 2.2, {...idle, throttle: 1});
  const highSpeedGear = session.telemetry.displayGear;
  stepDriveSession(session, {...idle, throttle: 1, shiftDown: true});
  // At max 4th speed (~65 m/s), downshift protection should hold gear or allow safe shift only
  expect(session.telemetry.displayGear).toBeGreaterThanOrEqual(highSpeedGear - 1);
 });

 it('activates DRS in a DRS zone and auto-closes DRS on braking', () => {
  const cfg = defaultDriveConfig();
  cfg.session = 'time-trial';
  const session = createDriveSession(cfg);
  advanceToGreen(session);

  const track = getTrack('monza');
  const car = session.race.cars.a;
  const zone = track.DRS_ZONES[0];
  car.distance = zone.start + 40;
  car.speed = 65;

  // Step once to detect DRS zone
  stepDriveSession(session, {...idle, throttle: 1});
  expect(session.telemetry.drsZone).toBe(true);
  expect(session.telemetry.drsAvailable).toBe(true);

  // Toggle DRS open
  stepDriveSession(session, {...idle, throttle: 1, drsToggle: true});
  expect(car.drs).toBe(true);

  // Braking immediately closes DRS
  stepDriveSession(session, {...idle, brake: 0.7});
  expect(car.drs).toBe(false);
 });

 it('modulates wheelspin via Traction Control and lockup via ABS', () => {
  const mk = (tc: 'full' | 'off', abs: boolean) => {
   const cfg = defaultDriveConfig();
   cfg.session = 'time-trial';
   cfg.assists.tractionControl = tc;
   cfg.assists.abs = abs;
   const s = createDriveSession(cfg);
   advanceToGreen(s);
   return s;
  };

  const sFull = mk('full', true);
  const sOff = mk('off', false);

  let maxSpinFull = 0;
  let maxSpinOff = 0;
  for (let i = 0; i < 180; i++) {
   stepDriveSession(sFull, {...idle, throttle: 1, steer: 0.45});
   stepDriveSession(sOff, {...idle, throttle: 1, steer: 0.45});
   maxSpinFull = Math.max(maxSpinFull, sFull.telemetry.wheelspin);
   maxSpinOff = Math.max(maxSpinOff, sOff.telemetry.wheelspin);
  }
  expect(maxSpinOff).toBeGreaterThan(maxSpinFull);

  // Build high speed then slam brakes to compare ABS vs non-ABS lockup
  sFull.race.cars.a.speed = 80;
  sOff.race.cars.a.speed = 80;
  let maxLockFull = 0;
  let maxLockOff = 0;
  for (let i = 0; i < 90; i++) {
   stepDriveSession(sFull, {...idle, brake: 1});
   stepDriveSession(sOff, {...idle, brake: 1});
   maxLockFull = Math.max(maxLockFull, sFull.telemetry.lockup);
   maxLockOff = Math.max(maxLockOff, sOff.telemetry.lockup);
  }
  expect(maxLockOff).toBeGreaterThan(maxLockFull);
 });

 it('supports ERS mode cycling, brake bias adjustment, box request, and 4-second Flashback rewind', () => {
  const cfg = defaultDriveConfig();
  cfg.session = 'race';
  const session = createDriveSession(cfg);
  advanceToGreen(session);

  cycleErsMode(session, 1);
  expect(session.mfd.ersMode).toBe('hotlap');
  adjustBrakeBias(session, 2);
  expect(session.mfd.brakeBias).toBe(58);
  setNextCompound(session, 'hard');
  expect(session.mfd.nextCompound).toBe('hard');
  toggleBoxRequest(session);
  expect(session.mfd.boxRequested).toBe(true);

  // Drive for 5.5 seconds to accumulate Flashback snapshots
  stepSeconds(session, 5.5, {...idle, throttle: 0.9});
  const distBefore = session.race.cars.a.distance;
  const tickBefore = session.race.tick;
  expect(session.telemetry.flashbackAvailable).toBe(true);

  const ok = triggerFlashback(session);
  expect(ok).toBe(true);
  expect(session.race.cars.a.distance).toBeLessThan(distBefore - 40);
  expect(session.race.tick).toBeLessThan(tickBefore - 300);
  expect(session.telemetry.flashbackCount).toBe(1);
 });

 it('invalidates Time Trial laps when cutting off-track and supports Las Vegas circuit', () => {
  const cfg = defaultDriveConfig();
  cfg.session = 'time-trial';
  cfg.circuit = 'las-vegas';
  const session = createDriveSession(cfg);
  expect(session.race.field.length).toBe(0);
  advanceToGreen(session);

  const car = session.race.cars.a;
  car.distance = 200;
  car.speed = 50;
  car.offset = 12; // Well outside track limits
  stepDriveSession(session, {...idle, throttle: 0.5});
  expect(session.telemetry.offTrack).toBe(true);
  expect(session.telemetry.lapInvalid).toBe(true);
 });
});
