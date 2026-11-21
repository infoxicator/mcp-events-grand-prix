import {expect,test} from 'vitest';
import {RaceRoom} from '../server/race-room';
import {radioInput} from '../server/strategy-events';
import {applyHazard,stepRaceControl,weatherTyre,wetGrip,type Hazard} from '../src/race/race-control';
import {createRace,DT,stepRace} from '../src/race/physics';
import {mockEngineer} from '../src/race/brains';
import {observeStrategy} from '../src/race/strategy-observation';
import {getTrack} from '../src/race/track';

const track=getTrack('monza');
function onTrack(){
 const race=createRace(5,track.id);
 race.phase='racing';
 race.field=[];
 Object.assign(race.cars.a,{distance:900,speed:57});
 Object.assign(race.cars.b,{distance:880,speed:68,offset:4});
 return race;
}

test('a physical safety car enters ahead of the leader and reduces pit loss',()=>{
 const race=onTrack(),green=observeStrategy(race,'a');
 expect(applyHazard(race,track,{kind:'safety-car',when:'now'})).toBe(true);
 const safety=race.control!.safetyCar!;
 expect(safety.distance).toBeGreaterThan(race.cars.a.distance);
 const startingPosition=safety.distance;
 for(let tick=0;tick<1200;tick++)stepRace(race);
 expect(safety.distance).toBeGreaterThan(startingPosition+250);
 expect(race.cars.a.distance).toBeLessThan(safety.distance);
 expect(race.cars.b.distance).toBeLessThan(race.cars.a.distance);
 expect(observeStrategy(race,'a').pit.pitLossSeconds).toBeLessThan(green.pit.pitLossSeconds);
});

test('queued second safety car deploys as the leader starts the next lap',()=>{
 const race=onTrack();
 applyHazard(race,track,{kind:'safety-car',when:'now'});
 const first=race.control!.safetyCar;
 expect(applyHazard(race,track,{kind:'safety-car',when:'next-lap'})).toBe(true);
 expect(applyHazard(race,track,{kind:'safety-car',when:'next-lap'})).toBe(false);
 race.cars.a.distance=track.LENGTH-2;
 stepRaceControl(race,track,DT);
 expect(race.control!.safetyCar).toBe(first);
 expect(race.control!.queuedSafetyCarLap).toBe(2);
 race.cars.a.distance=track.LENGTH+1;
 stepRaceControl(race,track,DT);
 expect(race.control).toMatchObject({change:'Safety car deployed',safetyCar:{releaseDistance:2*track.LENGTH+1}});
 expect(race.control!.safetyCar).not.toBe(first);
 expect(race.control!.queuedSafetyCarLap).toBeUndefined();
 race.cars.a.distance=2*track.LENGTH+1;
 stepRaceControl(race,track,DT);
 expect(race.control).toMatchObject({change:'Safety car in'});
 expect(race.control!.safetyCar).toBeUndefined();
});

test.each(['green','yellow'] as const)('scheduled safety car enters the pits and the next lap begins under %s',flag=>{
 const race=onTrack();
 expect(applyHazard(race,track,{kind:'safety-car-in'})).toBe(false);
 applyHazard(race,track,{kind:'safety-car',when:'now'});
 applyHazard(race,track,{kind:'safety-car',when:'next-lap'});
 if(flag==='yellow')applyHazard(race,track,{kind:'yellow',active:true});
 expect(applyHazard(race,track,{kind:'safety-car-in'})).toBe(true);
 expect(applyHazard(race,track,{kind:'safety-car-in'})).toBe(false);
 expect(applyHazard(race,track,{kind:'safety-car',when:'next-lap'})).toBe(false);
 expect(observeStrategy(race,'a').raceControl).toMatchObject({
  flag:'safety-car',safetyCarInLap:2,safetyCarScheduledLap:null,speedLimitKph:145,
 });
 const safety=race.control!.safetyCar!;
 race.cars.a.distance=track.PIT_ENTRY+100;
 safety.distance=track.PIT_ENTRY+160;
 safety.offset=0;
 stepRaceControl(race,track,DT);
 expect(safety.offset).toBeLessThan(0);
 race.cars.a.distance=track.LENGTH-.1;
 stepRaceControl(race,track,DT);
 expect(race.control!.safetyCar).toBe(safety);
 race.cars.a.distance=track.LENGTH;
 stepRaceControl(race,track,DT);
 expect(race.control!.safetyCar).toBeUndefined();
 expect(observeStrategy(race,'a').raceControl).toMatchObject({
  flag,change:'Safety car in',safetyCarInLap:null,speedLimitKph:flag==='yellow'?160:null,
 });
});

