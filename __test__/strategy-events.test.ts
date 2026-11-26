import {afterEach,expect,test,vi} from 'vitest';
import {RaceRoom} from '../server/race-room';
import {driverAnswerInput,radioInput} from '../server/strategy-events';
import {STRATEGY_RESPONSE_MS,type StrategyEventNotice} from '../src/race/strategy-events';
import {createRace,stepRace} from '../src/race/physics';
import {getTrack} from '../src/race/track';
import type {ServerMessage} from '../src/race/types';

function liveRace(){
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'monza',true);
 room.live='running';
 room.race.phase='racing';
 room.race.cars.a.distance=10;
 room.enableChatStrategy();
 room.advance(1);
 return room;
}
afterEach(()=>vi.restoreAllMocks());

test('answers a driver consultation over radio without consuming or changing a strategy order',async()=>{
 const room=liveRace();
 room.strategyPractice=true;
 room.strategyDriverKeys={a:crypto.randomUUID()};
 const messages:ServerMessage[]=[];
 const driver=room.add(message=>messages.push(structuredClone(message)));
 room.join(driver,'a',room.strategyDriverKeys.a!);
 await room.message(driver,{type:'event-log',subscribe:true});
 const order=room.strategyEvents!.pending!.event;
 const notices:(StrategyEventNotice&{event_id:string})[]=[];
 const unsubscribe=room.strategyEvents!.subscribe(notice=>notices.push(notice));
 const question='Can I keep this pace on these tyres?';
 await room.message(driver,{type:'strategy-question',text:` ${question} `});
 expect(notices).toHaveLength(2);
 const notice=notices[1];
 expect(notice).toMatchObject({
  room:room.id,team:'a',reasons:['Driver question'],driverQuestion:{text:question,source:'driver'},
 });
 expect(notice.event_id).not.toBe(order.event_id);
 expect(room.readDriverQuestion(notice.event_id,'b')).toBeUndefined();
 expect(room.readLiveStrategyEvent(notice.event_id,'a')?.observation.tyres.compound).toBe('soft');
 expect(room.readLiveStrategyEvent(undefined,'a')?.event_id).toBe(order.event_id);
 const orderInput={room:room.id,event_id:notice.event_id,action:'push',radio:'Push now.'} as const;
 expect(room.submitStrategyEvent(orderInput)).toHaveProperty('error');
 const car=room.race.cars.a,instruction=car.instruction,intent=car.intent;
 const reply={room:room.id,event_id:notice.event_id,reply:' Keep this pace until the gap opens. '};
 expect(room.answerDriver({...reply,room:crypto.randomUUID()})).toHaveProperty('error');
 expect(room.answerDriver({...reply,team:'b'})).toHaveProperty('error');
 expect(room.answerDriver({...reply,reply:'   '})).toHaveProperty('error');
 expect(room.answerDriver(reply)).toEqual({team:'a',line:reply.reply.trim()});
 expect(room.answerDriver(reply)).toHaveProperty('error');
 expect(room.readDriverQuestion(notice.event_id)).toBeUndefined();
 expect(car.instruction).toBe(instruction);
 expect(car.intent).toBe(intent);
 expect(room.strategyEvents!.pending!.event).toBe(order);
 expect(room.state().latestChatRadio).toBeUndefined();
 const lines=room.state().driverConsultRadio!.a!;
 expect(lines).toMatchObject([
  {consultation:'question',speaker:'DRIVER',text:question},
  {consultation:'answer',speaker:'ENGINEER',strategist:'chatgpt',text:reply.reply.trim()},
 ]);
 expect(lines[0].consultationId).toBe(lines[1].consultationId);
 expect(lines[0].consultationId).not.toBe(notice.event_id);
 expect(room.race.radio).toEqual(expect.arrayContaining(lines));
 expect(room.race.events.map(event=>event.message)).toEqual(expect.arrayContaining([question,reply.reply.trim()]));
 const logged=messages.flatMap(message=>message.type==='event-log'?message.entries:[]);
 expect(logged.map(entry=>entry.data)).toEqual(expect.arrayContaining([
  expect.objectContaining({kind:'radio',consultation:'question',text:question}),
  expect.objectContaining({kind:'radio',consultation:'answer',text:reply.reply.trim()}),
 ]));
 expect(JSON.stringify(messages)).not.toContain(notice.event_id);
 expect(JSON.stringify(room.state())).not.toContain(room.elicitationKey);
 unsubscribe();
});

