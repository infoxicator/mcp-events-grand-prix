export type Matchup='jev-vs-jev'|'jev-vs-luna';
export type Engine='jev'|'luna';
export interface DriverInfo{engine:Engine;name:string;model:string;provider:'mock'|'typesafe'|'openrouter'|'vercel'|'openai';mock:boolean;intervalMs:number}
export const isMatchup=(value:unknown):value is Matchup=>value==='jev-vs-jev'||value==='jev-vs-luna';
export const engineFor=(matchup:Matchup,team:'a'|'b'):Engine=>matchup==='jev-vs-luna'&&team==='b'?'luna':'jev';
export const engineLabel=(engine:Engine)=>engine==='luna'?'LUNA':'JEV';
