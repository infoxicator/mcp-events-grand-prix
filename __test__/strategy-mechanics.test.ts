import {describe,expect,it} from 'vitest';
import {createRace,damageRepairSeconds,dryCompoundRuleSatisfied,DT,FIA_MIN_FUEL_KG,racingSpeed,stepRace,tyreCompoundsMeta,tyreWearScale} from '../src/race/physics';
import {advanceField} from '../src/race/field-physics';
import {applyHazard,stepRaceControl} from '../src/race/race-control';
import {observeStrategy,projectFuelAtFlag,sectorGaps} from '../src/race/strategy-observation';
import {mockEngineer} from '../src/race/brains';
import {pitCommitmentPoint} from '../src/race/strategy-calls';
import {opponents,teammateEntry} from '../src/race/grid';
import {getTrack} from '../src/race/track';
import {createRaceDriver} from '../server/race-brains';
import {radioInput,radioInstruction} from '../server/strategy-events';
import {RaceRoom} from '../server/race-room';

describe('F1 physics, rules, and AI parity',()=>{
 it('scales tyre wear for 20-lap strategy races and assigns diverse AI stint plans',()=>{
  expect(tyreWearScale(3)).toBe(1);
  expect(tyreWearScale(20)).toBeCloseTo(0.2,4);
  const track=getTrack('monza');
  const meta=tyreCompoundsMeta(20,track.LENGTH);
  expect(meta.soft.lapsToCliff).toBeGreaterThanOrEqual(4);
  expect(meta.hard.lapsToCliff).toBeGreaterThan(meta.soft.lapsToCliff);

  const race=createRace(20,'monza');
  const stopCounts=new Set(race.field.map(c=>c.plannedStops?.length??0));
  expect(stopCounts.has(1)).toBe(true);
  expect(stopCounts.has(2)).toBe(true);

  race.phase='racing';
  for(let i=0;i<600;i++)advanceField(race,track,1/30);
  expect(race.field.every(c=>(c.wear??0)>0)).toBe(true);
  expect(race.field.every(c=>(c.tyreAge??0)>0)).toBe(true);
 });

 it('lets AI cars pit opportunistically under Safety Car when tyres are worn',()=>{
  const race=createRace(20,'monza'),track=getTrack('monza');
  race.phase='racing';
  applyHazard(race,track,{kind:'safety-car',when:'now'});
  const ai=race.field[0];
  ai.wear=.48;
  ai.distance=track.PIT_ENTRY-400;
  ai.plannedStops=[12];
  advanceField(race,track,1/30);
  expect(ai.weatherPit).toBeDefined();
 });

 it('enforces the mandatory two-dry-compound rule on dry races and exempts wet races',()=>{
  const dry=createRace(3,'monza'),track=getTrack('monza');
  dry.phase='racing';dry.field=[];
  const a=dry.cars.a;
  Object.assign(a,{lap:2,distance:3*track.LENGTH-.2,speed:70,compoundsUsed:['soft']});
  expect(dryCompoundRuleSatisfied(dry,a)).toBe(false);
  stepRace(dry);
  expect(a.compoundPenaltyApplied).toBe(true);
  expect(a.penalty).toBeGreaterThanOrEqual(30);

  const wet=createRace(3,'monza');
  wet.phase='racing';wet.field=[];wet.wetRace=true;
  const wa=wet.cars.a;
  Object.assign(wa,{lap:2,distance:3*track.LENGTH-.2,speed:70,compoundsUsed:['soft']});
  expect(dryCompoundRuleSatisfied(wet,wa)).toBe(true);
  stepRace(wet);
  expect(wa.compoundPenaltyApplied).toBeFalsy();
  expect(wa.penalty).toBe(0);
 });

 it('enforces fuel-empty limp mode and the FIA 1.0 kg fuel sample penalty on 10+ lap races',()=>{
  const race=createRace(20,'monza'),track=getTrack('monza');
  race.phase='racing';race.field=[];
  const empty=race.cars.a,fuelled=race.cars.b;
  Object.assign(empty,{distance:100,speed:35,fuel:0});
  Object.assign(fuelled,{distance:250,speed:35,fuel:12});
  for(let i=0;i<240;i++)stepRace(race);
  expect(empty.speed).toBeLessThan(41);
  expect(fuelled.speed).toBeGreaterThan(empty.speed+15);

  const finish=createRace(10,'monza');
  finish.phase='racing';finish.field=[];
  const c=finish.cars.a;
  Object.assign(c,{lap:9,distance:10*track.LENGTH-.2,speed:65,fuel:FIA_MIN_FUEL_KG-.4,compoundsUsed:['soft','hard']});
  stepRace(finish);
  expect(c.fuelPenaltyApplied).toBe(true);
  expect(c.penalty).toBeGreaterThanOrEqual(30);
 });

 it('shreds and overheats wet and intermediate tyres on dry asphalt',()=>{
  const race=createRace(20,'monza');
  race.phase='racing';race.field=[];
  const wetCar=race.cars.a,slickCar=race.cars.b;
  wetCar.compound='wet';slickCar.compound='medium';
  Object.assign(wetCar,{distance:200,speed:60});
  Object.assign(slickCar,{distance:500,speed:60});
  for(let i=0;i<720;i++)stepRace(race);
  expect(wetCar.wear).toBeGreaterThan(slickCar.wear*2);
  expect(wetCar.temperature).toBeGreaterThan(slickCar.temperature+6);
 });

 it('adds realistic wing-repair time to pit stops and decrements finite tyre sets',()=>{
  expect(damageRepairSeconds(undefined)).toBe(0);
  expect(damageRepairSeconds([.6,0,0,0])).toBeGreaterThan(2);
  const race=createRace(20,'monza'),track=getTrack('monza');
  race.phase='racing';race.field=[];
  const c=race.cars.a;
  const hardBefore=c.tyreSets!.hard;
  c.pit='stopped';c.instruction.tyre='hard';c.pitTime=track.PIT_STOP_SECONDS-DT;
  stepRace(race);
  expect(c.compound).toBe('hard');
  expect(c.tyreSets!.hard).toBe(hardBefore-1);
  expect(c.compoundsUsed).toContain('hard');
 });
});

