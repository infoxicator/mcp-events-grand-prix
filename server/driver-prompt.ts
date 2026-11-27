import {AI_LANES,AI_PEDALS,RAW_BRAKE,RAW_STEER,RAW_THROTTLE,type AiControl,type AiControlStyle} from '../src/race/ai-controls';
import {opponents,playerEntry} from '../src/race/grid';
import {drsAllowed,grip,pathCurvature} from '../src/race/physics';
import {sectorWetnessOf} from '../src/race/race-control';
import {boostJoulesLeft,boostZone,remainingOrderJoules} from '../src/race/strategy-radio';
import {getTrack,type Track} from '../src/race/track';
import type {Car,DriverIntent,Race,Team} from '../src/race/types';
import {cornerLimit,VEHICLE} from '../src/race/vehicle';

export function nearbyTrafficState(s:Race,team:Team){
 const c=s.cars[team],otherTeam:Team=team==='a'?'b':'a';
 const candidates=[
  {code:playerEntry(otherTeam).code,car:s.cars[otherTeam]},
  ...s.field.map((car,i)=>({code:opponents[i]?.code??`C${i}`,car})),
 ];
 return candidates
  .filter(({car})=>car.finishTime===null&&Math.abs(car.distance-c.distance)<=60)
  .map(({code,car})=>{
   const metres=Math.round(car.distance-c.distance);
   return {
    code,
    metres,
    offset:Math.round(car.offset*10)/10,
    closingMps:Math.round((c.speed-car.speed)*10)/10,
    alongside:Math.abs(metres)<8&&Math.abs(car.offset-c.offset)<4,
   };
  })
  .sort((a,b)=>Math.abs(a.metres)-Math.abs(b.metres))
  .slice(0,4);
}

export function serializeInstruction(c:Car,track:Track){
 const inst=c.instruction,energy=inst.energy;
 const zoneMode=energy?.zone??energy?.priority??'attack';
 return {
  pace:inst.pace,
  ers:inst.ers,
  box:inst.box,
  tyre:inst.tyre,
  tactic:inst.tactic,
  line:inst.line,
  fuelSave:inst.fuelSave?{sector:inst.fuelSave.sector+1,expiresLap:inst.fuelSave.expiresLap}:null,
  yielding:Boolean((inst.yieldUntilLap&&c.lap<inst.yieldUntilLap)||(inst.teamOrder?.kind==='swap-back'&&!inst.teamOrder.completed&&c.lap<inst.teamOrder.expiresLap)),
  teamOrder:inst.teamOrder?{kind:inst.teamOrder.kind,completed:Boolean(inst.teamOrder.completed),expiresLap:inst.teamOrder.expiresLap}:null,
  energy:energy?{
   priority:energy.priority,
   zone:zoneMode,
   budgetKJ:energy.budgetKJ,
   remainingKJ:Math.round(remainingOrderJoules(c,energy)/1000),
   expiresLap:energy.expiresLap,
   window:zoneMode==='any'?null:boostZone(track,zoneMode),
   canDeployHere:boostJoulesLeft(c,track)>0,
  }:null,
 };
}

const distanceChoices=(offsets:Record<string,number>)=>Object.fromEntries(
 Object.entries(offsets).map(([choice,offset])=>[choice,`${offset>0?'+':''}${offset} m from the racing line`]),
);
const aids={
 ers:{instructions:'Deploy battery now?',choices:{yes:'Deploy if available',no:'Hold or harvest'}},
 drs:{instructions:'Request DRS now?',choices:{yes:'Open if eligible',no:'Keep closed'}},
};
const rawQuestions={
 steer:{instructions:'Set steering. Use small corrections at speed; straight holds the wheels centred.',choices:{
  'hard-left':'Full left','left':'60% left','slight-left':'25% left',straight:'Centred',
  'slight-right':'25% right',right:'60% right','hard-right':'Full right',
 }},
 throttle:{instructions:'Set throttle pressure.',choices:{none:'Lift',half:'50%',full:'100%'}},
 brake:{instructions:'Set brake pressure. Lift throttle under braking.',choices:{none:'Released',light:'45%',hard:'100% with lockup risk'}},
 ...aids,
};
const hybridQuestions={
 lane:{instructions:'Choose the lateral target relative to the racing line. Check edges and traffic before changing lanes.',choices:distanceChoices(AI_LANES)},
 pedal:{instructions:'Choose pedal or speed mode against the upcoming corners and available grip.',choices:{
  'brake-hard':'Full brake with lockup risk','brake-light':'45% brake',coast:'Lift throttle and release brakes',
  normal:'Follow the normal corner speed profile',push:'Faster corner targets and later braking',
  overdrive:'Up to 112% of the corner speed limit and very late braking. Risk of running wide.',
 }},
 ...aids,
};

