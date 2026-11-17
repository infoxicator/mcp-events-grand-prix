import {describe,it,expect} from 'vitest';
import {BroadcastDirector,BROADCAST_SHOTS} from '../src/race/broadcast-camera';
describe('broadcast camera direction',()=>{
 it('holds every shot for its duration and loops through both drivers and external views',()=>{
  const director=new BroadcastDirector();let now=100000;
  for(let loop=0;loop<2;loop++)for(const shot of BROADCAST_SHOTS){
   expect(director.update(now)).toBe(shot.mode);
   expect(director.update(now+shot.seconds*1000-1)).toBe(shot.mode);
   now+=shot.seconds*1000;
  }
  expect(director.update(now)).toBe('side');
  expect(new Set(BROADCAST_SHOTS.map(s=>s.mode))).toEqual(new Set(['side','chase','helicopter','tcam-a','tcam-b','cockpit-a','cockpit-b']));
 });
 it('restarts with a full side hold when Broadcast is selected again',()=>{
  const d=new BroadcastDirector();d.update(0);expect(d.update(8000)).toBe('tcam-a');
  d.reset();expect(d.update(90000)).toBe('side');expect(d.update(97999)).toBe('side');
 });
 it('does not catch up with rapid cuts after a background pause',()=>{
  const d=new BroadcastDirector();d.update(0);expect(d.update(600000)).toBe('tcam-a');
  expect(d.update(600016)).toBe('tcam-a');expect(d.update(606999)).toBe('tcam-a');
 });
});
