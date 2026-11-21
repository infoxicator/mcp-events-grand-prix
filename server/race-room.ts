import type {LivePhase} from '../src/race/live';
import {observeStrategy,projectFuelAtFlag,sectorGaps} from '../src/race/strategy-observation';
import {strategistDue} from '../src/race/strategy-radio';
import {pitCommitmentPoint} from '../src/race/strategy-calls';
import {getTrack,isCircuit,type CircuitId} from '../src/race/track';
import {createRace,DT,stepRace,event,other} from '../src/race/physics';
import {TEAMS,type Team,type Race,type RaceState,type Radio,type Decision,type RoomLinks,type Instruction,type ClientMessage,type ServerMessage} from '../src/race/types';
import {mockDriver,mockEngineer} from '../src/race/brains';
import {StrategyEvents,radioInstruction,type RadioInput} from './strategy-events';
import {createRaceDriver,createRaceEngineer,providerConfig} from './race-brains';
import {createLunaDriver,lunaConfig} from './luna';
import {driverRoster} from './race-drivers';
import {isMatchup,type Matchup,type DriverInfo} from '../src/race/matchup';
import {invitationCode} from '../src/race/invitation';
import {applyHazard,compounds,parseHazard} from '../src/race/race-control';
export interface Peer{send:(m:ServerMessage)=>void;team:Team|null;owner:boolean;joined:boolean;lastSeen:number;lastDecision:number;sequence:number;accepted:number;busy:boolean;}
export class RaceRoom {
 private audible:Peer|null=null;
 live?:LivePhase;
 strategyPractice?:boolean;
 viewerKey?:string;
 chatStrategy?:RaceState['chatStrategy'];
 guestChatStrategy?:RaceState['chatStrategy'];
 latestChatRadio?:RaceState['latestChatRadio'];
 strategyWebhook?:RaceState['strategyWebhook'];
 guestStrategyWebhook?:RaceState['strategyWebhook'];
 strategyEvents?:StrategyEvents;
 guestStrategyEvents?:StrategyEvents;
 private nextDrive={a:0,b:0};
 private driving={a:false,b:false};
 private driverSequence={a:0,b:0};
 race:Race;readonly peers=new Set<Peer>();readonly tokens={owner:crypto.randomUUID(),a:crypto.randomUUID(),b:crypto.randomUUID()};mcpToken:string=crypto.randomUUID();expiresAt=Date.now()+2*60*60_000;
 decisions:Record<Team,Decision|null>={a:null,b:null};intents={a:0,b:0};engineerCalls={a:0,b:0};driverStats={a:{attempts:0,successes:0,fallbacks:0},b:{attempts:0,successes:0,fallbacks:0}};paidCalls=0;history:Race[]=[];replay:Race[]=[];bestReplayScore=0;private captureUntil=0;
 private gapHistory:Record<Team,ReturnType<typeof sectorGaps>[]>={a:[],b:[]};
 private observedFieldStops:Record<Team,Set<number>>={a:new Set(),b:new Set()};
 private lastSector:Partial<Record<Team,number>>={};
 private engineerWindow:Partial<Record<Team,{lap:number;change:string;controlRevision?:number}>>={};
 private pendingBox:Partial<Record<Team,{lap:number;instruction:Instruction;source:'mock'|'live'|'fallback';responseMs:number;strategist?:'chatgpt'}>>={};
 private awaitingChatReply=new Set<Team>();
 private radioRevision={a:0,b:0};private manualUntil={a:0,b:0};private engineerBusy={a:false,b:false};private generation=0;private sequence=0;private jevDriver;private lunaDriver:ReturnType<typeof createLunaDriver>|null=null;private engineer;mode:'mock'|'mixed'|'live';players:Record<Team,DriverInfo>;
 constructor(readonly id:string,readonly origin:string,private readonly env:Record<string,string|undefined>={},readonly speed=4,public matchup:Matchup='jev-vs-jev',transports:{luna?:typeof fetch;engineer?:typeof fetch;jev?:Parameters<typeof createRaceDriver>[1]}={},circuit:CircuitId='monza',readonly solo=false,laps=3){
  this.race=createRace(laps,circuit);const roster=driverRoster(env,matchup);this.mode=roster.mode;this.players=roster.players;this.jevDriver=createRaceDriver(providerConfig(env),transports.jev);this.engineer=createRaceEngineer(env,transports.engineer);if(matchup==='jev-vs-luna')this.lunaDriver=createLunaDriver(lunaConfig(env),transports.luna);
  if(solo&&!this.players.b.mock){
   this.players.b={...this.players.b,mock:true,provider:'mock',intervalMs:200};
   this.mode=this.players.a.mock?'mock':'mixed';
  }
 }
 private reset(){this.generation++;this.race=createRace(this.race.laps,this.race.circuit);this.decisions={a:null,b:null};this.intents={a:0,b:0};this.engineerCalls={a:0,b:0};this.engineerWindow={};this.gapHistory={a:[],b:[]};this.observedFieldStops={a:new Set(),b:new Set()};this.lastSector={};this.pendingBox={};this.radioRevision={a:0,b:0};this.awaitingChatReply.clear();this.latestChatRadio=undefined;this.history=[];this.replay=[];this.bestReplayScore=0;this.manualUntil={a:0,b:0};this.captureUntil=0;this.broadcast();}

