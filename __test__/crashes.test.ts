import {describe,expect,it} from 'vitest';
import {BufferGeometry,BufferAttribute,Mesh,Vector3} from 'three';
import {bindBodyDamage} from '../src/race/damaged-body';
import {barrierFace,damageLevel,trafficImpact} from '../src/race/crashes';
import {mockEngineer} from '../src/race/brains';
import {createRace,damageRepairSeconds,DT,stepRace} from '../src/race/physics';
import {pitBox} from '../src/race/pit-service';
import {getTrack,type CircuitId} from '../src/race/track';

function setup(id:CircuitId){
 const race=createRace(3,id);
 race.phase='racing';race.field=[];
 Object.assign(race.cars.a,{distance:1800,speed:55,offset:0});
 Object.assign(race.cars.b,{distance:2400,speed:45});
 return race;
}
describe.each(['monza','las-vegas'] as const)('%s player impacts',id=>{
 const track=getTrack(id);
 it('contains a wall strike on the contacted side and leaves room for runoff',()=>{
  const race=setup(id),car=race.cars.a,wall=barrierFace(track,car.distance,1);
  car.offset=wall-1.1;car.heading=-.18;
  stepRace(race);
  expect(car.damage?.[0]).toBeGreaterThan(0);expect(car.damage?.slice(1)).toEqual([0,0,0]);
  expect(car.offset).toBeLessThan(wall-1);expect(car.speed).toBeLessThan(54);
  expect(race.events.filter(e=>e.kind==='collision')).toHaveLength(1);
  const clean=setup(id);clean.cars.a.offset=track.trackHalfWidth(1800)-1;
  stepRace(clean);expect(clean.cars.a.damage).toBeUndefined();
 });
 it('detects the splitter nose and allows the normal entry on both sides',()=>{
  for(const offset of [-12,-18,0]){
   const race=setup(id),car=race.cars.a;
   Object.assign(car,{offset,distance:track.PIT_WALL_START-2.9,speed:20,pit:offset===-18?'entry':'none'});
   stepRace(race);expect(!!car.damage).toBe(offset===-12);
  }
 });
 it('damages the nose and tail of the two players on the same racing tick',()=>{
  const race=setup(id),{a,b}=race.cars;
  Object.assign(b,{distance:a.distance+5.7,speed:22,offset:.6});
  stepRace(race);
  expect(a.damage?.[0]).toBeGreaterThan(0);expect(b.damage?.[3]).toBeGreaterThan(0);
  expect(a.speed).toBeLessThan(55);expect(b.speed).toBeGreaterThan(22);
  expect(a.speed+b.speed).toBeCloseTo(77,0);expect(a.speed).toBeLessThan(b.speed);
  expect(race.events.filter(e=>e.kind==='collision')).toHaveLength(2);
  stepRace(race);expect(race.events.filter(e=>e.kind==='collision')).toHaveLength(2);
 });
 it('detects a catch from behind against moving field traffic',()=>{
  const race=setup(id),car=race.cars.a;
  race.field=[{distance:car.distance+10,offset:0,speed:22,service:0,finishTime:null}];
  for(let i=0;i<60&&!car.damage;i++)stepRace(race);
  expect(damageLevel(car.damage)).toBeGreaterThan(0);
  expect(race.events.some(e=>e.kind==='collision'&&e.message.includes('ANT'))).toBe(true);
 });
 it('transmits a lateral impulse to a moving field opponent, then recovers grip',()=>{
  const r=setup(id),a=r.cars.a;
  const field={distance:a.distance+.8,offset:1.95,speed:a.speed,service:0,finishTime:null,impactSideSpeed:0};
  r.field=[field];a.lateralVelocity=7;stepRace(r);
  expect(field.impactSideSpeed).toBeGreaterThan(3);
  const beginning=field.offset;a.finishTime=r.time;
  for(let i=0;i<8;i++)stepRace(r);
  expect(field.offset).toBeGreaterThan(beginning);
  for(let i=0;i<240;i++)stepRace(r);
  expect(field.impactSideSpeed).toBeUndefined();
 });
 it('detects side contact across a lap boundary, ignores near misses, separating cars and classified cars',()=>{
  const race=setup(id),{a,b}=race.cars;
  Object.assign(b,{distance:a.distance+track.LENGTH+1,offset:1.95,speed:55});
  a.lateralVelocity=4;
  expect(trafficImpact(a,b,track,DT,'RUS')?.closing).toBe(4);
  b.offset=2.1;expect(trafficImpact(a,b,track,DT,'RUS')).toBeUndefined();
  b.offset=1.935;a.lateralVelocity=-8;b.speed=32;expect(trafficImpact(a,b,track,DT,'RUS')).toBeUndefined();
  a.lateralVelocity=1;expect(trafficImpact(a,b,track,DT,'RUS')).toBeUndefined();
  b.finishTime=50;a.lateralVelocity=9;expect(trafficImpact(a,b,track,DT,'RUS')).toBeUndefined();
 });
 it('keeps damage and reduced acceleration until the completed service restores the car',()=>{
  const race=setup(id),car=race.cars.a;
  Object.assign(race.cars.b,{distance:car.distance+5.7,speed:22,offset:.6});
  stepRace(race);race.cars.b.distance+=400;
  const panels=structuredClone(car.damage);expect(panels).toBeDefined();
  const clean=structuredClone(race);delete clean.cars.a.damage;
  for(const a of [car,clean.cars.a]){a.distance=200;a.speed=15;a.throttle=1;}
  for(let i=0;i<120;i++){stepRace(race);stepRace(clean);}
  expect(car.speed).toBeLessThan(clean.cars.a.speed-.2);expect(car.damage).toEqual(panels);
  car.instruction=mockEngineer(race,'a');expect(car.instruction.box).toBe(true);
  Object.assign(car,{distance:track.PIT_ENTRY-.05,speed:20,heading:0,offset:0});
  stepRace(race);expect(car.pit).toBe('entry');expect(car.damage).toEqual(panels);
  Object.assign(car,{distance:pitBox(track,'a')-.01,speed:3,offset:-18});
  stepRace(race);expect(car.pit).toBe('stopped');
  const serviceSeconds=track.PIT_STOP_SECONDS+damageRepairSeconds(panels);
  expect(serviceSeconds).toBeGreaterThan(track.PIT_STOP_SECONDS);
  for(let i=1;i<Math.round(serviceSeconds/DT);i++)stepRace(race);
  expect(car.damage).toEqual(panels);stepRace(race);
  expect(car.pit).toBe('exit');expect(car.damage).toBeUndefined();
  expect(car.stops).toBe(1);expect(race.events.at(-1)?.message).toContain('DAMAGE REPAIRED');
 });
});

