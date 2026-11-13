import { createBrain, providerConfig } from './jev';
import { createLunaBrain, lunaConfig } from './luna';
import { engineFor, engineLabel, type Matchup, type PlayerInfo } from '../src/match';
import { SIDES, type Side } from '../src/physics';
import type { Decision, Snapshot } from '../src/agents';
export type Brain = (state: Snapshot, sequence: number) => Promise<Decision>;
export function createPlayers(env: Record<string, string | undefined>, matchup: Matchup) {
  const jev = providerConfig(env);
  const luna = matchup === 'jev-vs-luna' ? lunaConfig(env) : null;
  const players = {} as Record<Side, PlayerInfo>, brains = {} as Record<Side, Brain>;
  for (const side of SIDES) {
    const engine = engineFor(matchup, side), config = engine === 'luna' ? luna! : jev;
    players[side] = { engine, name: engineLabel(engine), model: config.model, provider: engine === 'luna' ? (config.mock ? 'mock' : 'openai') : jev.provider, mock: config.mock };
    brains[side] = engine === 'luna' ? createLunaBrain(luna!) : createBrain(jev);
  }
  const mockCount = SIDES.filter(side => players[side].mock).length;
  return { brains, players, mode: mockCount === 2 ? 'mock' : mockCount === 1 ? 'mixed' : matchup === 'jev-vs-jev' ? jev.provider : 'live' };
}
