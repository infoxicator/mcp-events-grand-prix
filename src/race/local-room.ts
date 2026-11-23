import {autopilotIntent, mockDriver, mockEngineer} from './brains';
import type {RaceLogData, RaceLogEntry, RaceLogKind, RaceLogUpdate} from './event-log';
import {isMatchup, type DriverInfo, type Matchup} from './matchup';
import type {ConnectOptions, Connection} from './network';
import {createRace, dryCompoundRuleSatisfied, event, FIA_MIN_FUEL_KG, humanInputToControls, stepRace, type DriverControls} from './physics';
import {applyHazard, compounds, parseHazard, wetnessBand} from './race-control';
import {pitCommitmentPoint} from './strategy-calls';
import {projectFuelAtFlag, sectorGaps} from './strategy-observation';
import {strategistDue} from './strategy-radio';
import {getTrack, isCircuit} from './track';
import {
 TEAMS,
 type ClientMessage,
 type Decision,
 type DriverControlMode,
 type EngineerControlMode,
 type HostedRoom,
 type HumanControlInput,
 type Instruction,
 type Race,
 type RaceState,
 type Radio,
 type Team,
} from './types';

const LOG_LIMIT: Record<RaceLogKind, number> = {strategy: 60, driver: 120, radio: 60};

function makePlayers(matchup: Matchup): Record<Team, DriverInfo> {
 return {
  a: {name: 'Jev', engine: 'jev', provider: 'mock', model: 'mock', mock: true, intervalMs: 200},
  b: matchup === 'jev-vs-luna'
   ? {name: 'Luna', engine: 'luna', provider: 'mock', model: 'mock', mock: true, intervalMs: 200}
   : {name: 'Jev', engine: 'jev', provider: 'mock', model: 'mock', mock: true, intervalMs: 200},
 };
}

function replayFrame(r: Race): Race {
 const copyCar = (c: Race['cars']['a']) => ({
  ...c,
  distance: +c.distance.toFixed(3),
  speed: +c.speed.toFixed(2),
  offset: +c.offset.toFixed(3),
  steering: +c.steering.toFixed(4),
  heading: +c.heading.toFixed(4),
  lateralVelocity: +c.lateralVelocity.toFixed(3),
  acceleration: +c.acceleration.toFixed(2),
  lateralG: +c.lateralG.toFixed(3),
  wear: +c.wear.toFixed(4),
  temperature: +c.temperature.toFixed(1),
  fuel: +c.fuel.toFixed(2),
  ers: +c.ers.toFixed(1),
  eligible: [...c.eligible],
  lapTimes: [...c.lapTimes],
  splits: [...c.splits],
  bestSectors: [...c.bestSectors],
  splitColours: [...c.splitColours],
  intent: {...c.intent},
  instruction: {...c.instruction},
  ...(c.damage ? {damage: [...c.damage] as [number, number, number, number]} : {}),
 });
 return {
  ...r,
  cars: {a: copyCar(r.cars.a), b: copyCar(r.cars.b)},
  field: r.field.map(f => ({
   distance: +f.distance.toFixed(3),
   offset: +f.offset.toFixed(3),
   speed: +f.speed.toFixed(2),
   finishTime: f.finishTime === null ? null : +f.finishTime.toFixed(3),
   service: +f.service.toFixed(2),
   compound: f.compound,
   ...(f.pit && f.pit !== 'none' ? {pit: f.pit} : {}),
   ...(f.pitHeading ? {pitHeading: +f.pitHeading.toFixed(3)} : {}),
  }) as Race['field'][number]),
  control: r.control ? {
   ...r.control,
   safetyCar: r.control.safetyCar ? {...r.control.safetyCar} : undefined,
   ...(r.control.sectorWetness ? {sectorWetness: [...r.control.sectorWetness] as [number, number, number]} : {}),
  } : undefined,
  fastest: r.fastest ? {...r.fastest} : null,
  events: [],
  radio: [],
 };
}

