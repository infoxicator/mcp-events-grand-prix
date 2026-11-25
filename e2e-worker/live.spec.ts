import {test,expect,type APIRequestContext} from '@playwright/test';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {WebSocket} from 'ws';
import {liveInvitation,liveSpectatorURL,newLiveKey,pairingChallenge,parseLiveInvitation} from '../src/race/live';
import type {RaceState,ServerMessage} from '../src/race/types';
import {sepCallbackTransport} from '../worker/sep-webhook';

const fixture='http://127.0.0.1:8798';
const host='http://127.0.0.1:8799';
const accessPath='/owner/live';
const pairPath='/api/live-pair';

async function signedToken(request:APIRequestContext,query=''){
 return (await request.get(fixture+'/token'+query).then(r=>r.json())).token as string;
}

async function pair(request:APIRequestContext,chat=false){
 const room=crypto.randomUUID(),key=newLiveKey(),challenge=await pairingChallenge(key);
 const registration=await request.post(pairPath,{data:{room,key:challenge,chat}});
 expect(registration.ok()).toBe(true);
 return {room,key,challenge,url:`${accessPath}?pair=${room}`};
}

const readCalls=(request:APIRequestContext)=>request.get(fixture+'/fixture').then(r=>r.json()) as Promise<{jev:number;luna:number;engineer:number;keys:number}>;
const counts=({jev,luna,engineer}:Awaited<ReturnType<typeof readCalls>>)=>({jev,luna,engineer});

