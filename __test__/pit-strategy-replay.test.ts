import {expect,test} from 'vitest';
import {pitStrategyReplay} from '../src/race/pit-strategy-replay';

test('only the rear gap changes which stop is faster at the common comparison line',()=>{
 const clearBox=pitStrategyReplay(26,'box');
 const clearExtend=pitStrategyReplay(26,'extend');
 const trafficBox=pitStrategyReplay(15,'box');
 const trafficExtend=pitStrategyReplay(15,'extend');
 expect(clearBox.splits[0].traffic).toBe(false);
 expect(trafficBox.splits[0].traffic).toBe(true);
 expect(clearBox.elapsed).toBeLessThan(clearExtend.elapsed);
 expect(trafficBox.elapsed).toBeGreaterThan(trafficExtend.elapsed);
 expect(clearExtend.elapsed).toBe(trafficExtend.elapsed);
 for(const run of [clearBox,clearExtend,trafficBox,trafficExtend]){
  expect(run.splits.filter(lap=>lap.stop)).toHaveLength(1);
  expect(run.elapsed).toBeGreaterThan(run.rivalServiceComplete);
  expect(run.comparisonStation).toBe(clearBox.comparisonStation);
 }
});

test('a late box call misses current entry and stops the following lap',()=>{
 const run=pitStrategyReplay(26,'box',true);
 expect(run.entry.inTime).toBe(false);
 expect(run.entry.beforeEntry).toBe(true);
 expect(run.stopLap).toBe(2);
 expect(run.elapsed).toBe(pitStrategyReplay(26,'extend').elapsed);
});
