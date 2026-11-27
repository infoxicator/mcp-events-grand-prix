import type {Engine} from './matchup';
import type {observeStrategy} from './strategy-observation';
import type {StrategyEventNotice} from './strategy-events';
import type {Decision,DriverIntent,Instruction,Radio,Team} from './types';

export type StrategyLogData={
 kind:'strategy';agent:'chatgpt'|'pit-wall';
 stage:'requested'|'delivered'|'delivery-failed'|'telemetry-read'|'rejected';
 source?:'mock'|'live'|'fallback';
 reasons:string[];
 summary?:StrategyEventNotice['summary'];
 telemetry?:ReturnType<typeof observeStrategy>;
 error?:string;
};
type DriverLogData={
 kind:'driver';engine:Engine;source:Decision['source'];responseMs:number;sequence:number;
 model?:string;provider?:string;warning?:string;changed?:string[];
 intent:Omit<DriverIntent,'reply'>;
};
type RadioLogData={
 kind:'radio';speaker:Radio['speaker'];source:Radio['source'];text:string;responseMs:number;
 strategist?:Radio['strategist'];instruction?:Instruction;submittedText?:string;
 consultation?:Radio['consultation'];consultationId?:string;
};
export type RaceLogData=StrategyLogData|DriverLogData|RadioLogData;
export type RaceLogKind=RaceLogData['kind'];
export interface RaceLogEntry {id:number;time:number;lap:number;team:Team;data:RaceLogData}
export interface RaceLogUpdate {type:'event-log';entries:RaceLogEntry[];reset?:true;discarded?:number}