describe('Jev drivability physics, perception, and cockpit feedback',()=>{
 it('applies speedBias and brakeAggression tradeoffs including lockups on worn tyres',()=>{
  const base=createRace(20,'monza'),track=getTrack('monza');
  base.phase='racing';base.field=[];
  const fast=structuredClone(base),slow=structuredClone(base);
  // Position approaching first chicane braking zone
  fast.cars.a.distance=slow.cars.a.distance=850;
  fast.cars.a.speed=slow.cars.a.speed=82;
  fast.cars.a.intent.speedBias=2;fast.cars.a.intent.brakeAggression=.9;
  slow.cars.a.intent.speedBias=-2;slow.cars.a.intent.brakeAggression=.2;
  expect(racingSpeed(fast.cars.a,fast.cars.b,track)).toBeGreaterThan(racingSpeed(slow.cars.a,slow.cars.b,track));

  // Verify lockup triggers under heavy late braking on worn tyres
  const lockRace=createRace(20,'monza');
  lockRace.phase='racing';lockRace.field=[];
  Object.assign(lockRace.cars.a,{distance:820,speed:88,wear:.72});
  lockRace.cars.a.intent={...lockRace.cars.a.intent,brakeAggression:.9,speedBias:2};
  let sawLockup=false;
  for(let i=0;i<240;i++){
   stepRace(lockRace);
   if(lockRace.cars.a.lockup){sawLockup=true;break;}
  }
  expect(sawLockup).toBe(true);
 });

 it('sends enriched perception to Jev and accepts expanded cockpit feedback replies',async()=>{
  const race=createRace(20,'monza');
  race.phase='racing';
  race.cars.a.distance=1200;race.cars.a.wear=.64;race.cars.a.fuel=18.5;
  race.cars.a.eligible=[true,false];
  let sentState:Record<string,unknown>|null=null;
  const driver=createRaceDriver(
   {mock:false,provider:'typesafe',apiKey:'fixture-only',baseURL:'https://api.typesafe.ai',model:'jev-latest'},
   async(_input,init)=>{
    const body=JSON.parse(String(init?.body));
    sentState=body.state;
    const ans=(c:string)=>({type:'choice',choice:c,confidence:.9,probabilities:{[c]:1}});
    return new Response(JSON.stringify({
     model:'jev-latest',
     answers:{line:ans('hold'),pace:ans('cautious'),brake:ans('early'),ers:ans('no'),drs:ans('yes'),reply:ans('graining')},
    }),{headers:{'content-type':'application/json'}});
   },
  );
  const decision=await driver(race,'a',1);
  expect(decision.source).toBe('jev');
  expect(decision.intent.reply).toContain('graining');
  expect(sentState).toMatchObject({
   lap:1,totalLaps:20,compound:'soft',drsEligible:true,pitPhase:'none',
  });
  expect(sentState!.racingLineOffset).toBeTypeOf('number');
  expect(sentState!.distanceToPitCommitment).toBeTypeOf('number');
  expect(Array.isArray(sentState!.nearbyTraffic)).toBe(true);
 });
});