 connected(){if(this.live)return {a:true,b:true};return {a:[...this.peers].some(p=>p.team==='a'),b:this.solo||[...this.peers].some(p=>p.team==='b')};}
 state():RaceState{return {type:'state',room:this.id,race:this.race,connected:this.connected(),decisions:this.decisions,intents:this.intents,engineerCalls:this.engineerCalls,driverStats:this.driverStats,matchup:this.matchup,players:this.players,mode:this.mode,serverTime:Date.now(),physicsHz:120,snapshotHz:30,speed:this.speed,paidCalls:this.paidCalls,...(this.solo?{solo:true}:{}),live:this.live,strategyPractice:this.strategyPractice,strategyWebhook:this.strategyWebhook,chatStrategy:this.chatStrategy,latestChatRadio:this.latestChatRadio,guestChatStrategy:this.guestChatStrategy,guestStrategyWebhook:this.guestStrategyWebhook};}
 links():RoomLinks{const root=`${this.origin}/?room=${this.id}`;return {room:this.id,expiresAt:this.expiresAt,owner:`${root}#token=${this.tokens.owner}`,a:`${root}&team=a#token=${this.tokens.a}`,b:this.solo?'':`${root}&team=b#token=${this.tokens.b}`,spectator:`${root}&spectate`};}
 invitation(team:Team){return invitationCode(this.id,team,this.tokens[team]);}
 add(send:Peer['send']):Peer{const p:Peer={send,team:null,owner:false,joined:false,lastSeen:Date.now(),lastDecision:0,sequence:0,accepted:0,busy:false};this.peers.add(p);return p;}
 remove(p:Peer){if(this.audible===p)this.audible=null;this.peers.delete(p);this.broadcast();}
 join(p:Peer,team:Team|null,token:string){if(p.joined)return;
  if(this.live&&(!this.viewerKey||token!==this.viewerKey)){p.send({type:'error',message:'Invalid live invitation'});return;}
  p.joined=true;if(this.live){p.send({type:'joined',team:null,canReset:false});p.send(this.state());return;}
  p.owner=token===this.tokens.owner;const allowed=team&&(token===this.tokens[team]||p.owner),taken=team&&this.connected()[team];p.team=allowed&&!taken?team:null;p.send({type:'joined',team:p.team,canReset:p.owner, ...(team&&!p.team?{reason:this.solo&&team==='b'?'COMPUTER-CONTROLLED SEAT':taken?'SEAT TAKEN · SPECTATING':'INVALID TEAM INVITATION'}:{})});this.broadcast();}
 broadcast(){const state=this.state();for(const p of this.peers)if(p.joined)p.send(state);}
 radio(team:Team,instruction:Instruction,source:'mock'|'live'|'fallback',responseMs=1,strategist?:'chatgpt',keepQueuedPit=false){
  const car=this.race.cars[team],track=getTrack(this.race.circuit);
  const position=track.wrap(car.distance);
  const late=this.race.phase==='racing'&&car.distance>=0&&car.pit==='none'&&
   position>pitCommitmentPoint(track.PIT_ENTRY);
  this.radioRevision[team]++;
  this.awaitingChatReply.delete(team);
  if(!keepQueuedPit)delete this.pendingBox[team];
  let applied=instruction.energy
   ? {...instruction,energy:{...instruction.energy,startJoules:car.ersDeployed??0}}
   : instruction;
  const prior=car.instruction.energy;
  if(instruction.energy&&prior&&car.lap<prior.expiresLap){
   applied={...instruction,energy:{...instruction.energy,startJoules:prior.startJoules,
    budgetKJ:Math.min(prior.budgetKJ,instruction.energy.budgetKJ),
    expiresLap:Math.min(prior.expiresLap,instruction.energy.expiresLap)}};
  }
  if(late&&instruction.box!==car.instruction.box){
   if(instruction.box&&car.lap+1<this.race.laps)this.pendingBox[team]={lap:car.lap+1,instruction:structuredClone(instruction),source,responseMs,strategist};
   applied={...applied,box:car.instruction.box,line:instruction.box
    ? this.pendingBox[team]?'Past pit commitment. Box next lap.':'Past pit commitment. Stay out to the flag.'
    : 'Pit entry committed. Continue to the box.'};
  }
  car.instruction=structuredClone(applied);
  car.intent.ers=false;
  this.decisions[team]=null;
  const transmission:Radio={id:++this.sequence,time:this.race.time,team,speaker:'ENGINEER',text:applied.line,source,responseMs,...(strategist?{strategist}:{})};
  this.race.radio.push(transmission);
  this.race.radio=this.race.radio.slice(-20);event(this.race,'radio',team,applied.line);
  return transmission;
 }
 private async think(team:Team,window:{lap:number;change:string;controlRevision:number}){
  if(this.engineerBusy[team]||(this.live&&this.live!=='running'))return;
  this.engineerBusy[team]=true;
  this.engineerWindow[team]=window;
  const generation=this.generation,revision=this.radioRevision[team];
  this.engineerCalls[team]++;
  try{
   const result=await this.engineer(structuredClone(this.race),team,[...this.gapHistory[team]]);
   if(generation!==this.generation)return;
   if(!this.live&&result.source!=='mock')this.paidCalls++;
   if(revision===this.radioRevision[team]&&window.lap===this.race.cars[team].lap&&window.change===this.strategyChange(team)&&this.race.phase==='racing')this.radio(team,result.instruction,result.source,result.responseMs);
  }finally{this.engineerBusy[team]=false;}
 }
 private strategyChange(team:Team){
  const car=this.race.cars[team],rival=this.race.cars[other(team)];
  const nearbyStops=this.observedFieldStops[team];
  for(let index=0;index<this.race.field.length;index++){
   const opponent=this.race.field[index];
   if((opponent.pit==='entry'||opponent.pit==='stopped')&&Math.abs(opponent.distance-car.distance)<160)nearbyStops.add(index);
  }
  const rivalStops=rival.stops+Number(rival.pit==='entry'||rival.pit==='stopped');
  return `${rivalStops}/${Boolean(car.damage)}/${nearbyStops.size}/${this.race.control?.revision??0}`;
 }
 private updateStrategy(team:Team){
  const car=this.race.cars[team];
  if(car.finishTime!==null)return;
  const sector=car.lap*3+car.sector;
  if(car.distance>=0&&sector!==this.lastSector[team]){
   this.lastSector[team]=sector;
   this.gapHistory[team]=[...this.gapHistory[team].slice(-2),sectorGaps(this.race,team)];
  }
  const strategyEvents=this.strategyFor(team);
  const controlRevision=this.race.control?.revision??0,previous=this.engineerWindow[team];
  const controlChange=this.race.control&&(previous?.controlRevision??0)!==controlRevision?this.race.control.change:null;
  if(car.pit!=='none'&&(!strategyEvents||!controlChange))return;
  const baseChange=this.strategyChange(team);
  const tyreBand=car.wear<.55?0:car.wear<.75?1:2;
  const change=strategyEvents?`${baseChange}/${tyreBand}/${projectFuelAtFlag(this.race,team)<0}`:baseChange;
  const window={lap:car.lap,change,controlRevision};
  const pending=this.pendingBox[team];
  if(pending&&car.lap>=pending.lap&&car.pit==='none'){
   this.radio(team,pending.instruction,pending.source,pending.responseMs,pending.strategist);
   if((previous?.controlRevision??0)===controlRevision){
    this.engineerWindow[team]=window;
    return;
   }
  }
  if(!strategistDue(previous,car.lap,change)||Date.now()<=this.manualUntil[team])return;
  if(this.solo&&team==='b'&&!strategyEvents){
   this.engineerWindow.b=window;
   this.radio(team,mockEngineer(this.race,team,true,this.gapHistory[team]),'mock');
   return;
  }
  if(!strategyEvents){void this.think(team,window);return;}
  if(strategyEvents.pending?.event.observation.raceControl.revision===controlRevision)return;
  const observation=observeStrategy(this.race,team,[...this.gapHistory[team]]);
  const reasons=controlChange?[controlChange]:[!previous?'Opening strategy':previous.lap!==car.lap?'New lap':'Tyre, fuel or traffic changed'];
  if(tyreBand)reasons.push('Tyre wear');
  if(observation.fuel.projectedAtFlagKg<0)reasons.push('Projected fuel shortfall');
  if(car.damage)reasons.push('Car damage');
  this.engineerWindow[team]=window;
  this.engineerCalls[team]++;
  this.updateChatState(team,'requested');
  strategyEvents.offer(this.id,{...window,revision:this.radioRevision[team],raceControlChange:Boolean(controlChange)},reasons,observation);
 }
 strategyFor(team:Team){return team==='a'?this.strategyEvents:this.guestStrategyEvents;}