export function createLocalConnection(team: Team | null, room: HostedRoom, options?: ConnectOptions): Connection {
 const cfg = room.local!;
 let matchup: Matchup = cfg.matchup ?? 'jev-vs-jev';
 let players = makePlayers(matchup);
 let race = createRace(cfg.laps, cfg.circuit);
 let decisions: Record<Team, Decision | null> = {a: null, b: null};
 let intents = {a: 0, b: 0};
 let engineerCalls = {a: 0, b: 0};
 const driverStats = {a: {attempts: 0, successes: 0, fallbacks: 0}, b: {attempts: 0, successes: 0, fallbacks: 0}};
 const driverMode: Record<Team, DriverControlMode> = {a: cfg.drive ? 'human' : 'jev', b: 'jev'};
 const engineerMode: Record<Team, EngineerControlMode> = {a: 'mock', b: 'mock'};
 const humanInputs: Partial<Record<Team, {input: HumanControlInput; at: number}>> = {};
 let gapHistory: Record<Team, ReturnType<typeof sectorGaps>[]> = {a: [], b: []};
 let lastSector: Partial<Record<Team, number>> = {};
 let engineerWindow: Partial<Record<Team, {lap: number; change: string; controlRevision?: number}>> = {};
 let pendingBox: Partial<Record<Team, {lap: number; instruction: Instruction}>> = {};
 let manualUntil = {a: 0, b: 0};
 let sequence = 0;
 let logSequence = 0;
 const eventLog: Record<RaceLogKind, RaceLogEntry[]> = {strategy: [], driver: [], radio: []};
 let eventLogSubscribed = false;
 let history: Race[] = [];
 let replay: Race[] = [];
 let bestReplayScore = 0;
 let captureUntil = 0;

 let timer: ReturnType<typeof setInterval> | undefined;
 let prev = Date.now();
 let accumulator = 0;
 let closed = false;

 const isHidden = () => typeof document !== 'undefined' && document.hidden;

 const emitLog = (update: RaceLogUpdate) => {
  if (eventLogSubscribed) c.onEventLog?.(update);
 };

 const log = (t: Team, data: RaceLogData, lap = race.cars[t].lap + 1) => {
  const entry: RaceLogEntry = {id: ++logSequence, time: race.time, lap, team: t, data: structuredClone(data)};
  const list = eventLog[data.kind];
  list.push(entry);
  const discarded = list.length > LOG_LIMIT[data.kind] ? list.shift()!.id : undefined;
  emitLog({type: 'event-log', entries: [entry], discarded});
 };

 const buildState = (): RaceState => ({
  type: 'state',
  room: room.room,
  race: structuredClone(race),
  connected: {a: true, b: true},
  decisions: {a: decisions.a ? structuredClone(decisions.a) : null, b: decisions.b ? structuredClone(decisions.b) : null},
  intents: {...intents},
  engineerCalls: {...engineerCalls},
  driverStats: {a: {...driverStats.a}, b: {...driverStats.b}},
  matchup,
  players: {a: {...players.a}, b: {...players.b}},
  mode: 'mock',
  serverTime: Date.now(),
  physicsHz: 120,
  snapshotHz: 30,
  speed: cfg.speed,
  paidCalls: 0,
  ...(cfg.solo ? {solo: true} : {}),
  ...(cfg.drive || driverMode.a !== 'jev' || driverMode.b !== 'jev' || engineerMode.a !== 'mock' || engineerMode.b !== 'mock'
   ? {drive: cfg.drive, driverMode: {...driverMode}, engineerMode: {...engineerMode}, engineerConnected: {a: false, b: false}}
   : {}),
 });

 const publish = () => {
  if (closed) return;
  const s = buildState();
  c.state = s;
  c.received = performance.now();
  c.onSnapshot?.(s, c.received);
 };

 const applyInstruction = (t: Team, instruction: Instruction, keepQueuedPit = false) => {
  const car = race.cars[t], track = getTrack(race.circuit);
  const position = track.wrap(car.distance);
  const late = race.phase === 'racing' && car.distance >= 0 && car.pit === 'none' && position > pitCommitmentPoint(track.PIT_ENTRY);
  if (!keepQueuedPit) delete pendingBox[t];
  let applied = instruction.energy ? {...instruction, energy: {...instruction.energy, startJoules: car.ersDeployed ?? 0}} : instruction;
  if (late && instruction.box !== car.instruction.box) {
   if (instruction.box && car.lap + 1 < race.laps) pendingBox[t] = {lap: car.lap + 1, instruction: structuredClone(instruction)};
   applied = {
    ...applied,
    box: car.instruction.box,
    line: instruction.box
     ? (pendingBox[t] ? 'Past pit commitment. Box next lap.' : 'Past pit commitment. Stay out to the flag.')
     : 'Pit entry committed. Continue to the box.',
   };
  }
  car.instruction = structuredClone(applied);
  car.intent.ers = false;
  decisions[t] = null;
  return applied;
 };

 const radio = (t: Team, instruction: Instruction, source: 'mock' | 'live' = 'mock') => {
  const applied = applyInstruction(t, instruction);
  const transmission: Radio = {id: ++sequence, time: race.time, team: t, speaker: 'ENGINEER', text: applied.line, source, responseMs: 0};
  race.radio.push(transmission);
  race.radio = race.radio.slice(-20);
  event(race, 'radio', t, applied.line);
  log(t, {kind: 'radio', speaker: transmission.speaker, source, text: transmission.text, responseMs: 0, instruction: applied});
  return transmission;
 };

 const applyIntent = (t: Team, decision: Decision) => {
  race.cars[t].intent = structuredClone(decision.intent);
  intents[t]++;
  const {reply: spoken, ...intent} = decision.intent;
  log(t, {kind: 'driver', engine: players[t].engine, source: decision.source, responseMs: 0, sequence: decision.sequence, intent});
  const text = spoken.trim();
  if (text) race.cars[t].lastDriverReport = text;
  if (intents[t] === 1 || intents[t] % 20 === 0) {
   const reply: Radio = {id: ++sequence, time: race.time, team: t, speaker: players[t].engine === 'luna' ? 'LUNA' : 'JEV', text, source: 'mock', responseMs: 0};
   race.radio.push(reply);
   race.radio = race.radio.slice(-20);
  }
 };

 const updateStrategy = (t: Team) => {
  const car = race.cars[t];
  if (race.phase !== 'racing' || car.finishTime !== null) return;
  if (lastSector[t] !== car.sector) {
   lastSector[t] = car.sector;
   if (car.distance > 0) {
    gapHistory[t].push(sectorGaps(race, t));
    if (gapHistory[t].length > 6) gapHistory[t].shift();
   }
  }
  const previous = engineerWindow[t];
  const controlRevision = race.control?.revision ?? 0;
  if (car.pit !== 'none') return;
  const wetBand = wetnessBand(race.control?.wetness ?? 0);
  const fuelThreshold = race.laps >= 10 ? FIA_MIN_FUEL_KG : 0;
  const fuelTight = projectFuelAtFlag(race, t) < fuelThreshold;
  const change = `${car.stops}/${Boolean(car.damage)}/${wetBand}/${fuelTight}/${dryCompoundRuleSatisfied(race, car)}`;
  const win = {lap: car.lap, change, controlRevision};
  const pending = pendingBox[t];
  if (pending && car.lap >= pending.lap && car.pit === 'none') {
   radio(t, pending.instruction, 'mock');
   engineerWindow[t] = win;
   return;
  }
  if (engineerMode[t] === 'joined') return;
  if (!strategistDue(previous, car.lap, change) || Date.now() <= manualUntil[t]) return;
  engineerWindow[t] = win;
  engineerCalls[t]++;
  radio(t, mockEngineer(race, t, true, gapHistory[t]), 'mock');
 };

 const stopClock = () => {
  if (timer) {
   clearInterval(timer);
   timer = undefined;
  }
 };

 const reset = () => {
  stopClock();
  race = createRace(race.laps, race.circuit);
  decisions = {a: null, b: null};
  intents = {a: 0, b: 0};
  engineerCalls = {a: 0, b: 0};
  gapHistory = {a: [], b: []};
  lastSector = {};
  engineerWindow = {};
  pendingBox = {};
  manualUntil = {a: 0, b: 0};
  history = [];
  replay = [];
  bestReplayScore = 0;
  captureUntil = 0;
  delete humanInputs.a;
  delete humanInputs.b;
  for (const list of Object.values(eventLog)) list.length = 0;
  emitLog({type: 'event-log', reset: true, entries: []});
  publish();
 };

 const advance = (steps: number) => {
  if (race.phase === 'lobby' || race.phase === 'finished') return;
  const nowMs = Date.now();
  for (let n = 0; n < steps; n++) {
   const oldLeader = race.leader;
   let controls: Partial<Record<Team, DriverControls>> | undefined;
   for (const t of TEAMS) {
    if (driverMode[t] === 'human') {
     const entry = humanInputs[t];
     const input = entry && nowMs - entry.at < 1500 ? entry.input : {throttle: 0, brake: 0, steer: 0};
     (controls ??= {})[t] = humanInputToControls(race.cars[t], input);
    }
   }
   stepRace(race, controls);
   if ((race.phase as Race['phase']) === 'finished') break;
   if (race.phase === 'racing') {
    if (race.tick % 24 === 0) {
     for (const t of TEAMS) {
      if (race.cars[t].finishTime !== null) continue;
      if (driverMode[t] === 'autopilot') {
       const decision: Decision = {sequence: race.tick, responseMs: 0, source: 'mock', intent: autopilotIntent(race, t)};
       decisions[t] = decision;
       applyIntent(t, decision);
      } else if (driverMode[t] === 'jev') {
       const decision: Decision = {sequence: race.tick, responseMs: 0, source: 'mock', intent: mockDriver(race, t)};
       decisions[t] = decision;
       applyIntent(t, decision);
      }
     }
    }
    for (const t of TEAMS) updateStrategy(t);
   }
   if (race.phase === 'racing' && race.tick % 8 === 0) {
    history.push(replayFrame(race));
    if (history.length > 120) history.shift();
   }
   if (race.phase === 'racing' && race.cars.a.finishTime === null && race.cars.b.finishTime === null && oldLeader !== race.leader && race.cars.a.pit === 'none' && race.cars.b.pit === 'none') {
    const score = 100 - Math.abs(race.cars.a.distance - race.cars.b.distance);
    if (score > bestReplayScore) {
     bestReplayScore = score;
     replay = history.slice();
     captureUntil = race.time + 3;
    }
   }
   if (race.phase === 'racing' && captureUntil > race.time && race.tick % 8 === 0 && replay.at(-1)?.tick !== race.tick) {
    replay.push(replayFrame(race));
    if (replay.length > 165) replay.shift();
   }
  }
 };

 const startClock = () => {
  if (timer || closed || race.phase === 'lobby' || race.phase === 'finished') return;
  prev = Date.now();
  timer = setInterval(() => {
   if (closed) { stopClock(); return; }
   const now = Date.now();
   if (isHidden()) { prev = now; return; }
   accumulator += Math.min(0.25, (now - prev) / 1000) * cfg.speed;
   prev = now;
   const steps = Math.min(120, Math.floor(accumulator * 120));
   accumulator -= steps / 120;
   if (steps > 0) advance(steps);
   publish();
   if (race.phase === 'finished' || race.phase === 'lobby') stopClock();
  }, 33);
 };

 const onVisibility = () => {
  if (!isHidden()) prev = Date.now();
 };
 if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', onVisibility);
 }

 const c: Connection = {
  state: null,
  team,
  role: options?.role,
  canReset: true,
  status: 'CONNECTED',
  latency: 0,
  received: performance.now(),
  onReplay: () => {},
  subscribeEventLog: (subscribe: boolean) => {
   eventLogSubscribed = subscribe;
   if (subscribe) {
    emitLog({type: 'event-log', reset: true, entries: Object.values(eventLog).flat().sort((a, b) => a.id - b.id)});
   }
  },
  claimAudio: async () => true,
  releaseAudio: () => {},
  send: (msg: ClientMessage) => {
   if (closed) return;
   if (msg.type === 'start') {
    if (race.phase === 'lobby') {
     race.phase = 'lights';
     publish();
     startClock();
    }
    return;
   }
   if (msg.type === 'reset') { reset(); return; }
   if (msg.type === 'circuit' && isCircuit(msg.circuit)) { race.circuit = msg.circuit; reset(); return; }
   if (msg.type === 'matchup' && !cfg.solo && isMatchup(msg.matchup)) { matchup = msg.matchup; players = makePlayers(matchup); reset(); return; }
   if (msg.type === 'replay') { c.onReplay(replay.length ? replay : history); return; }
   if (msg.type === 'race-control') {
    const hazard = parseHazard(msg.hazard);
    if (hazard && applyHazard(race, getTrack(race.circuit), hazard)) {
     for (const t of TEAMS) updateStrategy(t);
     publish();
    }
    return;
   }
   if (msg.type === 'driver-mode') {
    const t = team ?? 'a';
    if ((msg.mode === 'human' || msg.mode === 'jev' || msg.mode === 'autopilot') && driverMode[t] !== msg.mode) {
     driverMode[t] = msg.mode;
     if (msg.mode !== 'human') delete humanInputs[t];
     if (race.phase === 'racing') {
      const label = msg.mode === 'human' ? 'MANUAL CONTROL · YOU ARE DRIVING' : msg.mode === 'jev' ? 'JEV IN CONTROL' : 'AUTOPILOT ENGAGED';
      event(race, 'radio', t, label);
     }
     publish();
    }
    return;
   }
   if (msg.type === 'engineer-mode') {
    const t = team ?? 'a';
    if ((msg.mode === 'mock' || msg.mode === 'joined') && engineerMode[t] !== msg.mode) {
     engineerMode[t] = msg.mode;
     if (msg.mode === 'mock') { manualUntil[t] = 0; delete engineerWindow[t]; }
     publish();
    }
    return;
   }
   if (msg.type === 'control') {
    const t = team ?? 'a';
    if (driverMode[t] === 'human' && msg.input) {
     humanInputs[t] = {input: msg.input, at: Date.now()};
    }
    return;
   }
   if (msg.type === 'radio') {
    const t = team ?? 'a';
    const i = msg.instruction;
    if (i && ['push', 'balanced', 'manage'].includes(i.pace) && ['deploy', 'balanced', 'harvest'].includes(i.ers) && compounds.includes(i.tyre) && ['attack', 'defend', 'hold'].includes(i.tactic) && typeof i.box === 'boolean' && typeof i.line === 'string' && i.line.length <= 180) {
     manualUntil[t] = Date.now() + 3000;
     radio(t, {pace: i.pace, ers: i.ers, box: i.box, tyre: i.tyre, tactic: i.tactic, line: i.line}, engineerMode[t] === 'joined' ? 'live' : 'mock');
     publish();
    }
    return;
   }
  },
  close: () => {
   if (closed) return;
   closed = true;
   stopClock();
   if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility);
   }
  },
 };

 // Emit initial state asynchronously so callers can register onSnapshot first
 queueMicrotask(() => publish());
 return c;
}
