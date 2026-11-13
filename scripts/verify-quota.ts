/** Real HTTP, WebSockets and browser loops; upstream is a local Decisions fixture. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import WebSocket from 'ws';
import type { ArenaState } from '../src/protocol';
const requestTimes:number[]=[];
const fixture=createServer(async(req,res)=>{
  requestTimes.push(Date.now());assert.equal(req.url,'/v1/decisions');assert.equal(req.headers.authorization,'Bearer quota-fixture-only');
  let body='';for await(const c of req)body+=c;assert.equal(JSON.parse(body).model,'gpt-6-luna');
  res.setHeader('Content-Type','application/json');res.setHeader('x-request-id','quota-fixture-request');
  if(requestTimes.length>1){res.setHeader('Retry-After','30');res.writeHead(429);res.end(JSON.stringify({error:{code:'rate_limit_exceeded',message:'Rate limit reached on requests per day (RPD): Limit 50, Used 50, Requested 1.'}}));return;}
  const answer=(name:string,choice:string)=>({name,type:'choice',choice,confidence:.9});
  res.end(JSON.stringify({model:'gpt-6-luna',answers:[answer('target','lane_8'),answer('move','stay'),answer('taunt','line_1')],usage:{input_tokens:100}}));
});
fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
const fixtureAddress=fixture.address();assert(fixtureAddress&&typeof fixtureAddress!=='string');
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const address=reservation.address();assert(address&&typeof address!=='string');await new Promise<void>(resolve=>reservation.close(()=>resolve()));
const origin=`http://127.0.0.1:${address.port}`;
// Test-only preload redirects the official URL to HTTP fixture; production has no URL override.
const preload=`const original=globalThis.fetch;globalThis.fetch=(input,init)=>original(String(input)==='https://api.openai.com/v1/decisions'?'http://127.0.0.1:${fixtureAddress.port}/v1/decisions':input,init);`;
const child=spawn(process.execPath,['--import','tsx','--import',`data:text/javascript,${encodeURIComponent(preload)}`,'server/index.ts','--production'],{
  env:{...process.env,PORT:String(address.port),PONG_MATCHUP:'jev-vs-luna',JEV_PROVIDER:'mock',JEV_MOCK:'',LUNA_MOCK:'0',OPENAI_API_KEY:'quota-fixture-only',LUNA_INTERVAL_MS:'600',LUNA_TPM_BUDGET:'60000'},stdio:['ignore','pipe','pipe'],
});
let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
const until=async(check:()=>boolean|Promise<boolean>,label:string,timeout=10000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw new Error(`Timed out: ${label}`);};
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,probe:WebSocket|undefined;
try{
  await until(async()=>{if(child.exitCode!==null)throw new Error(output);return fetch(`${origin}/health`).then(r=>r.ok).catch(()=>false);},'server readiness');
  browser=await chromium.launch({headless:true});
  const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
  const [left,right,watch]=await Promise.all(contexts.map(c=>c.newPage()));
  let latest:ArenaState|undefined;const live:number[]=[];
  watch.on('websocket',ws=>ws.on('framereceived',({payload})=>{const m=JSON.parse(String(payload));if(m.type==='state'){latest=m;if(m.decisions.right?.source==='luna')live.push(m.decisions.right.sequence);}}));
  await Promise.all([left.goto(`${origin}/?side=left`),right.goto(`${origin}/?side=right`),watch.goto(`${origin}/?spectate`)]);
  await until(()=>latest?.decisions.right?.api?.status===429,'quota response');
  assert(live.length>0,'successful live Luna intent must precede rate limit');
  assert.equal(requestTimes.length,2);assert(requestTimes[1]-requestTimes[0]>=600,'client must honor live decision pacing');
  assert.equal(latest!.decisions.right!.retryAfterMs,30000);
  assert(latest!.decisions.right!.warning?.includes('50 requests/day'));
  await until(async()=>await watch.locator('#mode').textContent()==='API FALLBACK','honest header');
  assert((await watch.locator('#right-warning').textContent())?.includes('50 requests/day'));
  const before=latest!.intents.left;
  await until(()=>latest!.intents.left>=before+5,'other agent continues during cooldown');
  assert.equal(requestTimes.length,2,'browser must not retry during provider cooldown');
  await right.close();await until(()=>latest?.connected.right===false,'right disconnect');
  probe=new WebSocket(`ws://127.0.0.1:${address.port}/ws?side=right`,{origin});
  const cooldowns:number[]=[];let joined=false;
  probe.on('message',raw=>{const m=JSON.parse(String(raw));if(m.type==='joined')joined=m.side==='right';if(m.type==='cooldown')cooldowns.push(m.retryAfterMs);});
  await once(probe,'open');await until(()=>joined,'reconnected seat');
  probe.send(JSON.stringify({type:'decide'}));await until(()=>cooldowns.length===1,'server-enforced cooldown after reconnect');
  assert(cooldowns[0]>20000);
  probe.send(JSON.stringify({type:'reset'}));probe.send(JSON.stringify({type:'decide'}));
  await until(()=>cooldowns.length===2,'cooldown survives new match');assert.equal(requestTimes.length,2);
  console.log('PASS: three browser contexts, real HTTP success then 429, >=600ms cadence, visible daily quota, no repeated provider calls, other agent keeps playing.');
  console.log('PASS: raw WebSocket decide after reconnect and match reset still respects server cooldown; total upstream requests = 2.');
}finally{
  probe?.terminate();await browser?.close();
  if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}
  fixture.closeAllConnections();await new Promise<void>(resolve=>fixture.close(()=>resolve()));
}
