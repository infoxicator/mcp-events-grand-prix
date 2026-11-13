import type { GameState, Side } from './physics';
import type { Decision } from './agents';
import type { Matchup, PlayerInfo } from './match';
export interface ArenaState {
  type: 'state'; game: GameState; connected: Record<Side, boolean>; serverTime: number;
  decisions: Record<Side, Decision | null>; intents: Record<Side, number>; mode: string; matchup: Matchup; players: Record<Side, PlayerInfo>;
}
export type ServerMessage = ArenaState | {type:'joined';side:Side|null;reason?:string;canReset?:boolean} | {type:'decision';decision:Decision} | {type:'decision-cancelled'} | {type:'cooldown';retryAfterMs:number} | {type:'pong';sent:number} | {type:'replay';frames:GameState[]} | {type:'error';message:string};
export type ClientMessage = {type:'join';side:Side|null;token:string} | {type:'decide'} | {type:'intent';sequence:number;target_y:number} | {type:'ping';sent:number} | {type:'replay'} | {type:'reset'} | {type:'matchup';matchup:Matchup};
