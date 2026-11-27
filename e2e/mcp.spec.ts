import {test,expect} from '@playwright/test';import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';import {RESOURCE_MIME_TYPE,getToolUiResourceUri} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {RaceState} from '../src/race/types';

test('MCP autopilot lets the driver ask the strategist from the live feed',async({page,baseURL})=>{
 const host=new URL(baseURL!);
 host.port=String(Number(host.port)+1);
 await page.setViewportSize({width:420,height:840});
 await page.route('**/mcp/assets/monza-mcp.glb-*.gz',route=>route.abort());
 await page.goto(host.href);
 const app=page.frameLocator('#app-frame').frameLocator('iframe');
 await app.getByRole('button',{name:'Accept',exact:true}).click();
 const talk=app.getByRole('button',{name:'Team radio',exact:true});
 const field=app.getByRole('textbox',{name:'Ask the strategist'});
 await expect(app.locator('body')).toHaveAttribute('data-phase','racing',{timeout:30_000});
 await expect(talk).toBeVisible();
 await expect(field).toBeHidden();
 await talk.click();
 await expect(field).toBeFocused();
 const question='Where would we rejoin if we boxed now?';
 await field.fill(question);
 await field.press('Escape');
 await expect(talk).toBeFocused();
 await talk.click();
 await expect(field).toHaveValue(question);
 await field.press('Enter');
 await expect(talk).toHaveAttribute('aria-expanded','false');
 const line=app.getByRole('region',{name:'ChatGPT radio'}).locator('.radio-transcript');
 await expect(line).toHaveText(`"${question}"`);
 const state=await app.locator('body').evaluate(()=> (window as Window&{__raceState?:RaceState}).__raceState);
 expect(state?.driverMode?.a).toBe('autopilot');
 expect(state?.driverConsultRadio?.a?.filter(r=>r.text===question)).toHaveLength(1);
 await talk.click();
 await field.fill('Is it time for inters?');
 await app.getByRole('button',{name:'Send',exact:true}).click();
 await expect(app.getByRole('region',{name:'Driver radio'}).getByRole('status')).toContainText('awaiting a reply');
 await expect(field).toHaveValue('Is it time for inters?');
});

test('MCP shows a live map and waits at the grid until a delayed 3D frame is visible',async({page})=>{
 let releaseCircuit!:()=>void,releasePit!:()=>void;
 const circuit=new Promise<void>(resolve=>{releaseCircuit=resolve;});
 const pit=new Promise<void>(resolve=>{releasePit=resolve;});
 await page.setViewportSize({width:820,height:850});
 await page.route('**/mcp/assets/monza-mcp.glb-*.gz',async route=>{await circuit;await route.continue();});
 await page.route('**/mcp/assets/pit-equipment.glb-*.gz',async route=>{await pit;await route.continue();});
 try{
  await page.goto('http://127.0.0.1:5388/?player=both&autoplay=1');
  const app=page.frameLocator('#app-frame').frameLocator('iframe');
  const feed=app.locator('#viewport'),start=app.getByRole('button',{name:'Start race',exact:true});
  const map=app.getByRole('img',{name:'Live circuit map'}),canvas=feed.locator('canvas[aria-label]');
  await expect(app.locator('body')).toHaveAttribute('data-connected','true',{timeout:15_000});
  await expect(feed).toHaveAttribute('data-feed-view','loading');
  await expect(map).toBeVisible();
  expect(await map.evaluate(svg=>(svg as unknown as SVGSVGElement).getBBox().width)).toBeGreaterThan(0);
  await expect(start).toBeDisabled();
  await expect(app.locator('body')).toHaveAttribute('data-tick','0');
  releaseCircuit();
  await expect(feed).toHaveAttribute('data-feed-view','3d',{timeout:15_000});
  await expect(canvas).toBeVisible();
  await expect.poll(()=>feed.evaluate(()=>(window as Window&{__renderStats?:{calls:number}}).__renderStats?.calls??0)).toBeGreaterThan(0);
  await expect(app.getByRole('img',{name:'Live circuit map'})).toBeHidden();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(app.locator('body')).toHaveAttribute('data-phase','racing');
  await expect(feed).toHaveAttribute('data-feed-view','3d',{timeout:15_000});
  releasePit();
  await canvas.evaluate(element=>{
   const gl=(element as HTMLCanvasElement).getContext('webgl2');
   const extension=gl?.getExtension('WEBGL_lose_context');
   if(!extension)throw new Error('Expected WEBGL_lose_context in Chromium');
   extension.loseContext();
   element.addEventListener('test-restore-webgl',()=>extension.restoreContext(),{once:true});
  });
  await expect(feed).toHaveAttribute('data-feed-view','map');
  await expect(map).toBeVisible();
  await canvas.dispatchEvent('test-restore-webgl');
  await expect(feed).toHaveAttribute('data-feed-view','3d');
 }finally{releaseCircuit();releasePit();}
});

