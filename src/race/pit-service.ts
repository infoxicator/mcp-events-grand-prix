import type {Track} from './track';

export interface PitTelemetry{distance:number;pit?:string;pitTime?:number;offset?:number;heading?:number;compound?:string;instruction?:{tyre?:string}}
export function pitBox(track:Pick<Track,'PIT_STOP'>,team:'a'|'b'){return track.PIT_STOP-(team==='b'?28:0);}
export function ramp(x:number,start:number,end:number){
 const u=Math.max(0,Math.min(1,(x-start)/(end-start)));return u*u*(3-2*u);
}
/** Service seconds are authoritative, including when the viewer joins mid-stop or scrubs a replay. */
export function jackLift(car:PitTelemetry){
 if(car.pit!=='stopped')return 0;
 const t=car.pitTime??0;return .086*ramp(t,.08,.34)*(1-ramp(t,2.13,2.40));
}
export function cornerService(seconds:number,index:number){
 const t=seconds-[.015,.05,.085,0][index];
 return {off:t>=.49&&t<1.66,remove:ramp(t,.49,.99),fit:ramp(t,1.00,1.66),
  gun:ramp(t,-.15,.17)*(1-ramp(t,.44,.69))+ramp(t,1.50,1.71)*(1-ramp(t,1.99,2.23))};
}
