/** Small contact-preserving grip changes, deterministic from car telemetry. Radians. */
export function fingerCurl(side:-1|1,digit:number,steering:number,distance:number,speed:number){
 const load=Math.max(-1,Math.min(1,steering/.25))*side;
 const pressure=[.021,.032,.028,.018,.012][digit]??0;
 const breathe=speed>1?Math.sin(distance*.018+digit*1.73+side)*.0035:0;
 return {curl:side*(pressure*load+breathe),spread:side*load*(digit-2)*.0025};
}