test('MCP can start from a live map when the circuit model is unavailable',async({page})=>{
 await page.route('**/mcp/assets/monza-mcp.glb-*.gz',route=>route.abort());
 await page.goto('http://127.0.0.1:5388/?player=both&autoplay=1');
 const app=page.frameLocator('#app-frame').frameLocator('iframe');
 await expect(app.locator('#viewport')).toHaveAttribute('data-feed-view','map',{timeout:15_000});
 await expect(app.getByText('3D unavailable · Live map')).toBeVisible();
 await expect(app.getByRole('img',{name:'Live circuit map'})).toBeVisible();
 const start=app.getByRole('button',{name:'Start race',exact:true});
 await expect(start).toBeEnabled();
 await start.click();
 await expect(app.locator('body')).toHaveAttribute('data-phase','racing');
 await expect(app.getByRole('img',{name:'Live circuit map'})).toBeVisible();
});

for(const circuit of ['monza','las-vegas'])test(`two MCP app contexts join by invitation and a browser spectator watches the same race (${circuit})`,async({browser,request,baseURL})=>{
 const client=new Client({name:'Grand Prix verification',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',baseURL!)));const tools=await client.listTools();const open=tools.tools.find(t=>t.name==='open_grand_prix')!;expect(open).toBeTruthy();const resource=await client.readResource({uri:getToolUiResourceUri(open)!});expect(open._meta?.['openai/outputTemplate']).toBe(getToolUiResourceUri(open));expect(resource.contents[0].mimeType).toBe(RESOURCE_MIME_TYPE);const html='text' in resource.contents[0]?resource.contents[0].text:'';expect(html).toContain('MCP Grand Prix');expect(Buffer.byteLength(html)).toBeLessThan(64*1024);const script=html.match(/<script[^>]+src="([^"]+)"/)?.[1];expect(script).toMatch(new RegExp('^'+baseURL+'/mcp/assets/'));const module=await request.get(script!,{headers:{Origin:'http://127.0.0.1:5389'}});expect(module.headers()['access-control-allow-origin']).toBe('*');expect(module.headers()['content-type']).toContain('javascript');const oldResource=await client.readResource({uri:'ui://jev-grand-prix/pit-wall.html'});expect(oldResource.contents[0]).toMatchObject({text:html});expect(html).not.toContain('TypeSafeClient');expect(html).not.toContain('fixture-only');
 const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({viewport:{width:1440,height:1100}}))),pages=await Promise.all(contexts.map(c=>c.newPage())),[hostA,hostB,spectator]=pages,errors:string[]=[];pages.forEach(p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('clipboard')){if(m.text().includes('403')&&/\/api\/rooms\/[^/]+\/links$/.test(m.location().url))return;errors.push(m.text());}});});
 try{
  await hostA.goto('http://127.0.0.1:5388/?player=a&autoplay=1&matchup=jev-vs-luna&circuit='+circuit);const a=hostA.frameLocator('#app-frame').frameLocator('iframe');await expect(a.locator('html')).toHaveAttribute('data-mcp-ready','true',{timeout:15_000});const invite=await a.locator('#mcp-invite').inputValue();expect(invite).toMatch(/^jev:.*:b:/);const room=invite.split(':')[1];
  await a.locator('#mcp-invite').evaluate(e=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Clipboard blocked by sandbox');}}});document.execCommand=()=>false;});await a.getByRole('button',{name:'Copy invitation',exact:true}).click();await expect(a.locator('#mcp-copy')).toHaveText('Selected — press ⌘C / Ctrl+C');expect(await a.locator('#mcp-invite').evaluate(e=>(e as HTMLInputElement).selectionStart)).toBe(0);
  const joined=await client.callTool({name:'open_grand_prix',arguments:{invite,autoplay:true}});expect(joined.isError).not.toBe(true);expect((joined.structuredContent as {room?:string})?.room).toBe(room);const privateData=joined._meta as {connection:{hosted:{links:{owner:string;a:string;b:string}}};invitation?:string};expect(privateData.connection.hosted.links.owner).toBe('');expect(privateData.connection.hosted.links.a).toBe('');expect(privateData.invitation).toBeUndefined();
  await hostB.goto('http://127.0.0.1:5388/?autoplay=1&invite='+encodeURIComponent(invite));const b=hostB.frameLocator('#app-frame').frameLocator('iframe');await expect(b.locator('html')).toHaveAttribute('data-mcp-ready','true',{timeout:15_000});await spectator.goto(`${baseURL}/?room=${room}&spectate`);
  const read=async()=>request.get(`/api/rooms/${room}/status`).then(r=>r.json()) as Promise<RaceState>;await expect.poll(async()=>(await read()).connected).toEqual({a:true,b:true});
  for(const frame of [a,b])await expect.poll(()=>frame.locator('html').evaluate(()=>(window as any).__renderStats?.modelsReady),{timeout:30000}).toBe(true);
  expect((await read()).race).toMatchObject({phase:'lobby',tick:0});
  await hostA.bringToFront();
  await a.getByRole('button',{name:'Start race',exact:true}).click();
  await expect.poll(async()=>(await read()).race.phase).toBe('racing');
  await expect.poll(async()=>(await read()).intents.a).toBeGreaterThan(3);await expect.poll(async()=>(await read()).intents.b).toBeGreaterThan(3);await expect(a.locator('body')).toHaveAttribute('data-room',room);await expect(b.locator('body')).toHaveAttribute('data-room',room);await expect(spectator.locator('body')).toHaveAttribute('data-room',room);expect((await read()).paidCalls).toBe(0);expect((await read()).race.circuit).toBe(circuit);await expect(spectator.locator('body')).toHaveAttribute('data-circuit',circuit);await expect(b.locator('body')).toHaveAttribute('data-circuit',circuit);expect((await read()).matchup).toBe('jev-vs-luna');expect((await read()).players.b.engine).toBe('luna');await expect(b.locator('#mode')).toHaveAttribute('title',/LUNA \/ MOCK/);
  await expect.poll(async()=>(await read()).race.cars.a.lap,{timeout:60000}).toBeGreaterThan(0);await hostA.screenshot({path:`artifacts/mcp-team-a${circuit==='las-vegas'?'-vegas':''}.png`});const status=await client.callTool({name:'grand_prix_status',arguments:{room}});expect((status.structuredContent as {room?:string})?.room).toBe(room);expect((status.structuredContent as unknown as RaceState).intents.a).toBeGreaterThan(3);
  // A wrong-side code cannot take the opposing seat; owner reset is denied to joiners.
  const before=(await read()).race.tick;const result=await b.locator('#mcp-play').innerText();expect(result).toContain('B');
  const menuToggle=b.getByRole('button',{name:'Race menu',exact:true});
  await expect(menuToggle).toHaveAttribute('aria-expanded','false');
  await menuToggle.click();
  await b.getByRole('button',{name:'Expand',exact:true}).click();
  await expect(hostB.locator('body')).toHaveClass(/fullscreen/);
  await hostA.getByRole('button',{name:'Close app',exact:true}).click();await expect.poll(async()=>(await read()).connected).toEqual({a:false,b:true});const paused=(await read()).race.tick;await spectator.waitForTimeout(300);expect((await read()).race.tick).toBe(paused);expect(paused).toBeGreaterThan(before);expect(errors).toEqual([]);
  // Browser invitation entry joins the same free seat (using A's original credential privately in test).
  const hostData=await client.callTool({name:'open_grand_prix',arguments:{player:'a'}});const meta=hostData._meta as {invitation:string};const freshRoom=String((hostData.structuredContent as {room?:string})?.room);await spectator.goto(`${baseURL}/?spectate`);await spectator.getByRole('button',{name:'Invite a team'}).click();await spectator.getByLabel('Join by invitation').fill(meta.invitation);await spectator.getByRole('button',{name:'Join team',exact:false}).click();await spectator.waitForURL(url=>url.searchParams.get('room')===freshRoom);
  await spectator.waitForFunction(()=>(window as unknown as {__raceState?:RaceState}).__raceState?.connected.b===true,undefined,{timeout:30000});
  await expect(spectator.locator('body')).toHaveAttribute('data-room',freshRoom);
  expect(errors).toEqual([]);console.log(JSON.stringify({mcpResource:getToolUiResourceUri(open),sharedRoom:room,circuit,intents:(await read()).intents,paidCalls:(await read()).paidCalls,clipboardFallback:true,independentTeardown:true,browserInvitation:true,errors}));
 }finally{await Promise.all(contexts.map(c=>c.close()));await client.close();}
});