test('SEP-3415 reuses server authentication across races and signs and retries webhook deliveries',async({request,baseURL})=>{
 const origin=baseURL!, incoming='grand_prix.strategy_required',version='2026-07-28';
 const extension='io.modelcontextprotocol/events';
 const token='e'.repeat(64),wrongToken='d'.repeat(64);
 const rpc=async(method:string,params:Record<string,unknown>={},token?:string,nameHeader?:string|null,path='/mcp/sep-events')=>{
  const name=nameHeader===undefined&&typeof params.name==='string'?params.name:nameHeader;
  const response=await request.post(path,{
   headers:{Accept:'application/json, text/event-stream','Mcp-Protocol-Version':version,'Mcp-Method':method,
    ...(name?{'Mcp-Name':name}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
   data:{jsonrpc:'2.0',id:crypto.randomUUID(),method,params:{...params,_meta:{
    'io.modelcontextprotocol/protocolVersion':version,
    'io.modelcontextprotocol/clientInfo':{name:'SEP regression client',version:'1'},
    'io.modelcontextprotocol/clientCapabilities':{},
   }}},
  });
  return {status:response.status(),...await response.json()};
 };
 const discovery=await rpc('server/discover');
 expect(discovery.result.capabilities.extensions[extension]).toEqual({});
 const legacyDiscovery=await rpc('server/discover',{},undefined,undefined,'/mcp');
 expect(legacyDiscovery.result.capabilities.events).toEqual({});
 expect(legacyDiscovery.result.capabilities.extensions?.[extension]).toBeUndefined();
 const listed=await rpc('events/list');
 expect(listed.result).toMatchObject({resultType:'complete',events:[{name:incoming,delivery:['webhook'],inputSchema:{required:['room','team']}}]});

 const open={name:'open_grand_prix_strategy',arguments:{multiplayer:true}};
 expect(await rpc('tools/call',open)).toMatchObject({status:401,error:{code:-32024}});
 const opening=await rpc('tools/call',open,token);
 expect(opening).toHaveProperty('result');
 const opened=opening.result;
 expect(opened.isError).toBeFalsy();
 const {room,key}=opened._meta.liveInvitation;
 const {strategyKey,guestInvitation}=opened._meta;
 const filter=opened.structuredContent.event_filter;
 expect(filter).toEqual({room,team:'a'});
 expect(opened._meta).not.toHaveProperty('eventBearerToken');
 expect(JSON.stringify(opened)).not.toContain(token);
 const localPath='/sep-callback/'+crypto.randomUUID();
 const url='https://callback.example.test'+localPath;
 const secret=(byte:number)=>'whsec_'+Buffer.alloc(32,byte).toString('base64');
 const subscription={name:incoming,arguments:filter,delivery:{mode:'webhook',url,secret:secret(7)},cursor:null,ttlMs:null};
 const probe=watch(origin,room,key);
 const received=(path=localPath)=>request.get(fixture+path).then(response=>response.json());
 try{
  expect((await rpc('events/subscribe',subscription)).error.code).toBe(-32024);
  expect((await rpc('events/subscribe',subscription,wrongToken)).error.code).toBe(-32024);
  expect(await rpc('events/subscribe',subscription,token,null)).toMatchObject({status:400,error:{code:-32020}});
  expect(await rpc('events/subscribe',subscription,token,'wrong')).toMatchObject({status:400,error:{code:-32020}});
  expect((await rpc('events/subscribe',{...subscription,name:'unknown.event'},token)).error).toMatchObject({code:-32023,data:{kind:'event'}});
  expect((await rpc('events/poll',{name:incoming,arguments:filter},token)).error).toMatchObject({code:-32026,data:{value:'poll'}});
  expect((await rpc('events/stream',{name:incoming,arguments:filter},token)).error).toMatchObject({code:-32026,data:{value:'push'}});
  expect((await rpc('events/subscribe',{...subscription,delivery:{...subscription.delivery,url:url+'-reject'}},token)).error).toMatchObject({code:-32027,data:{reason:'challenge_failed'}});
  expect((await rpc('events/subscribe',{...subscription,delivery:{...subscription.delivery,url:url+'-oversize'}},token)).error).toMatchObject({code:-32027,data:{reason:'challenge_failed'}});
  expect((await rpc('events/subscribe',{...subscription,delivery:{...subscription.delivery,url:'https://private-callback.example.test'+localPath+'-private'}},token)).error).toMatchObject({code:-32027,data:{reason:'challenge_failed'}});
  expect((await received(localPath+'-private')).verifications).toBe(0);
  expect((await rpc('events/subscribe',{...subscription,delivery:{...subscription.delivery,url:'http://callback.example.test'+localPath}},token)).error.code).toBe(-32602);
  const competing=await Promise.all([rpc('events/subscribe',subscription,token),rpc('events/subscribe',subscription,token)]);
  const subscribed=competing[0].result;
  expect(subscribed).toMatchObject({resultType:'complete',id:expect.stringMatching(/^sub_/),refreshBefore:expect.any(String),cursor:null,truncated:false});
  expect(competing[1].result.id).toBe(subscribed.id);
  const rotated=await rpc('events/subscribe',{...subscription,delivery:{...subscription.delivery,secret:secret(9)}},token);
  expect(rotated.result.id).toBe(subscribed.id);
  expect((await received()).verifications).toBe(1);

  const otherRace=(await rpc('tools/call',open,token)).result;
  const otherFilter=otherRace.structuredContent.event_filter;
  try{
   expect(otherFilter).toEqual({room:expect.any(String),team:'a'});
   expect(otherFilter.room).not.toBe(room);
   const otherSubscription={...subscription,arguments:otherFilter};
   const other=(await rpc('events/subscribe',otherSubscription,token)).result;
   expect(other).toMatchObject({resultType:'complete',id:expect.stringMatching(/^sub_/)});
   expect(other.id).not.toBe(subscribed.id);
   expect((await received()).verifications).toBe(1);
   expect((await rpc('events/unsubscribe',{...otherSubscription,delivery:{url}},token)).result).toMatchObject({resultType:'complete'});
  }finally{
   await rpc('tools/call',{name:'stop_grand_prix_chat_strategy',arguments:{room:otherFilter.room,key:otherRace._meta.strategyKey}},token);
  }

  const joined=(await rpc('tools/call',{name:'open_grand_prix_strategy',arguments:{invite:guestInvitation}},token)).result;
  const guestPath=localPath+'-gone';
  const guest={name:incoming,arguments:joined.structuredContent.event_filter,delivery:{...subscription.delivery,url:'https://another-callback.example.test'+guestPath}};
  expect((await rpc('events/subscribe',guest,token)).result.id).not.toBe(subscribed.id);
  await expect.poll(()=>probe.state()?.strategyWebhook).toBe('connected');
  probe.ws.send(JSON.stringify({type:'start',startKey:strategyKey}));
  await expect.poll(async()=>(await received()).attempts.length,{timeout:15_000}).toBeGreaterThanOrEqual(2);
  const {attempts:[first,retry]}=await received();
  expect(first).toMatchObject({id:expect.stringMatching(/^msg_/),signatures:2,status:503,value:{name:incoming,cursor:null,data:{room,team:'a'}}});
  expect(first.id).not.toBe(first.value.eventId);
  expect(retry).toEqual({...first,status:200});
  await expect.poll(async()=>(await received(guestPath)).attempts[0]?.status).toBe(410);
  const rejectedDelivery=(await received(guestPath)).attempts[0].id;
  const guestUnsubscribe={...guest,delivery:{url:guest.delivery.url}};
  expect((await rpc('events/unsubscribe',guestUnsubscribe,wrongToken)).error.code).toBe(-32024);
  expect((await rpc('events/unsubscribe',guestUnsubscribe,token)).result).toMatchObject({resultType:'complete'});
  expect((await rpc('events/unsubscribe',guestUnsubscribe,token)).error).toMatchObject({code:-32023,data:{kind:'subscription'}});
  const short=(await rpc('events/subscribe',{...guest,ttlMs:1000},token)).result;
  await expect.poll(()=>Date.now()).toBeGreaterThan(Date.parse(short.refreshBefore));
  expect((await rpc('events/unsubscribe',guestUnsubscribe,token)).error.code).toBe(-32023);
  expect((await received(guestPath)).attempts.filter((attempt:{id:string})=>attempt.id===rejectedDelivery)).toHaveLength(1);
  const eventId=first.value.eventId;
  const radio={name:'submit_grand_prix_radio',arguments:{room,event_id:eventId,action:'manage',radio:'Manage the tyres on the opening stint.'}};
  expect(await rpc('tools/call',radio,wrongToken)).toMatchObject({status:401,error:{code:-32024}});
  expect((await rpc('tools/call',{...radio,arguments:{...radio.arguments,team:'b'}},token)).result.isError).toBe(true);
  expect((await rpc('tools/call',radio,token,undefined,'/mcp')).result.isError).toBe(true);
  expect((await rpc('tools/call',radio,token)).result.isError).toBeFalsy();
  await expect.poll(()=>probe.state()?.race.radio.some(r=>r.text===radio.arguments.radio)).toBe(true);
  await rpc('tools/call',{name:'stop_grand_prix_chat_strategy',arguments:{room,key:strategyKey}},token);
  await expect.poll(async()=>(await received()).attempts.some((a:{value:{type?:string}})=>a.value.type==='terminated')).toBe(true);
 }finally{
  probe.ws.close();
  await rpc('tools/call',{name:'stop_grand_prix_chat_strategy',arguments:{room,key:strategyKey}},token);
 }
});

test('SEP callback transport checks DNS before each POST and preserves the signed request',async()=>{
 const requests:{url:string;redirect?:RequestRedirect;body?:BodyInit|null}[]=[];
 let addresses=['8.8.8.8','2606:4700:4700::1111'];
 const deliver=sepCallbackTransport(async(input,init)=>{
  requests.push({url:String(input),redirect:init?.redirect,body:init?.body});
  return new Response(null,{status:204});
 },async()=>addresses);
 const url='https://callback.example.test/receive';
 await deliver(url,{method:'POST',redirect:'follow',body:'{}'});
 for(const address of ['127.0.0.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fd00::1','2001:db8::1']){
  addresses=['8.8.8.8',address];
  await expect(deliver(url)).rejects.toMatchObject({reason:'challenge_failed'});
 }
 expect(requests).toEqual([{url,redirect:'manual',body:'{}'}]);
});

async function mcp(origin:string){
 const client=new Client({name:'Grand Prix Worker verification',version:'1'});
 await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',origin)));
 return client;
}

function watch(origin:string,room:string,token:string){
 const ws=new WebSocket(origin.replace('http','ws')+`/api/rooms/${room}/ws`,{origin:'https://independent.example'});
 const messages:ServerMessage[]=[];
 ws.on('open',()=>ws.send(JSON.stringify({type:'join',team:'a',token})));
 ws.on('message',data=>messages.push(JSON.parse(data.toString())));
 const state=()=>messages.findLast((m):m is RaceState=>m.type==='state');
 return {ws,messages,state};
}

test('workerd accepts signed header and cookie only, and rejects signing-key redirects',async({request,baseURL})=>{
 const {url,room,key,challenge}=await pair(request);
 const token=await signedToken(request);
 const header={'Cf-Access-Jwt-Assertion':token}, cookie={Cookie:`other=1; CF_Authorization=${token}`};
 const before=counts(await readCalls(request));
 for(const headers of [header,cookie]){
  const res=await request.get(url,{headers});
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('Confirm and start live race');
 }
 for(const query of ['?aud=pong','?iss=https://other.cloudflareaccess.com','?email=owner+other@example.test','?expired','?future','?tampered']){
  const denied=await request.get(url,{headers:{Cookie:`CF_Authorization=${await signedToken(request,query)}`}});
  expect(denied.status()).toBe(403);
 }
 expect((await request.get(url,{headers:{'Cf-Access-Authenticated-User-Email':'owner@example.test'}})).status()).toBe(403);
 expect((await request.get(url,{headers:{...cookie,'Cf-Access-Jwt-Assertion':'invalid'}})).status()).toBe(403);
 await request.post(fixture+'/fixture?keys=redirect');
 try{expect((await request.get(url,{headers:header})).status()).toBe(403);}finally{await request.post(fixture+'/fixture');}
 const form={confirm:'start',challenge,circuit:'monza',matchup:'jev-vs-jev'};
 expect((await request.post(url,{headers:header,form})).status()).toBe(403);
 expect((await request.post(url,{headers:{Origin:baseURL!},form})).status()).toBe(403);
 expect((await request.post(url,{headers:{Origin:baseURL!,...header},form:{...form,challenge:newLiveKey()}})).status()).toBe(410);
 expect((await request.post(pairPath+'/claim',{data:{room,key:challenge}})).status()).toBe(410);
 expect((await request.post(pairPath+'/claim',{data:{room,key}})).status()).toBe(202);
 expect((await request.post('/internal-start',{data:form})).status()).toBe(404);
 expect(counts(await readCalls(request))).toEqual(before);
});

test('one confirmed room plays through two MCP hosts and a separate browser, then stops for all',async({browser,request,baseURL})=>{
 const origin=baseURL!;
 const [contextA,contextB,spectatorContext,ownerContext]=await Promise.all(Array.from({length:4},()=>browser.newContext()));
 const [pageA,pageB,browserView,ownerPage]=await Promise.all([contextA,contextB,spectatorContext,ownerContext].map(c=>c.newPage()));
 const client=await mcp(origin);
 const before=counts(await readCalls(request));
 let probe:ReturnType<typeof watch>|undefined;
 let second:ReturnType<typeof watch>|undefined;
 try{
  const paired=await pair(request);
  const ownerUrl=`${origin}${paired.url}&matchup=jev-vs-luna`;
  const room=paired.room;
  expect(counts(await readCalls(request))).toEqual(before);
  await ownerPage.goto(ownerUrl);
  await expect(ownerPage.getByRole('heading',{name:'Owner sign-in required'})).toBeVisible();
  const token=await signedToken(request);
  await ownerContext.addCookies([{name:'CF_Authorization',value:token,url:origin}]);
  await ownerPage.reload();
  await expect(ownerPage.getByRole('heading',{name:'Confirm live race'})).toBeVisible();
  expect(counts(await readCalls(request))).toEqual(before);
  const challenge=await ownerPage.locator('input[name=challenge]').inputValue();
  await expect(ownerPage.getByLabel('Matchup')).toHaveValue('jev-vs-luna');
  await ownerPage.getByRole('button',{name:'Confirm and start live race'}).click();
  await expect(ownerPage.getByRole('heading',{name:'Manage live race'})).toBeVisible();
  const code=await ownerPage.getByLabel('Live spectator invitation').inputValue();
  const invite=parseLiveInvitation(code,origin)!;
  expect(invite.room).toBe(room);
  const headers={Origin:origin,'Cf-Access-Jwt-Assertion':token};
  const form={confirm:'start',challenge,matchup:'jev-vs-luna',circuit:'monza'};
  const retries=await Promise.all(Array.from({length:3},()=>request.post(ownerUrl,{headers,form})));
  for(const retry of retries){
   expect(retry.ok()).toBe(true);
   expect(await retry.text()).toContain(code);
  }

  probe=watch(origin,room,invite.key);
  await expect.poll(()=>probe?.state()?.intents.a??0).toBeGreaterThan(0);
  await expect.poll(()=>probe?.state()?.intents.b??0).toBeGreaterThan(0);
  await expect.poll(()=>probe?.state()?.race.radio.some(r=>r.speaker==='ENGINEER'&&r.source==='live')).toBe(true);
  expect(probe.messages.find(m=>m.type==='joined')).toEqual({type:'joined',team:null,canReset:false});
  await expect.poll(()=>probe?.state()?.driverStats.a.successes??0).toBeGreaterThan(0);
  await expect.poll(()=>probe?.state()?.driverStats.b.successes??0).toBeGreaterThan(0);
  expect((await readCalls(request)).jev).toBeGreaterThan(before.jev);
  expect((await readCalls(request)).luna).toBeGreaterThan(before.luna);
  expect((await readCalls(request)).engineer).toBeGreaterThan(before.engineer);
  const deniedSocket=watch(origin,room,newLiveKey());
  const deniedCode=await new Promise<number>(resolve=>deniedSocket.ws.once('close',resolve));
  expect(deniedCode).toBe(1008);
  expect(deniedSocket.state()).toBeUndefined();
  expect((await request.get(`/api/rooms/${room}/status`)).status()).toBe(404);
  expect((await client.callTool({name:'grand_prix_status',arguments:{room}})).isError).toBe(true);
  expect((await client.callTool({name:'open_grand_prix',arguments:{invite:liveInvitation({room,key:newLiveKey()})}})).isError).toBe(true);

  await pageA.goto(host+'/?invite='+encodeURIComponent(code));
  const appA=pageA.frameLocator('#app-frame').frameLocator('iframe');
  await expect(appA.locator('#mcp-invite')).toHaveValue(code);
  await pageB.goto(host+'/');
  const appB=pageB.frameLocator('#app-frame').frameLocator('iframe');
  await appB.locator('#mcp-join-panel summary').click();
  await appB.locator('#mcp-join').fill(code);
  await appB.getByRole('button',{name:'Join Team B',exact:true}).click();
  await expect(appB.locator('#mcp-invite')).toHaveValue(code);
  for(const app of [appA,appB]){
   const menu=app.getByRole('button',{name:'Race menu',exact:true});
   await expect(menu).toHaveAttribute('aria-expanded','false');
   await menu.click();
  }
  const spectatorPopup=contextA.waitForEvent('page');
  await appA.getByRole('button',{name:'Open spectator',exact:false}).click();
  const linkPage=await spectatorPopup;
  await linkPage.waitForURL(url=>url.searchParams.get('live')===room);
  const browserLink=new URL(linkPage.url());
  await linkPage.close();
  browserLink.searchParams.set('view','telemetry');
  await browserView.goto(browserLink.toString());
  for(const view of [appA,appB,browserView]){
   await expect(view.locator('body')).toHaveAttribute('data-room',room);
   await expect(view.locator('#connection')).toContainText(/PRIVATE LIVE RACE/);
  }
  await expect(appA.getByRole('button',{name:'Stop live race',exact:false})).toBeVisible();
  await expect(appB.getByRole('button',{name:'Copy live invitation'})).toBeVisible();
  await expect(appB.locator('#mcp-play')).toBeHidden();

  // An independent paired room can still run when the first room stops.
  await request.post(fixture+'/fixture?engineer=fail');
  const comparison=await pair(request);
  await request.post(comparison.url,{headers,form:{...form,challenge:comparison.challenge}});
  const comparisonLive=await request.post(pairPath+'/claim',{data:{room:comparison.room,key:comparison.key}}).then(r=>r.json());
  second=watch(origin,comparison.room,comparisonLive.key);
  await ownerPage.getByRole('button',{name:'Stop live race',exact:true}).click();
  await expect(ownerPage.getByRole('heading',{name:'Live race stopped by owner'})).toBeVisible();
  await expect.poll(()=>probe?.state()?.live).toBe('stopped');
  await expect.poll(()=>second?.state()?.live).toBe('running');
  await expect.poll(()=>second?.state()?.race.radio.some(r=>r.speaker==='ENGINEER'&&r.source==='fallback')).toBe(true);
  const comparisonStop=await request.post(comparison.url,{headers,form:{confirm:'stop'}});
  expect(comparisonStop.ok()).toBe(true);
  const stopped=counts(await readCalls(request));

  for(const view of [appA,appB,browserView]){
   await expect(view.locator('#connection')).toContainText(/STOPPED BY OWNER/);
  }
  await expect(appA.locator('#mcp-invite')).toHaveValue(code);
  await expect(appB.locator('#mcp-invite')).toHaveValue(code);
  expect(await ownerPage.getByLabel('Live spectator invitation').inputValue()).toBe(code);
  await browserView.reload();
  await expect(browserView.locator('#connection')).toContainText(/STOPPED BY OWNER/);
  await pageB.goto(host+'/?invite='+encodeURIComponent(code));
  await expect(appB.locator('#mcp-status')).toContainText('stopped by owner');
  const retry=await request.post(ownerUrl,{headers,form});
  expect(await retry.text()).toContain('Live race stopped by owner');
  expect(counts(await readCalls(request))).toEqual(stopped);
 }finally{
  probe?.ws.close();
  second?.ws.close();
  await client.close();
  await request.post(fixture+'/fixture');
  await Promise.all([contextA,contextB,spectatorContext,ownerContext].map(c=>c.close()));
 }
});

test('mock MCP seats share one room and reconnect without making provider requests',async({browser,request,baseURL})=>{
 const before=counts(await readCalls(request));
 const [aContext,bContext,viewerContext]=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
 const [aPage,bPage,viewer]=await Promise.all([aContext,bContext,viewerContext].map(c=>c.newPage()));
 try{
  await aPage.goto(host+'/?player=a');
  const a=aPage.frameLocator('#app-frame').frameLocator('iframe'),b=bPage.frameLocator('#app-frame').frameLocator('iframe');
  await a.getByRole('button',{name:'Ready team A'}).click();
  await expect(a.locator('#mcp-status')).toContainText('Waiting for team B');
  const invitation=await a.locator('#mcp-invite').inputValue(),room=invitation.split(':')[1];
  await viewer.goto(`${baseURL}/?room=${room}&spectate&view=telemetry`);
  await bPage.goto(host+'/?invite='+encodeURIComponent(invitation));
  await expect(b.locator('#mcp-play')).toHaveText('Ready team B');
  await b.getByRole('button',{name:'Ready team B'}).click();
  await expect(a.locator('#mcp-status')).toContainText('Both teams ready');
  await expect(viewer.locator('#race-phase')).toHaveText('LOBBY');
  await expect(viewer.getByRole('button',{name:'Start race',exact:true})).toBeHidden();
  await a.getByRole('button',{name:'Start race',exact:true}).click();
  await expect(a.locator('#mcp-status')).toContainText('Race in progress');
  for(const v of [a,b,viewer])await expect(v.locator('body')).toHaveAttribute('data-room',room);
  const read=()=>request.get(`/api/rooms/${room}/status`).then(r=>r.json()) as Promise<RaceState>;
  await expect.poll(async()=>(await read()).intents.b).toBeGreaterThan(1);
  await bPage.getByRole('button',{name:'Close app'}).click();
  await expect(a.locator('#mcp-status')).toContainText('Waiting for team B');
  const pause=(await read()).race.tick;
  await bPage.reload();
  await b.getByRole('button',{name:'Ready team B'}).click();
  await expect.poll(async()=>(await read()).race.tick).toBeGreaterThan(pause);
  expect((await read()).paidCalls).toBe(0);
  expect(counts(await readCalls(request))).toEqual(before);
 }finally{await Promise.all([aContext,bContext,viewerContext].map(c=>c.close()));}
});

test('owner-paired strategy waits for subscription and Start race before paid driving',async({browser,request,baseURL})=>{
 const origin=baseURL!,ownerHeaders={Origin:origin,'Cf-Access-Jwt-Assertion':await signedToken(request)};
 const callsBefore=counts(await readCalls(request));
 const client=await mcp(origin),context=await browser.newContext();
 const endpoint='/webhook/mcp-events/'+crypto.randomUUID();
 const incoming='grand_prix.strategy_required';
 let ownerUrl:string|undefined,probe:ReturnType<typeof watch>|undefined;
 try{
  const paired=await pair(request,true);
  ownerUrl=`${origin}${paired.url}&strategist=chatgpt`;
  const room=paired.room;
  const html=await request.get(ownerUrl,{headers:ownerHeaders}).then(r=>r.text());
  expect(html).toContain('<option value="chatgpt" selected>ChatGPT Work via native MCP Events');
  const challenge=html.match(/name="challenge" value="([a-f0-9]+)"/)?.[1];
  expect(challenge).toBeTruthy();
  const confirmed=await request.post(ownerUrl,{headers:ownerHeaders,form:{
   confirm:'start',challenge:challenge!,circuit:'monza',matchup:'jev-vs-jev',strategist:'chatgpt',
  }});
  expect(confirmed.ok()).toBe(true);
  const invitation=(await confirmed.text()).match(/value="(jev-live:[a-f0-9:-]+)"/)?.[1];
  const invite=parseLiveInvitation(invitation!,origin)!;
  const claimed=await request.post(pairPath+'/claim',{data:{room,key:paired.key}}).then(r=>r.json()) as {
   room:string;key:string;strategyKey:string;eventFilter:{room:string;subscription_key:string};
  };
  expect(claimed).toMatchObject({room,key:invite.key,eventFilter:{room,subscription_key:expect.stringMatching(/^[a-f0-9]{64}$/)}});
  probe=watch(origin,room,invite.key);
  await expect.poll(()=>probe?.state()?.strategyWebhook).toBe('waiting');
  expect(probe.state()?.race.phase).toBe('lobby');
  expect(counts(await readCalls(request))).toEqual(callsBefore);
  const requestRpc=(method:string,params:object)=>request.post('/mcp',{data:{jsonrpc:'2.0',id:method,method,params}});
  const stream=await requestRpc('events/stream',{name:incoming,arguments:{room}});
  expect(stream.status()).toBe(403);
  const subscription=await requestRpc('events/subscribe',{
   name:incoming,arguments:claimed.eventFilter,
   delivery:{mode:'webhook',url:'https://connectors.api.openai.com'+endpoint,secret:'whsec_'+Buffer.alloc(32,7).toString('base64')},
  }).then(r=>r.json());
  expect(subscription.result.id).toMatch(/^sub_/);
  const received=()=>request.get(fixture+endpoint).then(r=>r.json());
  await expect.poll(()=>probe?.state()?.strategyWebhook).toBe('connected');
  probe.ws.send(JSON.stringify({type:'start',startKey:invite.key}));
  const sent=Date.now();
  probe.ws.send(JSON.stringify({type:'ping',sent}));
  await expect.poll(()=>probe?.messages.some(message=>message.type==='pong'&&message.sent===sent)).toBe(true);
  expect(probe.state()?.race).toMatchObject({phase:'lobby',tick:0,time:0});
  expect((await received()).events).toEqual([]);
  expect(counts(await readCalls(request))).toEqual(callsBefore);
  probe.ws.send(JSON.stringify({type:'start',startKey:claimed.strategyKey}));
  await expect.poll(async()=>(await received()).events.length,{timeout:15000}).toBeGreaterThan(0);
  const {events:[event]}=await received();
  expect(event.data).toMatchObject({room,team:'a',lap:1});
  const args={room,event_id:event.eventId};
  expect((await client.callTool({name:'get_grand_prix_strategy_event',arguments:args})).isError).toBeFalsy();
  const order={...args,action:'manage',radio:'Manage the tyres through this stint.'};
  expect((await client.callTool({name:'submit_grand_prix_radio',arguments:order})).isError).toBeFalsy();
  expect((await client.callTool({name:'submit_grand_prix_radio',arguments:order})).isError).toBe(true);
  const page=await context.newPage();
  await page.goto(host+'/?test-messages=1&invite='+encodeURIComponent(invitation!));
  const app=page.frameLocator('#app-frame').frameLocator('iframe');
  await expect(app.getByRole('region',{name:'ChatGPT radio'})).toContainText(order.radio);
  expect(await page.locator('body').getAttribute('data-strategy-message')).toBeNull();
  await expect.poll(async()=>(await readCalls(request)).jev).toBeGreaterThan(callsBefore.jev);
  expect((await readCalls(request)).engineer).toBe(callsBefore.engineer);
 }finally{
  if(ownerUrl)await request.post(ownerUrl,{headers:ownerHeaders,form:{confirm:'stop'}});
  probe?.ws.close();
  await client.close();
  await context.close();
 }
});

test('the simplified MCP race menu fits a narrow host and launches ChatGPT strategy with chosen options',async({page})=>{
 await page.setViewportSize({width:390,height:850});
 await page.goto(host+'/?test-messages=1');
 const app=page.frameLocator('#app-frame').frameLocator('iframe');
 const menu=app.getByRole('dialog',{name:'Race menu'});
 const accept=menu.getByRole('button',{name:'Accept',exact:true});
 await expect(accept).toBeEnabled();
 await expect(menu.locator('#mcp-mode-pill')).toHaveText('ChatGPT strategy');
 await expect(menu.locator('#mcp-driver-jev-option')).toBeHidden();
 await expect(menu.getByText(/Mock mode|Mock race/i)).toHaveCount(0);
 expect(await menu.evaluate(element=>getComputedStyle(element).position==='fixed'&&
  document.documentElement.scrollWidth===document.documentElement.clientWidth&&
  element.getBoundingClientRect().right<=document.documentElement.clientWidth)).toBe(true);
 // Defaults: Monza, 5 laps, Autopilot, Multiplayer unchecked
 await expect(menu.locator('input[name="circuit"][value="monza"]')).toBeChecked();
 await expect(menu.locator('input[name="laps"][value="5"]')).toBeChecked();
 await expect(menu.locator('input[name="driver"][value="autopilot"]')).toBeChecked();
 await expect(menu.locator('#mcp-multiplayer')).not.toBeChecked();
 // Select Las Vegas, 10 laps, Manual, Add Multiplayer -> Accept
 await menu.locator('input[name="circuit"][value="las-vegas"]').check();
 await menu.locator('input[name="laps"][value="10"]').check();
 await menu.locator('input[name="driver"][value="human"]').check();
 await menu.locator('#mcp-multiplayer').check();
 await accept.click();
 await expect(app.getByRole('button',{name:'Race menu',exact:true})).toHaveAttribute('aria-expanded','false');
 await expect(app.locator('#mcp-multiplayer-bar')).toBeVisible();
 await expect(app.locator('#mcp-guest-invite')).toHaveValue(/^jev-strategy:/);
 await expect(app.locator('#drive-root')).toHaveAttribute('data-embedded','true');
 await expect(app.locator('#drive-mode-switcher [data-dmode="jev"]')).toBeHidden();
 await expect(app.locator('#race-event-log')).toBeVisible();
 await expect(app.locator('#mcp-status')).toContainText('ChatGPT strategy · Las Vegas · 10 laps · Manual');
 await expect(page.locator('body')).toHaveAttribute('data-strategy-context',/event_filter/);
 // Opening Race menu as a modal overlay must not push #app down
 const appTopClosed=await app.locator('#app').evaluate(el=>Math.round(el.getBoundingClientRect().top));
 await app.getByRole('button',{name:'Race menu',exact:true}).click();
 await expect(menu).toBeVisible();
 const appTopOpen=await app.locator('#app').evaluate(el=>Math.round(el.getBoundingClientRect().top));
 expect(appTopOpen).toBe(appTopClosed);
 // Switch back via Race menu to Monza, 5 laps, Autopilot, solo
 await menu.locator('input[name="circuit"][value="monza"]').check();
 await menu.locator('input[name="laps"][value="5"]').check();
 await menu.locator('input[name="driver"][value="autopilot"]').check();
 await menu.locator('#mcp-multiplayer').uncheck();
 await accept.click();
 await expect(app.locator('#mcp-multiplayer-bar')).toBeHidden();
 await expect(app.locator('#mcp-status')).toContainText('ChatGPT strategy · Monza · 5 laps · Autopilot');
 await expect(app.locator('#race-phase')).toHaveText('LOBBY');
 await expect(app.getByRole('button',{name:'Start race',exact:true})).toBeDisabled();
});

test('clicking Accept on the race menu keeps an active ChatGPT subscription without resetting the room',async({page,request})=>{
 const incoming='grand_prix.strategy_required';
 const endpoint='/webhook/mcp-events/'+crypto.randomUUID();
 const callback='https://connectors.api.openai.com'+endpoint;
 const secret='whsec_'+Buffer.alloc(32,7).toString('base64');
 const rpc=(method:string,params:object)=>request.post('/mcp',{
  headers:{Accept:'application/json, text/event-stream'},
  data:{jsonrpc:'2.0',id:method,method,params},
 }).then(r=>r.json());
 await page.goto(host+'/?test-messages=1');
 const app=page.frameLocator('#app-frame').frameLocator('iframe');
 const menu=app.getByRole('dialog',{name:'Race menu'});
 await expect(menu).toBeVisible();
 await expect(page.locator('body')).toHaveAttribute('data-initial-event-filter',/subscription_key/);
 const initialFilter=JSON.parse((await page.locator('body').getAttribute('data-initial-event-filter'))!) as {room:string;subscription_key:string};
 await expect(app.locator('body')).toHaveAttribute('data-room',initialFilter.room);

 // ChatGPT subscribes while the Race menu is open.
 const subscribed=await rpc('events/subscribe',{
  name:incoming,arguments:initialFilter,delivery:{mode:'webhook',url:callback,secret},
 });
 expect(subscribed.error).toBeUndefined();
 await expect(menu.locator('#mcp-crew')).toHaveText('ChatGPT strategy connected');

 // Change circuit, laps, and enable multiplayer, then click Accept: must keep the same room and subscription.
 await menu.locator('input[name="circuit"][value="las-vegas"]').check();
 await menu.locator('input[name="laps"][value="10"]').check();
 await menu.locator('#mcp-multiplayer').check();
 await menu.getByRole('button',{name:'Accept',exact:true}).click();
 await expect(app.getByRole('button',{name:'Race menu',exact:true})).toHaveAttribute('aria-expanded','false');
 await expect(app.locator('body')).toHaveAttribute('data-room',initialFilter.room);
 await expect(app.locator('body')).toHaveAttribute('data-circuit','las-vegas');
 await expect(app.locator('#mcp-status')).toContainText('ChatGPT strategy · Las Vegas · 10 laps · Autopilot');
 await expect(app.locator('#waiting p')).not.toContainText('Waiting for ChatGPT to subscribe');
 await expect(app.getByRole('button',{name:'Start race',exact:true})).toBeEnabled();

 // Switch to Manual driving with multiplayer via Race menu: still the same room and subscription.
 await app.getByRole('button',{name:'Race menu',exact:true}).click();
 await expect(menu.locator('#mcp-crew')).toHaveText('ChatGPT strategy connected');
 await menu.locator('input[name="driver"][value="human"]').check();
 await menu.getByRole('button',{name:'Accept',exact:true}).click();
 await expect(app.locator('body')).toHaveAttribute('data-room',initialFilter.room);
 await expect(app.locator('#drive-start-btn')).toBeEnabled();
 await expect(app.locator('#drive-start-btn')).not.toContainText('Waiting for ChatGPT to subscribe');

 // Switch back to Monza, 5 laps, Autopilot, solo and click Accept: keeps subscription, auto-starts, and delivers telemetry.
 await app.getByRole('button',{name:'Race menu',exact:true}).click();
 await expect(menu.locator('#mcp-crew')).toHaveText('ChatGPT strategy connected');
 await menu.locator('input[name="circuit"][value="monza"]').check();
 await menu.locator('input[name="laps"][value="5"]').check();
 await menu.locator('input[name="driver"][value="autopilot"]').check();
 await menu.locator('#mcp-multiplayer').uncheck();
 await menu.getByRole('button',{name:'Accept',exact:true}).click();
 await expect(app.locator('body')).toHaveAttribute('data-room',initialFilter.room);
 await expect(app.locator('body')).toHaveAttribute('data-phase','racing',{timeout:20_000});
 const received=()=>request.get(fixture+endpoint).then(r=>r.json());
 await expect.poll(async()=>(await received()).events.length,{timeout:15_000}).toBeGreaterThan(0);
 const {events:[event]}=await received();
 expect(event.data).toMatchObject({room:initialFilter.room,team:'a',lap:1});

 // While race is running: Stop race is in the header; opening Race menu disables Accept and race controls and shows Stop race in the modal.
 await expect(app.locator('#mcp-stop-header')).toBeVisible();
 await app.getByRole('button',{name:'Race menu',exact:true}).click();
 await expect(menu).toBeVisible();
 await expect(app.locator('#mcp-stop-header')).toBeHidden();
 await expect(menu.getByRole('button',{name:'Accept',exact:true})).toBeDisabled();
 await expect(menu.locator('input[name="circuit"][value="las-vegas"]')).toBeDisabled();
 await expect(menu.locator('input[name="laps"][value="10"]')).toBeDisabled();
 await expect(menu.locator('input[name="driver"][value="human"]')).toBeDisabled();
 await expect(menu.locator('#mcp-multiplayer')).toBeDisabled();
 const stopRace=menu.getByRole('button',{name:'Stop race',exact:true});
 await expect(stopRace).toBeVisible();
 await expect(stopRace).toBeEnabled();
 await stopRace.click();
 await expect(app.locator('#mcp-status')).toContainText('stopped');
 await expect(stopRace).toBeHidden();
 await expect(app.locator('#mcp-stop-header')).toBeHidden();
 await expect(menu.getByRole('button',{name:'Accept',exact:true})).toBeEnabled();
 await expect(menu.locator('input[name="circuit"][value="las-vegas"]')).toBeEnabled();
 await expect(menu.locator('#mcp-multiplayer')).toBeEnabled();
});

test('multiplayer Team B joins with their own ChatGPT strategist and solo browser play still works',async({browser,request,baseURL})=>{
 const context=await browser.newContext();
 try{
  const hostA=await context.newPage();
  await hostA.goto(host+'/?test-messages=1');
  const appA=hostA.frameLocator('#app-frame').frameLocator('iframe');
  await appA.locator('#mcp-multiplayer').check();
  await appA.getByRole('button',{name:'Accept',exact:true}).click();
  await expect(appA.locator('#mcp-multiplayer-bar')).toBeVisible();
  const teamBInvite=await appA.locator('#mcp-guest-invite').inputValue();
  expect(teamBInvite).toMatch(/^jev-strategy:/);

  const hostB=await context.newPage();
  await hostB.goto(host+'/?test-messages=1');
  const appB=hostB.frameLocator('#app-frame').frameLocator('iframe');
  await appB.locator('#mcp-join-panel summary').click();
  await appB.locator('#mcp-join').fill(teamBInvite);
  await appB.getByRole('button',{name:'Join Team B',exact:true}).click();
  await expect(appB.locator('#mcp-status')).toContainText('Team B (Mercedes)');
  await expect(hostB.locator('body')).toHaveAttribute('data-strategy-context',/event_filter/);
  const roomA=await appA.locator('body').getAttribute('data-room');
  await expect(appB.locator('body')).toHaveAttribute('data-room',roomA!);

  const web=await context.newPage();
  await web.goto(baseURL+'/?solo&view=telemetry&circuit=las-vegas');
  await expect(web.locator('body')).toHaveAttribute('data-circuit','las-vegas');
  await expect(web.locator('#race-phase')).toHaveText('LOBBY');
  await web.getByRole('button',{name:'Start race',exact:true}).click();
  await expect(web.locator('#race-phase')).toHaveText('GREEN FLAG');
  const browserRoom=new URL(web.url()).searchParams.get('room');
  expect(browserRoom).not.toBe(roomA);
  const result=await request.get('/api/rooms/'+browserRoom+'/status').then(r=>r.json()) as RaceState;
  expect(result.solo).toBe(true);
  expect(result.race.field).toHaveLength(20);
  expect(result.paidCalls).toBe(0);
 }finally{await context.close();}
});

test('native MCP Events verifies the subscription, starts a race and delivers signed telemetry for radio',async({baseURL,request,page})=>{
 const origin=baseURL!,client=await mcp(origin),before=counts(await readCalls(request));
 const incoming='grand_prix.strategy_required';
 const endpoint='/webhook/mcp-events/'+crypto.randomUUID();
 const callback='https://connectors.api.openai.com'+endpoint;
 const secret='whsec_'+Buffer.alloc(32,7).toString('base64');
 const rpc=(method:string,params:object={})=>request.post('/mcp',{
  headers:{Accept:'application/json, text/event-stream'},
  data:{jsonrpc:'2.0',id:method,method,params},
 }).then(r=>r.json());
 const delivery={mode:'webhook',url:callback,secret};
 let filter:object|undefined,probe:ReturnType<typeof watch>|undefined,stop:Record<string,unknown>|undefined;
 try{
  const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'Work test',version:'1'}});
  expect(init.result.capabilities.events).toEqual({});
  const protocol='2026-07-28';
  const modern=await request.post('/mcp',{
   headers:{Accept:'application/json','Mcp-Protocol-Version':protocol,'Mcp-Method':'server/discover'},
   data:{jsonrpc:'2.0',id:'discover',method:'server/discover',params:{_meta:{
    'io.modelcontextprotocol/protocolVersion':protocol,'io.modelcontextprotocol/clientCapabilities':{},
   }}},
  }).then(r=>r.json());
  expect(modern.result.capabilities.events).toEqual({});
  const catalog=await rpc('events/list');
  expect(catalog.result.events[0]).toMatchObject({
   name:incoming,delivery:['webhook'],inputSchema:{required:['room','subscription_key']},
  });
  const solo=await client.callTool({name:'open_grand_prix',arguments:{solo:true,autoplay:false}});
  expect(solo.structuredContent).toMatchObject({strategist:'local',solo:true});
  expect(solo.structuredContent).not.toHaveProperty('event_filter');
  const race=await client.callTool({name:'open_grand_prix',arguments:{chat_strategy:true,circuit:'monza'}});
  expect(race.structuredContent).toMatchObject({strategist:'chatgpt',solo:true,strategy_team:'Ferrari',event:incoming,delivery:'webhook'});
  const invite=race._meta?.liveInvitation as {room:string;key:string};
  stop={room:invite.room,key:race._meta?.strategyKey};
  filter=(race.structuredContent as {event_filter:object}).event_filter;
  const subscription={name:incoming,arguments:filter,delivery};
  probe=watch(origin,invite.room,invite.key);
  await expect.poll(()=>probe?.state()?.strategyWebhook).toBe('waiting');
  expect(probe.state()?.race.phase).toBe('lobby');
  expect((await rpc('events/subscribe',{...subscription,arguments:{room:invite.room,subscription_key:invite.key}})).error.code).toBe(-32024);
  expect((await rpc('events/subscribe',{...subscription,delivery:{...delivery,url:'https://other.example'+endpoint}})).error.code).toBe(-32602);
  probe.ws.send(JSON.stringify({type:'start',startKey:race._meta?.strategyKey}));
  expect((await rpc('events/subscribe',{...subscription,delivery:{...delivery,url:callback+'-reject'}})).error.code).toBe(-32015);
  expect(probe.state()?.race.phase).toBe('lobby');
  const subscribed=await rpc('events/subscribe',subscription);
  expect(subscribed.error).toBeUndefined();
  const {result}=subscribed;
  expect(result).toMatchObject({id:expect.stringMatching(/^sub_/),refreshBefore:expect.any(String),cursor:null,truncated:false});
  const refresh=await rpc('events/subscribe',subscription);
  expect(refresh.result.id).toBe(result.id);
  const received=()=>request.get(fixture+endpoint).then(r=>r.json());
  expect((await received()).verifications).toBe(1);
  await expect.poll(()=>probe?.state()?.strategyWebhook).toBe('connected');
  expect(probe.state()?.race).toMatchObject({phase:'lobby',tick:0,time:0});
  expect((await received()).events).toEqual([]);
  probe.ws.send(JSON.stringify({type:'start',startKey:race._meta?.strategyKey}));
  await expect.poll(async()=>(await received()).events.length,{timeout:15_000}).toBeGreaterThan(0);
  const {events:[event]}=await received();
  expect(event).toMatchObject({name:incoming,cursor:null,data:{room:invite.room,team:'a',lap:1,event_id:expect.any(String)}});
  expect(event.eventId).toBe(event.data.event_id);
  const args={room:invite.room,event_id:event.eventId};
  const telemetry=await client.callTool({name:'get_grand_prix_strategy_event',arguments:args});
  expect(telemetry.structuredContent).toMatchObject({observation:{lapsRemaining:5,tyres:expect.any(Object)}});
  const order={...args,action:'manage',radio:'Manage the tyres on the opening stint.'};
  expect((await client.callTool({name:'submit_grand_prix_radio',arguments:order})).isError).toBeFalsy();
  expect((await client.callTool({name:'submit_grand_prix_radio',arguments:order})).isError).toBe(true);
  await expect.poll(()=>probe?.state()?.race.radio.some(r=>r.strategist==='chatgpt'&&r.text===order.radio)).toBe(true);
  const spectator=new URL(liveSpectatorURL(origin,invite));
  spectator.searchParams.set('view','telemetry');
  await page.goto(spectator.href);
  const pinned=page.getByRole('region',{name:'ChatGPT radio'});
  const caption=pinned.getByText(`"${order.radio}"`,{exact:true});
  await expect(caption).toBeVisible();
  await expect.poll(()=>probe?.state()?.latestChatRadio?.a?.reply?.team).toBe('a');
  const log=page.locator('#race-event-log');
  await expect(log.locator('ol')).toBeVisible();
  await expect(log.getByRole('button',{name:'Driver',exact:true})).toHaveCount(0);
  await expect(log.locator('li[data-kind="driver"]')).toHaveCount(0);
  await log.getByRole('button',{name:'Strategist',exact:true}).click();
  const telemetryRow=log.locator('li').filter({hasText:'Strategy requested'}).filter({hasText:'Opening strategy'});
  await telemetryRow.locator('summary').click();
  await expect(telemetryRow.locator('pre')).toContainText('"lapsRemaining": 5');
  await expect(telemetryRow.locator('pre')).toContainText('"projectedFuelKg"');
  await expect(log).toContainText('Telemetry read');
  await expect(log).toContainText('Event delivered');
  await expect(log).not.toContainText(event.eventId);
  await log.getByRole('button',{name:'Radio',exact:true}).click();
  await expect(log.getByText(order.radio,{exact:true})).toBeVisible();
  await expect(log.getByText(/JEV radio/)).toHaveCount(0);
  await page.reload();
  await expect(caption).toBeVisible();
  await expect(pinned.locator('.radio-transcript')).toHaveCount(1);
  await expect(log.locator('ol')).toBeVisible();
  await log.getByRole('button',{name:'Radio',exact:true}).click();
  await expect(log.getByText(order.radio,{exact:true})).toBeVisible();
  await expect(log.getByText(/JEV radio/)).toHaveCount(0);
  const controls=page.getByRole('group',{name:'Race control'});
  const conditions=page.locator('#race-conditions');
  const incident=async(reason:string)=>{
   const find=async()=>(await received()).events.find(({data}:{data:{reasons:string[]}})=>data.reasons.includes(reason));
   await expect.poll(find).toBeTruthy();
   return find();
  };
  await controls.getByRole('button',{name:'Yellow flags'}).click();
  const yellow=await incident('Full-course yellow');
  expect(yellow.data.summary).toMatchObject({flag:'yellow',speedLimitKph:160});
  await expect(page.locator('#race-phase')).toHaveText('YELLOW FLAGS');
  await controls.getByRole('button',{name:'Yellow flags'}).click();
  expect((await incident('Yellow flags cleared')).data.summary.flag).toBe('green');
  await expect(controls.getByRole('button',{name:'Deploy now'})).toBeVisible();
  await controls.getByRole('button',{name:'Deploy now'}).click();
  const safety=await incident('Safety car deployed');
  expect(safety.data.summary).toMatchObject({flag:'safety-car',speedLimitKph:145});
  const safetyRadio='Safety car out. Slow down and hold position.';
  expect((await client.callTool({name:'submit_grand_prix_radio',arguments:{room:invite.room,event_id:safety.eventId,action:'manage',radio:safetyRadio}})).isError).toBeFalsy();
  await expect(pinned.getByText(`"${safetyRadio}"`,{exact:true})).toBeVisible();
  await expect(page.locator('#map-safety-car')).toHaveAttribute('visibility','visible');
  await controls.getByRole('button',{name:'Deploy next lap'}).click();
  expect((await incident('Safety car scheduled for lap 2')).data.summary.safetyCarScheduledLap).toBe(2);
  await expect(conditions).toContainText('Safety car scheduled for lap 2');
  const returnSafetyCar=controls.getByRole('button',{name:'Safety car in next lap'});
  await returnSafetyCar.click();
  const returning=await incident('Safety car in at start of lap 2');
  expect(returning.data.summary).toMatchObject({flag:'safety-car',safetyCarInLap:2,safetyCarScheduledLap:null});
  await expect(conditions).toContainText('Safety car in at start of lap 2');
  await expect(page.locator('#map-safety-car')).toHaveAttribute('visibility','visible');
  await expect(returnSafetyCar).toBeDisabled();
  await expect(controls.getByRole('button',{name:'Light rain'})).toBeVisible();
  for(const level of ['Light','Moderate','Heavy']){
   await controls.getByRole('button',{name:`${level} rain`}).click();
   const weather=await incident(`${level} rain started`);
   expect(weather.data.summary).toMatchObject({rain:level.toLowerCase()});
   expect(weather.data.summary.wetGripByCompound).toBeDefined();
   await expect(conditions).toContainText(`${level} rain`);
  }
  const heavy=await incident('Heavy rain started');
  const weatherArgs={room:invite.room,event_id:heavy.eventId};
  const wetTelemetry=await client.callTool({name:'get_grand_prix_strategy_event',arguments:weatherArgs});
  expect(wetTelemetry.structuredContent).toMatchObject({observation:{raceControl:{flag:'safety-car'},weather:{outlook:'heavy'}}});
  const wetRadio='Box for full wets. Stay in the safety car queue until pit entry.';
  expect((await client.callTool({name:'submit_grand_prix_radio',arguments:{...weatherArgs,action:'box',tyre:'wet',radio:wetRadio}})).isError).toBeFalsy();
  await expect(pinned.getByText(`"${wetRadio}"`,{exact:true})).toBeVisible();
  await expect.poll(()=>probe?.state()?.race.cars.a.instruction).toMatchObject({box:true,tyre:'wet'});
  spectator.searchParams.delete('view');
  spectator.searchParams.set('camera','helicopter');
  await page.goto(spectator.href);
  await expect(page.locator('.minimap svg')).toBeVisible();
  await expect(page.locator('canvas[aria-label="Live 3D Monza circuit"]')).toBeVisible({timeout:25_000});
  await expect.poll(()=>page.evaluate(()=>(window as Window&{__renderStats?:{safetyCarOnTrack:boolean}}).__renderStats?.safetyCarOnTrack)).toBe(true);
  await expect(page.locator('#viewport')).toHaveAttribute('data-rain','heavy');
  const joined=await client.callTool({name:'open_grand_prix',arguments:{invite:race._meta?.guestInvitation}});
  expect(joined.structuredContent).toMatchObject({room:invite.room,player:'b',strategy_team:'Mercedes'});
  const guestFilter=(joined.structuredContent as {event_filter:object}).event_filter;
  const guestEndpoint=endpoint+'-mercedes',guestURL='https://connectors.api.openai.com'+guestEndpoint;
  const guestSubscription={name:incoming,arguments:guestFilter,delivery:{...delivery,url:guestURL}};
  const guestSubscribed=await rpc('events/subscribe',guestSubscription);
  expect(guestSubscribed.result.id).not.toBe(result.id);
  const guestReceived=()=>request.get(fixture+guestEndpoint).then(r=>r.json());
  await expect.poll(async()=>(await guestReceived()).events.length).toBeGreaterThan(0);
  const {events:[guestEvent]}=await guestReceived();
  expect(guestEvent.data).toMatchObject({room:invite.room,team:'b'});
  expect((await received()).events.every((event:{data:{team:string}})=>event.data.team==='a')).toBe(true);
  expect((await rpc('events/unsubscribe',{name:incoming,arguments:guestFilter,delivery:{url:guestURL}})).result).toEqual({});
  await expect.poll(()=>probe?.state()?.guestChatStrategy).toBeUndefined();
  expect((await rpc('events/unsubscribe',{name:incoming,arguments:filter,delivery:{url:callback}})).result).toEqual({});
  await expect.poll(()=>probe?.state()?.strategyWebhook).toBe('waiting');
  expect(probe?.state()?.paidCalls).toBe(0);
  expect(counts(await readCalls(request))).toEqual(before);
 }finally{
  if(stop)await client.callTool({name:'stop_grand_prix_chat_strategy',arguments:stop});
  probe?.ws.close();
  await client.close();
 }
});
