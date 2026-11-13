import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { ArenaState } from '../src/protocol';
import type { RoomLinks } from '../src/hosting';
function observe(page:Page){
  const states:ArenaState[]=[],sent:{type:string}[]=[],received:{type:string;message?:string}[]=[];
  page.on('websocket',ws=>{ws.on('framereceived',({payload})=>{if(String(payload)==='pong')return;const m=JSON.parse(String(payload));received.push(m);if(m.type==='state')states.push(m);});ws.on('framesent',({payload})=>{if(String(payload)!=='ping')sent.push(JSON.parse(String(payload)));});});
  return {states,sent,received};
}
const ownerToken=(links:RoomLinks)=>new URLSearchParams(new URL(links.owner).hash.slice(1)).get('token')!;

test('actual SDK executes in workerd: HTTP success, 429, malformed answers and timeout',async({request})=>{
  test.skip(!!process.env.LIVE_URL,'Fixture endpoints are absent from production');
  const calls:string[]=[];
  const fixture=createServer(async(req,res)=>{
    calls.push(req.url!);expect(req.headers.authorization).toBe('Bearer local-fixture-only');expect(req.headers['content-encoding']).toBeUndefined();
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
    expect(Object.keys(body.questions.target.criteria)).toHaveLength(17);expect(body.state.side).toBe('left');
    const scenario=req.url!.split('/')[1];
    if(scenario==='timeout'){await new Promise(r=>setTimeout(r,1900));if(res.destroyed)return;}
    res.setHeader('Content-Type','application/json');
    if(scenario==='rate-limit'){res.writeHead(429);res.end('{"error":{"message":"fixture rate limit"}}');return;}
    const answer=(choice:string)=>({type:'choice',choice,confidence:.91,probabilities:{[choice]:1}});
    res.end(JSON.stringify({model:'jev-1.13',answers:{target:answer(scenario==='malformed'?'lane_999':'lane_8'),move:answer('down'),taunt:answer('line_2')},usage:{input_tokens:100,output_tokens:10}}));
  });
  fixture.listen(5191,'127.0.0.1');await once(fixture,'listening');
  try{
    for(const scenario of ['success','rate-limit','malformed','timeout']){
      const response=await request.get(`/__test__/sdk?scenario=${scenario}`);expect(response.ok()).toBe(true);
      const d=await response.json();expect(d.source).toBe(scenario==='success'?'jev':'fallback');expect(d.responseMs).toBeLessThan(1850);
      if(scenario==='success'){expect(d.action.target_y).toBe(280);expect(d.action.taunt).toBe('Calculated. Obviously.');}else expect(d.warning).toContain('fallback');
      expect(calls.filter(p=>p===`/${scenario}/v1/systemone`)).toHaveLength(1);
      console.log(`workerd SDK ${scenario}: ${d.source}, ${d.responseMs} ms`);
    }
  }finally{fixture.closeAllConnections();fixture.close();await once(fixture,'close');}
});

