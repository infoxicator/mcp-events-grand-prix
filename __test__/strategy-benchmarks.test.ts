import {expect,test} from 'vitest';
import {batteryReleaseState,batterySeeds,batteryReplay,batteryState,cornerReplay,cornerDriver} from '../src/race/strategy-benchmarks';

test('inside occupancy changes the line and braking while the fixed controller is measured at the same finish', () => {
 const clear = cornerReplay(false,'adaptive',cornerDriver,()=>0);
 const occupied = cornerReplay(true,'adaptive',cornerDriver,()=>0);
 expect(occupied.firstBrake?.distance).toBeLessThan(clear.firstBrake!.distance);
 expect(occupied.path).not.toEqual(clear.path);
 expect(occupied.contacts).toBe(0);
 for (const inside of [false,true]) expect(cornerReplay(inside,'reference').finished).toBe(true);
 expect(clear.finished && occupied.finished).toBe(true);
});

test('a decision past the driving deadline is counted and discarded', () => {
 let time = 0;
 const run = cornerReplay(true,'adaptive',cornerDriver,()=>time+=250);
 expect(run.missed).toBeGreaterThan(0);
 expect(run.applied).toBe(0);
 expect(run.path).toEqual(cornerReplay(true,'adaptive',cornerDriver,()=>0).path);
});

test('the same battery state and seed compare one deployment against the alternative', () => {
 for (const seed of batterySeeds) for (const closing of [1,8]) {
  const state = batteryState(closing);
  const chosen = batteryReplay(state,seed);
  const alternative = batteryReplay(state,seed,closing === 1 ? 'defend' : 'attack');
  expect(chosen.call.priority).toBe(closing === 1 ? 'attack' : 'defend');
  expect(chosen.deployment?.sector).toBe(state.zones[chosen.call.priority==='attack'?'attack':'defend'].sector+1);
  expect(chosen.gaps.slice(0,3)).toEqual(alternative.gaps.slice(0,3));
  expect(chosen.place).toBeLessThan(alternative.place);
  const deployment=chosen.deployment!;
  const zone=state.zones[deployment.priority];
  expect(deployment.metres).toBeGreaterThanOrEqual(zone.start);
  expect(deployment.metres).toBeLessThan(zone.end);

 }
});

test('a receding threat releases the held boost while the locked alternative retains its call',()=>{
 const state=batteryReleaseState();
 const revised=batteryReplay(state,17,'defend');
 const locked=batteryReplay(state,17,'defend',undefined,true);
 expect(revised.call.priority).toBe('defend');
 expect(revised.calls.map(call=>call.priority)).toEqual(['defend','attack']);
 expect(revised.deployment?.priority).toBe('attack');
 expect(locked.calls).toHaveLength(1);
 expect(locked.deployment).toBeNull();
});

test('spending the boost on the back straight can leave Jev exposed on the final lap',()=>{
 const attack=batteryReplay(batteryState(8),17,'attack',undefined,true);
 expect(attack.deployment).toMatchObject({priority:'attack',lap:1});
 expect(attack.gaps[5].behind).toBeGreaterThan(0);
 expect(attack.rearGap).toBeLessThan(0);
});