 enableChatStrategy(responseMs?:number,team:Team='a'){
  const existing=this.strategyFor(team);
  if(existing)return existing;
  const events=new StrategyEvents(responseMs);
  if(team==='a')this.strategyEvents=events;
  else this.guestStrategyEvents=events;
  delete this.engineerWindow[team];
  this.updateChatState(team,'waiting');
  return events;
 }

 releaseGuestStrategy(){
  this.guestStrategyEvents=undefined;
  this.guestChatStrategy=undefined;
  this.guestStrategyWebhook=undefined;
  delete this.engineerWindow.b;
  delete this.pendingBox.b;
  this.broadcast();
 }

 private updateChatState(team:Team,state:NonNullable<RaceState['chatStrategy']>['state']){
  if(team==='a')this.chatStrategy={state,team};
  else this.guestChatStrategy={state,team};
 }

 private currentStrategyEvent(events:StrategyEvents|undefined,eventId?:string){
  const pending=events?.pending;
  if(!pending||this.live!=='running'||this.race.phase!=='racing')return undefined;
  const {event,window}=pending,car=this.race.cars[event.team];
  return (!eventId||event.event_id===eventId)&&event.expiresAt>Date.now()&&car.finishTime===null&&(car.pit==='none'||window.raceControlChange)
   &&event.observation.raceControl.revision===(this.race.control?.revision??0)
   &&car.lap===window.lap&&this.radioRevision[event.team]===window.revision?pending:undefined;
 }