test('yellow flags slow and hold position across lanes even with full-throttle driver controls',()=>{
 const race=onTrack();
 const field={distance:885,speed:60,offset:-4,finishTime:null,service:0};
 race.field.push(field);
 applyHazard(race,track,{kind:'yellow',active:true});
 const attack={throttle:1,brake:0,steering:0};
 for(let tick=0;tick<900;tick++)stepRace(race,{a:attack,b:attack});
 for(const car of [race.cars.a,race.cars.b,field])expect(car.speed*3.6).toBeLessThanOrEqual(161);
 expect(race.cars.a.distance).toBeGreaterThan(field.distance);
 expect(field.distance).toBeGreaterThan(race.cars.b.distance);
 expect(race.cars.a.drs).toBe(false);
 race.time=30;
 stepRaceControl(race,track,DT);
 expect(observeStrategy(race,'a').raceControl).toMatchObject({flag:'green',change:'Yellow flags cleared'});
});

test.each([
 ['light','soft'],['moderate','intermediate'],['heavy','wet'],
] as const)('%s rain changes the surface and recommends %s tyres', (level,tyre)=>{
 const race=onTrack();
 applyHazard(race,track,{kind:'rain',level});
 stepRaceControl(race,track,30);
 const wetness=race.control!.wetness;
 expect(wetness).toBeGreaterThan(0);
 expect(weatherTyre(race.control,'soft')).toBe(tyre);
 expect(wetGrip(tyre,wetness)).toBeGreaterThanOrEqual(wetGrip('soft',wetness));
 expect(mockEngineer(race,'a')).toMatchObject({box:tyre!=='soft',tyre});
 applyHazard(race,track,{kind:'rain',level:'dry'});
 stepRaceControl(race,track,16);
 expect(race.control!.wetness).toBeLessThan(wetness);
});

test('a field car can make a weather stop outside its regular pit window',()=>{
 const race=onTrack();
 const field={distance:track.LENGTH+track.PIT_ENTRY-240,speed:43,offset:0,finishTime:null,service:0,compound:'medium' as const};
 race.field.push(field);
 applyHazard(race,track,{kind:'rain',level:'moderate'});
 for(let tick=0;tick<30/DT&&race.field[0].compound!=='intermediate';tick++)stepRace(race);
 expect(race.field[0]).toMatchObject({compound:'intermediate',pit:'stopped'});
 expect(race.field[0].distance).toBeGreaterThan(track.LENGTH+track.PIT_ENTRY);
});