test('limits driver consults to racing seats and expires unanswered questions',async()=>{
 const room=liveRace();
 room.strategyPractice=true;
 room.viewerKey=crypto.randomUUID();
 const messages:ServerMessage[]=[];
 const viewer=room.add(message=>messages.push(message));
 room.join(viewer,null,room.viewerKey);
 await room.message(viewer,{type:'strategy-question',text:'How are the tyres?'});
 expect(messages.at(-1)).toMatchObject({type:'error',code:'strategy-question'});
 expect(room.state().driverConsultRadio).toBeUndefined();
 room.enableChatStrategy(undefined,'b');
 room.strategyWebhook='waiting';
 expect(room.askDriverQuestion('a','Are you on the radio?').error).toContain('disconnected');
 expect(room.state().driverConsultRadio).toBeUndefined();
 room.strategyWebhook='connected';
 const first=room.askDriverQuestion('a','Any traffic to worry about?');
 const guest=room.askDriverQuestion('b','Can we extend this stint?');
 expect(first.error??guest.error).toBeUndefined();
 expect(room.askDriverQuestion('a','Another question?')).toHaveProperty('error');
 expect(room.answerDriver({room:room.id,event_id:first.event_id!,team:'b',reply:'Keep going.'})).toHaveProperty('error');
 room.releaseGuestStrategy();
 expect(room.readDriverQuestion(guest.event_id!)).toBeUndefined();
 expect(room.readDriverQuestion(first.event_id!)).toBeDefined();
 const order=room.strategyEvents!.pending!.event;
 expect(room.submitStrategyEvent({room:room.id,event_id:order.event_id,action:'hold',radio:'Hold this pace.'})).toMatchObject({team:'a'});
 expect(room.readLiveStrategyEvent(undefined,'a')).toMatchObject({proactive:true});
 expect(room.readLiveStrategyEvent(undefined,'a')?.event_id).toBeUndefined();
 expect(room.readDriverQuestion(first.event_id!)).toBeDefined();
 const expiresAt=room.readDriverQuestion(first.event_id!)!.expiresAt;
 vi.spyOn(Date,'now').mockReturnValue(expiresAt);
 expect(room.readDriverQuestion(first.event_id!)).toBeUndefined();
 expect(room.answerDriver({room:room.id,event_id:first.event_id!,reply:'Keep going.'})).toHaveProperty('error');
 expect(room.askDriverQuestion('a','Any update?')).toHaveProperty('event_id');
 room.finishLive('stopped');
 expect(room.askDriverQuestion('a','Are we done?')).toHaveProperty('error');
});

test('offers one automatic contextual question from lap two and lets the driver replace it',()=>{
 const room=liveRace(),track=getTrack(room.race.circuit);
 const notices:{event_id:string;driverQuestion?:{text:string;source:string}}[]=[];
 room.strategyEvents!.subscribe(notice=>notices.push(notice));
 expect(notices).toHaveLength(1);
 expect(notices[0].driverQuestion).toBeUndefined();
 const car=room.race.cars.a;
 car.lap=1;
 car.distance=track.LENGTH+10;
 room.driverMode.a='human';
 room.advance(1);
 expect(notices.filter(notice=>notice.driverQuestion)).toHaveLength(0);
 room.driverMode.a='autopilot';
 room.advance(24);
 const questions=notices.filter(notice=>notice.driverQuestion);
 expect(questions).toHaveLength(1);
 expect(questions[0].driverQuestion).toMatchObject({source:'automatic',text:expect.stringContaining(car.compound)});
 const manual=room.askDriverQuestion('a','Is it time to box?');
 expect(manual).toHaveProperty('event_id');
 expect(room.answerDriver({room:room.id,event_id:questions[0].event_id,reply:'Save the tyres.'})).toHaveProperty('error');
 expect(room.answerDriver({room:room.id,event_id:manual.event_id!,reply:'Tyres look good.'})).toMatchObject({team:'a'});
 room.advance(24);
 expect(notices.filter(notice=>notice.driverQuestion?.source==='automatic')).toHaveLength(1);
});

test('declining releases the driver question without adding a radio transmission',()=>{
 const room=liveRace();
 const {event_id}=room.askDriverQuestion('a','Should I look after the rears?');
 const input={room:room.id,event_id:event_id!};
 expect(driverAnswerInput.safeParse({...input,reply:'  '}).success).toBe(false);
 expect(room.answerDriver(driverAnswerInput.parse(input))).toEqual({team:'a',sent:false});
 expect(room.state().driverConsultRadio?.a).toHaveLength(1);
 expect(room.askDriverQuestion('a','Can you update me on the gap?')).toHaveProperty('event_id');
 expect(room.answerDriver({...input,reply:'Stay on the throttle.'})).toHaveProperty('error');
});

