/** Real-time shot holds: independent of the accelerated race clock and battle events. */
export const BROADCAST_SHOTS=[
 {mode:'side',seconds:8},
 {mode:'tcam-a',seconds:7},
 {mode:'helicopter',seconds:9},
 {mode:'cockpit-b',seconds:7},
 {mode:'chase',seconds:8},
 {mode:'tcam-b',seconds:7},
 {mode:'cockpit-a',seconds:7},
 {mode:'trackside',seconds:9},
] as const;
export class BroadcastDirector {
 private index=0;
 private since:number|null=null;
 private incidentUntil=-Infinity;
 private lastIncident=-Infinity;
 reset(){this.index=0;this.since=null;this.incidentUntil=this.lastIncident=-Infinity;}
 update(now:number,incident=false){
  if(incident&&now-this.lastIncident>12000){this.incidentUntil=now+1600;this.lastIncident=now;}
  if(now<this.incidentUntil)return 'trackside';
  if(this.since===null||now<this.since)this.since=now;
  if(now-this.since>=BROADCAST_SHOTS[this.index].seconds*1000){
   this.index=(this.index+1)%BROADCAST_SHOTS.length;this.since=now;
  }
  // A suspended/background tab resumes with one clean cut, never a burst of cuts.
  return BROADCAST_SHOTS[this.index].mode;
 }
}