test('a live spectator creates a fresh strategy event for each incident and wet radio fits tyres',async()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{JEV_MOCK:'1'},1,'jev-vs-jev',{},track.id,true,5);
 room.live='running';room.viewerKey='viewer';room.race=onTrack();
 const strategy=room.enableChatStrategy(),notices:string[]=[];
 strategy.subscribe(event=>notices.push(event.event_id));
 room.advance(1);
 const original=strategy.pending!.event;
 const peer=room.add(()=>{});
 await room.message(peer,{type:'race-control',hazard:{kind:'yellow',active:true}});
 expect(notices).toHaveLength(1);
 await room.message(peer,{type:'join',team:null,token:room.viewerKey});
 const change=async(hazard:Hazard)=>{await room.message(peer,{type:'race-control',hazard});return strategy.pending!.event;};
 const safety=await change({kind:'safety-car',when:'now'});
 expect(safety).toMatchObject({reasons:['Safety car deployed'],summary:{flag:'safety-car',speedLimitKph:145}});
 expect(room.readStrategyEvent(original.event_id)).toBeUndefined();
 const scheduled=await change({kind:'safety-car',when:'next-lap'});
 expect(scheduled.summary.safetyCarScheduledLap).toBe(2);
 const yellow=await change({kind:'yellow',active:true});
 expect(yellow.observation.raceControl.yellow).toBe(true);
 const heavy=await change({kind:'rain',level:'heavy'});
 expect(heavy).toMatchObject({reasons:['Heavy rain started'],summary:{rain:'heavy',recommendedCompound:'wet'}});
 expect(await change({kind:'rain',level:'heavy'})).toBe(heavy);
 expect(new Set(notices).size).toBe(5);
 const order=radioInput.parse({room:room.id,event_id:heavy.event_id,action:'box',tyre:'wet',radio:'Box for full wets under the safety car.'});
 expect(room.submitStrategyEvent({...order,event_id:yellow.event_id})).toHaveProperty('error');
 expect(room.submitStrategyEvent(order)).toMatchObject({team:'a'});
 expect(room.state().latestChatRadio?.a).toMatchObject({text:order.radio});
 const car=room.race.cars.a;
 Object.assign(car,{pit:'stopped',distance:track.PIT_STOP,pitTime:track.PIT_STOP_SECONDS-DT});
 stepRace(room.race);
 expect(car).toMatchObject({compound:'wet',stops:1,pit:'exit'});
});

test('race control still reaches the strategist in the pit lane and a caution call preserves the planned tyre',async()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{JEV_MOCK:'1'},1);
 room.live='running';room.viewerKey='viewer';room.race=onTrack();
 const strategy=room.enableChatStrategy(),car=room.race.cars.a;
 car.pit='stopped';
 car.instruction={...car.instruction,box:true,tyre:'intermediate'};
 const peer=room.add(()=>{});
 await room.message(peer,{type:'join',team:null,token:room.viewerKey});
 await room.message(peer,{type:'race-control',hazard:{kind:'yellow',active:true}});
 const event=strategy.pending!.event;
 expect(room.readStrategyEvent(event.event_id)?.observation).toMatchObject({raceControl:{flag:'yellow'},pit:{phase:'stopped',plannedCompound:'intermediate'}});
 const radio='Yellow flags. Hold position after the stop.';
 expect(room.submitStrategyEvent({room:room.id,event_id:event.event_id,action:'manage',radio})).toMatchObject({team:'a',line:radio});
 expect(car.instruction).toMatchObject({box:true,tyre:'intermediate'});
});

test('the strategist receives the safety car return announcement and a fresh event at the restart',async()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{JEV_MOCK:'1'},1);
 room.live='running';room.viewerKey='viewer';room.race=onTrack();
 const strategy=room.enableChatStrategy(),peer=room.add(()=>{});
 await room.message(peer,{type:'join',team:null,token:room.viewerKey});
 await room.message(peer,{type:'race-control',hazard:{kind:'safety-car',when:'now'}});
 await room.message(peer,{type:'race-control',hazard:{kind:'safety-car-in'}});
 const scheduled=strategy.pending!.event;
 expect(scheduled).toMatchObject({reasons:['Safety car in at start of lap 2'],summary:{flag:'safety-car',safetyCarInLap:2}});
 room.race.cars.a.distance=track.LENGTH;
 room.advance(1);
 expect(room.readStrategyEvent(scheduled.event_id)).toBeUndefined();
 expect(strategy.pending!.event).toMatchObject({reasons:['Safety car in'],summary:{flag:'green',safetyCarInLap:null}});
});
