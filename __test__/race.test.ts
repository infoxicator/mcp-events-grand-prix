import {describe,it,expect} from 'vitest';
import {getTrack} from '../src/race/track';
const {LENGTH,OFFICIAL_LENGTH,pointAt,DRS_ZONES,PIT_STOP_SECONDS,PIT_LIMIT}=getTrack();
import {createRace,stepRace,DT,aero,drsAllowed,grip} from '../src/race/physics';
import {mockDriver,mockEngineer} from '../src/race/brains';
function run(seconds:number,s=createRace()){s.phase='racing';for(let i=0;i<seconds/DT;i++){if(i%24===0)for(const t of ['a','b'] as const){if(i%1440===0)s.cars[t].instruction=mockEngineer(s,t);s.cars[t].intent=mockDriver(s,t);}stepRace(s);}return s;}
describe('real Monza geometry',()=>{it('projects within 1% of official length and closes',()=>{expect(LENGTH/OFFICIAL_LENGTH).toBeCloseTo(1,2);expect(pointAt(0)).toEqual(pointAt(LENGTH));});});
describe('deterministic fixed-step race',()=>{
 it('reproduces exactly and counts laps and sector splits',()=>{const a=run(160),b=run(160);expect(a).toEqual(b);expect(a.cars.a.lap).toBeGreaterThanOrEqual(1);expect(a.cars.a.bestLap).toBeGreaterThan(40);expect(a.cars.a.splits.filter(Boolean).length).toBe(3);});
 it('allows DRS only with detection eligibility inside its corresponding zone',()=>{const c=createRace().cars.a;c.distance=DRS_ZONES[0].start+20;expect(drsAllowed(c)).toBe(false);c.eligible[0]=true;expect(drsAllowed(c)).toBe(true);c.distance=1500;expect(drsAllowed(c)).toBe(false);c.distance=3000;c.pit='entry';expect(drsAllowed(c)).toBe(false);});
 it('latches eligibility at detection and rejects a >1 second gap',()=>{for(const gap of [35,150]){const s=createRace();s.phase='racing';s.cars.b.distance=DRS_ZONES[0].detection-.1;s.cars.b.speed=65;s.cars.a.distance=s.cars.b.distance+gap;s.cars.a.speed=65;stepRace(s);expect(s.cars.b.eligible[0]).toBe(gap===35);}});
 it('tyre wear, temperature and fuel change grip and pace',()=>{const s=run(20);expect(s.cars.a.wear).toBeGreaterThan(0);expect(s.cars.a.fuel).toBeLessThan(34);const g=grip(s.cars.a);s.cars.a.wear=1;expect(grip(s.cars.a)).toBeLessThan(g);});
 it('slipstream rewards a following car and dirty air reduces cornering grip',()=>{const s=createRace(),c=s.cars.b,r=s.cars.a;c.distance=r.distance-25;c.offset=r.offset;expect(aero(c,r).slipstream).toBeGreaterThan(0);expect(aero(c,r).dirtyAir).toBeGreaterThan(0);c.offset=8;expect(aero(c,r).slipstream).toBe(0);});
 it('stops for exactly 2.6s, fits tyres and enforces the limiter',()=>{const s=createRace();s.phase='racing';const c=s.cars.a;c.pit='stopped';c.instruction.tyre='hard';c.wear=.7;for(let i=0;i<Math.round(PIT_STOP_SECONDS/DT)-1;i++)stepRace(s);expect(c.stops).toBe(0);stepRace(s);expect(c.stops).toBe(1);expect(c.compound).toBe('hard');expect(c.wear).toBe(0);run(4,s);expect(c.speed).toBeLessThanOrEqual(PIT_LIMIT);});
 it('issues track-limit warnings and five-second penalties',()=>{const s=createRace();s.phase='racing';s.cars.a.offset=12;s.cars.a.intent.offset=12;for(let i=0;i<12/DT;i++)stepRace(s);expect(s.cars.a.warnings).toBeGreaterThanOrEqual(3);expect(s.cars.a.penalty).toBe(5);});
});
describe('two-speed mock agents',()=>{
 it('engineer calls the undercut; the fast driver obeys manage and attack',()=>{const s=createRace();s.cars.a.distance=4400;const call=mockEngineer(s,'a');expect(call.box).toBe(true);expect(call.tyre).toBe('hard');expect(call.line).toContain('undercut');s.cars.a.instruction={...call,pace:'manage',tactic:'attack',ers:'deploy'};s.cars.b.distance=4430;const d=mockDriver(s,'a');expect(d.speedBias).toBeLessThan(0);expect(d.side).not.toBe('hold');expect(d.ers).toBe(true);});
 it('has distinct driver personalities and completes a full strategic race',()=>{const s=run(420);expect(s.phase).toBe('finished');expect(s.winner).toBeTruthy();for(const t of ['a','b'] as const){expect(s.cars[t].stops).toBe(1);expect(s.cars[t].lapTimes.length).toBe(3);}expect(mockDriver(s,'a').reply).not.toBe(mockDriver(s,'b').reply);});
});

it('reports an on-track duel pass and suppresses position changes at the flag or in the pits',()=>{
 for(const situation of ['track','finish','pit'] as const){
  const r=createRace();r.phase='racing';r.leader='a';
  Object.assign(r.cars.a,{distance:400,speed:48,offset:-2});
  Object.assign(r.cars.b,{distance:404,speed:50,offset:2});
  if(situation==='finish')r.cars.b.finishTime=309.1;
  if(situation==='pit')r.cars.b.pit='entry';
  stepRace(r);
  expect(r.events.some(e=>e.kind==='overtake')).toBe(situation==='track');
  expect(r.phase).toBe('racing');
 }
});