test('offers an immutable telemetry snapshot and applies the approved action once through radio',()=>{
 const room=liveRace();
 const pending=room.strategyEvents!.pending!;
 const {event}=pending,car=room.race.cars.a;
 expect(event.observation).toMatchObject({team:'a',tyres:{compound:'soft'},weather:{outlook:'dry'}});
 const replayed:string[]=[];
 const close=room.strategyEvents!.subscribe(notice=>replayed.push(notice.event_id));
 expect(replayed).toEqual([event.event_id]);
 close();
 car.splits[0]=999;
 expect(room.readStrategyEvent(event.event_id)?.observation.sectorTimes[0]).not.toBe(999);
 const input=radioInput.parse({room:room.id,event_id:event.event_id,action:'defend',budget_kj:500,laps:2,radio:'Hold 500 kJ for defence.'});
 expect(room.submitStrategyEvent({...input,room:crypto.randomUUID()})).toHaveProperty('error');
 expect(room.submitStrategyEvent(input)).toEqual({team:'a',line:input.radio});
 expect(car.instruction.energy).toMatchObject({priority:'defend',budgetKJ:500});
 expect(room.race.radio.at(-1)).toMatchObject({team:'a',speaker:'ENGINEER',strategist:'chatgpt',text:input.radio});
 expect(room.submitStrategyEvent(input)).toHaveProperty('error');
 room.advance(1);
 expect(room.strategyEvents!.pending).toBeUndefined();
 expect(replayed).toEqual([event.event_id]);
});

test('pins only the first applied driver reply to its accepted ChatGPT order',async()=>{
 const room=liveRace();
 const {event}=room.strategyEvents!.pending!;
 room.submitStrategyEvent({room:room.id,event_id:event.event_id,action:'manage',radio:'Look after the tyres.'});
 const call=room.state().latestChatRadio!.a!;
 expect(call.reply).toBeUndefined();
 const now=Date.now();
 room.driveLive(now);
 await vi.waitFor(()=>expect(room.state().latestChatRadio!.a!.reply).toMatchObject({team:'a',speaker:'JEV',source:'mock'}));
 const reply=room.state().latestChatRadio!.a!.reply!;
 expect(reply.id).toBeGreaterThan(call.id);
 expect(reply.text).toBe(room.race.cars.a.intent.reply);
 expect(room.race.radio.filter(line=>line.id===reply.id)).toEqual([reply]);
 room.driveLive(now+1000);
 await vi.waitFor(()=>expect(room.state().intents.a).toBe(2));
 expect(room.state().latestChatRadio!.a!.reply).toBe(reply);
});

test('does not attach a driver reply once another radio order supersedes the ChatGPT call',async()=>{
 const room=liveRace();
 const {event}=room.strategyEvents!.pending!;
 room.submitStrategyEvent({room:room.id,event_id:event.event_id,action:'hold',radio:'Hold position.'});
 room.radio('a',{...room.race.cars.a.instruction,line:'The track is clear.'},'fallback');
 room.driveLive(Date.now());
 await vi.waitFor(()=>expect(room.state().intents.a).toBe(1));
 expect(room.state().latestChatRadio!.a!.reply).toBeUndefined();
});

test('invalid orders keep the ticket available and a late pit call follows the normal commitment rule',()=>{
 const room=liveRace();
 const {event}=room.strategyEvents!.pending!;
 const input=radioInput.parse({room:room.id,event_id:event.event_id,action:'box',radio:'Box this lap.'});
 expect(room.submitStrategyEvent(input)).toHaveProperty('error');
 const {PIT_ENTRY}=getTrack();
 room.race.cars.a.distance=PIT_ENTRY-40;
 expect(room.submitStrategyEvent({...input,tyre:'hard'})).toMatchObject({line:'Past pit commitment. Box next lap.'});
 expect(room.race.cars.a.instruction.box).toBe(false);
 expect(room.state().latestChatRadio?.a).toMatchObject({
  lap:event.lap,submittedText:'Box this lap.',text:'Past pit commitment. Box next lap.',
 });
});

