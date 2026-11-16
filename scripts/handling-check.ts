import {createRace,stepRace,DT,grip} from '../src/race/physics';
import {mockDriver,mockEngineer} from '../src/race/brains';
import {LENGTH,CORNERS} from '../src/race/track';
import {writeFileSync} from 'node:fs';
const race=createRace(3);race.phase='racing';let maxSpeed=0,maxBrake=0,maxLateral=0;const samples:unknown[]=[];
const start=performance.now();
for(let i=0;i<500/DT&&(race.phase as string)!=='finished';i++){
 if(i%24===0)for(const t of ['a','b'] as const){if(i%1440===0)race.cars[t].instruction=mockEngineer(race,t);race.cars[t].intent=mockDriver(race,t);}
 stepRace(race);const c=race.cars.a;maxSpeed=Math.max(maxSpeed,c.speed*3.6);maxBrake=Math.max(maxBrake,-c.acceleration/9.81);maxLateral=Math.max(maxLateral,Math.abs(c.lateralG));
 if(i%60===0)samples.push({time:race.time,distance:c.distance,speed:c.speed*3.6,offset:c.offset,brake:c.brake,throttle:c.throttle,g:c.lateralG,acceleration:c.acceleration,grip:grip(c)});
}
const report={elapsedMs:performance.now()-start,phase:race.phase,maxSpeed,maxBrake,maxLateral,lapTimes:{a:race.cars.a.lapTimes,b:race.cars.b.lapTimes},stops:{a:race.cars.a.stops,b:race.cars.b.stops},tyres:{a:race.cars.a.wear,b:race.cars.b.wear},fuel:race.cars.a.fuel,corners:CORNERS.map(c=>({name:c.name,d:c.d})),samples};
writeFileSync('artifacts/handling.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,samples:report.samples.length},null,2));
if((race.phase as string)!=='finished')process.exitCode=1;
