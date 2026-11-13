import { test, expect } from '@playwright/test';
import type { RoomLinks } from '../src/hosting';
test('hosted Jev vs Luna selection is shared, owner-controlled, checkpointed, and mock by default',async({browser,request,baseURL})=>{
  const created=await request.post('/api/rooms',{headers:{Origin:baseURL!},data:{matchup:'jev-vs-luna'}});expect(created.status()).toBe(201);
  const links:RoomLinks=await created.json(),token=new URLSearchParams(new URL(links.owner).hash.slice(1)).get('token')!;
  const headers={Authorization:`Bearer ${token}`};
  const status=async()=>{const response=await request.get(`/api/rooms/${links.room}/status`,{headers});expect(response.ok()).toBe(true);return response.json();};
  let state=await status();expect(state.matchup).toBe('jev-vs-luna');expect(state.players.left.engine).toBe('jev');expect(state.players.right.engine).toBe('luna');expect(state.players.left.mock).toBe(true);expect(state.players.right.mock).toBe(true);
  const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
  const [left,right,owner]=await Promise.all(contexts.map(c=>c.newPage()));
  const errors:string[]=[];for(const page of [left,right,owner])page.on('pageerror',error=>errors.push(error.message));
  try{
    await owner.goto(links.owner);await left.goto(links.left);await right.goto(links.right);
    for(const page of [left,right,owner])await expect(page.locator('h1')).toContainText('Luna');
    await expect.poll(async()=>{const current=await status();return current.intents.left>2&&current.intents.right>2;}).toBe(true);
    await expect.poll(async()=>{const current=await status();return current.game.pointId>0;},{timeout:90_000}).toBe(true);
    const publicPage=await contexts[2].newPage();await publicPage.goto(links.spectator);
    await expect(publicPage.getByRole('button',{name:'Jev vs Jev',exact:true})).toBeDisabled();
    const denied=await publicPage.evaluate(async(room)=>new Promise<string>(resolve=>{
      const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/rooms/${room}/ws`);
      ws.onopen=()=>ws.send(JSON.stringify({type:'matchup',matchup:'jev-vs-jev'}));
      ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.type==='error'){resolve(message.message);ws.close();}};
    }),links.room);expect(denied).toContain('owner');expect((await status()).matchup).toBe('jev-vs-luna');
    await owner.getByRole('button',{name:'Jev vs Jev',exact:true}).click();
    for(const page of [left,right,owner,publicPage])await expect(page.locator('h1')).not.toContainText('Luna');
    state=await status();expect(state.matchup).toBe('jev-vs-jev');expect(state.game.score).toEqual({left:0,right:0});expect(state.players.right.engine).toBe('jev');
    await owner.getByRole('button',{name:'Jev vs Luna',exact:true}).click();await expect(owner.locator('h1')).toContainText('Luna');
    await left.close();await right.close();await expect.poll(async()=>(await status()).timerActive).toBe(false);
    if(!process.env.LIVE_URL){const restored=await request.get(`/api/rooms/${links.room}/reconstruct`,{headers});const recovered=await restored.json();expect(recovered.matchup).toBe('jev-vs-luna');expect(recovered.players.right.engine).toBe('luna');expect(recovered.timerActive).toBe(false);}
    expect(errors).toEqual([]);console.log('Hosted Luna: public mocks, scored point, shared mode switching, owner-only permission and checkpoint recovery PASS.');
  }finally{await Promise.all(contexts.map(c=>c.close()));}
});
