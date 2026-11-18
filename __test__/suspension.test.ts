import {describe,it,expect} from 'vitest';
import {getTrack} from '../src/race/track';
import {kerbHeight,Suspension} from '../src/race/suspension';
import {DriverHead} from '../src/race/onboard-camera';

const monza=getTrack('monza');
const coast={distance:2556,offset:0,speed:60};
describe('car and camera under load',()=>{
 it('dives under braking, squats under power and clears the loaded pose in the studio',()=>{
  const s=new Suspension();
  s.update(monza,{...coast,acceleration:-30,lateralG:3},0,false);
  expect(s.pitch).toBeGreaterThan(0);expect(s.roll).toBeLessThan(0);expect(s.compression[1]).toBeGreaterThan(s.compression[3]);
  s.update(monza,{...coast,acceleration:10},1000,false);
  expect(s.pitch).toBeLessThan(0);
  s.update(monza,{...coast,drs:true},1016,true);
  expect([s.heave,s.pitch,s.roll,s.flap]).toEqual([0,0,0,0]);
 });
 it('lifts only the wheels on a marked kerb and repeats on the following lap',()=>{
  const s=new Suspension();s.update(monza,{...coast,offset:5.7},0,false);
  expect(s.heights[0]).toBeGreaterThan(.02);expect(s.heights[2]).toBeGreaterThan(.02);
  expect(s.heights[1]).toBe(0);expect(s.heights[3]).toBe(0);
  expect(kerbHeight(monza,200,6.5)).toBe(0);
  expect(kerbHeight(monza,2556+monza.LENGTH,6.5)).toBeCloseTo(kerbHeight(monza,2556,6.5),9);
 });
 it('opens DRS progressively and closes faster under braking',()=>{
  const s=new Suspension();s.update(monza,coast,0,false);
  s.update(monza,{...coast,drs:true},50,false);const opened=s.flap;
  expect(opened).toBeLessThan(0);expect(opened).toBeGreaterThan(-.43);
  s.update(monza,coast,100,false);expect(s.flap).toBe(0);
 });
 it('damps the driver’s gaze consistently at 30 and 120 Hz and resets on a cut',()=>{
  function run(fps:number){const head=new DriverHead();head.update(0,0,0,0,0,0);
   for(let i=1;i<=fps;i++)head.update(1000*i/fps,.2,.1,60,-30,4);
   return head;
  }
  const a=run(30),b=run(120);
  expect(a.yaw).toBeCloseTo(b.yaw,8);expect(a.yaw).toBeGreaterThan(.1);
  expect(a.forward).toBeGreaterThan(0);expect(a.lateral).toBeGreaterThan(0);
  a.reset();a.update(1234,.2,0,0,0,0);expect(a.yaw).toBe(0);
 });
});
