import {expect,it} from 'vitest';
import {advanceField,clearRacingLine} from '../src/race/field-physics';
import {createRace} from '../src/race/physics';
import {getTrack} from '../src/race/track';

function vegasPair(behind:number,ahead:number,gap:number,removeLeader=false){
 const race=createRace(3,'las-vegas'),track=getTrack('las-vegas');
 race.phase='racing';race.time=409.4;
 for(const car of [...race.field,...Object.values(race.cars)])car.finishTime=350;
 const follower=race.field[behind],leader=race.field[ahead];
 Object.assign(follower,{distance:8010.810,offset:4.534,speed:16.919,finishTime:null});
 Object.assign(leader,{distance:8010.810+gap,offset:4.547,speed:16.919,finishTime:removeLeader?350:null});
 const players=structuredClone(race.cars);
 for(let i=0;i<300;i++){
  const previous=follower.distance;race.time+=1/30;advanceField(race,track,1/30);
  expect(follower.distance).toBeGreaterThanOrEqual(previous);
 }
 expect(race.cars).toEqual(players);
 return {advance:follower.distance-8010.810,gap:leader.distance-follower.distance};
}
it.each([[13,15],[15,13]])('recovers the late Vegas overlap with follower %i and leader %i',(behind,ahead)=>{
 const actual=vegasPair(behind,ahead,.338),free=vegasPair(behind,ahead,.338,true);
 expect(actual.advance).toBeGreaterThan(free.advance*.9);
 expect(actual.gap).toBeGreaterThanOrEqual(5.7999);
});
it('breaks an exact same-station tie by stable grid precedence',()=>{
 const actual=vegasPair(15,13,0);
 expect(actual.gap).toBeGreaterThanOrEqual(5.7999);
 expect(actual.advance).toBeGreaterThan(270);
});

it('keeps space for an overlapping car through a racing-line change',()=>{
 const race=createRace(),a=race.field[0],b=race.field[1];
 Object.assign(a,{distance:500,speed:50,offset:-1});Object.assign(b,{distance:501,speed:50,offset:1.5});
 expect(clearRacingLine(a,3,5,[b])).toBeCloseTo(-.7);
 b.distance+=30;expect(clearRacingLine(a,3,5,[b])).toBe(3);
});
it('lets a field car follow the distance a moving player covered in this field tick',()=>{
 const r=createRace(3,'monza'),track=getTrack('monza'),a=r.cars.a,car=r.field[0],dt=1/30;
 r.field=[car];r.cars.b.finishTime=100;r.time=20;
 Object.assign(car,{distance:210,offset:-2,speed:42});Object.assign(a,{distance:210+5.8+42*dt,offset:-2,speed:42});
 advanceField(r,track,dt);expect(car.speed).toBeGreaterThan(40);
});
