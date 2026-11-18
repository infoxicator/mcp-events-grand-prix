import {describe,expect,it} from 'vitest';
import {createRace,stepRace} from '../src/race/physics';
import {getTrack} from '../src/race/track';
import {cornerService,jackLift,pitBox} from '../src/race/pit-service';

describe('pit service',()=>{
 it.each(['monza','las-vegas'] as const)('services simultaneous arrivals in separate boxes on %s',id=>{
  const race=createRace(3,id),track=getTrack(id);race.phase='racing';
  for(const team of ['a','b'] as const){
   Object.assign(race.cars[team],{distance:pitBox(track,team)-.01,offset:-18,pit:'entry',speed:3});
   race.cars[team].instruction.tyre=team==='a'?'hard':'soft';
  }
  stepRace(race);
  const {a,b}=race.cars;
  expect([a.pit,b.pit]).toEqual(['stopped','stopped']);expect(a.distance-b.distance).toBeCloseTo(28);
  for(let i=0;i<311;i++)stepRace(race);
  expect([a.pit,b.pit]).toEqual(['stopped','stopped']);
  stepRace(race);expect([a.pit,b.pit,a.compound,b.compound]).toEqual(['exit','exit','hard','soft']);
 });
 it('keeps the car lifted while any wheel is off and clears the guns before release',()=>{
  for(let i=0;i<4;i++){
   expect(cornerService(.20,i).gun).toBeGreaterThan(.5);
   expect(cornerService(.85,i).off).toBe(true);
   expect(cornerService(1.9,i).off).toBe(false);
   for(let tick=0;tick<=312;tick++){
    const t=tick/120,c=cornerService(t,i);
    if(c.off)expect(jackLift({distance:0,pit:'stopped',pitTime:t})).toBeCloseTo(.086);
   }
   expect(cornerService(2.6,i)).toEqual({off:false,remove:1,fit:1,gun:0});
  }
  expect(jackLift({distance:0,pit:'exit',pitTime:2.6})).toBe(0);
 });
});
