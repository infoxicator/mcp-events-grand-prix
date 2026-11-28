import {describe,expect,it} from 'vitest';
import {createRace,stepRace} from '../src/race/physics';
import {kerbHeight} from '../src/race/suspension';
import {grid,opponents} from '../src/race/grid';
import {advanceField} from '../src/race/field-physics';
import {getTrack} from '../src/race/track';
import {BOX_OFFSET,canRelease,garageVisits,pitRoute,cornerService,frontJackPose,jackLift,pitBox,releaseGreen,serviceClock} from '../src/race/pit-service';

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
 it.each(['monza','las-vegas'] as const)('clears the splitter and timing islands with the full car footprint on %s',id=>{
  const t=getTrack(id),race=createRace(3,id),start=t.PIT_ENTRY-150;
  race.phase='racing';race.field=[];
  for(const [a,b] of t.pitOpenings)for(let d=a;d<=b;d+=.5)
   expect(kerbHeight(t,d,-t.trackHalfWidth(d)-.55)).toBe(0);
  for(const [index,car] of Object.values(race.cars).entries()){
   Object.assign(car,{distance:start-index*18,offset:index?3:-3,speed:60});
   car.instruction.box=true;
  }
  // The timing island projects 1.44 m beyond the divider centre at -12 m.
  let closest=Infinity;const crossed=new Set<number>();
  const check=(id:number,d:number,offset:number,heading:number)=>{
   if(d+3<t.PIT_WALL_START||d-3>t.PIT_STOP+12)return;
   crossed.add(id);const rightEdge=offset+Math.abs(Math.cos(heading))+2.93*Math.abs(Math.sin(heading));
   closest=Math.min(closest,-13.44-rightEdge);
  };
  for(let i=0;i<3000;i++){
   stepRace(race);for(const [i,c] of Object.values(race.cars).entries())check(i,c.distance,c.offset,c.heading);
  }
  const ai=createRace(3,id);
  for(const [i,c] of ai.field.entries())Object.assign(c,{distance:start+(i%2)*t.LENGTH-i*6,speed:64,offset:i%2?3:-3});
  for(let i=0;i<1100;i++){
   advanceField(ai,t,1/30);for(const [i,c] of ai.field.entries())check(i+2,t.wrap(c.distance),c.offset,c.pitHeading??0);
  }
  expect(closest).toBeGreaterThan(.75);expect(crossed.size).toBe(22);
 });
 it.each(['monza','las-vegas'] as const)('parks every constructor at a unique garage off the through lane on %s',id=>{
  const t=getTrack(id),s=createRace(3,id);s.phase='racing';
  expect(new Set(grid.map(e=>pitBox(t,e.team))).size).toBe(11);
  for(const [i,c] of s.field.entries()){
   const box=pitBox(t,opponents[i].team)+(i%2)*t.LENGTH;
   Object.assign(c,{distance:box-.05,offset:BOX_OFFSET,speed:8});
  }
  s.cars.a.finishTime=s.cars.b.finishTime=0;
  const serviced=new Set<number>();
  for(let i=0;i<650;i++){
   advanceField(s,t,1/30);
   const active=new Set<string>();
   for(const [j,c] of s.field.entries())if(c.service>0){
    const name=opponents[j].team;expect(active.has(name)).toBe(false);active.add(name);
    expect(t.wrap(c.distance)).toBeCloseTo(pitBox(t,name));expect(c.offset).toBeCloseTo(BOX_OFFSET);
    serviced.add(j);
   }
   if(serviced.size===20)break;
  }
  expect(serviced.size).toBe(20);
 });
 for(const playerFirst of [true,false])it.each(['monza','las-vegas'] as const)('double-stacks Ferrari while through traffic passes on %s, player first '+playerFirst,id=>{
  const t=getTrack(id),s=createRace(3,id);s.phase='racing';
  const box=pitBox(t,'Ferrari'),a=s.cars.a,lec=s.field[opponents.findIndex(e=>e.code==='LEC')];
  const otherIndex=opponents.findIndex(e=>e.code==='HUL'),rival=s.field[otherIndex];
  for(const c of s.field)c.finishTime=0;
  s.cars.b.finishTime=0;
  Object.assign(a,{pit:'entry',distance:box-(playerFirst?.08:10),offset:BOX_OFFSET,speed:5,damage:[.5,0,0,0]});
  Object.assign(lec,{pit:'entry',distance:t.LENGTH+box-(playerFirst?10:.08),offset:BOX_OFFSET,speed:5,finishTime:null});
  Object.assign(rival,{distance:box+(otherIndex%2)*t.LENGTH-13,offset:-18,speed:18,finishTime:null});
  const order:string[]=[];let waited=false,passed=false;
  for(let i=0;i<2700;i++){
   stepRace(s);
   const aIn=a.pit==='stopped',lIn=lec.service>0;
   expect(aIn&&lIn).toBe(false);
   const visits=garageVisits(t,s.cars,s.field);
   if(aIn||lIn){
    const code=aIn?'HAM':'LEC';if(!order.includes(code))order.push(code);
    expect(visits.get('Ferrari')?.entry.code).toBe(code);
    if(order.length===1){
     const tail=playerFirst?lec:a;
     if(tail.speed<.1&&Math.abs(t.wrap(tail.distance)-box+7.5)<.1)waited=true;
     if(t.wrap(rival.distance)>box+6)passed=true;
     if(!playerFirst)expect(a.damage?.[0]).toBe(.5);
    }
   }
  }
  expect(waited).toBe(true);expect(passed).toBe(true);expect(order).toEqual(playerFirst?['HAM','LEC']:['LEC','HAM']);
  expect(a.stops).toBe(1);expect(a.damage).toBeUndefined();
  expect(pitRoute(t,box,box)).toBe(BOX_OFFSET);
 });
 it('keeps a crew at home when an older snapshot reports a stop at another garage',()=>{
  const race=createRace(),track=getTrack('monza');
  const index=opponents.findIndex(e=>e.code==='LEC');
  Object.assign(race.field[index],{pit:'stopped',service:1,distance:pitBox(track,'Mercedes'),offset:BOX_OFFSET});
  expect(garageVisits(track,race.cars,race.field).size).toBe(0);
 });
 it('pivots around the planted front jack and signals only after withdrawal',()=>{
  expect(frontJackPose(1.65)).toMatchObject({pivot:1,withdraw:0});
  for(let tick=0;tick<=312;tick++){
   const t=tick/120;
   if(!releaseGreen(t))continue;
   const jack=frontJackPose(t);expect(jack.withdraw).toBe(1);
   // The outer caster is .245 m from centre. Clear the car's full metre of half-span.
   expect(jack.x-.245).toBeGreaterThan(1.05);
   expect(jackLift({distance:0,pit:'stopped',pitTime:t})).toMatchObject({front:0,rear:0});
   for(let i=0;i<4;i++)expect(cornerService(t,i)).toEqual({off:false,remove:1,fit:1,gun:0});
  }
  expect(releaseGreen(2.55)).toBe(false);
  expect(releaseGreen(2.57)).toBe(true);
 });
 it('pitches nose-up during loading and settles after the drop',()=>{
  const car={distance:0,pit:'stopped',pitTime:.20};
  const lift=jackLift(car);expect(lift.front).toBeGreaterThan(lift.rear);
  car.pitTime=2.43;expect(jackLift(car).dropBounce).toBeLessThan(0);
  car.pitTime=2.65;expect(jackLift(car).dropBounce).toBe(0);
 });
 it('holds the jack and release signal throughout a damage repair',()=>{
  const car={distance:0,pit:'stopped',pitTime:5,totalStop:8.6};
  expect(jackLift(car)).toEqual({front:.086,rear:.086,dropBounce:0});
  expect(releaseGreen(serviceClock(car))).toBe(false);
  car.pitTime=8.57;
  expect(jackLift(car)).toMatchObject({front:0,rear:0});
  expect(canRelease(car)).toBe(false);
  car.pitTime=8.6;expect(canRelease(car)).toBe(true);
 });
 it('keeps the car lifted while any wheel is off and clears the guns before release',()=>{
  for(let i=0;i<4;i++){
   expect(cornerService(.20,i).gun).toBeGreaterThan(.5);
   expect(cornerService(.85,i).off).toBe(true);
   expect(cornerService(1.9,i).off).toBe(false);
   for(let tick=0;tick<=312;tick++){
    const t=tick/120,c=cornerService(t,i);
    if(c.off)expect(jackLift({distance:0,pit:'stopped',pitTime:t})).toEqual({front:.086,rear:.086,dropBounce:0});
   }
   expect(cornerService(2.6,i)).toEqual({off:false,remove:1,fit:1,gun:0});
  }
  expect(jackLift({distance:0,pit:'exit',pitTime:2.6})).toEqual({front:0,rear:0,dropBounce:0});
 });
});
