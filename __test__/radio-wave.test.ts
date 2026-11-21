import {expect,test} from 'vitest';
import {radioWaveSample} from '../src/race/radio-wave';
import {radioLetterTime} from '../src/race/radio-overlay';

test('the broadcast carrier opens from a two-pixel floor and repeats at the recorded frame cadence',()=>{
 const peak=(elapsed:number)=>{
  const {profile,signal}=radioWaveSample(elapsed);
  return Math.round(2+(Math.max(...profile)-2)*signal);
 };
 expect([0,120,160,200,240,280].map(peak)).toEqual([2,2,4,12,29,27]);
 const quiet=1640;
 expect(peak(quiet)).toBe(7);
 expect(radioWaveSample(quiet+2040)).toEqual(radioWaveSample(quiet));
 expect([3480,3520,3560,3600,3640,3680].map(peak)).toEqual([19,19,16,13,9,7]);
 expect(radioWaveSample(2080).profile).toEqual([6,6,8,8,8,10,10,10,10,8,8]);
 expect(radioWaveSample(2280).profile).toEqual([8,8,18,19,20,29,29,28,14,12,12]);
});

test('the Shanghai engineer caption reaches the measured middle glyph without shortening the full reveal',()=>{
 expect(radioLetterTime(13,33)).toBeLessThan(200);
 expect(radioLetterTime(14,33)).toBeGreaterThan(200);
 expect(radioLetterTime(33,33)).toBe(528);
});
