import type { Side } from './physics';
export const MATCHUPS = ['jev-vs-jev', 'jev-vs-luna'] as const;
export type Matchup = typeof MATCHUPS[number];
export type Engine = 'jev' | 'luna';
export interface PlayerInfo { engine: Engine; name: string; model: string; provider: string; mock: boolean }
export const isMatchup = (value: unknown): value is Matchup => MATCHUPS.includes(value as Matchup);
export const engineFor = (matchup: Matchup, side: Side): Engine => matchup === 'jev-vs-luna' && side === 'right' ? 'luna' : 'jev';
export const matchupTitle = (matchup: Matchup) => matchup === 'jev-vs-luna' ? 'Jev vs Luna Pong' : 'Jev vs Jev Pong';
export const engineLabel = (engine: Engine) => engine === 'luna' ? 'Luna' : 'Jev';
export const engineDetail = (engine: Engine) => engine === 'luna' ? 'OPENAI / DECISIONS' : 'TYPESAFE / SYSTEM ONE';
