import {MathUtils,Vector3} from 'three';
import type {Track} from './track';

/** A helicopter follows the road corridor, not the driver's steering corrections.
 * Symmetric battle framing avoids a focus jump every time the lead changes. */
export function aerialStation(a:number,b:number){
 const gap=a-b,leaderWeight=MathUtils.smoothstep(Math.abs(gap),35,90);
 return (a+b)/2+Math.abs(gap)*.5*leaderWeight;
}
export class AerialCameraRig {
 readonly position=new Vector3();
 readonly target=new Vector3();
 private heading=new Vector3();
 private wantedHeading=new Vector3();
 private wantedTarget=new Vector3();
 private lastTime:number|null=null;
 private offset=0;
 reset(){this.lastTime=null;}
 update(track:Track,a:{distance:number;offset:number},b:{distance:number;offset:number},heightAt:(d:number)=>number,now:number){
  // Weight toward whichever car is ahead, continuously, with an equal midpoint
  // for a close battle. Use unwrapped distances so the finish line is continuous.
  const gap=a.distance-b.distance,weight=.5+.5*Math.sign(gap)*MathUtils.smoothstep(Math.abs(gap),35,90);
  const d=aerialStation(a.distance,b.distance),wantedOffset=a.offset*weight+b.offset*(1-weight),p=track.pointAt(d,wantedOffset);
  const behind=track.pointAt(d-55),ahead=track.pointAt(d+55);
  this.wantedHeading.set(ahead.x-behind.x,0,ahead.z-behind.z).normalize();
  this.wantedTarget.set(p.x,heightAt(d)+.5,p.z);
  const dt=this.lastTime===null?0:Math.max(0,(now-this.lastTime)/1000);
  const cut=this.lastTime===null||dt>.75||this.target.distanceToSquared(this.wantedTarget)>300**2;
  if(cut){this.offset=wantedOffset;this.heading.copy(this.wantedHeading);}
  else{
   this.offset+=(wantedOffset-this.offset)*-Math.expm1(-dt/.18);
   // Damped yaw on the shortest arc, with no frame-rate-dependent lerp factor.
   const yaw=Math.atan2(this.heading.x,this.heading.z),wanted=Math.atan2(this.wantedHeading.x,this.wantedHeading.z);
   const turn=Math.atan2(Math.sin(wanted-yaw),Math.cos(wanted-yaw));
   const next=yaw+turn*-Math.expm1(-dt/.9);this.heading.set(Math.sin(next),0,Math.cos(next));
  }
  // Follow longitudinal travel directly (already interpolated by the network).
  // Damping this would leave the cars out of frame at the accelerated demo clock.
  const centre=track.pointAt(d,this.offset);this.target.set(centre.x,heightAt(d)+.5,centre.z);
  this.position.set(this.target.x-this.heading.x*75-this.heading.z*100,this.target.y+190,this.target.z-this.heading.z*75+this.heading.x*100);
  this.lastTime=now;return this;
 }
}