 readStrategyEvent(eventId:string){
  return this.currentStrategyEvent(this.strategyEvents,eventId)?.event??this.currentStrategyEvent(this.guestStrategyEvents,eventId)?.event;
 }

 submitStrategyEvent(input:RadioInput){
  if(input.room!==this.id)return {error:'Race does not match this event.'} as const;
  const events=this.strategyEvents?.pending?.event.event_id===input.event_id?this.strategyEvents:this.guestStrategyEvents;
  const pending=this.currentStrategyEvent(events,input.event_id);
  if(!pending)return {error:'This strategy event is no longer active.'} as const;
  const {event}=pending,car=this.race.cars[event.team];
  const instruction=radioInstruction(this.race,car,input);
  if(!instruction)return {error:'This order needs a valid sector, tyre, or available energy.'} as const;
  delete events!.pending; // Consume before broadcasting the authoritative order.
  this.updateChatState(event.team,'applied');
  const transmission=this.radio(event.team,instruction,'live',Date.now()-event.issuedAt,'chatgpt',input.action==='hold');
  (this.latestChatRadio??={})[event.team]={
   ...transmission,lap:event.lap,...(instruction.line!==transmission.text?{submittedText:instruction.line}:{}),
  };
  this.awaitingChatReply.add(event.team);
  this.broadcast();
  return {team:event.team,line:car.instruction.line} as const;
 }