describe('Composable radio orders, tactical physics, unspoiled telemetry, and triggers',()=>{
 it('supports composable box+push+deploy, cover, extend, harvest, finite-set validation, and next-lap boxing',()=>{
  const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'monza',true,20);
  room.live='running';room.race.phase='racing';room.race.cars.a.distance=200;
  room.enableChatStrategy();room.advance(1);
  const car=room.race.cars.a;

  // Composable in-lap push: box + pace=push + budget_kj + zone=any + revisit_condition
  const evt1=room.strategyEvents!.pending!.event;
  const combo=radioInput.parse({
   room:room.id,event_id:evt1.event_id,action:'box',tyre:'hard',pace:'push',budget_kj:600,zone:'any',
   revisit_condition:'Check rejoin gap after stop',radio:'Box this lap for hards, push hard on the in-lap!',
  });
  const inst1=radioInstruction(room.race,car,combo)!;
  expect(inst1).toMatchObject({box:true,tyre:'hard',pace:'push',ers:'deploy',revisit:'Check rejoin gap after stop'});
  expect(inst1.energy).toMatchObject({budgetKJ:600,zone:'any'});

  // Finite tyre set check rejects unavailable compound
  car.tyreSets!.hard=0;
  expect(radioInstruction(room.race,car,combo)).toBeNull();
  car.tyreSets!.hard=2;

  // cover sets box + push + in-lap ERS deploy
  const coverInst=radioInstruction(room.race,car,radioInput.parse({
   room:room.id,event_id:evt1.event_id,action:'cover',tyre:'medium',radio:'Cover the undercut!',
  }))!;
  expect(coverInst).toMatchObject({box:true,tyre:'medium',pace:'push',ers:'deploy'});

  // extend clears un-committed box and conserves
  car.instruction.box=true;
  const extendInst=radioInstruction(room.race,car,radioInput.parse({
   room:room.id,event_id:evt1.event_id,action:'extend',radio:'Stay out and extend the stint.',
  }))!;
  expect(extendInst).toMatchObject({box:false,pace:'manage',ers:'harvest'});

  // harvest clears energy order
  const harvestInst=radioInstruction(room.race,car,radioInput.parse({
   room:room.id,event_id:evt1.event_id,action:'harvest',radio:'Harvest this lap.',
  }))!;
  expect(harvestInst.ers).toBe('harvest');
  expect(harvestInst.energy).toBeUndefined();

  // box_lap: next-lap queues pendingBox instead of boxing this lap
  const res=room.submitStrategyEvent(radioInput.parse({
   room:room.id,event_id:evt1.event_id,action:'box',tyre:'medium',box_lap:'next-lap',pace:'push',
   radio:'Push this lap, box next lap for mediums.',
  }));
  expect(res).toMatchObject({team:'a'});
  expect(car.instruction.box).toBe(false);
  expect(car.instruction.pace).toBe('push');
  // Crossing onto lap 2 activates queued box
  car.lap=1;car.distance=getTrack('monza').LENGTH+20;
  room.advance(1);
  expect(car.instruction.box).toBe(true);
  expect(car.instruction.tyre).toBe('medium');
 });

 it('executes single-car yield, teammate swap, and conditional defensive energy auto-release',()=>{
  const race=createRace(20,'monza'),track=getTrack('monza');
  race.phase='racing';
  const a=race.cars.a;
  const mate=teammateEntry('a')!;
  const lec=race.field[mate.index];

  // Single-car yield to LEC auto-clears once LEC passes
  a.distance=240;a.speed=65;a.offset=0;
  lec.distance=228;lec.speed=72;lec.offset=0;
  a.instruction={...a.instruction,yieldUntilLap:1,yieldTarget:mate.entry.code};
  for(let i=0;i<480&&a.instruction.yieldUntilLap;i++)stepRace(race);
  expect(lec.distance).toBeGreaterThan(a.distance);
  expect(a.instruction.yieldUntilLap).toBeUndefined();

  // Teammate swap: LEC ahead of HAM slows and pulls aside
  const swapRace=createRace(20,'monza');
  swapRace.phase='racing';
  const sa=swapRace.cars.a,slec=swapRace.field[mate.index];
  sa.distance=200;sa.speed=70;slec.distance=212;slec.speed=70;
  sa.instruction={...sa.instruction,teamOrder:{kind:'swap',issuedLap:0,expiresLap:2}};
  for(let i=0;i<600&&!sa.instruction.teamOrder?.completed;i++)stepRace(swapRace);
  expect(sa.instruction.teamOrder?.completed).toBe(true);

  // Conditional energy release flips defend -> attack when gap behind > threshold
  const condRace=createRace(20,'monza');
  condRace.phase='racing';condRace.field=[];
  condRace.cars.a.distance=2000;condRace.cars.a.speed=70;condRace.cars.a.lastLap=85;
  condRace.cars.b.distance=1700;condRace.cars.b.speed=68; // > 4s behind
  condRace.cars.a.instruction={
   ...condRace.cars.a.instruction,ers:'deploy',tactic:'defend',
   energy:{priority:'defend',budgetKJ:500,expiresLap:2,startJoules:0,releaseAttackIfBehindGtS:2.0},
  };
  stepRace(condRace);
  expect(condRace.cars.a.instruction.energy?.priority).toBe('attack');
  expect(condRace.cars.a.instruction.tactic).toBe('attack');
  expect(track.LENGTH).toBeGreaterThan(5000);
 });

 it('produces unspoiled weather telemetry, standings, rejoin traffic, and lap-speed stable gaps',()=>{
  const race=createRace(20,'monza'),track=getTrack('monza');
  race.phase='racing';
  applyHazard(race,track,{kind:'rain',level:'moderate'});
  for(let i=0;i<600;i++)stepRaceControl(race,track,1/30);
  const a=race.cars.a;
  a.distance=2000;a.lastLap=85;a.speed=30; // slow chicane speed shouldn't distort gaps!
  race.cars.b.distance=2000+track.LENGTH/85*2; // exactly 2.0s ahead at lap speed
  a.lastDriverReport='Fronts are graining through the medium-speed corners.';
  const obs=observeStrategy(race,'a');

  expect((obs.weather as Record<string,unknown>).recommendedCompound).toBeUndefined();
  expect(obs.weather.sectorWetness).toHaveLength(3);
  expect(obs.weather.wetGripByCompound.intermediate).toBeGreaterThan(obs.weather.wetGripByCompound.soft);
  expect(obs.standings.length).toBeGreaterThan(2);
  expect(obs.standings.some(s=>s.isTeammate)).toBe(true);
  expect(obs.standings.some(s=>s.isRivalPlayer)).toBe(true);
  expect(obs.pit.estimatedRejoinPosition).toBeGreaterThanOrEqual(1);
  expect(obs.tyres.dryCompoundRuleSatisfied).toBe(true); // Wet race exempts 2-dry-compound rule
  expect(observeStrategy(createRace(20,'monza'),'a').tyres.dryCompoundRuleSatisfied).toBe(false);
  expect(obs.tyres.availableSets.hard).toBeGreaterThan(0);
  expect(obs.fuel.fiaMinimumSampleKg).toBe(1);
  expect(obs.driverFeedback).toContain('graining');

  // Verify lap-speed stable gap vs instantaneous speed
  const gaps=sectorGaps(race,'a');
  expect(gaps.ahead).not.toBeNull();
  // Even though car speed is 30 m/s, gap uses lastLap speed (~68 m/s), so gap <= 2.1s
  expect(gaps.ahead!).toBeLessThan(2.5);
 });

 it('fires a pre-pit-commitment window in S3 and supersedes stale pending events on urgent changes',()=>{
  const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'monza',true,20);
  room.live='running';room.race.phase='racing';
  const track=getTrack('monza'),car=room.race.cars.a;
  car.distance=200;
  room.enableChatStrategy();
  room.advance(1);
  const opening=room.strategyEvents!.pending!.event;

  // Move into S3 pre-pit-commitment window with worn tyres while opening event is unanswered
  car.wear=.55;
  car.distance=pitCommitmentPoint(track.PIT_ENTRY)-500;
  room.advance(1);
  const pitWindowEvent=room.strategyEvents!.pending!.event;
  expect(pitWindowEvent.event_id).not.toBe(opening.event_id);
  expect(pitWindowEvent.reasons).toContain('Pre-pit commitment window');
  // Opening event was superseded and is no longer active
  expect(room.readStrategyEvent(opening.event_id)).toBeUndefined();
 });

 it('projects healthy fuel at race start, ignores pit/SC lap outliers, and still alerts on genuine low fuel',()=>{
  for(const circuit of ['monza','las-vegas'] as const){
   const track=getTrack(circuit);
   for(const laps of [3,10,20]){
    const race=createRace(laps,circuit);
    expect(projectFuelAtFlag(race,'a')).toBeGreaterThan(FIA_MIN_FUEL_KG+.5);
    expect(observeStrategy(race,'a').fuel.marginAboveSampleKg).toBeGreaterThan(.5);
    expect(mockEngineer(race,'a').fuelSave).toBeUndefined();
   }

   // Opening RaceRoom strategy event should not fire a false FIA fuel shortfall alert on Lap 1
   const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5278',{JEV_MOCK:'1'},1,'jev-vs-jev',{},circuit,true,20);
   room.live='running';room.race.phase='racing';
   room.enableChatStrategy();
   room.advance(1);
   const opening=room.strategyEvents!.pending!.event;
   expect(opening.reasons).not.toContain('Fuel margin below FIA 1.0 kg sample');
   expect(opening.summary.marginAboveFuelSampleKg).toBeGreaterThan(.5);

   // Slow pit-stop / safety-car lap (190s) must not cause a phantom fuel shortfall across remaining laps
   const car=room.race.cars.a;
   car.lap=6;
   car.distance=6*track.LENGTH;
   car.fuel=car.fuel-6*(circuit==='las-vegas'?2.18:1.92);
   car.bestLap=circuit==='las-vegas'?98:88;
   car.lastLap=190;
   expect(projectFuelAtFlag(room.race,'a')).toBeGreaterThan(FIA_MIN_FUEL_KG+.5);

   // Genuine low fuel still triggers lift-and-coast and the FIA fuel margin strategy alert
   car.fuel-=3.0;
   expect(projectFuelAtFlag(room.race,'a')).toBeLessThan(FIA_MIN_FUEL_KG);
   expect(mockEngineer(room.race,'a').fuelSave).toBeDefined();
   room.advance(1);
   const lowFuelEvent=room.strategyEvents!.pending!.event;
   expect(lowFuelEvent.reasons).toContain('Fuel margin below FIA 1.0 kg sample');
   expect(lowFuelEvent.summary.marginAboveFuelSampleKg).toBeLessThan(0);
  }
 });
});
