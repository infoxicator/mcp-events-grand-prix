export type Side = 'left' | 'right';
export const SIDES: Side[] = ['left', 'right'];
export const W = 1000, H = 560, PADDLE_H = 86, PADDLE_W = 12, INSET = 34, R = 7;
export const DT = 1 / 120, WIN_SCORE = 7;
export type Phase = 'lobby' | 'serve' | 'play' | 'point' | 'won';
export interface GameState {
  tick: number; ball: { x: number; y: number; vx: number; vy: number };
  paddles: Record<Side, number>; targets: Record<Side, number>; score: Record<Side, number>;
  phase: Phase; countdown: number; rally: number; bestRally: number; pointId: number; lastScorer: Side | null;
}
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export function createGame(): GameState {
  return { tick: 0, ball: { x: W/2, y: H/2, vx: 430, vy: 148 }, paddles: { left: H/2, right: H/2 }, targets: { left: H/2, right: H/2 }, score: { left: 0, right: 0 }, phase: 'lobby', countdown: 1.2, rally: 0, bestRally: 0, pointId: 0, lastScorer: null };
}
export function startServe(s: GameState) { s.phase = 'serve'; s.countdown = 1.2; }
export function setIntent(s: GameState, side: Side, target: number) { if (Number.isFinite(target)) s.targets[side] = clamp(target, PADDLE_H/2, H-PADDLE_H/2); }
function award(s: GameState, side: Side) {
  s.score[side]++; s.pointId++; s.lastScorer = side;
  s.bestRally = Math.max(s.bestRally, s.rally);
  s.phase = s.score[side] >= WIN_SCORE ? 'won' : 'point'; s.countdown = s.phase === 'won' ? 7 : 1.6;
}
/** Mutates one fixed 120 Hz step. No clocks, randomness, network, or AI here. */
export function step(s: GameState) {
  s.tick++;
  if (s.phase === 'lobby') return;
  for (const side of SIDES) {
    const diff = s.targets[side] - s.paddles[side];
    s.paddles[side] = clamp(s.paddles[side] + clamp(diff * 12, -470, 470)*DT, PADDLE_H/2, H-PADDLE_H/2);
  }
  if (s.phase !== 'play') {
    s.countdown -= DT;
    if (s.countdown <= 0) {
      if (s.phase === 'won') { s.score = { left: 0, right: 0 }; s.lastScorer = null; }
      if (s.phase === 'serve') s.phase = 'play';
      else {
        s.rally = 0; s.ball = { x: W/2, y: H/2, vx: (s.pointId % 2 ? -1 : 1)*430, vy: (s.pointId % 3 - 1)*146 || 180 };
        startServe(s);
      }
    }
    return;
  }
  const b = s.ball, oldX = b.x;
  b.x += b.vx*DT; b.y += b.vy*DT;
  if (b.y < R) { b.y = 2*R-b.y; b.vy = Math.abs(b.vy); }
  if (b.y > H-R) { b.y = 2*(H-R)-b.y; b.vy = -Math.abs(b.vy); }
  for (const side of SIDES) {
    const left = side === 'left', plane = left ? INSET+PADDLE_W+R : W-INSET-PADDLE_W-R;
    const crossing = left ? b.vx < 0 && oldX >= plane && b.x <= plane : b.vx > 0 && oldX <= plane && b.x >= plane;
    if (crossing && Math.abs(b.y-s.paddles[side]) <= PADDLE_H/2+R) {
      const offset = clamp((b.y-s.paddles[side])/(PADDLE_H/2), -1, 1);
      const speed = Math.min(1150, Math.hypot(b.vx,b.vy)*1.075+8), angle = offset*1.02;
      b.x = plane; b.vx = (left ? 1 : -1)*speed*Math.cos(angle); b.vy = speed*Math.sin(angle);
      s.rally++; s.bestRally = Math.max(s.bestRally, s.rally);
    }
  }
  if (b.x < -R) award(s, 'right');
  if (b.x > W+R) award(s, 'left');
}
