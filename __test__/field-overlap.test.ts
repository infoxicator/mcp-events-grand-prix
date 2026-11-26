import {expect,it} from 'vitest';
import {advanceField,clearRacingLine} from '../src/race/field-physics';
import {createRace,stepRace} from '../src/race/physics';
import {createDriveSession,defaultDriveConfig,stepDriveSession} from '../src/race/drive-physics';
import {resolveTraffic} from '../src/race/crashes';
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


it.each(['strategy','manual'])('resolves all contact pairs in a four-car pack in %s mode',mode=>{
 const cfg=defaultDriveConfig();cfg.session='race';
 const session=createDriveSession(cfg),race=session.race;
 race.phase='racing';race.time=12;race.field=race.field.slice(0,2);
 const cars=[race.cars.a,race.cars.b,...race.field];
 cars.forEach((car,i)=>Object.assign(car,{distance:800+(i%2)*5.45,offset:Math.floor(i/2)*1.86,speed:1}));
 for(let tick=0;tick<8;tick++){
  if(mode==='strategy')stepRace(race);
  else stepDriveSession(session,{throttle:0,brake:0,steer:0,ersOvertake:false,drsToggle:false,shiftUp:false,shiftDown:false});
  for(let i=0;i<4;i++)for(const b of cars.slice(i+1)){
   const a=cars[i];expect(Math.abs(b.distance-a.distance)>5.615||Math.abs(b.offset-a.offset)>1.937).toBe(true);
  }
 }
});

it('separates a full congested grid across the lap boundary',()=>{
 const race=createRace(),track=getTrack('monza'),cars=[race.cars.a,race.cars.b,...race.field];
 cars.forEach((c,i)=>Object.assign(c,{distance:track.LENGTH*(i%2)+.03*i,offset:.20*i,speed:0}));
 resolveTraffic(cars,cars.map((_,i)=>String(i)),track,10,0);
 for(const [i,a] of cars.entries())for(const b of cars.slice(i+1)){
  const along=Math.abs(track.wrap(a.distance-b.distance+track.LENGTH/2)-track.LENGTH/2);
  expect(along>=5.61999||Math.abs(a.offset-b.offset)>=1.93999).toBe(true);
 }
});

it.each(['manual','strategy'])('separates a rotated rear-quarter strike with a field car in %s mode',mode=>{
 const config=defaultDriveConfig();config.session='race';
 const session=createDriveSession(config),race=session.race,player=race.cars.a,other=race.field[0];
 race.phase='racing';race.time=11;race.field=[other];race.cars.b.finishTime=10;
 Object.assign(player,{distance:704,offset:.6,speed:50,heading:.22});
 Object.assign(other,{distance:709,offset:1.58,speed:27,impactYaw:-.09});
 if(mode==='strategy')stepRace(race);
 else stepDriveSession(session,{throttle:0,brake:0,steer:0,ersOvertake:false,drsToggle:false,shiftUp:false,shiftDown:false});
 // Project actual chassis corners independently of the solver's interval radii.
 const corners=(d:number,x:number,yaw:number)=>[-2.81,2.81].flatMap(z=>[-.97,.97].map(w=>({
  x:x+w*Math.cos(yaw)-z*Math.sin(yaw),z:d+z*Math.cos(yaw)+w*Math.sin(yaw)
 })));
 const yaw=other.impactYaw??0;
 const a=corners(player.distance,player.offset,player.heading),b=corners(other.distance,other.offset,yaw);
 const axes=[player.heading,yaw].flatMap(t=>[t,t+Math.PI/2]);
 expect(axes.some(t=>{
  const dot=(p:{x:number;z:number})=>Math.cos(t)*p.x+Math.sin(t)*p.z;
  const av=a.map(dot),bv=b.map(dot);
  return Math.max(...av)<=Math.min(...bv)+1e-5||Math.max(...bv)<=Math.min(...av)+1e-5;
 })).toBe(true);
 expect(other.lastImpact).toBeDefined();expect(player.lastImpact).toBeDefined();
});
