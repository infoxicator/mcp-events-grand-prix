/** Chassis-local lens poses, metres. +Z is forward; pitch is down from horizontal. */
export function onboardLens(tv:boolean){
 return tv?{height:1.14,back:.505,pitch:16,fov:66,offset:.060}:{height:.765,back:.33,pitch:12,fov:60,offset:0};
}

/** Helmet motion relative to the tub. The TV camera is bolted to the roll hoop. */
export class DriverHead {
 yaw=0;
 lateral=0;
 forward=0;
 roll=0;
 private lastTime:number|null=null;
 reset(){this.lastTime=null;}
 update(now:number,roadAngle:number,steering:number,speed:number,acceleration:number,lateralG:number){
  const limit=(value:number,bound:number)=>Math.max(-bound,Math.min(bound,value));
  const dt=this.lastTime===null?Infinity:(now-this.lastTime)/1000;
  const blend=dt<0||dt>.5?1:-Math.expm1(-dt/.14);
  const moving=Math.min(1,Math.max(0,speed/12));
  this.yaw+=(limit(roadAngle*.64+steering*.18,.155)*moving-this.yaw)*blend;
  this.lateral+=(limit(lateralG*.004,.018)*moving-this.lateral)*blend;
  this.forward+=(limit(-acceleration*.00075,.026)*moving-this.forward)*blend;
  this.roll+=(limit(-lateralG*.006,.028)*moving-this.roll)*blend;
  this.lastTime=now;
 }
}
