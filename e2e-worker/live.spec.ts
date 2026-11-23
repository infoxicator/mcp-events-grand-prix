import {test,expect,type APIRequestContext} from '@playwright/test';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {WebSocket} from 'ws';
import {liveInvitation,liveSpectatorURL,newLiveKey,pairingChallenge,parseLiveInvitation} from '../src/race/live';
import type {RaceState,ServerMessage} from '../src/race/types';

const fixture='http://127.0.0.1:8798';
const host='http://127.0.0.1:8799';
const accessPath='/owner/live';
const pairPath='/api/live-pair';

async function signedToken(request:APIRequestContext,query=''){
 return (await request.get(fixture+'/token'+query).then(r=>r.json())).token as string;
}

async function pair(request:APIRequestContext){
 const room=crypto.randomUUID(),key=newLiveKey(),challenge=await pairingChallenge(key);
 const registration=await request.post(pairPath,{data:{room,key:challenge}});
 expect(registration.ok()).toBe(true);
 return {room,key,challenge,url:`${accessPath}?pair=${room}`};
}

const readCalls=(request:APIRequestContext)=>request.get(fixture+'/fixture').then(r=>r.json()) as Promise<{jev:number;luna:number;engineer:number;keys:number}>;
const counts=({jev,luna,engineer}:Awaited<ReturnType<typeof readCalls>>)=>({jev,luna,engineer});

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
  await pageA.goto(host+'/?player=a');
  const appA=pageA.frameLocator('#app-frame').frameLocator('iframe');
  await expect(appA.locator('#mcp-status')).toContainText('Ready to connect');
  await appA.getByRole('button',{name:'Ready team A'}).click();
  await expect(appA.locator('#mcp-status')).toContainText('Waiting for team B');
  expect(counts(await readCalls(request))).toEqual(before);

  await appA.getByRole('radio',{name:'Private live'}).check();
  await appA.getByRole('region',{name:'Race menu'}).getByLabel('Driver matchup',{exact:true}).selectOption('jev-vs-luna');
  await appA.getByRole('button',{name:'Start live race',exact:true}).click();
  await expect(appA.locator('#mcp-pair-status')).toContainText('Sign in and confirm');
  await expect.poll(()=>contextA.pages().find(p=>p!==pageA)?.url()).toContain(accessPath);
  const ownerUrl=contextA.pages().find(p=>p!==pageA)!.url();
  const room=new URL(ownerUrl).searchParams.get('pair')!;
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

  await expect(appA.locator('#mcp-invite')).toHaveValue(code);
  await pageB.goto(host+'/?player=b');
  const appB=pageB.frameLocator('#app-frame').frameLocator('iframe');
  await appB.getByLabel('Join an existing race').fill(code);
  await appB.getByRole('button',{name:'Join race',exact:true}).click();
  await expect(appB.locator('#mcp-invite')).toHaveValue(code);
  for(const app of [appA,appB]){
   const menu=app.getByRole('button',{name:'Race menu',exact:true});
   await expect(menu).toHaveAttribute('aria-expanded','false');
   await menu.click();
  }
  const spectatorPopup=contextA.waitForEvent('page');
  await appA.getByRole('button',{name:'Open live spectator',exact:false}).click();
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
  const page=await context.newPage();
  await page.goto(host+'/?player=a&test-messages=1');
  const app=page.frameLocator('#app-frame').frameLocator('iframe');
  await app.getByRole('radio',{name:'Private live'}).check();
  await app.getByLabel('Strategist',{exact:true}).selectOption('chatgpt');
  await expect(app.getByRole('region',{name:'Race menu'}).getByLabel('Driver matchup',{exact:true})).toBeHidden();
  await app.getByRole('button',{name:'Start live race',exact:true}).click();
  await expect(app.locator('#mcp-pair-status')).toContainText('Sign in and confirm');
  await expect.poll(()=>context.pages().find(p=>p!==page)?.url()).toContain(accessPath);
  ownerUrl=context.pages().find(p=>p!==page)!.url();
  const room=new URL(ownerUrl).searchParams.get('pair')!;
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
  probe=watch(origin,room,invite.key);
  await expect.poll(()=>probe?.state()?.strategyWebhook).toBe('waiting');
  expect(probe.state()?.race.phase).toBe('lobby');
  expect(counts(await readCalls(request))).toEqual(callsBefore);
  const start=app.getByRole('button',{name:'Start race',exact:true});
  await expect(start).toBeDisabled();
  await expect(page.locator('body')).toHaveAttribute('data-strategy-context',/event_filter/);
  const handoff=JSON.parse((await page.locator('body').getAttribute('data-strategy-context'))!);
  expect(handoff).toMatchObject({event:incoming,event_filter:{room,subscription_key:expect.stringMatching(/^[a-f0-9]{64}$/)}});
  const requestRpc=(method:string,params:object)=>request.post('/mcp',{data:{jsonrpc:'2.0',id:method,method,params}});
  const stream=await requestRpc('events/stream',{name:incoming,arguments:{room}});
  expect(stream.status()).toBe(403);
  const subscription=await requestRpc('events/subscribe',{
   name:incoming,arguments:handoff.event_filter,
   delivery:{mode:'webhook',url:'https://connectors.api.openai.com'+endpoint,secret:'whsec_'+Buffer.alloc(32,7).toString('base64')},
  }).then(r=>r.json());
  expect(subscription.result.id).toMatch(/^sub_/);
  const received=()=>request.get(fixture+endpoint).then(r=>r.json());
  await expect(start).toBeEnabled();
  probe.ws.send(JSON.stringify({type:'start',startKey:invite.key}));
  const sent=Date.now();
  probe.ws.send(JSON.stringify({type:'ping',sent}));
  await expect.poll(()=>probe?.messages.some(message=>message.type==='pong'&&message.sent===sent)).toBe(true);
  expect(probe.state()?.race).toMatchObject({phase:'lobby',tick:0,time:0});
  expect((await received()).events).toEqual([]);
  expect(counts(await readCalls(request))).toEqual(callsBefore);
  await start.click();
  await expect.poll(async()=>(await received()).events.length,{timeout:15000}).toBeGreaterThan(0);
  const {events:[event]}=await received();
  expect(event.data).toMatchObject({room,team:'a',lap:1});
  const args={room,event_id:event.eventId};
  expect((await client.callTool({name:'get_grand_prix_strategy_event',arguments:args})).isError).toBeFalsy();
  const order={...args,action:'manage',radio:'Manage the tyres through this stint.'};
  expect((await client.callTool({name:'submit_grand_prix_radio',arguments:order})).isError).toBeFalsy();
  expect((await client.callTool({name:'submit_grand_prix_radio',arguments:order})).isError).toBe(true);
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

