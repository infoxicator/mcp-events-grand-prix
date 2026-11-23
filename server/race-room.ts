import type {LivePhase} from '../src/race/live';
import {observeStrategy,projectFuelAtFlag,sectorGaps} from '../src/race/strategy-observation';
import {strategistDue} from '../src/race/strategy-radio';
import {pitCommitmentPoint} from '../src/race/strategy-calls';
import {getTrack,isCircuit,type CircuitId} from '../src/race/track';
import {createRace,dryCompoundRuleSatisfied,DT,FIA_MIN_FUEL_KG,stepRace,event,other,humanInputToControls,type DriverControls} from '../src/race/physics';
import {TEAMS,type Team,type Race,type RaceState,type Radio,type Decision,type RoomLinks,type Instruction,type ClientMessage,type ServerMessage,type DriverControlMode,type EngineerControlMode,type PeerRole,type HumanControlInput} from '../src/race/types';
import {mockDriver,mockEngineer,autopilotIntent} from '../src/race/brains';
import {StrategyEvents,radioInstruction,type RadioInput} from './strategy-events';
import {createRaceDriver,createRaceEngineer,providerConfig} from './race-brains';
import {createLunaDriver,lunaConfig} from './luna';
import {driverRoster} from './race-drivers';
import {isMatchup,type Matchup,type DriverInfo} from '../src/race/matchup';
import {invitationCode} from '../src/race/invitation';
import {applyHazard,compounds,parseHazard,wetnessBand} from '../src/race/race-control';
import type {RaceLogData,RaceLogEntry,RaceLogKind,RaceLogUpdate} from '../src/race/event-log';
import type {StrategyEventNotice} from '../src/race/strategy-events';
export interface Peer{send:(m:ServerMessage,raw?:string)=>void;team:Team|null;role?:PeerRole;owner:boolean;joined:boolean;eventLog?:boolean;lastSeen:number;lastDecision:number;sequence:number;accepted:number;busy:boolean;}
const LOG_LIMIT:Record<RaceLogKind,number>={strategy:60,driver:120,radio:60};
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
 private readonly eventLog:Record<RaceLogKind,RaceLogEntry[]>={strategy:[],driver:[],radio:[]};
 private logSequence=0;
 private loggedTelemetryReads:Partial<Record<Team,string>>={};
 race:Race;readonly peers=new Set<Peer>();readonly tokens={owner:crypto.randomUUID(),a:crypto.randomUUID(),b:crypto.randomUUID()};mcpToken:string=crypto.randomUUID();expiresAt=Date.now()+2*60*60_000;
 decisions:Record<Team,Decision|null>={a:null,b:null};intents={a:0,b:0};engineerCalls={a:0,b:0};driverStats={a:{attempts:0,successes:0,fallbacks:0},b:{attempts:0,successes:0,fallbacks:0}};paidCalls=0;history:Race[]=[];replay:Race[]=[];bestReplayScore=0;private captureUntil=0;
 private gapHistory:Record<Team,ReturnType<typeof sectorGaps>[]>={a:[],b:[]};
 private observedFieldStops:Record<Team,Map<number,number>>={a:new Map(),b:new Map()};
 private lastSector:Partial<Record<Team,number>>={};
 private engineerWindow:Partial<Record<Team,{lap:number;change:string;controlRevision?:number}>>={};
 private pendingBox:Partial<Record<Team,{lap:number;instruction:Instruction;source:'mock'|'live'|'fallback';responseMs:number;strategist?:'chatgpt'}>>={};
 private awaitingChatReply=new Set<Team>();
 private radioRevision={a:0,b:0};private manualUntil={a:0,b:0};private engineerBusy={a:false,b:false};private generation=0;private sequence=0;private jevDriver;private lunaDriver:ReturnType<typeof createLunaDriver>|null=null;private engineer;mode:'mock'|'mixed'|'live';players:Record<Team,DriverInfo>;
 driverMode:Record<Team,DriverControlMode>={a:'jev',b:'jev'};
 engineerMode:Record<Team,EngineerControlMode>={a:'mock',b:'mock'};
 private humanInputs:Partial<Record<Team,{input:HumanControlInput;at:number}>>={};
 constructor(readonly id:string,readonly origin:string,private readonly env:Record<string,string|undefined>={},readonly speed=4,public matchup:Matchup='jev-vs-jev',transports:{luna?:typeof fetch;engineer?:typeof fetch;jev?:Parameters<typeof createRaceDriver>[1]}={},circuit:CircuitId='monza',readonly solo=false,laps=3,readonly drive=false){
  this.race=createRace(laps,circuit);const roster=driverRoster(env,matchup);this.mode=roster.mode;this.players=roster.players;this.jevDriver=createRaceDriver(providerConfig(env),transports.jev);this.engineer=createRaceEngineer(env,transports.engineer);if(matchup==='jev-vs-luna')this.lunaDriver=createLunaDriver(lunaConfig(env),transports.luna);
  if(solo&&!this.players.b.mock){
   this.players.b={...this.players.b,mock:true,provider:'mock',intervalMs:200};
   this.mode=this.players.a.mock?'mock':'mixed';
  }
  if(drive)this.driverMode.a='human';
 }
 private reset(){this.generation++;this.race=createRace(this.race.laps,this.race.circuit);this.decisions={a:null,b:null};this.intents={a:0,b:0};this.engineerCalls={a:0,b:0};this.engineerWindow={};this.gapHistory={a:[],b:[]};this.observedFieldStops={a:new Map(),b:new Map()};this.lastSector={};this.pendingBox={};this.radioRevision={a:0,b:0};this.awaitingChatReply.clear();this.latestChatRadio=undefined;this.history=[];this.replay=[];this.bestReplayScore=0;this.manualUntil={a:0,b:0};this.humanInputs={};this.captureUntil=0;this.clearEventLog();this.broadcast();}

 connected(){if(this.live)return {a:true,b:true};let a=false,b=this.solo;for(const p of this.peers){if(p.role==='engineer')continue;if(p.team==='a')a=true;else if(p.team==='b')b=true;if(a&&b)break;}return {a,b};}
 engineerConnected(){let a=false,b=false;for(const p of this.peers){if(p.role!=='engineer')continue;if(p.team==='a')a=true;else if(p.team==='b')b=true;}return {a,b};}
 state():RaceState{return {type:'state',room:this.id,race:this.race,connected:this.connected(),decisions:this.decisions,intents:this.intents,engineerCalls:this.engineerCalls,driverStats:this.driverStats,matchup:this.matchup,players:this.players,mode:this.mode,serverTime:Date.now(),physicsHz:120,snapshotHz:30,speed:this.speed,paidCalls:this.paidCalls,...(this.solo?{solo:true}:{}),...(this.drive||this.driverMode.a!=='jev'||this.driverMode.b!=='jev'||this.engineerMode.a!=='mock'||this.engineerMode.b!=='mock'||this.engineerConnected().a||this.engineerConnected().b?{drive:this.drive,driverMode:{...this.driverMode},engineerMode:{...this.engineerMode},engineerConnected:this.engineerConnected()}:{}),live:this.live,strategyPractice:this.strategyPractice,strategyWebhook:this.strategyWebhook,chatStrategy:this.chatStrategy,latestChatRadio:this.latestChatRadio,guestChatStrategy:this.guestChatStrategy,guestStrategyWebhook:this.guestStrategyWebhook};}
 links():RoomLinks{const root=`${this.origin}/?room=${this.id}`;return {room:this.id,expiresAt:this.expiresAt,owner:`${root}#token=${this.tokens.owner}`,a:`${root}&team=a#token=${this.tokens.a}`,b:this.solo?'':`${root}&team=b#token=${this.tokens.b}`,spectator:`${root}&spectate`};}
 invitation(team:Team){return invitationCode(this.id,team,this.tokens[team]);}
 add(send:Peer['send']):Peer{const p:Peer={send,team:null,owner:false,joined:false,lastSeen:Date.now(),lastDecision:0,sequence:0,accepted:0,busy:false};this.peers.add(p);return p;}
 remove(p:Peer){if(this.audible===p)this.audible=null;this.peers.delete(p);this.broadcast();}
 join(p:Peer,team:Team|null,token:string,role?:PeerRole){if(p.joined)return;
  if(this.live&&(!this.viewerKey||token!==this.viewerKey)){p.send({type:'error',message:'Invalid live invitation'});return;}
  p.joined=true;if(this.live){p.send({type:'joined',team:null,canReset:false});p.send(this.state());return;}
  p.owner=token===this.tokens.owner;
  if(role==='engineer'){
   const allowed=Boolean(team&&(token===this.tokens[team]||p.owner));
   const taken=Boolean(team&&this.engineerConnected()[team]);
   p.team=allowed&&!taken?team:null;
   p.role=p.team?'engineer':undefined;
   if(p.team)this.engineerMode[p.team]='joined';
   p.send({type:'joined',team:p.team,canReset:p.owner,...(p.role?{role:p.role}:{}),...(team&&!p.team?{reason:taken?'ENGINEER SEAT TAKEN · SPECTATING':'INVALID TEAM INVITATION'}:{})});
   this.broadcast();return;
  }
  const allowed=team&&(token===this.tokens[team]||p.owner),taken=team&&this.connected()[team];p.team=allowed&&!taken?team:null;p.role=p.team&&role==='driver'?'driver':undefined;p.send({type:'joined',team:p.team,canReset:p.owner,...(p.role?{role:p.role}:{}),...(team&&!p.team?{reason:this.solo&&team==='b'?'COMPUTER-CONTROLLED SEAT':taken?'SEAT TAKEN · SPECTATING':'INVALID TEAM INVITATION'}:{})});this.broadcast();}
 broadcast(){let state:RaceState|undefined,raw:string|undefined;for(const p of this.peers){if(!p.joined)continue;if(!state){state=this.state();raw=JSON.stringify(state);}p.send(state,raw);}}
 private publishEventLog(update:RaceLogUpdate){
  for(const peer of this.peers)if(peer.joined&&peer.eventLog)peer.send(update);
 }
 private clearEventLog(){
  for(const entries of Object.values(this.eventLog))entries.length=0;
  this.loggedTelemetryReads={};
  this.publishEventLog({type:'event-log',reset:true,entries:[]});
 }
 private log(team:Team,data:RaceLogData,lap=this.race.cars[team].lap+1){
  const entry:RaceLogEntry={id:++this.logSequence,time:this.race.time,lap,team,data:structuredClone(data)};
  const entries=this.eventLog[data.kind];
  entries.push(entry);
  const discarded=entries.length>LOG_LIMIT[data.kind]?entries.shift()!.id:undefined;
  this.publishEventLog({type:'event-log',entries:[entry],discarded});
 }
 logStrategyDelivery(event:StrategyEventNotice,delivered:boolean){
  this.log(event.team,{kind:'strategy',agent:'chatgpt',stage:delivered?'delivered':'delivery-failed',reasons:event.reasons},event.lap);
 }
 private hasChatStrategy(){return Boolean(this.strategyEvents||this.guestStrategyEvents);}
 private isChatConnected(team:Team){
  const status=team==='a'?this.strategyWebhook:this.guestStrategyWebhook;
  return status==='connected'||status==='delivered'||Boolean(this.latestChatRadio?.[team]);
 }
 private applyInstruction(team:Team,instruction:Instruction,source:'mock'|'live'|'fallback',responseMs=1,strategist?:'chatgpt',keepQueuedPit=false){
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
  return applied;
 }
 radio(team:Team,instruction:Instruction,source:'mock'|'live'|'fallback',responseMs=1,strategist?:'chatgpt',keepQueuedPit=false){
  const applied=this.applyInstruction(team,instruction,source,responseMs,strategist,keepQueuedPit);
  const transmission:Radio={id:++this.sequence,time:this.race.time,team,speaker:'ENGINEER',text:applied.line,source,responseMs,...(strategist?{strategist}:{})};
  this.race.radio.push(transmission);
  this.race.radio=this.race.radio.slice(-20);event(this.race,'radio',team,applied.line);
  this.log(team,{kind:'radio',speaker:transmission.speaker,source,text:transmission.text,responseMs,strategist,instruction:applied,
   ...(instruction.line!==applied.line?{submittedText:instruction.line}:{})});
  return transmission;
 }
 private async think(team:Team,window:{lap:number;change:string;controlRevision:number},reason:string){
  if(this.engineerBusy[team]||(this.live&&this.live!=='running'))return;
  this.engineerBusy[team]=true;
  this.engineerWindow[team]=window;
  const generation=this.generation,revision=this.radioRevision[team];
  this.engineerCalls[team]++;
  try{
   const result=await this.engineer(structuredClone(this.race),team,[...this.gapHistory[team]],
    telemetry=>this.log(team,{kind:'strategy',agent:'pit-wall',stage:'requested',reasons:[reason],telemetry}));
   if(generation!==this.generation)return;
   if(!this.live&&result.source!=='mock')this.paidCalls++;
   if(revision===this.radioRevision[team]&&window.lap===this.race.cars[team].lap&&window.change===this.strategyChange(team)&&this.race.phase==='racing')this.radio(team,result.instruction,result.source,result.responseMs);
  }finally{this.engineerBusy[team]=false;}
 }
 private strategyChange(team:Team){
  const car=this.race.cars[team],rival=this.race.cars[other(team)];
  const nearbyStops=this.observedFieldStops[team];
  let nearbyStopCount=0;
  for(let index=0;index<this.race.field.length;index++){
   const opponent=this.race.field[index];
   const oppStops=(opponent.stops??0)+Number(opponent.pit==='entry'||opponent.pit==='stopped');
   const stopRange=this.race.laps>4?320:160;
   if((opponent.pit==='entry'||opponent.pit==='stopped')&&Math.abs(opponent.distance-car.distance)<stopRange){
    const seen=nearbyStops.get(index)??0;
    if(oppStops>seen)nearbyStops.set(index,oppStops);
   }
   nearbyStopCount+=nearbyStops.get(index)??0;
  }
  const rivalStops=rival.stops+Number(rival.pit==='entry'||rival.pit==='stopped');
  return `${rivalStops}/${Boolean(car.damage)}/${nearbyStopCount}/${this.race.control?.revision??0}`;
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
  const track=getTrack(this.race.circuit);
  const baseChange=this.strategyChange(team);
  const tyreBand=car.wear<.55?0:car.wear<.75?1:2;
  const wetBand=wetnessBand(this.race.control?.wetness??0);
  const fuelThreshold=this.race.laps>=10?FIA_MIN_FUEL_KG:0;
  const projectedFuel=projectFuelAtFlag(this.race,team);
  const wasFuelTight=(previous?.change.split('/')[5]??'')==='true';
  const fuelTight=wasFuelTight?projectedFuel<fuelThreshold+.15:projectedFuel<fuelThreshold;
  const distToCommit=track.wrap(pitCommitmentPoint(track.PIT_ENTRY)-car.distance);
  const pitWindow=this.race.laps>4&&car.pit==='none'&&car.lap<this.race.laps-1&&!car.instruction.box
   &&distToCommit>60&&distToCommit<=1100&&(car.wear>=.5||wetBand>=1||!dryCompoundRuleSatisfied(this.race,car));
  const change=strategyEvents?`${baseChange}/${tyreBand}/${fuelTight}/${wetBand}/${pitWindow}`:baseChange;
  const window={lap:car.lap,change,controlRevision};
  const pending=this.pendingBox[team];
  if(pending&&car.lap>=pending.lap&&car.pit==='none'){
   if(this.hasChatStrategy()&&pending.source==='mock'&&team==='b'&&!strategyEvents){
    this.applyInstruction(team,pending.instruction,pending.source,pending.responseMs,pending.strategist);
   }else{
    const transmission=this.radio(team,pending.instruction,pending.source,pending.responseMs,pending.strategist);
    if(pending.strategist==='chatgpt'){
     (this.latestChatRadio??={})[team]={...transmission,lap:car.lap+1};
     this.broadcast();
    }
   }
   if((previous?.controlRevision??0)===controlRevision){
    this.engineerWindow[team]=window;
    return;
   }
  }
  if(!strategyEvents&&this.engineerMode[team]==='joined')return;
  if(!strategistDue(previous,car.lap,change)||Date.now()<=this.manualUntil[team])return;
  const prevParts=previous?.change.split('/')??[];
  const curParts=change.split('/');
  const rivalStopChanged=prevParts.length>=3&&(prevParts[0]!==curParts[0]||prevParts[2]!==curParts[2]);
  const damageAppeared=Boolean(car.damage)&&prevParts[1]!=='true';
  const wetCrossed=prevParts.length>=7&&prevParts[6]!==String(wetBand);
  const pitWindowOpened=pitWindow&&prevParts[7]!=='true';
  const reason=controlChange??(
   !previous?'Opening strategy'
    :damageAppeared?'Car damage'
     :wetCrossed?'Track wetness crossover'
      :rivalStopChanged?'Nearby rival pitted'
       :pitWindowOpened?'Pre-pit commitment window'
        :previous.lap!==car.lap?'New lap'
         :'Tyre, fuel or traffic changed'
  );
  if(this.solo&&team==='b'&&!strategyEvents){
   this.engineerWindow.b=window;
   const instruction=mockEngineer(this.race,team,true,this.gapHistory[team]);
   if(this.hasChatStrategy())this.applyInstruction(team,instruction,'mock');
   else this.radio(team,instruction,'mock');
   return;
  }
  if(!strategyEvents){void this.think(team,window,reason);return;}
  const urgentSupersede=damageAppeared||rivalStopChanged||wetCrossed||pitWindowOpened||(fuelTight&&prevParts[5]!=='true');
  if(strategyEvents.pending&&strategyEvents.pending.event.observation.raceControl.revision===controlRevision&&!urgentSupersede)return;
  const observation=observeStrategy(this.race,team,[...this.gapHistory[team]]);
  const reasons=[reason];
  if(tyreBand&&!reasons.includes('Tyre wear'))reasons.push('Tyre wear');
  if(fuelTight)reasons.push(this.race.laps>=10?'Fuel margin below FIA 1.0 kg sample':'Projected fuel shortfall');
  if(car.damage&&!reasons.includes('Car damage'))reasons.push('Car damage');
  if(pitWindow&&!dryCompoundRuleSatisfied(this.race,car)&&this.race.laps-car.lap<=4)reasons.push('Mandatory two-compound rule');
  this.engineerWindow[team]=window;
  this.engineerCalls[team]++;
  this.updateChatState(team,'requested');
  const ticket=strategyEvents.offer(this.id,{...window,revision:this.radioRevision[team],raceControlChange:Boolean(controlChange)},reasons,observation);
  this.log(team,{kind:'strategy',agent:'chatgpt',stage:'requested',reasons,summary:ticket.summary,telemetry:ticket.observation},ticket.lap);
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
  const event=this.currentStrategyEvent(this.strategyEvents,eventId)?.event??this.currentStrategyEvent(this.guestStrategyEvents,eventId)?.event;
  if(event&&this.loggedTelemetryReads[event.team]!==eventId){
   this.loggedTelemetryReads[event.team]=eventId;
   this.log(event.team,{kind:'strategy',agent:'chatgpt',stage:'telemetry-read',reasons:event.reasons},event.lap);
  }
  return event;
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
  const queueNextLap=input.box_lap==='next-lap'&&Boolean(input.tyre)&&(input.action==='box'||input.action==='cover'||input.box===true)&&car.lap+1<this.race.laps;
  if(queueNextLap){
   this.pendingBox[event.team]={lap:car.lap+1,instruction:structuredClone({...instruction,box:true,tyre:input.tyre!}),source:'live',responseMs:Date.now()-event.issuedAt,strategist:'chatgpt'};
  }
  const transmission=this.radio(event.team,instruction,'live',Date.now()-event.issuedAt,'chatgpt',input.action==='hold'||queueNextLap);
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
  if(this.isChatConnected(event.team))return;
  this.updateChatState(event.team,'fallback');
  const instruction=mockEngineer(this.race,event.team,true,this.gapHistory[event.team]);
  this.radio(event.team,instruction,'fallback');
 }

 private replayFrame():Race{
  const r=this.race,copyCar=(c:Race['cars']['a'])=>({
   ...c,
   ...(c.damage?{damage:[c.damage[0],c.damage[1],c.damage[2],c.damage[3]] as NonNullable<Race['cars']['a']['damage']>}:{}),
   splitColours:[...c.splitColours] as Race['cars']['a']['splitColours'],
   eligible:[...c.eligible],
   lapTimes:[],
   instruction:{...c.instruction},
   intent:{...c.intent},
  });
  return {
   ...r,
   cars:{a:copyCar(r.cars.a),b:copyCar(r.cars.b)},
   field:r.field.map(f=>({
    distance:+f.distance.toFixed(3),
    offset:+f.offset.toFixed(3),
    speed:+f.speed.toFixed(2),
    finishTime:f.finishTime===null?null:+f.finishTime.toFixed(3),
    service:+f.service.toFixed(2),
    compound:f.compound,
    ...(f.pit&&f.pit!=='none'?{pit:f.pit}:{}),
    ...(f.pitHeading?{pitHeading:+f.pitHeading.toFixed(3)}:{}),
   }) as Race['field'][number]),
   control:r.control?{...r.control,safetyCar:r.control.safetyCar?{...r.control.safetyCar}:undefined,...(r.control.sectorWetness?{sectorWetness:[...r.control.sectorWetness] as [number,number,number]}:{})}:undefined,
   fastest:r.fastest?{...r.fastest}:null,
   events:[],
   radio:[],
  };
 }
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
  for(const team of TEAMS)if(!(this.solo&&team==='b')&&this.driverMode[team]==='jev'&&!this.driving[team]&&now>=this.nextDrive[team]&&this.race.cars[team].finishTime===null){
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
  const {reply:spoken,...intent}=decision.intent;
  this.log(team,{kind:'driver',engine:this.players[team].engine,source:decision.source,responseMs:decision.responseMs,sequence:decision.sequence,intent});
  const text=spoken.trim();
  if(text)this.race.cars[team].lastDriverReport=text;
  const chatCall=text&&this.awaitingChatReply.has(team)?this.latestChatRadio?.[team]:undefined;
  if(!chatCall&&this.intents[team]!==1&&this.intents[team]%20!==0)return;
  const reply:Radio={id:++this.sequence,time:this.race.time,team,speaker:this.players[team].engine==='luna'?'LUNA':'JEV',
   text,source:decision.source==='jev'||decision.source==='luna'?'live':decision.source,responseMs:decision.responseMs};
  if(chatCall){
   this.awaitingChatReply.delete(team);
   this.latestChatRadio![team]={...chatCall,reply};
  }
  if(reply.source==='live'||!this.hasChatStrategy()||chatCall){
   this.race.radio.push(reply);
   this.race.radio=this.race.radio.slice(-20);
  }
  if(reply.source==='live')this.log(team,{kind:'radio',speaker:reply.speaker,source:reply.source,text,responseMs:reply.responseMs});
 }

 start():boolean{
  const seats=this.connected();
  if(this.race.phase!=='lobby'||(this.live&&this.live!=='running')||Date.now()>=this.expiresAt||!seats.a||!seats.b)return false;
  this.race.phase='lights';
  this.broadcast();
  return true;
 }

 advance(steps:number){if(this.live&&this.live!=='running'||this.race.phase==='lobby'||this.race.phase==='finished'||Date.now()>this.expiresAt||!this.connected().a||!this.connected().b)return;
  const nowMs=Date.now();
  for(let n=0;n<steps;n++){const oldLeader=this.race.leader;
   let controls:Partial<Record<Team,DriverControls>>|undefined;
   for(const team of TEAMS){
    if(this.driverMode[team]==='human'){
     const entry=this.humanInputs[team];
     const input=entry&&nowMs-entry.at<1500?entry.input:{throttle:0,brake:0,steer:0};
     (controls??={})[team]=humanInputToControls(this.race.cars[team],input);
    }
   }
   stepRace(this.race,controls);if((this.race.phase as Race['phase'])==='finished')break;if(this.race.phase==='racing'){
    if(this.race.tick%24===0){
     for(const team of TEAMS){
      if(this.race.cars[team].finishTime!==null)continue;
      if(this.driverMode[team]==='autopilot'){
       const decision:Decision={sequence:this.race.tick,responseMs:0,source:'mock',intent:autopilotIntent(this.race,team)};
       this.decisions[team]=decision;
       this.applyIntent(team,decision);
      }else if(this.solo&&team==='b'){
       const decision:Decision={sequence:this.race.tick,responseMs:0,source:'mock',intent:mockDriver(this.race,'b')};
       this.decisions.b=decision;
       this.applyIntent('b',decision);
      }
     }
    }
    this.expireStrategyEvent(this.strategyEvents);
    this.expireStrategyEvent(this.guestStrategyEvents);
    for(const team of TEAMS)this.updateStrategy(team);
   }
   if(this.race.phase==='racing'&&this.race.tick%8===0){this.history.push(this.replayFrame());if(this.history.length>120)this.history.shift();}
   if(this.race.phase==='racing'&&this.race.cars.a.finishTime===null&&this.race.cars.b.finishTime===null&&oldLeader!==this.race.leader&&this.race.cars.a.pit==='none'&&this.race.cars.b.pit==='none'){const score=100-Math.abs(this.race.cars.a.distance-this.race.cars.b.distance);if(score>this.bestReplayScore){this.bestReplayScore=score;this.replay=this.history.slice();this.captureUntil=this.race.time+3;}}
   if(this.race.phase==='racing'&&this.captureUntil>this.race.time&&this.race.tick%8===0&&this.replay.at(-1)?.tick!==this.race.tick){this.replay.push(this.replayFrame());if(this.replay.length>165)this.replay.shift();}
  }
 }
 async message(p:Peer,msg:ClientMessage){p.lastSeen=Date.now();if(msg.type==='join'){this.join(p,msg.team,msg.token,msg.role);return;}if(!p.joined)return;
  if(msg.type==='event-log'){
   p.eventLog=msg.subscribe===true;
   if(p.eventLog)p.send({type:'event-log',reset:true,entries:Object.values(this.eventLog).flat().sort((a,b)=>a.id-b.id)});
   return;
  }
  if(msg.type==='audio'){
   if(msg.claim===true){
    if(!this.audible)this.audible=p;p.send({type:'audio',granted:this.audible===p});
   }else if(this.audible===p)this.audible=null;
   return;
  }
  if(msg.type==='ping'){p.send(msg.sent===undefined?{type:'pong'}:{type:'pong',sent:msg.sent});return;}if(msg.type==='replay'){p.send({type:'replay',frames:this.replay.length?this.replay:this.history});return;}
  if(msg.type==='race-control'){
   const hazard=parseHazard(msg.hazard);
   if((this.live==='running'||(this.drive&&(p.owner||p.role==='engineer')))&&hazard&&applyHazard(this.race,getTrack(this.race.circuit),hazard)){
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
  if(msg.type==='driver-mode'&&(p.team||p.owner)){
   const team=p.team??'a';
   if(p.role!=='engineer'&&(msg.mode==='human'||msg.mode==='jev'||msg.mode==='autopilot')&&this.driverMode[team]!==msg.mode){
    this.driverMode[team]=msg.mode;
    if(msg.mode!=='human')delete this.humanInputs[team];
    if(this.race.phase==='racing'){
     const label=msg.mode==='human'?'MANUAL CONTROL · YOU ARE DRIVING':msg.mode==='jev'?'JEV IN CONTROL':'AUTOPILOT ENGAGED';
     event(this.race,'radio',team,label);
    }
    this.broadcast();
   }
   return;
  }
  if(msg.type==='engineer-mode'&&(p.team||p.owner)){
   const team=p.team??'a';
   if((msg.mode==='mock'||msg.mode==='joined')&&this.engineerMode[team]!==msg.mode){
    this.engineerMode[team]=msg.mode;
    if(msg.mode==='mock'){this.manualUntil[team]=0;delete this.engineerWindow[team];}
    this.broadcast();
   }
   return;
  }
  if(msg.type==='control'&&p.team&&p.role!=='engineer'&&this.driverMode[p.team]==='human'){
   const inp=msg.input;
   if(inp&&typeof inp.throttle==='number'&&typeof inp.brake==='number'&&typeof inp.steer==='number'){
    this.humanInputs[p.team]={input:{
     throttle:Number.isFinite(inp.throttle)?inp.throttle:0,
     brake:Number.isFinite(inp.brake)?inp.brake:0,
     steer:Number.isFinite(inp.steer)?inp.steer:0,
     ersOvertake:Boolean(inp.ersOvertake),
     ersMode:inp.ersMode==='deploy'||inp.ersMode==='balanced'||inp.ersMode==='harvest'?inp.ersMode:undefined,
     drs:typeof inp.drs==='boolean'?inp.drs:undefined,
     brakeBias:typeof inp.brakeBias==='number'&&Number.isFinite(inp.brakeBias)?inp.brakeBias:undefined,
     gear:typeof inp.gear==='number'&&Number.isFinite(inp.gear)?inp.gear:undefined,
     tc:inp.tc==='off'||inp.tc==='medium'||inp.tc==='full'?inp.tc:undefined,
     abs:typeof inp.abs==='boolean'?inp.abs:undefined,
     pitAssist:typeof inp.pitAssist==='boolean'?inp.pitAssist:undefined,
    },at:Date.now()};
   }
   return;
  }
  if(msg.type==='radio'&&p.team){const i=msg.instruction;if(i&&['push','balanced','manage'].includes(i.pace)&&['deploy','balanced','harvest'].includes(i.ers)&&compounds.includes(i.tyre)&&['attack','defend','hold'].includes(i.tactic)&&typeof i.box==='boolean'&&typeof i.line==='string'&&i.line.length<=180){this.manualUntil[p.team]=Date.now()+3000;this.radio(p.team,{pace:i.pace,ers:i.ers,box:i.box,tyre:i.tyre,tactic:i.tactic,line:i.line},p.role==='engineer'||'joined'===this.engineerMode[p.team]?'live':'mock');this.broadcast();}return;}
  if(!p.team||p.role==='engineer')return;const team=p.team;
  if(msg.type==='decide'&&this.driverMode[team]==='jev'&&!p.busy&&Date.now()-p.lastDecision>=150&&this.race.phase==='racing'){
   p.busy=true;p.lastDecision=Date.now();const gen=this.generation,revision=this.radioRevision[team];
   try{const decision=await (this.players[team].engine==='luna'?this.lunaDriver!:this.jevDriver)(structuredClone(this.race),team,++p.sequence);if(gen!==this.generation||!this.peers.has(p))return;if(decision.attempted){this.paidCalls++;this.driverStats[team].attempts++;}if(decision.attempted&&(decision.source==='jev'||decision.source==='luna'))this.driverStats[team].successes++;if(decision.source==='fallback'&&decision.attempted)this.driverStats[team].fallbacks++;if(revision===this.radioRevision[team])this.decisions[team]=decision;p.send({type:'decision',decision});}finally{p.busy=false;}
  }
  if(msg.type==='intent'&&this.driverMode[team]==='jev'){const d=this.decisions[team];if(d&&d.sequence===msg.sequence&&msg.sequence>p.accepted){
   p.accepted=msg.sequence;this.applyIntent(team,d);
  }}
 }
}
