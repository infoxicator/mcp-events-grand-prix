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
export interface Instruction {pace:'push'|'balanced'|'manage';ers:ErsMode;box:boolean;tyre:Compound;tactic:'attack'|'defend'|'hold';line:string;energy?:EnergyOrder;fuelSave?:{sector:number;expiresLap:number};yieldUntilLap?:number}
export interface DriverIntent {offset:number;speedBias:number;brakeAggression:number;side:'left'|'right'|'hold';ers:boolean;drs:boolean;reply:string}
export type PanelDamage=[number,number,number,number]; // front left/right, rear left/right
export interface Car {damage?:PanelDamage;lastImpact?:{time:number;source:string};team:Team;distance:number;speed:number;speedTrap:number;gear:number;throttle:number;brake:number;offset:number;steering:number;heading:number;lateralVelocity:number;acceleration:number;lateralG:number;rpm:number;ersUsed:number;ersDeployed?:number;ersRecovered:number;ers:number;drs:boolean;eligible:boolean[];compound:Compound;wear:number;temperature:number;fuel:number;pit:'none'|'entry'|'stopped'|'exit';pitTime:number;stops:number;tyreAge:number;warnings:number;penalty:number;lap:number;lapStart:number;lastLap:number;bestLap:number;lapTimes:number[];sector:number;sectorStart:number;splits:number[];bestSectors:number[];splitColours:('purple'|'green'|'yellow')[];finishTime:number|null;intent:DriverIntent;instruction:Instruction;lastLimit:number;}
export interface RaceEvent {id:number;time:number;kind:'start'|'radio'|'pit'|'lap'|'overtake'|'finish'|'limits'|'collision';team:Team;message:string}
export interface Radio {id:number;time:number;team:Team;speaker:'ENGINEER'|'JEV'|'LUNA';text:string;source:'mock'|'live'|'fallback';responseMs:number;strategist?:'chatgpt'}
export interface ChatStrategyRadio extends Radio {lap:number;submittedText?:string;reply?:Radio}
export interface Race {control?:RaceControl;circuit:CircuitId;tick:number;time:number;phase:'lobby'|'lights'|'racing'|'finished';countdown:number;laps:number;cars:Record<Team,Car>;field:OpponentCar[];events:RaceEvent[];radio:Radio[];leader:Team;fastest:{team:Team;time:number}|null;winner:string|null;}
export interface Decision {sequence:number;responseMs:number;source:'mock'|'jev'|'luna'|'fallback';intent:DriverIntent;engine?:Engine;cached?:boolean;attempted?:boolean;retryAfterMs?:number;warning?:string;api?:{provider:'typesafe'|'openrouter'|'vercel'|'mock'|'openai';model:string;status?:number;code?:string;requestId?:string;inputTokens?:number}}
export interface DriverStats{attempts:number;successes:number;fallbacks:number}
export interface RaceState {type:'state';room:string;race:Race;connected:Record<Team,boolean>;decisions:Record<Team,Decision|null>;intents:Record<Team,number>;engineerCalls:Record<Team,number>;driverStats:Record<Team,DriverStats>;matchup:Matchup;players:Record<Team,DriverInfo>;mode:'mock'|'mixed'|'live';serverTime:number;physicsHz:number;snapshotHz:number;speed:number;paidCalls:number;solo?:boolean;strategyPractice?:boolean;strategyWebhook?:StrategyWebhookStatus;latestChatRadio?:Partial<Record<Team,ChatStrategyRadio>>;live?:LivePhase;guestStrategyWebhook?:StrategyWebhookStatus;guestChatStrategy?:ChatStrategyState;chatStrategy?:ChatStrategyState;}
export interface ChatStrategyState {state:'waiting'|'requested'|'applied'|'fallback';team?:Team}
export interface RoomLinks {room:string;expiresAt:number;owner:string;a:string;b:string;spectator:string;}
export interface HostedRoom {room:string;token:string;links:RoomLinks|null;origin?:string;mcpToken?:string;live?:boolean;}
export type ClientMessage={type:'race-control';hazard:Hazard}|{type:'audio';claim:boolean}|{type:'join';team:Team|null;token:string}|{type:'ping';sent:number}|{type:'decide'}|{type:'intent';sequence:number}|{type:'start';startKey?:string}|{type:'reset'}|{type:'matchup';matchup:Matchup}|{type:'circuit';circuit:CircuitId}|{type:'replay'}|{type:'radio';instruction:Instruction};
export type ServerMessage={type:'audio';granted:boolean}|RaceState|{type:'joined';team:Team|null;canReset:boolean;reason?:string}|{type:'decision';decision:Decision}|{type:'pong';sent:number}|{type:'replay';frames:Race[]}|{type:'error';message:string};
export const PERSONAS={a:{name:'Ferrari',number:'44',colour:'#ed3446',subtitle:'Precision under pressure',engineer:'THE STRATEGIST'},b:{name:'Mercedes',number:'63',colour:'#30b9ad',subtitle:'Born to send it',engineer:'THE TACTICIAN'}};