test('mock watch links use the MCP host to open the selected circuit in a browser',async({page,baseURL})=>{
 const cspErrors:string[]=[];
 page.on('console',message=>{
  if(message.type()==='error'&&message.text().includes('frame-src'))cspErrors.push(message.text());
 });
 await page.goto('http://127.0.0.1:5388/?player=a&circuit=las-vegas');
 const app=page.frameLocator('#app-frame').frameLocator('iframe');
 const body=app.locator('body');
 await expect(body).toHaveAttribute('data-circuit','las-vegas');
 const room=await body.getAttribute('data-room');
 await app.locator('html').evaluate(()=>{
  const policy=document.createElement('meta');
  policy.httpEquiv='Content-Security-Policy';
  policy.content="frame-src 'none'";
  document.head.append(policy);
 });
 for(const selector of ['.watch-entry','.private-watch']){
  if(selector==='.private-watch'){
   await app.getByRole('button',{name:'Clean broadcast'}).click();
   await app.locator('.broadcast-menu summary').click();
  }
  const link=app.locator(selector);
  const expected=new URL('/?watch&circuit=las-vegas',baseURL).href;
  await expect(link).toHaveAttribute('href',expected);
  const [popup]=await Promise.all([page.context().waitForEvent('page'),link.click()]);
  try{
   await popup.waitForURL(url=>url.origin===baseURL&&url.searchParams.has('watch'));
   await expect(popup.locator('body')).toHaveAttribute('data-circuit','las-vegas');
   await expect.poll(()=>popup.evaluate(()=>(window as Window&{__raceState?:RaceState}).__raceState?.speed)).toBe(1);
   await expect(body).toHaveAttribute('data-room',room!);
  }finally{await popup.close();}
 }
 expect(cspErrors).toEqual([]);
});