test('Ferrari receives the next lap call, and its pinned radio survives a full feed',()=>{
 const room=liveRace();
 const {event}=room.strategyEvents!.pending!;
 const radio='Ferrari, save your tyres.';
 expect(room.submitStrategyEvent({room:room.id,event_id:event.event_id,action:'hold',radio})).toEqual({team:'a',line:radio});
 const {LENGTH}=getTrack();
 Object.assign(room.race.cars.b,{distance:LENGTH+10,lap:1});
 room.advance(24);
 expect(room.intents.b).toBeGreaterThan(0);
 expect(room.strategyEvents!.pending).toBeUndefined();
 Object.assign(room.race.cars.a,{distance:LENGTH+10,lap:1});
 room.advance(1);
 expect(room.strategyEvents!.pending?.event).toMatchObject({team:'a',lap:2});
 for(let index=0;index<21;index++){
  room.radio('a',{...room.race.cars.a.instruction,line:`Local pit wall call ${index}`},'fallback');
 }
 expect(room.race.radio.some(entry=>entry.strategist==='chatgpt')).toBe(false);
 expect(room.state().latestChatRadio).toMatchObject({a:{lap:1,text:radio}});
 expect(room.state().latestChatRadio?.b).toBeUndefined();
});

test('an invited Mercedes seat has its own pending call and can return to game control',()=>{
 const room=liveRace(),ferrari=room.strategyEvents!.pending!.event;
 const guest=room.enableChatStrategy(undefined,'b');
 room.advance(1);
 const mercedes=guest.pending!.event;
 expect(mercedes.team).toBe('b');
 expect(mercedes.event_id).not.toBe(ferrari.event_id);
 expect(room.submitStrategyEvent({room:room.id,event_id:mercedes.event_id,action:'manage',radio:'Mercedes, manage tyres.'})).toMatchObject({team:'b'});
 expect(room.readStrategyEvent(ferrari.event_id)).toEqual(ferrari);
 expect(room.race.cars.a.instruction.pace).toBe('balanced');
 expect(room.race.cars.b.instruction.pace).toBe('manage');
 room.race.cars.b.wear=.6;
 room.advance(1);
 const next=guest.pending!.event;
 room.releaseGuestStrategy();
 expect(room.readStrategyEvent(next.event_id)).toBeUndefined();
 expect(room.readStrategyEvent(ferrari.event_id)).toEqual(ferrari);
 room.advance(24);
 expect(room.intents.b).toBeGreaterThan(0);
});

test('expired tickets cannot mutate the race, and the local pit wall covers the missed call',()=>{
 const now=vi.spyOn(Date,'now').mockReturnValue(10_000);
 const room=liveRace();
 const {event}=room.strategyEvents!.pending!;
 now.mockReturnValue(10_000+STRATEGY_RESPONSE_MS+1);
 expect(room.submitStrategyEvent({room:room.id,event_id:event.event_id,action:'push',radio:'Push.'})).toHaveProperty('error');
 room.advance(1);
 expect(room.race.radio.at(-1)).toMatchObject({team:'a',source:'fallback'});
 expect(room.strategyEvents!.pending).toBeUndefined();
 room.race.cars.a.wear=.60;
 room.advance(1);
 const second=room.strategyEvents!.pending!.event;
 room.finishLive('stopped');
 expect(room.readStrategyEvent(second.event_id)).toBeUndefined();
});

test('fuel-save assigns only its requested sector and lap window',()=>{
 const room=liveRace(),{event}=room.strategyEvents!.pending!;
 const input=radioInput.parse({room:room.id,event_id:event.event_id,action:'save-fuel',radio:'Lift in sector two.'});
 expect(room.submitStrategyEvent(input)).toHaveProperty('error');
 expect(room.submitStrategyEvent({...input,sector:2,laps:2})).toMatchObject({team:'a'});
 expect(room.race.cars.a.instruction.fuelSave).toEqual({sector:1,expiresLap:2});
});

test('tyre degradation requests a new strategy within the same lap',()=>{
 const room=liveRace();
 const first=room.strategyEvents!.pending!.event;
 room.submitStrategyEvent({room:room.id,event_id:first.event_id,action:'hold',radio:'Hold position.'});
 room.advance(1);
 expect(room.strategyEvents!.pending).toBeUndefined();
 room.race.cars.a.wear=.60;
 room.advance(1);
 const event=room.strategyEvents!.pending?.event;
 expect(event?.lap).toBe(1);
 expect(event?.reasons).toContain('Tyre wear');
 expect(event?.observation.tyres.wear).toBeGreaterThanOrEqual(.60);
});

