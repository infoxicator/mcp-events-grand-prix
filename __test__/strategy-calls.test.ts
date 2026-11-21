import {expect,test} from 'vitest';
import {fuelDecision,fightDecision,tyreDecision,pitDecision,pitCommitment,weatherDecision,teamDecision} from '../src/race/strategy-calls';

test('fuel lift recovers the deficit in the cheapest safe sector',()=>{
 const sectors=[{saved:.4,lost:.1,vulnerable:true},{saved:.25,lost:.2,vulnerable:false},{saved:.3,lost:.5,vulnerable:false}];
 const plan=fuelDecision(-.4,sectors);
 expect(plan.call.sector).toBe(1);
 expect(plan.fuelAtFlag).toBeGreaterThan(0);
 expect(fuelDecision(.1,sectors).timeLost).toBe(0);
});

test('yield trades position for the group gap, while a slower rival is defended',()=>{
 expect(fightDecision(.8,4,1.2,1)).toMatchObject({call:{priority:'yield'},place:4});
 expect(fightDecision(.05,0,1.2,1).call.priority).toBe('defend');
});

test('tyre push closes a gap at the cost of wear, management protects a long stint',()=>{
 expect(tyreDecision(.8,.35,3)).toMatchObject({call:{priority:'push'},nextWear:.5});
 expect(tyreDecision(.8,.76,3).call.priority).toBe('manage');
});

test('box in clear air, extend in traffic, cover a stopped rival and respect commitment',()=>{
 const box=pitDecision(21,2,5,25,false);
 expect(box.priority).toBe('box');
 expect(pitDecision(21,2,5,15,false).priority).toBe('extend');
 expect(pitDecision(21,2,5,25,true).priority).toBe('cover');
 const mark=pitCommitment(box,0,0).commitment;
 expect(pitCommitment(box,0,mark).committed).toBe(true);
 expect(pitCommitment(box,0,mark+.1).committed).toBe(false);
});

test('weather waits for a sector time and spends an available intermediate set',()=>{
 expect(weatherDecision([1,.67,.9],[0,2],1,null).compound).toBe('Slicks');
 expect(weatherDecision([1,.67,.9],[0,2],1,-.8)).toMatchObject({compound:'Intermediates',setsLeft:0});
 expect(weatherDecision([1,.67,.9],[0,2],0,-.8).compound).toBe('Slicks');
});

test('team swaps for upside and reverses after two laps without a pass',()=>{
 expect(teamDecision(3,.5,2).order).toBe('Teammate ahead');
 expect(teamDecision(3,.5,2,2,false).call.priority).toBe('swap-back');
 expect(teamDecision(3,.5,2,2,true).pointsGain).toBe(2);
});

test('an uncovered fuel deficit chooses the greatest safe saving and reports the shortfall',()=>{
 const plan=fuelDecision(-.9,[{saved:.8,lost:.1,vulnerable:true},{saved:.25,lost:.2,vulnerable:false},{saved:.3,lost:.4,vulnerable:false}]);
 expect(plan.call.sector).toBe(2);
 expect(plan.call.message).toContain('margin is still negative');
 expect(plan.fuelAtFlag).toBeLessThan(0);
 expect(fuelDecision(-1,[]).call.message).toContain('No safe sector lift');
});

test('a wider forecast window warrants waiting when a sector is only marginally damp',()=>{
 expect(weatherDecision([1,.75,1],[0,1],1,-.6).compound).toBe('Intermediates');
 expect(weatherDecision([1,.75,1],[0,3],1,-.6).compound).toBe('Slicks');
});

test('a completed team attack closes the order and a failed one restores order even after pace changes',()=>{
 expect(teamDecision(3,.5,2,2,true).call.message).toContain('Pass complete');
 expect(teamDecision(0,0,0,2,false).call.priority).toBe('swap-back');
 expect(teamDecision(0,0,0).call.priority).toBe('hold');
});
