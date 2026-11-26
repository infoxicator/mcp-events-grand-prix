import {it,expect} from 'vitest';
import {getTrack} from '../src/race/track';
import {createRace,stepRace,drsAllowed,DT} from '../src/race/physics';
import {mockDriver,mockEngineer} from '../src/race/brains';
import {RaceRoom} from '../server/race-room';
import {sparkContact} from '../src/race/sparks';
const vegas=getTrack('las-vegas');
it('projects the real Vegas geometry without scaling, within 1% of 6201m, with 17 turns and ordered sectors',()=>{
 expect(Math.abs(vegas.LENGTH/6201-1)).toBeLessThan(.01);expect(vegas.pointAt(0)).toEqual(vegas.pointAt(vegas.LENGTH));expect(vegas.CORNERS).toHaveLength(17);expect(vegas.SECTORS).toEqual([...vegas.SECTORS].sort((a,b)=>a-b));expect(vegas.night).toBe(true);
 let length=0;for(let d=2;d<vegas.LENGTH;d+=2){const a=vegas.pointAt(d-2),b=vegas.pointAt(d);length+=Math.hypot(b.x-a.x,b.z-a.z);expect(Number.isFinite(vegas.racingCurvature(d))).toBe(true);}expect(length/vegas.LENGTH).toBeGreaterThan(.99);
});
it('Vegas DRS eligibility is zone-specific and cannot use Monza activation points',()=>{
 const c=createRace(3,'las-vegas').cars.a;c.eligible=[true,false];c.distance=vegas.DRS_ZONES[0].start+50;expect(drsAllowed(c,vegas)).toBe(true);c.distance=vegas.DRS_ZONES[1].start+50;expect(drsAllowed(c,vegas)).toBe(false);c.eligible=[false,true];expect(drsAllowed(c,vegas)).toBe(true);c.brake=.3;expect(drsAllowed(c,vegas)).toBe(false);
});
it('independent Monza and Vegas rooms have independent physics, and only owners can change circuit',async()=>{
 const a=new RaceRoom('a','http://localhost',{JEV_MOCK:'1'}),b=new RaceRoom('b','http://localhost',{JEV_MOCK:'1'},4,'jev-vs-luna',{},'las-vegas');
 const guest=b.add(()=>{});b.join(guest,'b',b.tokens.b);await b.message(guest,{type:'circuit',circuit:'monza'});expect(b.race.circuit).toBe('las-vegas');const owner=b.add(()=>{});b.join(owner,null,b.tokens.owner);b.race.tick=99;await b.message(owner,{type:'circuit',circuit:'monza'});expect(b.race.circuit).toBe('monza');expect(b.race.tick).toBe(0);await b.message(owner,{type:'circuit',circuit:'las-vegas'});await b.message(owner,{type:'reset'});expect(b.race.circuit).toBe('las-vegas');expect(a.race.circuit).toBe('monza');expect(getTrack().LENGTH).toBeLessThan(vegas.LENGTH);
 const m=createRace(1),v=createRace(1,'las-vegas');m.phase=v.phase='racing';m.cars.a.distance=v.cars.a.distance=6000;m.cars.a.speed=v.cars.a.speed=60;stepRace(m);stepRace(v);expect(m.cars.a.lap).toBe(1);expect(v.cars.a.lap).toBe(0);
});
it('Vegas runs deterministic full strategic races with lap timing and both tyre stops',()=>{
 const run=()=>{const s=createRace(3,'las-vegas');s.phase='racing';for(let i=0;i<500/DT&&(s.phase as string)!=='finished';i++){if(i%24===0)for(const t of ['a','b'] as const){if(i%1440===0)s.cars[t].instruction=mockEngineer(s,t);s.cars[t].intent=mockDriver(s,t);}stepRace(s);}return s;};const a=run(),b=run();expect(a).toEqual(b);expect(a.phase).toBe('finished');for(const c of Object.values(a.cars)){expect(c.lapTimes).toHaveLength(3);expect(c.stops).toBeGreaterThanOrEqual(1);
 const repairs=a.events.filter(e=>e.team===c.team&&e.kind==='pit'&&e.message.includes('DAMAGE REPAIRED'));
 expect(c.stops).toBeLessThanOrEqual(1+repairs.length);
 expect(c.lapTimes.every(t=>t>70&&t<150)).toBe(true);}
});
it('titanium sparks require high speed and road excitation, and stay off in the pit lane',()=>{
 expect(sparkContact(30,100)).toBe(0);expect(sparkContact(90,100,'entry')).toBe(0);const samples=Array.from({length:200},(_,d)=>sparkContact(90,d));expect(Math.max(...samples)).toBeGreaterThan(.3);expect(samples.filter(x=>x===0).length).toBeGreaterThan(50);
});