test('the MCP race menu fits a narrow host and opens lobbies with the selected options',async({page,request})=>{
 await page.setViewportSize({width:390,height:850});
 await page.goto(host+'/?player=a&test-messages=1');
 const app=page.frameLocator('#app-frame').frameLocator('iframe');
 const menu=app.getByRole('region',{name:'Race menu'}),launch=menu.getByRole('button',{name:'Open multiplayer lobby'});
 await expect(launch).toBeEnabled();
 expect(await menu.evaluate(element=>document.documentElement.scrollWidth===document.documentElement.clientWidth&&
  element.getBoundingClientRect().right<=document.documentElement.clientWidth)).toBe(true);
 await menu.getByLabel('Circuit',{exact:true}).selectOption('las-vegas');
 await menu.getByLabel('Driver matchup',{exact:true}).selectOption('jev-vs-luna');
 await menu.getByLabel('Seat',{exact:true}).selectOption('both');
 await menu.getByLabel('Connect seats when the lobby opens').check();
 await launch.click();
 await expect(app.locator('#mcp-session-details')).toHaveText('Las Vegas · 3 laps · Jev vs Luna');
 await expect(app.locator('body')).toHaveAttribute('data-connected','true');
 await expect(app.locator('#race-phase')).toHaveText('LOBBY');
 const start=menu.getByRole('button',{name:'Start race',exact:true});
 await expect(start).toBeEnabled();
 const room=await app.locator('body').getAttribute('data-room');
 const state:RaceState=await request.get('/api/rooms/'+room+'/status').then(r=>r.json());
 expect(state).toMatchObject({race:{circuit:'las-vegas',tick:0},matchup:'jev-vs-luna',connected:{a:true,b:true}});
 await menu.getByRole('radio',{name:'ChatGPT strategy',exact:true}).check();
 await expect(menu.getByLabel('Seat',{exact:true})).toBeHidden();
 await menu.getByRole('button',{name:'Open ChatGPT strategy lobby',exact:true}).click();
 await expect(app.locator('#mcp-session-details')).toHaveText('Las Vegas · 20 laps · Jev vs Jev');
 await expect(menu.getByLabel('Mercedes strategy invitation')).toBeVisible();
 await expect(start).toBeDisabled();
 await expect(page.locator('body')).toHaveAttribute('data-strategy-context',/event_filter/);
});

