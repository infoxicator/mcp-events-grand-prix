import { describe, expect, it } from 'vitest';
import { createGame, step, startServe, setIntent, H, R, INSET, PADDLE_W, WIN_SCORE } from '../src/physics';
describe('fixed timestep Pong', () => {
  it('waits in the lobby and serves after the countdown', () => { const s=createGame();step(s);expect(s.ball.x).toBe(500);startServe(s);for(let i=0;i<146;i++)step(s);expect(s.phase).toBe('play');expect(s.ball.x).toBeGreaterThan(500); });
  it('is deterministic for the same intents',()=>{const a=createGame(),b=createGame();startServe(a);startServe(b);for(let i=0;i<1500;i++){setIntent(a,'left',i%H);setIntent(b,'left',i%H);step(a);step(b);}expect(a).toEqual(b);});
  it('bounces off walls without leaving the court',()=>{const s=createGame();s.phase='play';s.ball={x:500,y:R+1,vx:100,vy:-430};step(s);expect(s.ball.vy).toBeGreaterThan(0);expect(s.ball.y).toBeGreaterThanOrEqual(R);});
  it('accelerates on a paddle hit and counts the rally',()=>{const s=createGame();s.phase='play';s.ball={x:INSET+PADDLE_W+R+2,y:H/2,vx:-430,vy:0};step(s);expect(s.ball.vx).toBeGreaterThan(430);expect(s.rally).toBe(1);});
  it('awards exactly one point and resets for the next serve',()=>{const s=createGame();s.phase='play';s.ball.x=1010;step(s);expect(s.score.left).toBe(1);for(let i=0;i<200;i++)step(s);expect(s.score.left).toBe(1);expect(s.ball.x).toBe(500);expect(s.phase).toBe('serve');});
  it('declares a winner at seven and bounds paddle intents',()=>{const s=createGame();s.phase='play';s.score.right=WIN_SCORE-1;s.ball.x=-10;s.ball.vx=-430;step(s);expect(s.phase).toBe('won');expect(s.score.right).toBe(WIN_SCORE);setIntent(s,'left',-200);setIntent(s,'right',Infinity);expect(s.targets.left).toBe(43);expect(s.targets.right).toBe(H/2);});
});
