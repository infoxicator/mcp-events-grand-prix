import {describe, expect, it} from 'vitest';
import {RaceRoom} from '../server/race-room';
import type {ServerMessage} from '../src/race/types';

function makeRoom() {
 return new RaceRoom('drive-test-room', 'http://127.0.0.1:5277', {JEV_MOCK: '1'}, 1, 'jev-vs-jev', {}, 'monza', true, 3, true);
}

function connectPeer(room: RaceRoom) {
 const inbox: ServerMessage[] = [];
 const peer = room.add((m) => inbox.push(m));
 return {peer, inbox};
}

describe('Room-backed Drive Mode (Human / Jev / Autopilot + Engineer Join/Mock)', () => {
 it('allows driver and strategy engineer to join the same team without colliding', async () => {
  const room = makeRoom();
  expect(room.drive).toBe(true);
  expect(room.driverMode.a).toBe('human');
  expect(room.engineerMode.a).toBe('mock');

  const driver = connectPeer(room);
  await room.message(driver.peer, {type: 'join', team: 'a', token: room.tokens.owner, role: 'driver'});
  expect(driver.peer.team).toBe('a');
  expect(driver.peer.role).toBe('driver');
  expect(room.connected()).toEqual({a: true, b: true});
  expect(room.engineerConnected()).toEqual({a: false, b: false});

  const engineer = connectPeer(room);
  await room.message(engineer.peer, {type: 'join', team: 'a', token: room.tokens.a, role: 'engineer'});
  expect(engineer.peer.team).toBe('a');
  expect(engineer.peer.role).toBe('engineer');
  expect(room.engineerConnected()).toEqual({a: true, b: false});
  // Joining as engineer automatically switches engineerMode to 'joined'
  expect(room.engineerMode.a).toBe('joined');
  expect(room.state().engineerConnected?.a).toBe(true);
 });

 it('drives manually with human control inputs in human mode and ignores decide calls', async () => {
  const room = makeRoom();
  const driver = connectPeer(room);
  await room.message(driver.peer, {type: 'join', team: 'a', token: room.tokens.owner, role: 'driver'});
  await room.message(driver.peer, {type: 'start'});
  // Advance past 5-second lights sequence
  room.advance(120 * 6);
  expect(room.race.phase).toBe('racing');

  // Decide should be ignored while in human mode
  await room.message(driver.peer, {type: 'decide'});
  expect(room.decisions.a).toBeNull();

  // Send throttle + left steer control packet
  await room.message(driver.peer, {
   type: 'control',
   input: {throttle: 1, brake: 0, steer: 0.08, ersOvertake: true, tc: 'medium', abs: true, pitAssist: true},
  });
  const startDist = room.race.cars.a.distance;
  room.advance(120 * 3);
  expect(room.race.cars.a.speed).toBeGreaterThan(25);
  expect(room.race.cars.a.distance).toBeGreaterThan(startDist + 20);
  expect(room.race.cars.a.offset).toBeLessThan(0); // +steer turns left (negative offset)
 });

 it('switches seamlessly between human, autopilot, and jev live during a race', async () => {
  const room = makeRoom();
  const driver = connectPeer(room);
  await room.message(driver.peer, {type: 'join', team: 'a', token: room.tokens.owner, role: 'driver'});
  await room.message(driver.peer, {type: 'start'});
  room.advance(120 * 6);
  expect(room.race.phase).toBe('racing');

  // Switch to autopilot
  await room.message(driver.peer, {type: 'driver-mode', mode: 'autopilot'});
  expect(room.driverMode.a).toBe('autopilot');
  const distBeforeAuto = room.race.cars.a.distance;
  room.advance(120 * 3);
  expect(room.race.cars.a.distance).toBeGreaterThan(distBeforeAuto + 40);
  expect(room.race.cars.a.intent.reply).toContain('Autopilot');

  // Switch to Jev and verify decide + intent pipeline works
  await room.message(driver.peer, {type: 'driver-mode', mode: 'jev'});
  expect(room.driverMode.a).toBe('jev');
  await room.message(driver.peer, {type: 'decide'});
  expect(room.decisions.a).not.toBeNull();
  const seq = room.decisions.a!.sequence;
  const intentsBefore = room.intents.a;
  await room.message(driver.peer, {type: 'intent', sequence: seq});
  expect(room.intents.a).toBe(intentsBefore + 1);
 });

 it('suppresses mocked engineer when joined engineer is active and applies live radio orders', async () => {
  const room = makeRoom();
  const driver = connectPeer(room);
  const engineer = connectPeer(room);
  await room.message(driver.peer, {type: 'join', team: 'a', token: room.tokens.owner, role: 'driver'});
  await room.message(engineer.peer, {type: 'join', team: 'a', token: room.tokens.a, role: 'engineer'});
  expect(room.engineerMode.a).toBe('joined');

  await room.message(driver.peer, {type: 'start'});
  await room.message(driver.peer, {type: 'driver-mode', mode: 'autopilot'});
  room.advance(120 * 8);
  // No mocked engineer calls should have fired for seat a while engineerMode is joined
  expect(room.engineerCalls.a).toBe(0);

  // Joined Strategy Engineer sends live radio order
  await room.message(engineer.peer, {
   type: 'radio',
   instruction: {
    pace: 'push',
    ers: 'deploy',
    box: true,
    tyre: 'hard',
    tactic: 'attack',
    line: 'Box this lap for hard tyres. Undercut is on.',
   },
  });
  expect(room.race.cars.a.instruction.box).toBe(true);
  expect(room.race.cars.a.instruction.tyre).toBe('hard');
  const lastRadio = room.race.radio.filter((r) => r.team === 'a').at(-1);
  expect(lastRadio?.source).toBe('live');
  expect(lastRadio?.text).toContain('Undercut is on');

  // Switching back to mocked engineer resumes automatic calls
  await room.message(driver.peer, {type: 'engineer-mode', mode: 'mock'});
  expect(room.engineerMode.a).toBe('mock');
  room.advance(120 * 2);
  expect(room.engineerCalls.a).toBeGreaterThan(0);
 });
});