test('Cloudflare room: independent browser loops, scoring, protected seats/reset, replay, pause and recovery',async({browser,request,baseURL},info)=>{
  const created=await request.post('/api/rooms',{headers:{Origin:baseURL!}});expect(created.status()).toBe(201);
  const links:RoomLinks=await created.json(),headers={Authorization:`Bearer ${ownerToken(links)}`};
  expect((await request.get(`/api/rooms/${links.room}/links`)).status()).toBe(403);
  expect((await request.get(`/api/rooms/${links.room}/ws`,{headers:{Origin:'https://evil.example'}})).status()).toBe(403);
  const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
  const [left,right,owner]=await Promise.all(contexts.map(c=>c.newPage()));
  const l=observe(left),r=observe(right),s=observe(owner),errors:string[]=[];
  for(const p of [left,right,owner])p.on('pageerror',e=>errors.push(e.message));
  const status=async()=>{const res=await request.get(`/api/rooms/${links.room}/status`,{headers});expect(res.ok()).toBe(true);return res.json();};
  try{
    await owner.goto(links.owner);await expect(owner.locator('body')).toHaveAttribute('data-phase','lobby');
    expect((await status()).timerActive).toBe(false);
    await left.goto(links.left);await expect(left.locator('body')).toHaveAttribute('data-role','left');
    await right.goto(links.right);await expect(right.locator('body')).toHaveAttribute('data-role','right');
    await expect(owner.locator('#left-online')).toHaveText('ONLINE');await expect(owner.locator('#right-online')).toHaveText('ONLINE');
    await expect.poll(()=>s.states.some(v=>v.game.phase==='play'&&Math.abs(v.game.ball.x-500)>80)).toBe(true);
    await expect.poll(()=>s.states.some(v=>v.intents.left>=3&&v.intents.right>=3)).toBe(true);
    for(const side of ['left','right'] as const)await expect.poll(()=>Math.max(...s.states.map(v=>v.game.paddles[side]))-Math.min(...s.states.map(v=>v.game.paddles[side]))).toBeGreaterThan(20);
    const first=await status();await new Promise(r=>setTimeout(r,1000));const second=await status();
    const hz=(second.game.tick-first.game.tick)/((second.serverTime-first.serverTime)/1000);expect(hz).toBeGreaterThan(105);expect(hz).toBeLessThan(135);
    await owner.screenshot({path:info.outputPath('workers-live.png'),fullPage:true});
    // A duplicate authorized seat watches; public users cannot claim either seat.
    const duplicate=await contexts[2].newPage();await duplicate.goto(links.left);await expect(duplicate.locator('#connection')).toContainText('PADDLE TAKEN');await duplicate.close();
    const publicPage=await contexts[2].newPage();const publicObserved=observe(publicPage);
    await publicPage.goto(links.spectator+'&side=left');await expect(publicPage.locator('body')).toHaveAttribute('data-role','spectator');
    await expect(publicPage.locator('#reset')).toBeDisabled();
    await expect.poll(()=>s.states.some(v=>v.game.pointId>0&&v.game.bestRally>0),{timeout:90_000}).toBe(true);
    const point=s.states.find(v=>v.game.pointId>0&&v.game.bestRally>0)!;expect(point.mode).toBe('mock');expect(point.game.bestRally).toBeGreaterThan(0);
    // Raw spectator attempts cannot reset, request decisions, or submit intents.
    expect(publicObserved.sent.some(m=>m.type==='decide'||m.type==='intent')).toBe(false);
    const before=await status();
    const denied=await publicPage.evaluate(async(room)=>new Promise<string>(resolve=>{
      const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/rooms/${room}/ws`);
      ws.onopen=()=>{ws.send(JSON.stringify({type:'reset'}));ws.send(JSON.stringify({type:'decide'}));ws.send(JSON.stringify({type:'intent',sequence:1,target_y:0}));};
      ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.type==='error'){resolve(m.message);ws.close();}};
    }),links.room);expect(denied).toContain('owner');expect((await status()).game.pointId).toBeGreaterThanOrEqual(before.game.pointId);
    await owner.getByRole('button',{name:/replay last point/i}).click();
    await expect.poll(()=>s.received.some(m=>m.type==='replay')).toBe(true);
    console.log('Replay frames', (s.received.find(m=>m.type==='replay') as unknown as {frames:unknown[]}).frames.length);await expect(owner.locator('body')).toHaveAttribute('data-replay','true');
    await owner.getByRole('button',{name:/back to live/i}).click();await expect(owner.locator('body')).toHaveAttribute('data-replay','false');
    await right.close();await expect(owner.locator('#right-online')).toHaveText('OFFLINE');
    const paused=await status();expect(paused.timerActive).toBe(false);expect(paused.game.phase).toBe('lobby');expect(paused.checkpoint.score).toEqual(paused.game.score);
    await new Promise(r=>setTimeout(r,12_000));expect((await status()).game.tick).toBe(paused.game.tick);
    if(!process.env.LIVE_URL){
      const recovered=await request.get(`/api/rooms/${links.room}/reconstruct`,{headers});expect(recovered.ok()).toBe(true);
      const restored=await recovered.json();expect(restored.game.score).toEqual(paused.game.score);expect(restored.connected).toEqual({left:true,right:false});expect(restored.timerActive).toBe(false);
    }
    const replacement=await contexts[1].newPage();await replacement.goto(links.right);await expect(replacement.locator('body')).toHaveAttribute('data-role','right');
    await expect.poll(()=>s.states.at(-1)?.game.phase).toBe('play');expect(s.states.at(-1)!.game.score).toEqual(paused.game.score);
    await left.reload();await expect(left.locator('body')).toHaveAttribute('data-role','left');
    await owner.getByRole('button',{name:/title card/i}).click();await expect(owner.getByRole('dialog')).toBeVisible();
    await owner.getByRole('button',{name:/start fresh match/i}).click();await expect(owner.locator('#score-left')).toHaveText('0');await expect(owner.locator('#score-right')).toHaveText('0');
    await owner.setViewportSize({width:480,height:1000});expect(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await owner.screenshot({path:info.outputPath('workers-narrow.png'),fullPage:true});
    await owner.setViewportSize({width:1280,height:800});
    await expect.poll(()=>owner.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
    await owner.screenshot({path:info.outputPath('workers-laptop.png'),fullPage:true});
    expect(l.sent.some(m=>m.type==='intent')).toBe(true);expect(r.sent.some(m=>m.type==='intent')).toBe(true);expect(s.sent.some(m=>m.type==='decide'||m.type==='intent')).toBe(false);
    expect(errors).toEqual([]);
    console.log(`Cloudflare adapter: ${s.states.length} frames, score ${point.game.score.left}:${point.game.score.right}, measured physics ${hz.toFixed(1)} Hz, intents ${l.sent.filter(m=>m.type==='intent').length}/${r.sent.filter(m=>m.type==='intent').length}; pause/recovery/reset authorization PASS.`);
  }finally{await Promise.all(contexts.map(c=>c.close()));}
});

test('isolated rooms, capability rejection, durable paid budget and message limits',async({browser,request,baseURL})=>{
  const create=async()=>{const r=await request.post('/api/rooms',{headers:{Origin:baseURL!}});expect(r.status()).toBe(201);return await r.json() as RoomLinks;};
  const a=await create(),b=await create();expect(a.room).not.toBe(b.room);
  const headers={Authorization:`Bearer ${ownerToken(a)}`};
  expect((await request.get(`/api/rooms/${b.room}/status`,{headers})).status()).toBe(403);
  if(!process.env.LIVE_URL){
    // Force a true object cold start after a durable budget reservation, without provider traffic.
    const exhausted=await request.get(`/api/rooms/${a.room}/budget-exhausted`);expect(exhausted.status()).toBe(500);
  }
  const context=await browser.newContext(),page=await context.newPage();
  try{
    await page.goto(a.spectator);
    const result=await page.evaluate(async(links)=>{
      const root=`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/rooms/${links.room}/ws`;
      const socket=()=>new WebSocket(root);
      const open=(ws:WebSocket)=>new Promise<void>((resolve,reject)=>{ws.onopen=()=>resolve();ws.onerror=()=>reject(new Error('Upgrade failed'));});
      const left=socket(),right=socket();await Promise.all([open(left),open(right)]);
      const token=(url:string)=>new URLSearchParams(new URL(url).hash.slice(1)).get('token');
      left.send(JSON.stringify({type:'join',side:'left',token:token(links.left)}));right.send(JSON.stringify({type:'join',side:'right',token:token(links.right)}));
      const decision=await new Promise<{source:string;warning?:string;action:{target_y:number};sequence:number}>(resolve=>{
        let requested=false;
        left.onmessage=event=>{
          const m=JSON.parse(event.data);
          // Request immediately on activation: the lease must not block the first decision.
          if(!requested&&m.type==='state'&&m.connected.left&&m.connected.right){requested=true;left.send(JSON.stringify({type:'decide'}));}
          if(m.type==='decision')resolve(m.decision);
        };
      });
      left.send(JSON.stringify({type:'intent',sequence:decision.sequence+100,target_y:decision.action.target_y}));
      left.send(JSON.stringify({type:'intent',sequence:decision.sequence,target_y:-1000}));
      await new Promise(r=>setTimeout(r,100));
      left.send(JSON.stringify({type:'intent',sequence:decision.sequence,target_y:decision.action.target_y}));
      left.send(JSON.stringify({type:'intent',sequence:decision.sequence,target_y:decision.action.target_y}));
      await new Promise(r=>setTimeout(r,100));
      // A binary message and a flood must close with explicit policy codes.
      const binary=socket();await open(binary);const binaryClose=new Promise<number>(resolve=>binary.onclose=e=>resolve(e.code));binary.send(new Uint8Array(5000));
      const flood=socket();await open(flood);const floodClose=new Promise<number>(resolve=>flood.onclose=e=>resolve(e.code));for(let i=0;i<30;i++)flood.send('{"type":"unknown"}');
      const codes=await Promise.all([binaryClose,floodClose]);
      const extras=await Promise.all(Array.from({length:9},async()=>{const ws=socket();await open(ws);return ws;}));
      const capped=await new Promise<boolean>(resolve=>{const extra=socket();extra.onerror=()=>resolve(true);extra.onopen=()=>{extra.close();resolve(false);};});
      for(const ws of extras)ws.close();left.close();right.close();return {decision,codes,capped};
    },a);
    expect(result.codes).toEqual([1009,1008]);expect(result.capped).toBe(true);
    if(!process.env.LIVE_URL){expect(result.decision.source).toBe('fallback');expect(result.decision.warning).toContain('budget exhausted');}
    const status=await (await request.get(`/api/rooms/${a.room}/status`,{headers})).json();expect(status.intents.left).toBe(1);
    await expect.poll(async()=>(await (await request.get(`/api/rooms/${a.room}/status`,{headers})).json()).timerActive).toBe(false);
    if(!process.env.LIVE_URL)expect(status.calls).toBe(1200);
    const other=await (await request.get(`/api/rooms/${b.room}/status`,{headers:{Authorization:`Bearer ${ownerToken(b)}`}})).json();expect(other.game.tick).toBe(0);expect(other.mode).toBe('mock');expect(other.connected).toEqual({left:false,right:false});
  }finally{await context.close();}
});