export function experimentalDriverRequest(s:Race,team:Team,style:Exclude<AiControlStyle,'tactical'>){
 const car=s.cars[team],track=getTrack(s.circuit);
 const hybrid=style==='no-assist';
 // Raw controls use the driver's steering sign. The hybrid lane controller uses track offsets.
 const offsetSign=hybrid?1:-1;
 const offset=car.offset*offsetSign,line=track.racingLineOffset(car.distance)*offsetSign;
 const halfWidth=track.trackHalfWidth(car.distance);
 const tireGrip=grip(car,sectorWetnessOf(s.control,car.sector));
 const round=(value:number)=>Math.round(value*100)/100;
 return {
  instructions:hybrid
   ? 'Drive the F1 car by choosing a lane and pedal mode. Steering follows the chosen lane without dodging rivals. Negative lane offsets are left. Obey the engineer.'
   : 'Drive the F1 car with steering, throttle and brake. Negative steering, heading, offset and curvature are left; positive is right. Heading is relative to the road. Brake ahead of corners, steer toward the racing line and keep clear of traffic. Obey the engineer.',
  telemetry:{
   team,speedKmh:Math.round(car.speed*3.6),headingDeg:round(car.heading*180/Math.PI),
   offsetM:round(offset),racingLineOffsetM:round(line),offsetErrorFromLineM:round(offset-line),
   trackHalfWidthM:round(halfWidth),distToLeftEdgeM:round(halfWidth+offset),distToRightEdgeM:round(halfWidth-offset),
   lateralVelocityMps:round(car.lateralVelocity*offsetSign),
   upcomingTrack:[10,25,50,80,120,180,250].map(m=>{
    const distance=car.distance+m;
    return {m,curvature:Number((track.signedCurvatureAt(distance)*offsetSign).toFixed(5)),
     racingLineOffsetM:round(track.racingLineOffset(distance)*offsetSign),
     cornerSpeedKmh:Math.round(3.6*cornerLimit(pathCurvature(distance,track),VEHICLE.dryMass+car.fuel,tireGrip))};
   }),
   nearbyTraffic:nearbyTrafficState(s,team).map(rival=>({...rival,offset:rival.offset*offsetSign})),
   lockup:Boolean(car.lockup),wear:round(car.wear),grip:round(tireGrip),
   inDrsZone:track.isDrsZone(car.distance),drsEligible:drsAllowed(car,track),battery:Math.round(car.ers),
   pitPhase:car.pit,instruction:serializeInstruction(car,track),
  },
  questions:hybrid?hybridQuestions:rawQuestions,
 };
}

export function experimentalDriverDecision(style:Exclude<AiControlStyle,'tactical'>,answers:Record<string,string>):
 {control:AiControl;intent:DriverIntent}{
 const questions=style==='no-assist'?hybridQuestions:rawQuestions;
 for(const [name,question] of Object.entries(questions)){
  if(!Object.hasOwn(question.choices,answers[name]))throw new Error('Invalid experimental driving choice');
 }
 const intent:DriverIntent={offset:0,speedBias:0,brakeAggression:.55,side:'hold',ers:answers.ers==='yes',drs:answers.drs==='yes',reply:''};
 const control:AiControl=style==='no-assist'
  ? {style,lane:answers.lane as keyof typeof AI_LANES,pedal:answers.pedal as typeof AI_PEDALS[number]}
  : {style,steer:answers.steer as keyof typeof RAW_STEER,throttle:answers.throttle as keyof typeof RAW_THROTTLE,brake:answers.brake as keyof typeof RAW_BRAKE};
 return {intent,control};
}

