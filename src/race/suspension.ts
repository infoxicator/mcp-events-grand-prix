import {MathUtils} from 'three';
import {pavementHeight} from './pavement';
import type {Track} from './track';

export const wheelStations=[
 {name:'FrontL',x:-.8475,z:1.55},{name:'FrontR',x:.8475,z:1.55},
 {name:'RearL',x:-.7675,z:-2.05},{name:'RearR',x:.7675,z:-2.05}
] as const;

interface LoadState {distance:number;speed:number;offset?:number;heading?:number;acceleration?:number;lateralG?:number;drs?:boolean}

/** Height above the asphalt of the kerb cross-section in build_circuits.py. */
export function kerbHeight(track:Track,station:number,offset:number){
 const night=track.night,width=night?.85:1.1;
 const edge=Math.abs(offset)-track.trackHalfWidth(station);
 if(edge<=0||edge>=width)return 0;
 const d=track.wrap(station);
 if(offset<0&&track.pitOpenings.some(([a,b])=>d>=a&&d<=b))return 0;
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

// Sprung-body modes. Integrate at a bounded step so a short kerb strike
// compresses the tyre before the tub follows and the damper settles it.
class RideMode {
 value=0;
 velocity=0;
 constructor(private omega:number,private damping:number){}
 follow(target:number,dt:number,cut:boolean){
  if(cut){this.value=target;this.velocity=0;return;}
  this.velocity+=(this.omega**2*(target-this.value)-2*this.damping*this.omega*this.velocity)*dt;
  this.value+=this.velocity*dt;
 }
}
export class Suspension {
 private vertical=new RideMode(2*Math.PI*4.6,.61);
 private longitudinal=new RideMode(2*Math.PI*3.9,.73);
 private transverse=new RideMode(2*Math.PI*4.1,.70);
 get heave(){return this.vertical.value;}
 get pitch(){return this.longitudinal.value;}
 get roll(){return this.transverse.value;}
 flap=0;
 readonly heights=[0,0,0,0];
 readonly compression=[.007,.007,.007,.007];
 private time:number|null=null;
 private distance=0;
 private offset=0;
 update(track:Track,c:LoadState,now:number,studio:boolean){
  const dt=this.time===null?Infinity:(now-this.time)/1000;
  const cut=studio||dt<0||dt>.20||Math.abs(c.distance-this.distance)>40;
  const accel=studio?0:c.acceleration??0,lateral=studio?0:c.lateralG??0;
  const pressure=studio?0:Math.min(1,c.speed*c.speed/8100);
  const yaw=c.heading??0,cs=Math.cos(yaw),sn=Math.sin(yaw),offset=c.offset??0;
  // Sample along the travelled path, including the rear axle's later arrival.
  // Avoid sampling the springs more often than necessary on a stopped frame.
  const steps=cut?1:Math.max(1,Math.ceil(dt*180)),step=cut?0:dt/steps;
  for(let n=1;n<=steps;n++){
   const t=cut?1:n/steps,d=this.distance+(c.distance-this.distance)*t,x=this.offset+(offset-this.offset)*t;
   for(let i=0;i<4;i++){
    const w=wheelStations[i],station=d+w.z*cs-w.x*sn,lane=x-w.x*cs-w.z*sn;
    const height=studio?0:pavementHeight(track,station,lane)+kerbHeight(track,station,lane);
    const bumpRate=step>0?(height-this.heights[i])/step:0;
    this.heights[i]=height;
    const load=.007+pressure*.009+(i<2?-1:1)*accel*.00023+Math.sign(w.x)*lateral*.0012;
    const compression=MathUtils.clamp(load+MathUtils.clamp(bumpRate*.004,-.003,.009),.003,.032);
    this.compression[i]+=cut?compression-this.compression[i]:(compression-this.compression[i])*-Math.expm1(-step/.014);
   }
   const [fl,fr,rl,rr]=this.heights;
   this.longitudinal.follow(MathUtils.clamp(-accel*.00079+(rl+rr-fl-fr)*.104,-.030,.039),step,cut);
   this.transverse.follow(MathUtils.clamp(-lateral*.0039+(fr+rr-fl-rl)*.23,-.045,.045),step,cut);
   this.vertical.follow((fl+fr+rl+rr)*.25-pressure*.016,step,cut);
  }
  const flapTarget=!studio&&c.drs?-.43:0,flapRate=flapTarget===0?5.1:2.9;
  this.flap=cut?flapTarget:MathUtils.clamp(flapTarget,this.flap-dt*flapRate,this.flap+dt*flapRate);
  this.time=now;this.distance=c.distance;this.offset=offset;
 }
}