test('race physics applies a fuel order in its sector and keeps power available in passing zones',()=>{
 function fuelAt(distance:number,save:boolean){
  const track=getTrack(),race=createRace();
  race.phase='racing';
  race.field=[];
  race.cars.b.finishTime=10;
  const car=race.cars.a;
  Object.assign(car,{distance,speed:30,offset:track.racingLineOffset(distance)});
  if(save)car.instruction.fuelSave={sector:0,expiresLap:1};
  for(let tick=0;tick<90;tick++)stepRace(race);
  return car.fuel;
 }
 expect(fuelAt(1100,true)).toBeGreaterThan(fuelAt(1100,false));
 expect(fuelAt(140,true)).toBeCloseTo(fuelAt(140,false),7);
});

test('connected ChatGPT races never emit mock engineer or mock rival radio',()=>{
 const now=vi.spyOn(Date,'now').mockReturnValue(20_000);
 const room=liveRace();
 room.strategyWebhook='connected';
 const {event}=room.strategyEvents!.pending!;
 // Solo rival Mercedes updates its AI strategy silently without mock radio entries.
 expect(room.race.radio.some(r=>r.source==='mock')).toBe(false);
 // Even if a pending strategy event expires while ChatGPT is connected, no mock fallback radio fires.
 now.mockReturnValue(20_000+STRATEGY_RESPONSE_MS+1);
 room.advance(1);
 expect(room.strategyEvents!.pending).toBeUndefined();
 expect(room.race.radio.some(r=>r.source==='fallback'||r.source==='mock')).toBe(false);
 expect(room.chatStrategy?.state).not.toBe('fallback');
 now.mockRestore();
});

test('field pit stops do not double-count on box arrival or flood events during a pit wave',()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'monza',true,10);
 room.live='running';
 room.race.phase='racing';
 room.race.cars.a.distance=100;
 const events=room.enableChatStrategy();
 const notices:string[]=[];
 events.subscribe(n=>notices.push(`${n.event_id}:${n.reasons.join('|')}`));
 room.advance(1);
 const opening=events.pending!.event;
 expect(room.submitStrategyEvent({room:room.id,event_id:opening.event_id,action:'manage',radio:'Settle in.'})).toMatchObject({team:'a'});
 room.race.time=25;
 const f0=room.race.field[0],f1=room.race.field[1],f2=room.race.field[2];
 f0.distance=room.race.cars.a.distance+50;
 f0.pit='entry';
 f0.stops=0;
 room.advance(1);
 expect(events.pending?.event.reasons).toContain('Nearby rival pitted');
 const afterEntry=notices.length;
 // Same car arrives at pit box (field-physics sets pit='stopped' AND stops=1 simultaneously): must NOT fire again.
 f0.pit='stopped';
 f0.stops=1;
 room.advance(1);
 expect(notices.length).toBe(afterEntry);
 // Additional field cars pitting in the same wave within cooldown must NOT flood duplicate events.
 f1.distance=room.race.cars.a.distance+40;f1.pit='entry';f1.stops=0;
 f2.distance=room.race.cars.a.distance+60;f2.pit='entry';f2.stops=0;
 room.advance(1);
 expect(notices.length).toBe(afterEntry);
 // Answer the pit-wave event, advance past 20s cooldown, and a later rival stop can trigger cleanly.
 expect(room.submitStrategyEvent({room:room.id,event_id:events.pending!.event.event_id,action:'extend',radio:'Stay out.'})).toMatchObject({team:'a'});
 room.race.time+=21;
 const f3=room.race.field[3];
 f3.distance=room.race.cars.a.distance+30;f3.pit='entry';f3.stops=0;
 room.advance(1);
 expect(notices.length).toBe(afterEntry+1);
 expect(events.pending?.event.reasons).toContain('Nearby rival pitted');
});

