/** Transparent, calibrated 2025-style model; coefficients are estimates, not team data.
 * SI throughout: kg, m/s, N, W. Combined tyre force is bounded by a friction ellipse. */
export const VEHICLE={dryMass:800,wheelbase:3.6,tyreRadius:.36,airDensity:1.225,dragArea:1.1,downforceArea:6.2,enginePower:570000,ersPower:120000,batteryJoules:4000000,cgHeight:.3,frontWeight:.455,rollingCoefficient:.014,mu:1.9,maxBrakeG:4.85};
export function forces(speed:number,mass:number,grip:number,drs=false,tow=0,dirtyAir=0){
 const q=.5*VEHICLE.airDensity*speed*speed;
 const drag=q*VEHICLE.dragArea*(drs?.77:1)*(1-tow*.18);
 const downforce=q*VEHICLE.downforceArea*(drs?.86:1)*(1-dirtyAir);
 // Load sensitivity: doubling tyre load does not double the coefficient of friction.
 const load=mass*9.81+downforce,mu=VEHICLE.mu*grip*Math.pow(load/(mass*9.81),-.12);
 return {drag,downforce,load,mu,tyreForce:load*mu,rolling:mass*9.81*VEHICLE.rollingCoefficient};
}
export function brakeCapacity(speed:number,mass:number,grip:number,lateralAcceleration=0,dirtyAir=0){
 const f=forces(speed,mass,grip,false,0,dirtyAir),lateral=mass*Math.abs(lateralAcceleration);
 return Math.min(VEHICLE.maxBrakeG*9.81,(Math.sqrt(Math.max(0,f.tyreForce**2-lateral**2))+f.drag+f.rolling)/mass);
}
// Each braking forecast tests dozens of corners with identical mass, grip and
// wake. Bisection revisits exactly the same speed at a given tree node.
const lateralLimits=new Float64Array(4096),epochs=new Float64Array(4096);
let epoch=0,lastMass=0,lastGrip=0,lastWake=0;
export function cornerLimit(curvature:number,mass:number,grip:number,dirtyAir=0){
 const k=Math.abs(curvature);if(k<.0004)return 105;
 if(mass!==lastMass||grip!==lastGrip||dirtyAir!==lastWake){
  epoch++;lastMass=mass;lastGrip=grip;lastWake=dirtyAir;
 }
 let lo=5,hi=105,node=1;
 for(let i=0;i<12;i++){
  const v=(lo+hi)*.5;
  if(epochs[node]!==epoch){lateralLimits[node]=Math.min(5.5*9.81,forces(v,mass,grip,false,0,dirtyAir).tyreForce/mass);epochs[node]=epoch;}
  const inside=v*v*k<=lateralLimits[node];node=node*2+Number(inside);
  if(inside)lo=v;else hi=v;
 }
 return lo;
}
export function drivetrain(speed:number,mass:number,grip:number,deploy:boolean,drs:boolean,tow:number,dirtyAir:number,lateralAcceleration:number){
 const f=forces(speed,mass,grip,drs,tow,dirtyAir),power=VEHICLE.enginePower+(deploy?VEHICLE.ersPower:0);
 const rearLoad=.545*mass*9.81+.58*f.downforce+mass*8*VEHICLE.cgHeight/VEHICLE.wheelbase;
 const lateralRear=mass*Math.abs(lateralAcceleration)*.55;
 const traction=Math.sqrt(Math.max(0,(rearLoad*f.mu)**2-lateralRear**2));
 return {maxDrive:Math.min(power/Math.max(12,speed),traction),...f};
}