test('solo play waits for Start race with Ferrari alone in MCP and the browser',async({browser,request,baseURL})=>{
 const context=await browser.newContext();
 try{
  const page=await context.newPage();
  await page.goto(host+'/?player=a');
  const app=page.frameLocator('#app-frame').frameLocator('iframe');
  await expect(app.locator('#mcp-status')).toContainText('Ready to connect');
  for(const name of ['Solo','Multiplayer','ChatGPT strategy','Private live'])
   await expect(app.getByRole('radio',{name,exact:true})).toBeVisible();
  const oldRoom=await app.locator('body').getAttribute('data-room');
  await app.getByRole('radio',{name:'Solo',exact:true}).check();
  await app.getByRole('region',{name:'Race menu'}).getByLabel('Circuit',{exact:true}).selectOption('las-vegas');
  await app.getByRole('button',{name:'Open solo lobby',exact:true}).click();
  await expect(app.locator('#mcp-status')).toContainText('Solo race · Ferrari ready');
  await expect(app.locator('#race-phase')).toHaveText('LOBBY');
  await expect(app.locator('body')).toHaveAttribute('data-circuit','las-vegas');
  await app.getByRole('button',{name:'Start race',exact:true}).click();
  await expect(app.locator('#mcp-status')).toContainText('Solo race · Race in progress');
  await expect(app.getByRole('button',{name:'Race menu',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(app.locator('#mcp-copy')).toBeHidden();
  const room=await app.locator('body').getAttribute('data-room');
  expect(room).not.toBe(oldRoom);
  const state=()=>request.get('/api/rooms/'+room+'/status').then(result=>result.json()) as Promise<RaceState>;
  await expect.poll(async()=>(await state()).intents.b).toBeGreaterThan(0);
  await app.getByRole('button',{name:'Full grid'}).click();
  await expect(app.locator('#timing-rows .timing-row')).toHaveCount(22);
  await expect(app.locator('#timing-rows .timing-row').filter({hasText:'George Russell'})).toContainText('AI');

  const web=await context.newPage();
  await web.goto(baseURL+'/?solo&view=telemetry&circuit=las-vegas');
  await expect(web.locator('body')).toHaveAttribute('data-circuit','las-vegas');
  await expect(web.locator('#race-phase')).toHaveText('LOBBY');
  await web.getByRole('button',{name:'Start race',exact:true}).click();
  await expect(web.locator('#race-phase')).toHaveText('GREEN FLAG');
  const browserRoom=new URL(web.url()).searchParams.get('room');
  expect(browserRoom).not.toBe(room);
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
  expect(telemetry.structuredContent).toMatchObject({observation:{lapsRemaining:20,tyres:expect.any(Object)}});
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
  const log=page.locator('#race-event-log'),logToggle=log.locator(':scope > summary');
  await expect(log.locator('ol')).toBeHidden();
  await logToggle.click();
  await log.getByRole('button',{name:'Strategist',exact:true}).click();
  const telemetryRow=log.locator('li').filter({hasText:'Strategy requested'}).filter({hasText:'Opening strategy'});
  await telemetryRow.locator('summary').click();
  await expect(telemetryRow.locator('pre')).toContainText('"lapsRemaining": 20');
  await expect(telemetryRow.locator('pre')).toContainText('"projectedFuelKg"');
  await expect(log).toContainText('Telemetry read');
  await expect(log).toContainText('Event delivered');
  await expect(log).not.toContainText(event.eventId);
  await log.getByRole('button',{name:'Driver',exact:true}).click();
  await log.locator('li[data-kind="driver"]').first().locator('summary').click();
  await expect(log.locator('pre')).toContainText('"brakeAggression"');
  await log.getByRole('button',{name:'Radio',exact:true}).click();
  await expect(log.getByText(order.radio,{exact:true})).toBeVisible();
  await expect(log.getByText(/JEV radio/)).toHaveCount(0);
  await page.reload();
  await expect(caption).toBeVisible();
  await expect(pinned.locator('.radio-transcript')).toHaveCount(1);
  await logToggle.click();
  await log.getByRole('button',{name:'Radio',exact:true}).click();
  await expect(log.getByText(order.radio,{exact:true})).toBeVisible();
  await expect(log.getByText(/JEV radio/)).toHaveCount(0);
  await logToggle.click();
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
