import {it,expect} from 'vitest';
import {VEHICLE,forces,brakeCapacity,cornerLimit,drivetrain} from '../src/race/vehicle';
import {createRace,stepRace,DT} from '../src/race/physics';
import {LENGTH,pointAt,tangentAt,racingLineOffset,trackHalfWidth} from '../src/race/track';
it('downforce and drag grow with speed squared, with physical DRS and tow reductions',()=>{
 const slow=forces(40,820,1),fast=forces(80,820,1);expect(fast.drag/slow.drag).toBeCloseTo(4);expect(fast.downforce/slow.downforce).toBeCloseTo(4);
 expect(forces(80,820,1,true).drag).toBeLessThan(fast.drag);expect(forces(80,820,1,false,.8).drag).toBeLessThan(fast.drag);expect(forces(80,820,1,false,0,.2).downforce).toBeLessThan(fast.downforce);
});
it('braking shares tyre capacity with cornering and increases with aero load',()=>{
 expect(brakeCapacity(85,820,1)).toBeGreaterThan(brakeCapacity(30,820,1));expect(brakeCapacity(50,820,1,25)).toBeLessThan(brakeCapacity(50,820,1));expect(brakeCapacity(100,820,1)).toBeLessThanOrEqual(VEHICLE.maxBrakeG*9.81);
 expect(cornerLimit(.02,820,.7)).toBeLessThan(cornerLimit(.02,820,1));
});
it('ERS contributes power at high speed while launch is traction limited',()=>{
 const base=drivetrain(85,820,1,false,false,0,0,0),ers=drivetrain(85,820,1,true,false,0,0,0);expect((ers.maxDrive-base.maxDrive)*85).toBeCloseTo(120000);
 const launch=drivetrain(2,820,1,true,false,0,0,0);expect(launch.maxDrive).toBeLessThan(15000);
});
it('smoothed track remains closed, within 1% length, with continuous headings and bounded racing line',()=>{
 let length=0,last=pointAt(0);for(let d=2;d<=LENGTH;d+=2){const p=pointAt(d);length+=Math.hypot(p.x-last.x,p.z-last.z);last=p;expect(Math.abs(racingLineOffset(d))).toBeLessThan(trackHalfWidth(d)-1);const a=tangentAt(d-.01),b=tangentAt(d+.01);expect(a.x*b.x+a.z*b.z).toBeGreaterThan(.999);}
 expect(length/LENGTH).toBeGreaterThan(.99);expect(pointAt(0)).toEqual(pointAt(LENGTH));
});
it('clean fresh-tyre flying lap stays on circuit with bounded tyre forces and finite steering',()=>{
 const s=createRace(2);s.phase='racing';const c=s.cars.a;s.cars.b.distance=-1000;c.instruction.pace='push';c.instruction.ers='deploy';c.intent.ers=true;c.intent.brakeAggression=.85;
 let maxOffset=0,maxG=0;for(let i=0;i<210/DT&&c.lap<2;i++){c.wear=0;c.temperature=95;c.fuel=10;stepRace(s);maxOffset=Math.max(maxOffset,Math.abs(c.offset));maxG=Math.max(maxG,Math.abs(c.lateralG));expect(Number.isFinite(c.heading)).toBe(true);expect(Math.abs(c.steering)).toBeLessThanOrEqual(.42);}
 expect(c.lapTimes).toHaveLength(2);expect(c.lapTimes[1]).toBeGreaterThan(75);expect(c.lapTimes[1]).toBeLessThan(90);expect(maxOffset).toBeLessThan(5.9);expect(maxG).toBeLessThanOrEqual(5.50001);
});
it('an excessive entry speed saturates lateral grip instead of locking the car to the line',()=>{
 const s=createRace();s.phase='racing';const c=s.cars.a;c.distance=930;c.speed=95;c.wear=.8;c.offset=0;s.cars.b.distance=-500;for(let i=0;i<120;i++)stepRace(s);
 expect(Math.abs(c.offset)).toBeGreaterThan(1);expect(Math.abs(c.lateralG)).toBeLessThanOrEqual(5.50001);expect(c.speed).toBeLessThan(95);
});
