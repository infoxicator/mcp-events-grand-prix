import {expect,it} from 'vitest';
import {classification,grid,opponents,paints,playerEntry} from '../src/race/grid';
import {createRace,stepRace} from '../src/race/physics';
import {getTrack} from '../src/race/track';

it('places eleven two-car teams in 22 unique slots with exactly two controller seats',()=>{
 const race=createRace(),rows=classification(race);
 expect(rows.map(row=>row.entry)).toEqual(grid);
 expect(new Set(grid.map(x=>x.number)).size).toBe(22);
 expect(new Set(grid.map(x=>x.team)).size).toBe(11);
 for(const entry of grid)expect(grid.filter(x=>x.team===entry.team)).toHaveLength(2);
 expect(new Set(rows.map(x=>x.car.distance)).size).toBe(22);
 expect(playerEntry('a')).toMatchObject({team:'Ferrari',number:44});
 expect(playerEntry('b')).toMatchObject({team:'Mercedes',number:63});
 expect(opponents).toHaveLength(20);
 expect(new Set(grid.map(x=>paints(x).join('/'))).size).toBe(11);
});

it.each(['monza','las-vegas'] as const)('classifies a computer winner and waits for the last finisher at %s',circuit=>{
 const race=createRace(1,circuit),finish=getTrack(circuit).LENGTH;
 race.phase='racing';
 for(const {car} of classification(race)){car.distance=finish-.1;car.speed=70;}
 const tail=race.field.at(-1)!;
 tail.distance=finish-25;
 race.field[0].distance=finish;race.field[0].finishTime=.001;
 stepRace(race);expect(race.phase).toBe('racing');
 for(let i=0;i<100;i++)stepRace(race);
 expect(race.phase).toBe('finished');expect(race.winner).toBe(opponents[0].code);
 expect(classification(race).at(-1)?.car).toBe(tail);
});
