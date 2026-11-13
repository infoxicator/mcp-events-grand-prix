import { test, expect } from '@playwright/test';
import type { RoomLinks } from '../src/hosting';
import type { ArenaState } from '../src/protocol';
test('live HTTP and three browser contexts complete a full scored mock match',async({browser,request,baseURL},info)=>{
  test.skip(process.env.FULL_MATCH!=='1','Opt-in full match verification');test.setTimeout(600_000);
  const health=await request.get('/health');expect(health.ok()).toBe(true);expect((await health.json()).runtime).toBe('cloudflare-workers');
  const created=await request.post('/api/rooms',{headers:{Origin:baseURL!},data:{matchup:process.env.PONG_MATCHUP??'jev-vs-jev'}});expect(created.status()).toBe(201);const links:RoomLinks=await created.json();
  const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
  const [left,right,spectator]=await Promise.all(contexts.map(c=>c.newPage()));
  let frames=0,leftIntents=0,rightIntents=0,spectatorIntents=0,lastPoint=0,winner:ArenaState|null=null,latest:ArenaState|null=null;
  const errors:string[]=[];
  for(const [page,side] of [[left,'left'],[right,'right'],[spectator,'spectator']] as const){
    page.on('pageerror',error=>errors.push(error.message));
    page.on('websocket',ws=>{
      ws.on('framesent',({payload})=>{if(String(payload)==='ping')return;const m=JSON.parse(String(payload));if(m.type==='intent'){if(side==='left')leftIntents++;else if(side==='right')rightIntents++;else spectatorIntents++;}});
      if(side==='spectator')ws.on('framereceived',({payload})=>{
        if(String(payload)==='pong')return;const state=JSON.parse(String(payload)) as ArenaState;if(state.type!=='state')return;
        frames++;latest=state;if(state.game.pointId!==lastPoint){lastPoint=state.game.pointId;console.log(`Live point ${lastPoint}: ${state.game.score.left}:${state.game.score.right}, rally ${state.game.rally}, tick ${state.game.tick}`);}
        if(state.game.phase==='won')winner=state;
      });
    });
  }
  try{
    await spectator.goto(links.spectator);await left.goto(links.left);await right.goto(links.right);
    await expect(left.locator('body')).toHaveAttribute('data-role','left');await expect(right.locator('body')).toHaveAttribute('data-role','right');
    await expect.poll(()=>winner!==null,{timeout:570_000,intervals:[500]}).toBe(true);
    const final=winner! as ArenaState;expect(Math.max(final.game.score.left,final.game.score.right)).toBe(7);expect(final.mode).toBe('mock');expect(final.game.bestRally).toBeGreaterThan(0);expect(leftIntents).toBeGreaterThan(10);expect(rightIntents).toBeGreaterThan(10);expect(spectatorIntents).toBe(0);expect(errors).toEqual([]);
    await spectator.screenshot({path:info.outputPath('live-full-match.png'),fullPage:true});
    const summary={url:baseURL,matchup:final.matchup,score:final.game.score,points:final.game.pointId,bestRally:final.game.bestRally,tick:final.game.tick,frames,leftIntents,rightIntents,spectatorIntents,errors};
    await info.attach('live-match-summary',{body:JSON.stringify(summary,null,2),contentType:'application/json'});console.log('FULL MATCH PASS',JSON.stringify(summary));
  }finally{void latest;await Promise.all(contexts.map(c=>c.close()));}
});
