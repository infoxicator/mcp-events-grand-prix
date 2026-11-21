import {fightDecision,fuelDecision,pitCommitment,pitDecision,teamDecision,tyreDecision,weatherDecision} from './strategy-calls';
import type {RadioCall} from './strategy-radio';

interface Case {
 name: string;
 call: RadioCall;
 outcome: string;
}
const signed = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);
const fuel = (projection: number): Case => {
 const {call,fuelAtFlag,timeLost}=fuelDecision(projection,[
  {saved:.36,lost:.12,vulnerable:true},{saved:.26,lost:.22,vulnerable:false},{saved:.29,lost:.43,vulnerable:false},
 ]);
 return {name:`Projected at flag ${signed(projection)} kg`,call,outcome:`Fuel at flag ${signed(fuelAtFlag)} kg · ${timeLost.toFixed(2)} s lost · main straight full pace`};
};
const fight=(pace: number): Case=>{
 const {call,place,groupGap}=fightDecision(pace,pace>.4?4:0,1.2,1);
 return {name:`Rival pace advantage ${pace.toFixed(2)} s/lap · group 1.00 s ahead`,call,outcome:`P${place} · group gap ${groupGap.toFixed(2)} s`};
};
const tyres=(wear:number):Case=>{
 const {call,nextGap,nextWear,lateLoss}=tyreDecision(.8,wear,3);
 return {name:`${Math.round(wear*100)}% wear · gap 0.80 s · 3 laps left`,call,outcome:`Next gap ${nextGap.toFixed(2)} s · wear ${Math.round(nextWear*100)}% · extra late-stint loss ${lateLoss.toFixed(2)} s`};
};
const pit=(gap:number, stopped:boolean, late=false):Case=>{
 const call=pitDecision(21,2,5,gap,stopped);
 const marker=pitCommitment(call,0,0).commitment;
 const receivedAt=marker+(late?18:-18);
 const result=pitCommitment(call,0,receivedAt);
 return {name:`Rear gap ${gap} s · rival ${stopped?'has stopped':'still out'} · call ${late?'late':'on time'}`,call,
  outcome:`Received at ${receivedAt.toFixed(0)} m · commitment at ${marker.toFixed(0)} m · ${result.committed?'Pit lane':'Stays on track this lap'}`};
};
const weather=(delta:number|null):Case=>{
 const {call,compound,setsLeft,nextSectorDelta}=weatherDecision([1,.67,.89],[0,2],1,delta);
 return {name:`Sector 2 grip 67% · rain arrival now to two laps · ${delta===null?'waiting for intermediate split':'intermediates '+signed(delta)+' s in sector 2'}`,
  call,outcome:`${compound} · ${setsLeft} intermediate set remaining · sector delta ${signed(nextSectorDelta)} s`};
};
const team=(laps:number,passed:boolean):Case=>{
 const {call,order,pointsGain}=teamDecision(3,.5,2,laps,passed);
 return {name:laps===0?'Teammate has 3 laps more tyre life and 0.50 s/lap more pace':`Two laps later · ${passed?'pass completed':'no pass'}`,call,outcome:`${order} · +${pointsGain} team points`};
};

export const strategyScenarios = {
 fuel:{name:'Fuel by sector', cases:()=>[fuel(-.4),fuel(.18),fuel(-.8)]},
 fight:{name:'Fight or yield',cases:()=>[fight(.8),fight(.05)]},
 tyres:{name:'Push or manage tyres',cases:()=>[tyres(.35),tyres(.76)]},
 pit:{name:'Box, extend or cover',cases:()=>[pit(25,false),pit(15,false),pit(25,true),pit(25,true,true)]},
 weather:{name:'Weather tyre choice',cases:()=>[weather(null),weather(-.8)]},
 team:{name:'Teammate coordination',cases:()=>[team(0,false),team(2,false),team(2,true)]},
};