test('in-flight strategy events survive lap rollovers, pit-lane entry, and non-hazard supersedes',()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'monza',true,10);
 room.live='running';
 room.race.phase='racing';
 const track=getTrack('monza'),car=room.race.cars.a;
 car.distance=track.PIT_ENTRY-400;
 const events=room.enableChatStrategy();
 room.advance(1);
 const opening=events.pending!.event;
 expect(opening.summary).toMatchObject({
  compound:'soft',lapsRemaining:10,damage:false,pitPhase:'none',
  availableSets:expect.objectContaining({soft:expect.any(Number),wet:expect.any(Number)}),
  estimatedRejoinPosition:expect.any(Number),teammateInPitLane:false,
 });

 // Crossing into lap 2 does NOT invalidate the unanswered L1 ticket.
 car.lap=1;
 car.distance=track.LENGTH+50;
 room.advance(1);
 expect(events.pending?.event.event_id).toBe(opening.event_id);

 // Even after a non-hazard urgent event supersedes opening, submitting opening's event_id still succeeds!
 car.wear=.60;
 car.distance=track.LENGTH+track.PIT_ENTRY-500;
 room.advance(1);
 const pitEvt=events.pending!.event;
 expect(pitEvt.event_id).not.toBe(opening.event_id);
 // Passing 60m before commitment on the same lap does NOT trigger a spurious window-close event.
 car.distance=track.LENGTH+track.PIT_ENTRY-130;
 room.advance(1);
 expect(events.pending!.event.event_id).toBe(pitEvt.event_id);

 // Even if the car is in the pit lane, the superseded non-hazard ticket still applies cleanly.
 car.pit='entry';
 expect(room.submitStrategyEvent({room:room.id,event_id:opening.event_id,action:'manage',radio:'Manage tyres on the out-lap.'})).toMatchObject({team:'a'});
 expect(events.pending).toBeUndefined();
 // Duplicate submission of the consumed event_id is still rejected.
 expect(room.submitStrategyEvent({room:room.id,event_id:opening.event_id,action:'push',radio:'Duplicate.'})).toHaveProperty('error');
});

test('readLiveStrategyEvent self-heals on superseded or omitted event_id and submitStrategyEvent supports proactive calls',()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'monza',true,10);
 room.live='running';
 room.race.phase='racing';
 const track=getTrack('monza'),car=room.race.cars.a;
 car.distance=200;
 const events=room.enableChatStrategy();
 room.advance(1);
 const opening=events.pending!.event;

 // Supersede with pre-pit commitment window.
 car.wear=.60;
 car.distance=track.PIT_ENTRY-500;
 room.advance(1);
 const newer=events.pending!.event;
 expect(newer.event_id).not.toBe(opening.event_id);

 // readLiveStrategyEvent heals stale event_id by returning the newer active event.
 const healed=room.readLiveStrategyEvent(opening.event_id);
 expect(healed).toMatchObject({event_id:newer.event_id,superseded:true,team:'a'});

 // Answer newer, leaving no pending event.
 expect(room.submitStrategyEvent({room:room.id,event_id:newer.event_id,action:'push',radio:'Push now.'})).toMatchObject({team:'a'});
 expect(events.pending).toBeUndefined();

 // Omitting event_id pulls fresh proactive live telemetry and allows proactive radio calls.
 const live=room.readLiveStrategyEvent();
 expect(live).toMatchObject({team:'a',proactive:true,reasons:['Live telemetry check']});
 expect(live?.event_id).toBeUndefined();
 expect(room.submitStrategyEvent({room:room.id,action:'attack',budget_kj:400,radio:'Proactive attack with 400 kJ.'})).toMatchObject({team:'a'});
 expect(car.instruction.energy).toMatchObject({priority:'attack',budgetKJ:400});

 // In two-strategist mode, omitting event_id requires team to avoid ambiguity.
 room.enableChatStrategy(undefined,'b');
 expect(room.submitStrategyEvent({room:room.id,action:'manage',radio:'Ambiguous.'})).toHaveProperty('error');
 expect(room.submitStrategyEvent({room:room.id,team:'b',action:'manage',radio:'Mercedes, manage tyres.'})).toMatchObject({team:'b'});
});

test('a stale unanswered event refreshes on a new lap after cooldown without killing the prior ticket',()=>{
 const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5277',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'monza',true,10);
 room.live='running';
 room.race.phase='racing';
 const track=getTrack('monza'),car=room.race.cars.a;
 car.distance=200;
 const events=room.enableChatStrategy(120_000);
 room.advance(1);
 const lap1Event=events.pending!.event;

 // Advance race clock by 30s and cross into lap 2 without answering lap 1: a fresh New lap nudge fires.
 room.race.time+=30;
 car.lap=1;
 car.distance=track.LENGTH+100;
 room.advance(1);
 const lap2Event=events.pending!.event;
 expect(lap2Event.event_id).not.toBe(lap1Event.event_id);
 expect(lap2Event.reasons).toContain('New lap');

 // If ChatGPT was still answering lap1Event, it is still accepted rather than dropped.
 expect(room.submitStrategyEvent({room:room.id,event_id:lap1Event.event_id,action:'manage',radio:'Manage tyres.'})).toMatchObject({team:'a'});
 expect(events.pending).toBeUndefined();
});
