import type {FieldCar} from './grid';
import type {Track} from './track';
import type {Car, PanelDamage} from './types';

export function damageLevel(panels?:PanelDamage){
 return panels?Math.min(1,Math.max(...panels)*.7+(panels[0]+panels[1]+panels[2]+panels[3])*.3):0;
}

type MovingCar=FieldCar & {lateralVelocity?:number};
export interface Impact{closing:number;side:number;rear:boolean;source:string;lateralRate?:number;headOn?:boolean}

// Use the near side of each contact. Longitudinal overlap alone is ordinary
// side-by-side racing. Relative speed across the contacting face sets severity.
export function trafficImpact(car:Car,other:MovingCar,track:Track,dt:number,source:string,fieldAge=0):Impact|undefined{
 if(car.finishTime!==null||other.finishTime!==null)return;
 const along=other.distance+other.speed*fieldAge-car.distance;
 const z=Math.abs(along)<track.LENGTH/2?along:track.wrap(along+track.LENGTH/2)-track.LENGTH/2;
 const x=other.offset+(other.lateralVelocity??0)*fieldAge-car.offset;
 const dz=car.speed-other.speed,dx=car.lateralVelocity-(other.lateralVelocity??0);
 const length=5.62,width=1.94;
 if(Math.abs(z)>length+Math.abs(dz)*dt||Math.abs(x)>width+Math.abs(dx)*dt)return;
 // Time of entry on each separating axis. If already touching, the
 // shallowest penetration identifies the face even when moving apart.
 const axialGap=Math.abs(z)-length,sideGap=Math.abs(x)-width;
 const axialRate=Math.sign(z)*dz,sideRate=Math.sign(x)*dx;
 if((axialGap>0&&axialRate<=0)||(sideGap>0&&sideRate<=0))return;
 const axialTime=axialGap>0?axialGap/axialRate:0;
 const sideTime=sideGap>0?sideGap/sideRate:0;
 const at=Math.max(axialTime,sideTime);
 if(at>dt||Math.abs(z-dz*at)>length+1e-6||Math.abs(x-dx*at)>width+1e-6)return;
 const sideHit=at>0?sideTime>axialTime:sideGap>axialGap;
 const closing=sideHit?sideRate:axialRate;
 if(closing<2.5)return;
 return {closing,side:Math.abs(x)<.28&&!sideHit?0:Math.sign(x),rear:z<0,source,lateralRate:sideHit?sideRate:undefined};
}

// Match the barrier cross-sections and the pit-side opening in build_circuits.py.
export function barrierFace(track:Track,distance:number,side:number){
 const d=track.wrap(distance);
 if(side<0&&(d>track.PIT_ENTRY-8||d<track.PIT_EXIT+15)){
  return Infinity;
 }
 if(track.night)return track.trackHalfWidth(d)+2-.34;
 let edge=16;
 for(const corner of track.CORNERS){
  const delta=Math.abs(track.wrap(d-corner.d+track.LENGTH/2)-track.LENGTH/2);
  const radius=corner.name==='Parabolica'?275:144;
  if(delta<radius)edge=Math.max(edge,16+8*(1+Math.cos(Math.PI*delta/radius)));
 }
 const finish=Math.abs(track.wrap(d+155+track.LENGTH/2)-track.LENGTH/2);
 return Math.max(edge,16+15*(1-Math.min(1,Math.max(0,(finish-255)/100))))-.205;
}

export function hitBarrier(car:Car,track:Track,before:number):Impact|undefined{
 if(Math.abs(car.offset)<4)return;
 const halfWidth=Math.abs(Math.cos(car.heading))+2.8*Math.abs(Math.sin(car.heading));
 const nose=2.8*Math.cos(car.heading);
 const d=track.wrap(car.distance+nose);
 const splitter=d>=track.PIT_WALL_START&&d<track.LENGTH-20&&car.offset<0;
 const noseStrike=splitter&&track.wrap(before+nose)<track.PIT_WALL_START&&Math.abs(car.offset+12)<halfWidth+.34;
 let side=Math.sign(car.offset),limit:number;
 if(splitter){
  // Either lane can touch the divider. Resolve onto the side of approach.
  side=car.offset<-12?1:-1;
  limit=-12-side*(halfWidth+(d<track.PIT_WALL_START+1.5?.34:.225));
 }else{
  const face=barrierFace(track,car.distance,side);
  if(!Number.isFinite(face))return;
  limit=side*(face-halfWidth);
 }
 if(side*(car.offset-limit)<0)return;
 const closing=noseStrike?car.speed:side*car.lateralVelocity;
 car.offset=limit;
 if(closing<=0)return;
 car.heading*=-.10;car.lateralVelocity*=-.10;
 if(closing<1.5)return;
 return {closing,side:noseStrike?0:side,rear:false,source:'BARRIER',headOn:noseStrike};
}

export function applyImpact(car:Car,hit:Impact,time:number){
 if(car.lastImpact?.source===hit.source&&time-car.lastImpact.time<.8)return false;
 // Cars of similar mass share the impulse. A fixed wall absorbs no motion.
 const impactSpeed=hit.closing*(hit.source==='BARRIER'?1:.5);
 const severity=Math.min(1,Math.max(.025,(impactSpeed/26)**1.35));
 const panels:PanelDamage=car.damage?[...car.damage]:[0,0,0,0];
 const index=hit.rear?2:0;
 if(hit.side>=0)panels[index]=Math.min(1,panels[index]+severity);
 if(hit.side<=0)panels[index+1]=Math.min(1,panels[index+1]+severity);
 car.damage=panels;car.lastImpact={time,source:hit.source};
 if(hit.lateralRate){
  car.lateralVelocity-=hit.side*hit.lateralRate*.53;
  car.heading=-Math.asin(Math.max(-.56,Math.min(.56,car.lateralVelocity/Math.max(1,car.speed))));
 }
 if(hit.source==='BARRIER'){
  // A scrape dissipates motion across the wall, with limited tangential scrub.
  // The blunt splitter instead arrests most of the longitudinal velocity.
  car.speed=hit.headOn?car.speed*.06:Math.sqrt(Math.max(0,car.speed**2-Math.min(car.speed,hit.closing)**2))*.99;
 }else if(hit.lateralRate===undefined){
  car.speed=Math.max(0,car.speed+longitudinalImpulse(hit));
 }else car.speed=Math.max(0,car.speed-.06*hit.closing);
 return true;
}

// Equal-mass, low-restitution collision along the struck face. Both cars
// receive opposite impulses; a nose-to-tail collision pushes the leader on.
export function longitudinalImpulse(hit:Impact){
 return (hit.rear?1:-1)*.53*hit.closing;
}
