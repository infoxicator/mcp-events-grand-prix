import { expect,it } from 'vitest';
import { createInterpolator } from '../src/network';
import { createGame,type GameState } from '../src/physics';
import type { ArenaState } from '../src/protocol';
const state=(game:GameState):ArenaState=>({type:'state',game,connected:{left:true,right:true},serverTime:0,decisions:{left:null,right:null},intents:{left:0,right:0},mode:'mock',matchup:'jev-vs-jev',players:{left:{engine:'jev',name:'Jev',model:'mock',provider:'mock',mock:true},right:{engine:'jev',name:'Jev',model:'mock',provider:'mock',mock:true}}});
it('shows a disconnect lobby even when authoritative physics stops on the same tick',()=>{
  const render=createInterpolator(),play={...createGame(),tick:9,phase:'play' as const},point={...play,tick:10,phase:'point' as const,pointId:1,score:{left:1,right:0}};
  render(state(play),100,180);
  const scored=state(point);expect(render(scored,130,210).phase).toBe('point');
  const paused=state({...point,phase:'lobby'});render(paused,150,150);
  expect(render(paused,150,240).phase).toBe('lobby');expect(render(paused,150,10_000).score.left).toBe(1);
});
it('interpolates normal motion and clears old frames after a match reset',()=>{
  const render=createInterpolator(),a=state({...createGame(),tick:20,phase:'play'}),b=state({...a.game,tick:24,ball:{...a.game.ball,x:600}});
  render(a,100,180);expect(render(b,200,230).ball.x).toBe(550);
  const reset=state(createGame());expect(render(reset,300,400).tick).toBe(0);expect(render(reset,300,400).phase).toBe('lobby');
});
