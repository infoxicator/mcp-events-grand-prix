import {describe,expect,it} from 'vitest';
import {createRace} from '../src/race/physics';
import {blendRace,createInterpolator} from '../src/race/presentation-motion';
import type {RaceState} from '../src/race/types';

function snapshot(time:number,speed=1){
 const race=createRace(3);
 race.phase='racing';race.time=time;race.tick=Math.round(time*120);
 for(const [i,c] of [race.cars.a,race.cars.b,...race.field].entries()){
  c.distance=6000+time*60-i*10;c.speed=60;
 }
 return {race,speed,physicsHz:120} as RaceState;
}

describe('race presentation clock',()=>{
 for(const speed of [1,4])it('preserves constant velocity with batched 30 Hz packets at '+speed+'×',()=>{
  const sample=createInterpolator();
  let s=snapshot(0,speed),received=0,next=0,previous:number[]=[];
  for(let frame=0;frame<180;frame++){
   const now=frame*1000/60;
   while(next*1000/30+[0,16,0,56,23,0,6,0][next%8]<=now+.00001){
    received=now;s=snapshot(next*speed/30,speed);sample.push(s,received);
    sample.push({...s,race:{...s.race}},received);next++;
   }
   // Use the same latest packet the WebSocket connection published.
   const r=sample(s,received,now),stations=[r.cars.a.distance,r.cars.b.distance,r.field[14].distance];
   if(frame>30)stations.forEach((d,i)=>expect(d-previous[i]).toBeCloseTo(speed,6));
   previous=stations;
  }
 });
 it('uses the field integration tick when a server broadcast falls between two steps',()=>{
  const sample=createInterpolator();
  let s=snapshot(0),received=0,tick=0;
  for(let frame=0;frame<150;frame++){
   const now=frame*1000/60;
   if(tick*1000/120<=now){
    s=snapshot(tick/120);received=tick*1000/120;
    for(const car of s.race.field)car.distance-=60*(tick%4)/120;
    sample.push(s,received);tick+=5;
   }
   const r=sample(s,received,now);
   if(frame>20)expect(r.cars.a.distance-r.field[0].distance).toBeCloseTo(20,6);
  }
 });
 it('holds at the last known position and never blends across a reset',()=>{
  const sample=createInterpolator(),first=snapshot(60),next=snapshot(60.1);
  sample(first,1000,1000);sample(next,1100,1100);
  expect(sample(next,1100,5000).cars.a.distance).toBe(next.race.cars.a.distance);
  const resumed=snapshot(60.13);const r=sample(resumed,5010,5010);
  expect(r.cars.a.distance).toBeGreaterThanOrEqual(next.race.cars.a.distance);
  const restart=snapshot(0);expect(sample(restart,5040,5040)).toBe(restart.race);
 });
 it('interpolates replay motion and load, but changes damage and service only on the recorded frame',()=>{
  const a=snapshot(12).race,b=snapshot(12+1/30).race;
  a.cars.a.heading=Math.PI-.02;b.cars.a.heading=-Math.PI+.02;
  b.cars.a.damage=[.8,0,0,0];b.cars.a.pit='entry';b.cars.a.acceleration=-8;
  const r=blendRace(a,b,.5);
  expect(r.time).toBeCloseTo(12+1/60);expect(r.cars.a.distance-a.cars.a.distance).toBeCloseTo(1);
  expect(r.cars.a.heading).toBeCloseTo(Math.PI);expect(r.cars.a.acceleration).toBe(-4);
  expect(r.cars.a.pit).toBe('none');expect(r.cars.a.damage).toBe(a.cars.a.damage);
  expect(blendRace(a,b,1)).toBe(b);
 });
});
