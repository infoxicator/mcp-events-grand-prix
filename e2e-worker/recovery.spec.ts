import { test, expect } from '@playwright/test';
import type { RoomLinks } from '../src/hosting';
import type { ArenaState } from '../src/protocol';
test('winning checkpoints resume the rematch countdown and stay detached from live physics',async({browser,request,baseURL})=>{
  test.skip(!!process.env.LIVE_URL,'Checkpoint seeding is local-only');
  const created=await request.post('/api/rooms',{headers:{Origin:baseURL!},data:{matchup:'jev-vs-luna'}});expect(created.status()).toBe(201);const links:RoomLinks=await created.json();
  expect((await request.get(`/api/rooms/${links.room}/won-checkpoint`)).status()).toBe(500);
  const token=new URLSearchParams(new URL(links.owner).hash.slice(1)).get('token')!,headers={Authorization:`Bearer ${token}`};
  const status=async()=>{const response=await request.get(`/api/rooms/${links.room}/status`,{headers});expect(response.ok()).toBe(true);return response.json();};
  const context=await browser.newContext(),page=await context.newPage(),states:ArenaState[]=[];
  page.on('websocket',ws=>ws.on('framereceived',({payload})=>{if(String(payload)==='pong')return;const value=JSON.parse(String(payload));if(value.type==='state')states.push(value);}));
  try{
    await page.goto(links.owner);
    await page.evaluate(async(links)=>{
      const url=`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/rooms/${links.room}/ws`;
      const retained:WebSocket[]=[];(window as unknown as {recoverySockets:WebSocket[]}).recoverySockets=retained;
      await Promise.all((['left','right'] as const).map(side=>new Promise<void>((resolve,reject)=>{
        const ws=new WebSocket(url);retained.push(ws);ws.onerror=()=>reject(new Error('Upgrade failed'));ws.onopen=()=>{ws.send(JSON.stringify({type:'join',side,token:new URLSearchParams(new URL(links[side]).hash.slice(1)).get('token')}));resolve();};
      })));
    },links);
    await expect.poll(()=>states.some(state=>state.game.phase==='won'&&state.game.score.left===7)).toBe(true);
    await expect.poll(async()=>(await status()).game.tick).toBeGreaterThan(920);
    const active=await status();expect(active.checkpoint.tick).toBe(900);expect(active.matchup).toBe('jev-vs-luna');
    await expect.poll(()=>states.some(state=>state.game.phase==='serve'&&state.game.score.left===0&&state.game.score.right===0),{timeout:10_000}).toBe(true);
    expect(states.some(state=>state.game.score.left>7||state.game.score.right>7)).toBe(false);
    console.log('PASS: cold-start winning score resumes won countdown, resets to 0:0, and preserves the last checkpoint while physics advances.');
  }finally{await context.close();}
});
