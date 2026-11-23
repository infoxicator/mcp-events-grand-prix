import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CHAT_STRATEGY_LAPS, CHAT_STRATEGY_MAX_LAPS, CHAT_STRATEGY_TIME_MS, strategyTimeBudgetMs} from '../src/race/live';
import {connect} from '../src/race/network';
import {RaceRoom} from '../server/race-room';

describe('local browser physics & single-WS watch optimizations', () => {
 beforeEach(() => {
  vi.useFakeTimers();
 });
 afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
 });

 it('runs solo drive physics 100% locally with zero WebSockets or fetch calls', async () => {
  const wsSpy = vi.fn(() => { throw new Error('Should not open WebSocket in local mode'); });
  const fetchSpy = vi.fn(() => { throw new Error('Should not call fetch in local mode'); });
  vi.stubGlobal('WebSocket', wsSpy);
  vi.stubGlobal('fetch', fetchSpy);

  const conn = connect('a', {
   room: '55555555-5555-4555-8555-555555555555',
   token: '',
   links: null,
   local: {circuit: 'monza', laps: 3, speed: 1, solo: true, drive: true, watch: false},
  }, {role: 'driver'});

  await Promise.resolve();
  expect(conn.status).toBe('CONNECTED');
  expect(conn.latency).toBe(0);
  expect(conn.state?.race.phase).toBe('lobby');
  expect(conn.state?.driverMode?.a).toBe('human');
  expect(wsSpy).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();

  conn.send({type: 'start'});
  expect(conn.state?.race.phase).toBe('lights');

  // Advance past 5-second lights countdown into racing
  vi.advanceTimersByTime(6_000);
  expect(conn.state?.race.phase).toBe('racing');

  // Manual human throttle advances the car locally
  conn.send({type: 'control', input: {throttle: 1, brake: 0, steer: 0}});
  vi.advanceTimersByTime(2_000);
  expect(conn.state!.race.cars.a.speed).toBeGreaterThan(15);

  // Live mode switches to Jev and Autopilot work locally
  conn.send({type: 'driver-mode', mode: 'jev'});
  vi.advanceTimersByTime(500);
  expect(conn.state?.driverMode?.a).toBe('jev');
  expect(conn.state!.intents.a).toBeGreaterThan(0);

  conn.send({type: 'driver-mode', mode: 'autopilot'});
  vi.advanceTimersByTime(500);
  expect(conn.state?.driverMode?.a).toBe('autopilot');

  // Instant replay and race control work locally
  let replayCount = 0;
  conn.onReplay = (frames) => { replayCount = frames.length; };
  conn.send({type: 'replay'});
  expect(replayCount).toBeGreaterThan(0);

  conn.send({type: 'race-control', hazard: {kind: 'rain', level: 'heavy'}});
  expect(conn.state?.race.control?.rain).toBe('heavy');

  conn.close();
  expect(wsSpy).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
 });

 it('scales ChatGPT strategy defaults to 10 laps / 25 min and supports up to 20 laps', () => {
  expect(CHAT_STRATEGY_LAPS).toBe(10);
  expect(CHAT_STRATEGY_MAX_LAPS).toBe(20);
  expect(CHAT_STRATEGY_TIME_MS).toBe(25 * 60_000);
  expect(strategyTimeBudgetMs(3)).toBe(25 * 60_000);
  expect(strategyTimeBudgetMs(10)).toBe(25 * 60_000);
  expect(strategyTimeBudgetMs(20)).toBe(50 * 60_000);
 });

 it('drives both seats internally in single-WS watchMode without extra seat sockets', () => {
  const room = new RaceRoom(crypto.randomUUID(), 'https://example.test', {JEV_MOCK: '1'}, 1, 'jev-vs-jev', {}, 'monza', false, 3, false, true);
  expect(room.connected()).toEqual({a: true, b: true});
  const startA = room.race.cars.a.distance;
  const startB = room.race.cars.b.distance;
  expect(room.start()).toBe(true);
  // Advance past lights (5s = 600 ticks) + 2s of racing (240 ticks)
  room.advance(840);
  expect(room.race.phase).toBe('racing');
  expect(room.intents.a).toBeGreaterThan(0);
  expect(room.intents.b).toBeGreaterThan(0);
  expect(room.race.cars.a.distance).toBeGreaterThan(startA + 20);
  expect(room.race.cars.b.distance).toBeGreaterThan(startB + 20);
  expect(room.race.cars.a.speed).toBeGreaterThan(20);
  expect(room.race.cars.b.speed).toBeGreaterThan(20);
 });
});
