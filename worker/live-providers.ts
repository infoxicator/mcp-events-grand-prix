import {providerConfig} from '../server/provider';
import {engineerProvider} from '../server/engineer-provider';
import {accessConfigured,type AccessConfig} from './access';
import type {LiveStrategist} from '../src/race/strategy-events';
import type {Matchup} from '../src/race/matchup';

const providerBindings = [
 'TYPESAFE_API_KEY','OPENROUTER_API_KEY','AI_GATEWAY_API_KEY','OPENAI_API_KEY',
 'JEV_PROVIDER','JEV_MODEL','ENGINEER_PROVIDER','ENGINEER_MODEL',
] as const;

export type LiveBindings = AccessConfig & Partial<Record<typeof providerBindings[number],string>>;

export function raceProviders(env: LiveBindings) {
 const result: Record<string,string|undefined> = {};
 for (const name of providerBindings) result[name] = env[name]?.trim() || undefined;
 return result;
}

export function liveAvailable(env: LiveBindings, matchup: Matchup = 'jev-vs-jev', strategist:LiveStrategist='provider') {
 if (!accessConfigured(env)) return false;
 const providers = raceProviders(env);
 try {
  const engineerReady=(!providers.ENGINEER_PROVIDER||['openrouter','vercel'].includes(providers.ENGINEER_PROVIDER))
   &&Boolean(engineerProvider(providers));
  return !providerConfig(providers).mock&&(strategist==='chatgpt'||engineerReady)
   && (matchup !== 'jev-vs-luna' || Boolean(providers.OPENAI_API_KEY));
 } catch {
  return false;
 }
}

export const livePairingAvailable=(env:LiveBindings)=>liveAvailable(env)||liveAvailable(env,'jev-vs-jev','chatgpt');
