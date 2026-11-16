import {createRace,stepRace,DT} from '../src/race/physics';import {getTrack,isCircuit} from '../src/race/track';
const circuit=process.env.RACE_CIRCUIT??'monza';if(!isCircuit(circuit))throw new Error('Invalid circuit');const {CORNERS,LENGTH}=getTrack(circuit);
const s=createRace(2,circuit);s.phase='racing';const c=s.cars.a,r=s.cars.b;c.instruction.pace='push';c.instruction.ers='deploy';c.intent={offset:0,speedBias:0,brakeAggression:.85,side:'hold',ers:true,drs:false,reply:''};r.distance=-1000;
const cornerSpeeds=CORNERS.map(()=>999);let maxG=0,maxOffset=0,maxBrake=0;
for(let i=0;i<220/DT&&c.lap<2;i++){c.wear=0;c.temperature=95;c.fuel=10;stepRace(s);maxG=Math.max(maxG,Math.abs(c.lateralG));maxBrake=Math.max(maxBrake,-c.acceleration/9.81);maxOffset=Math.max(maxOffset,Math.abs(c.offset));if(c.lap===1)CORNERS.forEach((corner,j)=>{if(Math.abs(c.distance-LENGTH-corner.d)<80)cornerSpeeds[j]=Math.min(cornerSpeeds[j],c.speed*3.6);});}
console.log({laps:c.lapTimes,maxG,maxBrake,maxOffset,corners:CORNERS.map((c,i)=>({name:c.name,kph:cornerSpeeds[i]}))});