 private expireStrategyEvent(events:StrategyEvents|undefined){
  const pending=events?.pending;
  if(!pending||this.currentStrategyEvent(events))return;
  delete events!.pending;
  const {event,window}=pending,car=this.race.cars[event.team];
  if(event.observation.raceControl.revision!==(this.race.control?.revision??0))return;
  if(car.finishTime!==null||car.pit!=='none'||car.lap!==window.lap||this.radioRevision[event.team]!==window.revision)return;
  this.updateChatState(event.team,'fallback');
  const instruction=mockEngineer(this.race,event.team,true,this.gapHistory[event.team]);
  this.radio(event.team,instruction,'fallback');
 }

 private replayFrame(){const frame=structuredClone(this.race);frame.events=[];frame.radio=[];return frame;}
 finishLive(phase:Exclude<LivePhase,'running'>){
  if(this.live!=='running')return;
  this.live=phase;
  if(this.strategyEvents)delete this.strategyEvents.pending;
  if(this.guestStrategyEvents)delete this.guestStrategyEvents.pending;
  this.generation++;
  this.broadcast();
 }

 driveLive(now:number){
  if(this.live!=='running'||this.race.phase!=='racing')return;
  for(const team of TEAMS)if(!(this.solo&&team==='b')&&!this.driving[team]&&now>=this.nextDrive[team]&&this.race.cars[team].finishTime===null){
   this.driving[team]=true;
   this.nextDrive[team]=now+this.players[team].intervalMs;
   void this.driveLiveTeam(team).finally(()=>{this.driving[team]=false;});
  }
 }

 private async driveLiveTeam(team:Team){
  const revision=this.radioRevision[team],sequence=++this.driverSequence[team];
  const engine=this.players[team].engine;
  const decision=await (engine==='luna'?this.lunaDriver!:this.jevDriver)(structuredClone(this.race),team,sequence);
  if(this.live!=='running'||this.race.phase!=='racing')return;
  if(decision.attempted){
   const stats=this.driverStats[team];
   stats.attempts++;
   if(decision.source==='fallback')stats.fallbacks++;
   else stats.successes++;
  }
  this.nextDrive[team]=Math.max(this.nextDrive[team],Date.now()+(decision.retryAfterMs??0));
  if(revision!==this.radioRevision[team])return;
  this.decisions[team]=decision;
  this.applyIntent(team,decision);
 }

 private applyIntent(team:Team,decision:Decision){
  this.race.cars[team].intent=structuredClone(decision.intent);
  this.intents[team]++;
  const text=decision.intent.reply.trim();
  const chatCall=text&&this.awaitingChatReply.has(team)?this.latestChatRadio?.[team]:undefined;
  if(!chatCall&&this.intents[team]!==1&&this.intents[team]%20!==0)return;
  const reply:Radio={id:++this.sequence,time:this.race.time,team,speaker:this.players[team].engine==='luna'?'LUNA':'JEV',
   text,source:decision.source==='jev'||decision.source==='luna'?'live':decision.source,responseMs:decision.responseMs};
  if(chatCall){
   this.awaitingChatReply.delete(team);
   this.latestChatRadio![team]={...chatCall,reply};
  }
  this.race.radio.push(reply);
  this.race.radio=this.race.radio.slice(-20);
 }

 start():boolean{
  const seats=this.connected();
  if(this.race.phase!=='lobby'||(this.live&&this.live!=='running')||Date.now()>=this.expiresAt||!seats.a||!seats.b)return false;
  this.race.phase='lights';
  this.broadcast();
  return true;
 }

