import type {RaceLogUpdate} from './event-log';
import type {Hazard,RaceControl} from './race-control';
import type {StrategyWebhookStatus} from './strategy-events';
import type {LivePhase} from './live';
import type {EnergyOrder} from './strategy-radio';
import type {OpponentCar} from './grid';
import type {CircuitId} from './track';
import type {Matchup,Engine,DriverInfo} from './matchup';
export type Team='a'|'b';
export const TEAMS:Team[]=['a','b'];
export type Compound='soft'|'medium'|'hard'|'intermediate'|'wet';
export type ErsMode='deploy'|'balanced'|'harvest';
export type DriverControlMode='human'|'jev'|'luna'|'autopilot';
export type StrategyDriver='autopilot'|'human'|'jev'|'luna';
export type JevProvider='typesafe'|'openrouter'|'vercel';
export const isStrategyDriver=(value:unknown):value is StrategyDriver=>value==='autopilot'||value==='human'||value==='jev'||value==='luna';
export const isJevProvider=(value:unknown):value is JevProvider=>value==='typesafe'||value==='openrouter'||value==='vercel';
export type EngineerControlMode='mock'|'joined';
export type PeerRole='driver'|'engineer';
export interface HumanControlInput {throttle:number;brake:number;steer:number;ersOvertake?:boolean;ersMode?:ErsMode;drs?:boolean;brakeBias?:number;gear?:number;tc?:'off'|'medium'|'full';abs?:boolean;pitAssist?:boolean;}
export interface TeamOrder {kind:'swap'|'swap-back';issuedLap:number;expiresLap:number;completed?:boolean}
export interface Instruction {pace:'push'|'balanced'|'manage';ers:ErsMode;box:boolean;tyre:Compound;tactic:'attack'|'defend'|'hold';line:string;energy?:EnergyOrder;fuelSave?:{sector:number;expiresLap:number};yieldUntilLap?:number;yieldTarget?:string;teamOrder?:TeamOrder;revisit?:string}
export interface DriverIntent {offset:number;speedBias:number;brakeAggression:number;side:'left'|'right'|'hold';ers:boolean;drs:boolean;reply:string}
export type PanelDamage=[number,number,number,number]; // front left/right, rear left/right
export interface Car {damage?:PanelDamage;lastImpact?:{time:number;source:string};team:Team;distance:number;speed:number;speedTrap:number;gear:number;throttle:number;brake:number;offset:number;steering:number;heading:number;lateralVelocity:number;acceleration:number;lateralG:number;rpm:number;ersUsed:number;ersDeployed?:number;ersPowerKw?:number;ersRecovered:number;ers:number;drs:boolean;eligible:boolean[];compound:Compound;wear:number;temperature:number;fuel:number;pit:'none'|'entry'|'stopped'|'exit';pitTime:number;totalStop?:number;stops:number;tyreAge:number;warnings:number;penalty:number;lap:number;lapStart:number;lastLap:number;bestLap:number;lapTimes:number[];sector:number;sectorStart:number;splits:number[];bestSectors:number[];splitColours:('purple'|'green'|'yellow')[];finishTime:number|null;intent:DriverIntent;instruction:Instruction;lastLimit:number;compoundsUsed?:Compound[];tyreSets?:Record<Compound,number>;lastDriverReport?:string;fuelPenaltyApplied?:boolean;compoundPenaltyApplied?:boolean;lockup?:number;}
export interface RaceEvent {id:number;time:number;kind:'start'|'radio'|'pit'|'lap'|'overtake'|'finish'|'limits'|'collision';team:Team;message:string}
export interface Radio {id:number;time:number;team:Team;speaker:'ENGINEER'|'JEV'|'LUNA'|'DRIVER';text:string;source:'mock'|'live'|'fallback';responseMs:number;strategist?:'chatgpt';consultation?:'question'|'answer';consultationId?:string}
export interface DriverConsultRadio extends Radio {consultation:'question'|'answer';consultationId:string}
export interface ChatStrategyRadio extends Radio {lap:number;submittedText?:string;reply?:Radio}
export interface Race {control?:RaceControl;wetRace?:boolean;circuit:CircuitId;tick:number;time:number;phase:'lobby'|'lights'|'racing'|'finished';countdown:number;laps:number;cars:Record<Team,Car>;field:OpponentCar[];events:RaceEvent[];radio:Radio[];leader:Team;fastest:{team:Team;time:number}|null;winner:string|null;}
export interface Decision {sequence:number;responseMs:number;source:'mock'|'jev'|'luna'|'fallback';intent:DriverIntent;engine?:Engine;cached?:boolean;attempted?:boolean;retryAfterMs?:number;warning?:string;api?:{provider:'typesafe'|'openrouter'|'vercel'|'mock'|'openai';model:string;status?:number;code?:string;requestId?:string;inputTokens?:number}}
export interface DriverStats{attempts:number;successes:number;fallbacks:number}
export interface RaceState {type:'state';room:string;race:Race;connected:Record<Team,boolean>;decisions:Record<Team,Decision|null>;intents:Record<Team,number>;engineerCalls:Record<Team,number>;driverStats:Record<Team,DriverStats>;matchup:Matchup;players:Record<Team,DriverInfo>;mode:'mock'|'mixed'|'live';serverTime:number;physicsHz:number;snapshotHz:number;speed:number;paidCalls:number;solo?:boolean;drive?:boolean;driverMode?:Record<Team,DriverControlMode>;engineerMode?:Record<Team,EngineerControlMode>;engineerConnected?:Record<Team,boolean>;strategyPractice?:boolean;strategyWebhook?:StrategyWebhookStatus;latestChatRadio?:Partial<Record<Team,ChatStrategyRadio>>;driverConsultRadio?:Partial<Record<Team,DriverConsultRadio[]>>;live?:LivePhase;guestStrategyWebhook?:StrategyWebhookStatus;guestChatStrategy?:ChatStrategyState;chatStrategy?:ChatStrategyState;}
export interface ChatStrategyState {state:'waiting'|'requested'|'applied'|'fallback';team?:Team}
export interface RoomLinks {room:string;expiresAt:number;owner:string;a:string;b:string;spectator:string;}
export interface LocalRoomConfig {circuit:CircuitId;laps:number;speed:number;solo:boolean;drive:boolean;watch:boolean;matchup?:Matchup;}
export interface HostedRoom {room:string;token:string;links:RoomLinks|null;origin?:string;mcpToken?:string;live?:boolean;local?:LocalRoomConfig;}
export type ClientMessage={type:'event-log';subscribe:boolean}|{type:'race-control';hazard:Hazard}|{type:'audio';claim:boolean}|{type:'join';team:Team|null;token:string;role?:PeerRole}|{type:'control';input:HumanControlInput}|{type:'driver-mode';mode:DriverControlMode}|{type:'engineer-mode';mode:EngineerControlMode}|{type:'ping';sent?:number}|{type:'decide'}|{type:'intent';sequence:number}|{type:'start';startKey?:string}|{type:'reset'}|{type:'matchup';matchup:Matchup}|{type:'circuit';circuit:CircuitId}|{type:'replay'}|{type:'radio';instruction:Instruction}|{type:'strategy-question';text:string};
export type ServerMessage=RaceLogUpdate|{type:'audio';granted:boolean}|RaceState|{type:'joined';team:Team|null;canReset:boolean;reason?:string;role?:PeerRole}|{type:'decision';decision:Decision}|{type:'pong';sent?:number}|{type:'replay';frames:Race[]}|{type:'error';message:string;code?:'strategy-question'};
export const PERSONAS={a:{name:'Ferrari',number:'44',colour:'#ed3446',subtitle:'Precision under pressure',engineer:'THE STRATEGIST'},b:{name:'Mercedes',number:'63',colour:'#30b9ad',subtitle:'Born to send it',engineer:'THE TACTICIAN'}};
