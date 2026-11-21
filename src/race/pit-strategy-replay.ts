import {pitCommitment,pitCommitmentPoint,pitDecision} from './strategy-calls';
import {getTrack} from './track';
import type {RadioCall} from './strategy-radio';

export function pitReplayState(rearGap: number) {
 const track=getTrack();
 return {rearGap,pitLoss:21,freshGain:2,trafficLoss:5,tyreAge:9,stopWindows:2,
  observationAt:pitCommitmentPoint(track.PIT_ENTRY)-100,approachSpeed:65,
  rivalStopsOnLap:2,comparisonStation:track.SECTORS[2]};
}

export function pitStrategyReplay(rearGap: number, plan: 'box' | 'extend', late = false, radioArrival?: number) {
 const {pitLoss,freshGain,trafficLoss,tyreAge,comparisonStation,observationAt,approachSpeed,rivalStopsOnLap}=pitReplayState(rearGap);
 const track=getTrack();
 const recommendation = pitDecision(pitLoss,freshGain,trafficLoss,rearGap,false);
 const marker = pitCommitment(recommendation,0,0).commitment;
 const receivedAt = radioArrival ?? marker + (late ? 25 : -25);
 const call:RadioCall={...recommendation,priority:plan,
  message:plan==='box'?'Box this lap.':'Extend one lap.'};
 const entry = pitCommitment(call,0,receivedAt);
 const stopLap = entry.committed ? 1 : 2;
 const firstApproach=(track.LENGTH-observationAt)/approachSpeed;
 const lapTime=86;
 // The follower travels the same road and incurs its stop on the second
 // lap. The comparison gate is beyond the point when both have been served.
 const rivalServiceComplete=firstApproach+lapTime+rearGap+(pitLoss/2)-(track.LENGTH-track.PIT_STOP)/approachSpeed;
 let elapsed = 0;
 let age = tyreAge;
 const splits = [1,2].map(lap => {
  const stop = lap === stopLap;
  // The following group stops on lap two. A lap-one stop rejoins behind it
  // when the pre-stop rear gap is smaller than the time spent in the lane.
  const rejoinGap=stop?rearGap-pitLoss+(lap===rivalStopsOnLap?pitLoss:0):null;
  const traffic=rejoinGap!==null&&rejoinGap<0&&rejoinGap>=-10;
  const paceCost = age >= tyreAge ? freshGain + (age - tyreAge) * .3 : 0;
  const driveTime=lap===1?firstApproach:lapTime;
  elapsed += driveTime + paceCost + (stop ? pitLoss : 0) + (traffic ? trafficLoss : 0);
  age = stop ? 0 : age + 1;
  return {lap,elapsed,stop,traffic,rejoinGap};
 });
 elapsed+=comparisonStation/approachSpeed;
 return {rearGap,plan,recommendation,stopLap,entry,receivedAt,splits,elapsed,comparisonStation,rivalServiceComplete};
}
