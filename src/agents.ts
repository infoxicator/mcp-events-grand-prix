import { H, W, R, INSET, PADDLE_W, PADDLE_H, clamp, type GameState, type Side } from './physics';
export const PERSONAS = {
  left: { name: 'VECTOR', subtitle: 'The calculated one', motto: 'Every angle has an answer.', taunts: ['Geometry is on my side.', 'That was always the angle.', 'Calculated. Obviously.', 'Your move. I have time.'] },
  right: { name: 'CHAOS', subtitle: 'The unpredictable one', motto: 'Good luck predicting this.', taunts: ['Have you tried being random?', 'Oops. Did I do that?', 'Catch me if you can.', 'A little chaos looks good on you.'] },
} as const;
export interface Snapshot { tick: number; side: Side; ball: GameState['ball']; paddle: number; opponent: number; score: GameState['score']; rally: number }
export interface Action { target_y: number; move: 'up' | 'down' | 'stay'; taunt: string; confidence: number }
export interface Decision { action: Action; source: 'mock' | 'jev' | 'luna' | 'fallback'; responseMs: number; sequence: number; warning?: string; retryAfterMs?: number; api?: { status: number; requestId?: string; inputTokens?: number } }
export const snapshot = (s: GameState, side: Side): Snapshot => ({ tick: s.tick, side, ball: {...s.ball}, paddle: s.paddles[side], opponent: s.paddles[side==='left'?'right':'left'], score: {...s.score}, rally: s.rally });
/** Reflect a projected y through any number of wall bounces. */
export function reflectY(y: number): number { const range=H-2*R, t=((y-R)%(range*2)+range*2)%(range*2);return R+(t>range?range*2-t:t); }
export function intercept(s: Snapshot): number {
  const toward = s.side==='left' ? s.ball.vx<0 : s.ball.vx>0;
  if(!toward) return H/2 + (s.ball.y-H/2)*0.18;
  const plane=s.side==='left'?INSET+PADDLE_W+R:W-INSET-PADDLE_W-R;
  return reflectY(s.ball.y+s.ball.vy*Math.max(0,(plane-s.ball.x)/s.ball.vx));
}
function noise(seed: number) { let n=seed|0;n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/4294967295; }
/** Predictive but fallible: seeded wobble, overconfidence, and a different style per side. */
export function mockBrain(s: Snapshot): Action {
  const seed=Math.floor(s.tick/24)+(s.side==='left'?173:719)+s.score.left*37+s.score.right*61;
  const error=(noise(seed)*2-1)*(12+s.rally*5)+(s.side==='right'?Math.sin(s.tick/135)*15:0);
  const target_y=clamp(intercept(s)+error,PADDLE_H/2,H-PADDLE_H/2);
  return { target_y: Math.round(target_y), move: Math.abs(target_y-s.paddle)<7?'stay':target_y<s.paddle?'up':'down', taunt:PERSONAS[s.side].taunts[Math.floor(noise(seed+89)*4)%4], confidence:0.76+noise(seed+19)*0.2 };
}
