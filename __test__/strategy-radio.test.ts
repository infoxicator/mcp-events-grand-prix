import {expect, test} from 'vitest';
import {createRace,stepRace} from '../src/race/physics';
import {getTrack} from '../src/race/track';
import {boostJoulesLeft,boostRequested,boostZone,strategistDue,type RadioCall} from '../src/race/strategy-radio';

test('strategy is reconsidered at the line or on a material change', () => {
 const previous = {lap: 1, change: 'dry'};
 expect(strategistDue(previous, 1, 'dry')).toBe(false);
 expect(strategistDue(previous, 2, 'dry')).toBe(true);
 expect(strategistDue(previous, 1, 'damp')).toBe(true);
});

test('a boost budget spans corners and deployment still requires an opening in the target sector', () => {
 const call: RadioCall = {priority: 'defend', message: 'Hold', issuedLap: 1, expiresLap: 3, revisit: 'Threat recedes', sector: 1, energy: 1};
 expect(boostRequested(call, 2, 1, 1, true)).toBe(true);
 expect(boostRequested(call, 2, 2, 1, true)).toBe(false);
 expect(boostRequested(call, 2, 1, 1, false)).toBe(false);
 expect(boostRequested(call, 3, 1, 1, true)).toBe(false);
});

test('physics spends a reserved budget only in its zone, including partial throttle, and keeps the spend across a lap reset',()=>{
 const race=createRace(3);
 race.phase='racing';
 race.field=[];
 const car=race.cars.a,track=getTrack();
 const back=boostZone(track,'attack');
 const order={priority:'attack' as const,budgetKJ:2,expiresLap:2,startJoules:0};
 car.instruction={...car.instruction,ers:'deploy',energy:order};
 car.intent.ers=true;
 car.distance=back.start-25;
 car.speed=50;
 car.throttle=.25;
 const pedals={a:{throttle:.25,brake:0,steering:0}};
 stepRace(race,pedals);
 expect(car.ersDeployed).toBeUndefined();
 car.distance=back.start+30;
 stepRace(race,pedals);
 expect(car.ersDeployed).toBeCloseTo(250);
 const remaining=boostJoulesLeft(car,track);
 car.lap=1;
 car.distance+=track.LENGTH;
 car.ersUsed=0;
 expect(boostJoulesLeft(car,track)).toBe(remaining);
 for(let tick=0;tick<40;tick++)stepRace(race,pedals);
 expect(car.ersDeployed).toBeGreaterThan(1995);
 expect(car.ersDeployed).toBeLessThanOrEqual(2000);
 car.lap=2;
 expect(boostJoulesLeft(car,track)).toBe(0);
});