it('folds rotated and translated decals with the laminate, and restores their exact positions',()=>{
 const make=()=>{
  const g=new BufferGeometry();
  g.setAttribute('position',new BufferAttribute(new Float32Array(3),3));
  g.setAttribute('normal',new BufferAttribute(new Float32Array([0,1,0]),3));
  return new Mesh(g);
 };
 const laminate=make(),decal=make(),point=new Vector3(-.9,.22,2.5);
 decal.position.set(-.31,.94,.10);decal.rotation.set(.12,.24,-.08);decal.scale.set(.8,1.2,1);
 const meshes=[laminate,decal];
 const bindings=meshes.map(mesh=>{
  mesh.updateMatrixWorld();const local=mesh.worldToLocal(point.clone());
  mesh.geometry.getAttribute('position').setXYZ(0,local.x,local.y,local.z);
  return bindBodyDamage(mesh)!;
 });
 const positions=()=>meshes.map(mesh=>mesh.localToWorld(new Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'),0)));
 const before=positions();
 for(const deform of bindings)deform([1,0,0,0]);
 const [wing,ink]=positions();expect(wing.distanceTo(ink)).toBeLessThan(1e-6);expect(wing.y-point.y).toBeGreaterThan(.2);
 for(const deform of bindings)deform([0,0,0,0]);
 expect(positions()).toEqual(before);
});
