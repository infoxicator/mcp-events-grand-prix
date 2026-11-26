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
 const pitEdge=side<0?-track.pitOffset(d)+4.6:0;
 if(track.night)return Math.max(pitEdge,track.trackHalfWidth(d)+2)-.34;
 let edge=16;
 for(const corner of track.CORNERS){
  const delta=Math.abs(track.wrap(d-corner.d+track.LENGTH/2)-track.LENGTH/2);
  const radius=corner.name==='Parabolica'?275:144;
  if(delta<radius)edge=Math.max(edge,16+8*(1+Math.cos(Math.PI*delta/radius)));
 }
 const finish=Math.abs(track.wrap(d+155+track.LENGTH/2)-track.LENGTH/2);
 return Math.max(edge,pitEdge,16+15*(1-Math.min(1,Math.max(0,(finish-255)/100))))-.205;
}

export function hitBarrier(car:Car,track:Track,before:number):Impact|undefined{
 if(Math.abs(car.offset)<4)return;
 const halfWidth=Math.abs(Math.cos(car.heading))+2.8*Math.abs(Math.sin(car.heading));
 const nose=2.8*Math.cos(car.heading);
 const d=track.wrap(car.distance+nose);
 const splitter=track.inZone(d,track.PIT_WALL_START,track.PIT_EXIT-90)&&car.offset<0;
 const noseStrike=splitter&&track.wrap(d-track.PIT_WALL_START)<=Math.max(0,car.distance-before)&&Math.abs(car.offset+12)<halfWidth+.34;
 let side=Math.sign(car.offset),limit:number;
 if(splitter){
  // Either lane can touch the divider. Resolve onto the side of approach.
  side=car.offset<-12?1:-1;
  limit=-12-side*(halfWidth+(track.wrap(d-track.PIT_WALL_START)<1.5?.34:.225));
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

// The contact manifold lives in metres along and across the track. Resolve near
// pairs at 120 Hz even when no damage event is due. Finished entries are ghosts.
type ContactCar = FieldCar & {team?:Car['team'];heading?:number;lateralVelocity?:number;impactSideSpeed?:number;impactYaw?:number;impactTimes?:Record<string,number>;damage?:PanelDamage;lastImpact?:Car['lastImpact']};
type ContactNotice = (car:Car,hit:Impact)=>void;

export function resolveTraffic(cars:ContactCar[],names:readonly string[],track:Track,time:number,dt:number,notice?:ContactNotice){
 const halfLength=2.81,halfWidth=.97;
 const maxPasses=dt?1:Math.max(64,2*cars.length*cars.length);
 for(let pass=0;pass<maxPasses;pass++){
  let moved=false;
  for(let i=0;i<cars.length;i++){
   const a=cars[i];if(a.finishTime!==null)continue;
   for(let j=i+1;j<cars.length;j++){
    const b=cars[j];if(b.finishTime!==null)continue;
    let z=b.distance-a.distance;
    if(Math.abs(z)>track.LENGTH/2)z-=Math.round(z/track.LENGTH)*track.LENGTH;
    const vz=a.speed-b.speed;
    if(Math.abs(z)>6+Math.abs(vz)*dt)continue;
    const x=b.offset-a.offset,vx=(a.lateralVelocity??0)-(b.lateralVelocity??0);
    if(Math.abs(x)>6+Math.abs(vx)*dt)continue;
    const ha=a.heading??((a.pitHeading??0)+(a.impactYaw??0)),hb=b.heading??((b.pitHeading??0)+(b.impactYaw??0));
    const ca=Math.cos(ha),sa=-Math.sin(ha),cb=Math.cos(hb),sb=-Math.sin(hb);
    let nx=0,nz=0,depth=Infinity,entry=-Infinity,leave=Infinity,ex=0,ez=0;
    // Slab intersection over the timestep also catches nose/quarter strikes before penetration.
    for(let k=0;k<4;k++){
     const ax=k===0?ca:k===1?sa:k===2?cb:sb,az=k===0?-sa:k===1?ca:k===2?-sb:cb;
     const radius=halfLength*(Math.abs(sa*ax+ca*az)+Math.abs(sb*ax+cb*az))
      +halfWidth*(Math.abs(ca*ax-sa*az)+Math.abs(cb*ax-sb*az));
     const p=x*ax+z*az,v=vx*ax+vz*az,penetration=radius-Math.abs(p);
     if(penetration<depth){depth=penetration;nx=ax*(Math.sign(p)||1);nz=az*(Math.sign(p)||1);}
     if(Math.abs(v)<1e-8){if(penetration<0){leave=-Infinity;break;}continue;}
     const t1=(p-radius)/v,t2=(p+radius)/v,start=Math.min(t1,t2);
     if(start>entry){entry=start;ex=ax*Math.sign(v);ez=az*Math.sign(v);}
     leave=Math.min(leave,Math.max(t1,t2));
    }
    if(depth<0){if(!dt||entry>dt||leave<Math.max(0,entry))continue;nx=ex;nz=ez;}
    const wa=a.pit==='stopped'?0:1,wb=b.pit==='stopped'&&wa?0:1,sum=wa+wb;
    if(!dt&&depth>1e-7){
     const push=(depth+.00001)/sum;
     a.offset-=nx*push*wa;b.offset+=nx*push*wb;a.distance-=nz*push*wa;b.distance+=nz*push*wb;moved=true;
    }
    const closing=vx*nx+vz*nz;if(closing<=.00001)continue;
    const impulse=1.06*closing/sum,friction=Math.max(-.14*impulse,Math.min(.14*impulse,(vx*nz-vz*nx)/sum));
    const ix=nx*impulse+nz*friction,iz=nz*impulse-nx*friction;
    for(let slot=0;slot<2;slot++){
     const c=slot?b:a,weight=slot?wb:wa,sign=slot?1:-1;
     if(weight){
      c.speed=Math.max(0,c.speed+sign*iz*weight);
      c.lateralVelocity=(c.lateralVelocity??0)+sign*ix*weight;
      const torque=Math.max(-.20,Math.min(.20,(z*ix-x*iz)*.006));
      if(c.team)c.heading=(c.heading??0)+torque-Math.atan2(sign*ix,Math.max(12,c.speed));
      else {c.impactSideSpeed=(c.impactSideSpeed??0)+sign*ix;c.impactYaw=(c.impactYaw??0)+torque;}
     }
     if(closing<2.5)continue;
     const source=names[slot?i:j];const last=c.impactTimes?.[source]??(c.lastImpact?.source===source?c.lastImpact.time:-Infinity);if(time-last<.8)continue;
     (c.impactTimes??={})[source]=time;
     const side=Math.abs(x)<.28&&Math.abs(nx)<.5?0:Math.sign(x)*-sign;
     const rear=z*-sign<0,hit={source,side,rear,closing};
     const damage=c.damage??[0,0,0,0],panel=rear?2:0,severity=Math.min(1,Math.max(.025,(closing/52)**1.35));
     const next:PanelDamage=[...damage];
     if(side>=0)next[panel]=Math.min(1,next[panel]+severity);
     if(side<=0)next[panel+1]=Math.min(1,next[panel+1]+severity);
     c.damage=next;c.lastImpact={source,time};if(c.team)notice?.(c as Car,hit);
    }
   }
  }
  if(!moved)break;
 }
}
