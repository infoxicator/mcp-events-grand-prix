import type {Matchup,Engine,DriverInfo} from './matchup';
export type Team='a'|'b';
export const TEAMS:Team[]=['a','b'];
export type Compound='soft'|'medium'|'hard';
export type ErsMode='deploy'|'balanced'|'harvest';
export interface Instruction {pace:'push'|'balanced'|'manage';ers:ErsMode;box:boolean;tyre:Compound;tactic:'attack'|'defend'|'hold';line:string}
export interface DriverIntent {offset:number;speedBias:number;brakeAggression:number;side:'left'|'right'|'hold';ers:boolean;drs:boolean;reply:string}
export interface Car {team:Team;distance:number;speed:number;speedTrap:number;gear:number;throttle:number;brake:number;offset:number;steering:number;heading:number;lateralVelocity:number;acceleration:number;lateralG:number;rpm:number;ersUsed:number;ersRecovered:number;ers:number;drs:boolean;eligible:boolean[];compound:Compound;wear:number;temperature:number;fuel:number;pit:'none'|'entry'|'stopped'|'exit';pitTime:number;stops:number;tyreAge:number;warnings:number;penalty:number;lap:number;lapStart:number;lastLap:number;bestLap:number;lapTimes:number[];sector:number;sectorStart:number;splits:number[];bestSectors:number[];splitColours:('purple'|'green'|'yellow')[];finishTime:number|null;intent:DriverIntent;instruction:Instruction;lastLimit:number;}
export interface RaceEvent {id:number;time:number;kind:'start'|'radio'|'pit'|'lap'|'overtake'|'finish'|'limits';team:Team;message:string}
export interface Radio {id:number;time:number;team:Team;speaker:'ENGINEER'|'JEV'|'LUNA';text:string;source:'mock'|'live'|'fallback';responseMs:number}
export interface Race {tick:number;time:number;phase:'lobby'|'lights'|'racing'|'finished';countdown:number;laps:number;cars:Record<Team,Car>;events:RaceEvent[];radio:Radio[];leader:Team;fastest:{team:Team;time:number}|null;winner:Team|null;}
export interface Decision {sequence:number;responseMs:number;source:'mock'|'jev'|'luna'|'fallback';intent:DriverIntent;engine?:Engine;cached?:boolean;attempted?:boolean;retryAfterMs?:number;warning?:string;api?:{provider:'typesafe'|'openrouter'|'vercel'|'mock'|'openai';model:string;status?:number;code?:string;requestId?:string;inputTokens?:number}}
export interface DriverStats{attempts:number;successes:number;fallbacks:number}
export interface RaceState {type:'state';room:string;race:Race;connected:Record<Team,boolean>;decisions:Record<Team,Decision|null>;intents:Record<Team,number>;engineerCalls:Record<Team,number>;driverStats:Record<Team,DriverStats>;matchup:Matchup;players:Record<Team,DriverInfo>;mode:'mock'|'mixed'|'live';serverTime:number;physicsHz:number;snapshotHz:number;speed:number;paidCalls:number;}
export interface RoomLinks {room:string;expiresAt:number;owner:string;a:string;b:string;spectator:string;}
export interface HostedRoom {room:string;token:string;links:RoomLinks|null;origin?:string;mcpToken?:string;}
export type ClientMessage={type:'join';team:Team|null;token:string}|{type:'ping';sent:number}|{type:'decide'}|{type:'intent';sequence:number}|{type:'reset'}|{type:'matchup';matchup:Matchup}|{type:'replay'}|{type:'radio';instruction:Instruction};
export type ServerMessage=RaceState|{type:'joined';team:Team|null;canReset:boolean;reason?:string}|{type:'decision';decision:Decision}|{type:'pong';sent:number}|{type:'replay';frames:Race[]}|{type:'error';message:string};
export const PERSONAS={a:{name:'VECTOR',number:'07',colour:'#ff6335',subtitle:'Precision under pressure',engineer:'THE STRATEGIST'},b:{name:'CHAOS',number:'23',colour:'#a5a9ff',subtitle:'Born to send it',engineer:'THE TACTICIAN'}};
