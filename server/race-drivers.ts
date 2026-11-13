import {providerConfig} from './provider';
import {lunaConfig} from './luna';
import {engineFor,engineLabel,type Matchup,type DriverInfo} from '../src/race/matchup';
import type {Team} from '../src/race/types';
/** Public roster contains no credentials or endpoints. Factories remain server-side. */
export function driverRoster(env:Record<string,string|undefined>,matchup:Matchup){
 const jev=providerConfig(env),luna=matchup==='jev-vs-luna'?lunaConfig(env):null;
 const players={} as Record<Team,DriverInfo>;
 for(const team of ['a','b'] as const){const engine=engineFor(matchup,team),config=engine==='luna'?luna!:jev;players[team]={engine,name:engineLabel(engine),model:config.model,provider:config.mock?'mock':engine==='luna'?'openai':jev.provider,mock:config.mock,intervalMs:engine==='luna'&&!config.mock?luna!.intervalMs:200};}
 const count=Object.values(players).filter(p=>p.mock).length;
 return {players,mode:count===2?'mock' as const:count===1?'mixed' as const:'live' as const};
}
