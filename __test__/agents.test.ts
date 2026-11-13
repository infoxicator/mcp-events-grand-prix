import { describe, it, expect } from 'vitest';
import { createGame, H, PADDLE_H } from '../src/physics';
import { intercept, reflectY, mockBrain, snapshot, PERSONAS } from '../src/agents';
describe('mock agent',()=>{
  it('predicts the incoming ball after wall bounces',()=>{const s=snapshot(createGame(),'right');s.ball={x:800,y:500,vx:300,vy:300};expect(intercept(s)).toBeCloseTo(459);expect(reflectY(600)).toBe(506);});
  it('is deterministic and always produces bounded structured intents',()=>{const g=createGame();for(let i=0;i<400;i++){g.tick=i*24;g.rally=i%30;for(const side of ['left','right'] as const){const s=snapshot(g,side),a=mockBrain(s);expect(a).toEqual(mockBrain(s));expect(a.target_y).toBeGreaterThanOrEqual(PADDLE_H/2);expect(a.target_y).toBeLessThanOrEqual(H-PADDLE_H/2);expect(['up','down','stay']).toContain(a.move);expect(PERSONAS[side].taunts).toContain(a.taunt);}}});
  it('gives each persona different, changing decisions',()=>{const g=createGame();const a=mockBrain(snapshot(g,'left')),b=mockBrain(snapshot(g,'right'));expect(a).not.toEqual(b);g.tick+=240;expect(mockBrain(snapshot(g,'left'))).not.toEqual(a);});
});
