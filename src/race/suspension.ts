import {MathUtils} from 'three';
import type {Track} from './track';

export const wheelStations=[
 {name:'FrontL',x:-.8175,z:1.55},{name:'FrontR',x:.8175,z:1.55},
 {name:'RearL',x:-.7675,z:-2.05},{name:'RearR',x:.7675,z:-2.05}
] as const;

interface LoadState {distance:number;speed:number;offset?:number;heading?:number;acceleration?:number;lateralG?:number;drs?:boolean}

/** Height above the asphalt of the kerb cross-section in build_circuits.py. */
export function kerbHeight(track:Track,station:number,offset:number){
 const night=track.night,width=night?.85:1.1;
 const edge=Math.abs(offset)-track.trackHalfWidth(station);
 if(edge<=0||edge>=width)return 0;
 const d=track.wrap(station);
 for(const corner of track.CORNERS){
  if(corner.speed>78)continue;
  const parabolica=corner.name==='Parabolica';
  const from=corner.d-(night?18:parabolica?140:45),to=corner.d+(night?25:parabolica?180:70);
  if(d<from||d>to)continue;
  const phase=(d-from)%1.8;
  // The tyre footprint rounds off the leading edge of each raised bar.
  const rib=night?0:Math.max(0,1-Math.abs(((phase+.05)%.6)-.38)/.16)
   *MathUtils.smoothstep(edge,.10,.20)*(1-MathUtils.smoothstep(edge,.90,1.01));
  const top=.02+(night?.025:.07)*edge/width;
  return (top+rib*Math.max(0,.10-.05*edge-top))*MathUtils.smoothstep(edge,0,.10)
   *(1-MathUtils.smoothstep(edge,width-.12,width))*Math.min(1,d-from,to-d);
 }
 return 0;
}

export class Suspension {
 pitch=0;roll=0;heave=0;flap=0;
 readonly heights=[0,0,0,0];
 readonly compression=[.007,.007,.007,.007];
 private time:number|null=null;
 private distance=0;
 update(track:Track,c:LoadState,now:number,studio:boolean){
  const dt=this.time===null?Infinity:(now-this.time)/1000;
  const cut=studio||dt<0||dt>.45||Math.abs(c.distance-this.distance)>40;
  const response=cut?1:-Math.expm1(-dt/.085);
  const accel=studio?0:c.acceleration??0,lateral=studio?0:c.lateralG??0;
  const pressure=studio?0:Math.min(1,c.speed*c.speed/8100),yaw=c.heading??0,cs=Math.cos(yaw),sn=Math.sin(yaw);
  for(const [i,w] of wheelStations.entries()){
   const station=c.distance+w.z*cs-w.x*sn,offset=(c.offset??0)-w.x*cs-w.z*sn;
   this.heights[i]=studio?0:kerbHeight(track,station,offset);
   this.compression[i]=MathUtils.clamp(.007+pressure*.009+(i<2?-1:1)*accel*.00023+Math.sign(w.x)*lateral*.0012,.003,.025);
  }
  const [fl,fr,rl,rr]=this.heights;
  // +Z points forward. Positive X rotation lowers the nose, positive Z raises the right sill.
  const pitch=MathUtils.clamp(-accel*.00079+(rl+rr-fl-fr)*.095,-.024,.033);
  const roll=MathUtils.clamp(-lateral*.0039+(fr+rr-fl-rl)*.19,-.039,.039);
  this.pitch+=(pitch-this.pitch)*response;this.roll+=(roll-this.roll)*response;
  this.heave+=((fl+fr+rl+rr)*.16-pressure*.016-this.heave)*response;
  const flapTarget=!studio&&c.drs?-.43:0;
  const flapRate=flapTarget===0?5.1:2.9;
  this.flap=cut?flapTarget:MathUtils.clamp(flapTarget,this.flap-dt*flapRate,this.flap+dt*flapRate);
  this.time=now;this.distance=c.distance;
 }
}
