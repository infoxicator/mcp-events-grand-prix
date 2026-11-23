import {describe,it,expect} from 'vitest';
import {TrackingCameraRig,SIDE_CAMERA,CHASE_CAMERA} from '../src/race/tracking-camera';
import {getTrack,type Track} from '../src/race/track';
import {Vector3} from 'three';
const straight={pointAt:(d:number,offset=0)=>({x:offset,z:d})} as Track;
const car=(distance:number,offset=0)=>({distance,offset});
describe('continuous side and chase cameras',()=>{
 it.each([SIDE_CAMERA,CHASE_CAMERA])('has no anchor relocation, lead-swap or 55m framing jump (%j)',lens=>{
  const rig=new TrackingCameraRig(lens);let previous:Vector3|undefined,maxSpeed=0;
  for(let i=0;i<1800;i++){
   const t=i/60,d=t*70,gap=60*Math.sin(t*.5);
   rig.update(straight,car(d+gap/2),car(d-gap/2),()=>0,t*1000);
   if(previous)maxSpeed=Math.max(maxSpeed,rig.position.distanceTo(previous)*60);previous=rig.position.clone();
   expect(rig.position.x).toBe(-lens.side);expect(rig.position.y-rig.target.y).toBe(lens.height);
   expect(rig.position.z-rig.target.z).toBeCloseTo(-lens.back,8);
  }
  expect(maxSpeed).toBeLessThan(90); // Old side shot jumped ~175m in one frame.
 });
 it('absorbs a compressed side-camera snapshot and stays with an accelerated pack',()=>{
  const rig=new TrackingCameraRig(SIDE_CAMERA);
  let station=0,now=0;
  function advance(metres:number){
   const previous=rig.position.clone();station+=metres;now+=8;
   rig.update(straight,car(station),car(station),()=>0,now);
   return rig.position.distanceTo(previous)/.008;
  }
  for(let frame=0;frame<60;frame++)advance(.28);
  expect(advance(1.184)).toBeLessThan(100);
  expect(advance(.72)).toBeLessThan(100);
  for(let frame=0;frame<60;frame++){
   advance(10);expect(Math.abs(station-rig.target.z)).toBeLessThanOrEqual(2);
  }
 });
 it.each(['monza','las-vegas'] as const)('tracks a complete accelerated lap at %s with a fixed lens',id=>{
  const track=getTrack(id),rig=new TrackingCameraRig(SIDE_CAMERA);
  for(let i=0;i<2000;i++){
   const d=i*track.LENGTH/1950;rig.update(track,car(d),car(d-12),()=>0,i*1000/60);
   expect(Number.isFinite(rig.position.length())).toBe(true);
   expect(rig.position.distanceTo(rig.target)).toBeCloseTo(Math.hypot(SIDE_CAMERA.back,SIDE_CAMERA.side,SIDE_CAMERA.height),8);
   expect(rig.lens.fov).toBe(48);
  }
 });
});