 advance(steps:number){if(this.live&&this.live!=='running'||this.race.phase==='lobby'||this.race.phase==='finished'||Date.now()>this.expiresAt||!this.connected().a||!this.connected().b)return;
  for(let n=0;n<steps;n++){const oldLeader=this.race.leader;stepRace(this.race);if((this.race.phase as Race['phase'])==='finished')break;if(this.race.phase==='racing'){
    if(this.solo&&this.race.tick%24===0&&this.race.cars.b.finishTime===null){
     const decision:Decision={sequence:this.race.tick,responseMs:0,source:'mock',intent:mockDriver(this.race,'b')};
     this.decisions.b=decision;
     this.applyIntent('b',decision);
    }
    this.expireStrategyEvent(this.strategyEvents);
    this.expireStrategyEvent(this.guestStrategyEvents);
    for(const team of TEAMS)this.updateStrategy(team);
   }
   if(this.race.phase==='racing'&&this.race.tick%4===0){this.history.push(this.replayFrame());if(this.history.length>240)this.history.shift();}
   if(this.race.phase==='racing'&&this.race.cars.a.finishTime===null&&this.race.cars.b.finishTime===null&&oldLeader!==this.race.leader&&this.race.cars.a.pit==='none'&&this.race.cars.b.pit==='none'){const score=100-Math.abs(this.race.cars.a.distance-this.race.cars.b.distance);if(score>this.bestReplayScore){this.bestReplayScore=score;this.replay=structuredClone(this.history);this.captureUntil=this.race.time+3;}}
   if(this.race.phase==='racing'&&this.captureUntil>this.race.time&&this.race.tick%4===0&&this.replay.at(-1)?.tick!==this.race.tick){this.replay.push(this.replayFrame());if(this.replay.length>330)this.replay.shift();}
  }
 }
 async message(p:Peer,msg:ClientMessage){p.lastSeen=Date.now();if(msg.type==='join'){this.join(p,msg.team,msg.token);return;}if(!p.joined)return;
  if(msg.type==='audio'){
   if(msg.claim===true){
    if(!this.audible)this.audible=p;p.send({type:'audio',granted:this.audible===p});
   }else if(this.audible===p)this.audible=null;
   return;
  }
  if(msg.type==='ping'){p.send({type:'pong',sent:msg.sent});return;}if(msg.type==='replay'){p.send({type:'replay',frames:this.replay.length?this.replay:this.history});return;}
  if(msg.type==='race-control'){
   const hazard=parseHazard(msg.hazard);
   if(this.live==='running'&&hazard&&applyHazard(this.race,getTrack(this.race.circuit),hazard)){
    for(const team of TEAMS)this.updateStrategy(team);
    this.broadcast();
   }
   return;
  }
  if(this.live)return;
  if(msg.type==='start'&&(p.owner||p.team)){this.start();return;}
  if(msg.type==='matchup'&&p.owner&&!this.solo){if(!isMatchup(msg.matchup)){p.send({type:'error',message:'Invalid matchup'});return;}const roster=driverRoster(this.env,msg.matchup);if(msg.matchup==='jev-vs-luna')this.lunaDriver??=createLunaDriver(lunaConfig(this.env));this.players=roster.players;this.mode=roster.mode;this.matchup=msg.matchup;this.driverStats={a:{attempts:0,successes:0,fallbacks:0},b:{attempts:0,successes:0,fallbacks:0}};this.reset();return;}
  if(msg.type==='circuit'&&p.owner){if(!isCircuit(msg.circuit)){p.send({type:'error',message:'Invalid circuit'});return;}this.race.circuit=msg.circuit;this.reset();return;}
  if(msg.type==='reset'&&p.owner){this.reset();return;}
  if(msg.type==='radio'&&p.team){const i=msg.instruction;if(i&&['push','balanced','manage'].includes(i.pace)&&['deploy','balanced','harvest'].includes(i.ers)&&compounds.includes(i.tyre)&&['attack','defend','hold'].includes(i.tactic)&&typeof i.box==='boolean'&&typeof i.line==='string'&&i.line.length<=180){this.manualUntil[p.team]=Date.now()+3000;this.radio(p.team,{pace:i.pace,ers:i.ers,box:i.box,tyre:i.tyre,tactic:i.tactic,line:i.line},'mock');}return;}
  if(!p.team)return;const team=p.team;
  if(msg.type==='decide'&&!p.busy&&Date.now()-p.lastDecision>=150&&this.race.phase==='racing'){
   p.busy=true;p.lastDecision=Date.now();const gen=this.generation,revision=this.radioRevision[team];
   try{const decision=await (this.players[team].engine==='luna'?this.lunaDriver!:this.jevDriver)(structuredClone(this.race),team,++p.sequence);if(gen!==this.generation||!this.peers.has(p))return;if(decision.attempted){this.paidCalls++;this.driverStats[team].attempts++;}if(decision.attempted&&(decision.source==='jev'||decision.source==='luna'))this.driverStats[team].successes++;if(decision.source==='fallback'&&decision.attempted)this.driverStats[team].fallbacks++;if(revision===this.radioRevision[team])this.decisions[team]=decision;p.send({type:'decision',decision});}finally{p.busy=false;}
  }
  if(msg.type==='intent'){const d=this.decisions[team];if(d&&d.sequence===msg.sequence&&msg.sequence>p.accepted){
   p.accepted=msg.sequence;this.applyIntent(team,d);
  }}
 }
}