test('MCP pit wall keeps its dark palette on a light host',async({page})=>{
 await page.goto('http://127.0.0.1:5388/?player=b');
 const app=page.frameLocator('#app-frame').frameLocator('iframe');
 const body=app.locator('body');
 await expect(body).toHaveAttribute('data-circuit','monza');
 // Reproduce a host painting a light background on the widget document.
 await body.evaluate(element=>{
  document.documentElement.dataset.theme='light';
  document.documentElement.style.background='#fff';
  element.style.background='#fff';
  element.style.color='#141414';
 });
 await expect(body).toHaveCSS('background-color','rgb(255, 255, 255)');
 await expect(app.locator('#app')).toHaveCSS('background-color','rgb(10, 13, 18)');
 await expect(app.locator('#app')).toHaveCSS('color-scheme','dark');
 for(const selector of ['.brand b','.race-heading > h1']){
  await expect(app.locator(selector)).toHaveCSS('color','rgb(246, 248, 251)');
 }
 await expect(app.locator('#circuit-name')).toHaveCSS('color','rgb(255, 255, 255)');
});

test('MCP setup supports Jev System 1 and Luna with an in-memory API key',async({page,baseURL})=>{
 const host=new URL(baseURL!);
 host.port=String(Number(host.port)+1);
 await page.setViewportSize({width:560,height:860});
 await page.route('**/mcp/assets/monza-mcp.glb-*.gz',route=>route.abort());
 const mcpBodies:string[]=[];
 let keyRequest:{url:string;auth:string|null;body:string}|null=null;
 page.on('request',req=>{
  if(req.url().endsWith('/mcp')&&req.method()==='POST')mcpBodies.push(req.postData()??'');
  if(req.url().includes('/driver-key')&&req.method()==='POST'){
   keyRequest={url:req.url(),auth:req.headers()['authorization']??null,body:req.postData()??''};
  }
 });
 await page.goto(host.href);
 const app=page.frameLocator('#app-frame').frameLocator('iframe');
 const keyPanel=app.locator('#mcp-driver-key-panel');
 const keyInput=app.locator('#mcp-driver-key');
 const providerSelect=app.locator('#mcp-jev-provider');
 const accept=app.getByRole('button',{name:'Accept',exact:true});
 await expect(accept).toBeEnabled({timeout:15_000});
 await expect(keyPanel).toBeHidden();

 // Select Jev System 1: provider selector appears, OpenRouter prefix auto-detects, empty key blocked.
 await app.locator('input[name="driver"][value="jev"]').check();
 await expect(keyPanel).toBeVisible();
 await expect(providerSelect).toBeVisible();
 await accept.click();
 await expect(app.locator('#mcp-join-error')).toContainText('Jev System 1');
 await keyInput.fill('sk-or-test-key');
 await expect(providerSelect).toHaveValue('openrouter');

 // Switch to Luna: provider selector hides and prior input is cleared.
 await app.locator('input[name="driver"][value="luna"]').check();
 await expect(providerSelect).toBeHidden();
 await expect(keyInput).toHaveValue('');
 const secret='sk-luna-ephemeral-test-key-42';
 await keyInput.fill(secret);
 await accept.click();

 await expect(app.locator('body')).toHaveAttribute('data-phase','racing',{timeout:30_000});
 expect(keyRequest).not.toBeNull();
 expect(keyRequest!.auth).toMatch(/^Bearer [a-f0-9]{64}$/);
 expect(JSON.parse(keyRequest!.body)).toMatchObject({team:'a',engine:'luna',apiKey:secret});
 // Never sent through MCP tool calls.
 for(const body of mcpBodies)expect(body).not.toContain(secret);
 // Cleared from input and never persisted in browser storage.
 await expect(keyInput).toHaveValue('');
 const storage=await app.locator('body').evaluate(()=>({
  local:Object.keys(localStorage).map(k=>`${k}=${localStorage.getItem(k)}`).join(';'),
  session:Object.keys(sessionStorage).map(k=>`${k}=${sessionStorage.getItem(k)}`).join(';'),
 }));
 expect(storage.local).not.toContain(secret);
 expect(storage.session).not.toContain(secret);

 const state=await app.locator('body').evaluate(()=>(window as Window&{__raceState?:RaceState}).__raceState);
 expect(state?.driverMode?.a).toBe('luna');
 expect(state?.players?.a?.engine).toBe('luna');
 expect(state?.players?.a?.provider).toBe('openai');
 expect(state?.players?.a?.mock).toBe(false);
 expect(JSON.stringify(state)).not.toContain(secret);
});
