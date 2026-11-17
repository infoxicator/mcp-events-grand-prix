import {describe,it,expect} from 'vitest';
import {AerialCameraRig,aerialStation} from '../src/race/aerial-camera';
import {getTrack,type Track} from '../src/race/track';
import {Vector3} from 'three';
const car=(distance:number,offset=0)=>({distance,offset});
const flat=()=>0;
const straight={pointAt:(d:number,offset=0)=>({x:offset,z:d})} as Track;
describe('stabilised helicopter tracking',()=>{
 it('frames a battle symmetrically across overtakes and fades to the leading car',()=>{
  for(const gap of [-100,-55,-1,0,1,55,100])expect(aerialStation(400+gap,400)).toBe(aerialStation(400,400+gap));
  expect(aerialStation(420,400)).toBe(410);expect(aerialStation(500,400)).toBe(500);
  expect(Math.abs(aerialStation(455.001,400)-aerialStation(454.999,400))).toBeLessThan(.003);
  // The old 55m battle threshold jumped the target by ~19m in one frame.
  const rig=new AerialCameraRig();rig.update(straight,car(454.999),car(400),flat,0);const before=rig.position.clone();
  rig.update(straight,car(455.001),car(400),flat,16.67);expect(rig.position.distanceTo(before)).toBeLessThan(.003);
 });
 it('does not weave with rapid lateral corrections or lead swaps on a straight',()=>{
  const rig=new AerialCameraRig();let last:Vector3|undefined,maxLateralStep=0;
  for(let i=0;i<600;i++){
   const d=200+i*70/60,jitter=Math.sin(i*.8)*1.5;
   rig.update(straight,car(d+Math.sin(i),jitter),car(d-Math.sin(i),jitter),flat,i*1000/60);
   if(last)maxLateralStep=Math.max(maxLateralStep,Math.abs(rig.position.x-last.x));last=rig.position.clone();
  }
  expect(maxLateralStep).toBeLessThan(.19); // raw lateral steps exceed 1m.
 });
 it('has frame-rate independent damping, reset on cuts and no long flight after a teleport',()=>{
  const sample=(fps:number)=>{const rig=new AerialCameraRig();rig.update(straight,car(0),car(-10),flat,0);for(let i=1;i<=fps;i++)rig.update(straight,car(100,2),car(90,2),flat,i*1000/fps);return rig;};
  expect(sample(30).position.distanceTo(sample(120).position)).toBeLessThan(1e-8);
  const rig=sample(60);rig.update(straight,car(4000),car(3990),flat,1016);expect(rig.target.z).toBe(3995);
  rig.reset();rig.update(straight,car(0),car(-10),flat,1033);expect(rig.target.z).toBe(-5);
 });
 it('keeps the cars centred even at the accelerated 18× test clock',()=>{
  const rig=new AerialCameraRig();
  for(let i=0;i<300;i++){
   const d=i*70*18/60;rig.update(straight,car(d),car(d-10),flat,i*1000/60);
   expect(rig.target.z).toBe(d-5);
  }
 });
 it.each(['monza','las-vegas'] as const)('stays finite and tracks turns across a full lap at %s',id=>{
  const track=getTrack(id),rig=new AerialCameraRig();let previous:Vector3|undefined,maxStep=0;
  for(let i=0;i<6000;i++){
   const d=i*track.LENGTH/5900;rig.update(track,car(d),car(d-15),flat,i*1000/60);
   expect(Number.isFinite(rig.position.length())).toBe(true);
   if(previous)maxStep=Math.max(maxStep,rig.position.distanceTo(previous));previous=rig.position.clone();
   expect(rig.position.distanceTo(rig.target)).toBeCloseTo(Math.hypot(75,100,190),8);
  }
  expect(maxStep).toBeLessThan(5);
 });
});
