import {test,expect} from '@playwright/test';import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';import {getToolUiResourceUri} from '@modelcontextprotocol/ext-apps/app-bridge';
for(const circuit of ['monza','las-vegas'])test(`local Worker Durable Object drives one race and serves the MCP invitation resource (${circuit})`,async({browser,request,baseURL})=>{
 test.setTimeout(120_000);
 const health=await request.get('/health').then(r=>r.json());expect(health.runtime).toBe('cloudflare-workers');expect(health.paidCalls).toBe(0);
 const links=await request.get('/api/default?circuit='+circuit).then(r=>r.json());const ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage();const errors:string[]=[];a.on('pageerror',e=>errors.push(e.message));b.on('pageerror',e=>errors.push(e.message));
 const seats=[links.a,links.b].map(link=>{const url=new URL(link);url.searchParams.set('view','telemetry');return url.href;});
 try{await Promise.all([a.goto(seats[0]),b.goto(seats[1])]);const state=async()=>request.get(`/api/rooms/${links.room}/status`).then(r=>r.json());
  const start=a.getByRole('button',{name:'Start race',exact:true});
  await a.bringToFront();
  await expect(start).toBeEnabled();
  expect((await state()).race).toMatchObject({phase:'lobby',tick:0});
  await start.click();
  await expect.poll(async()=>(await state()).race.phase,{timeout:20_000}).toBe('racing');
  await expect.poll(async()=>(await state()).intents.a,{timeout:20_000}).toBeGreaterThan(2);
  await expect.poll(async()=>(await state()).intents.b).toBeGreaterThan(2);
  // Driver responses can arrive while the player is still behind the start line.
  await expect.poll(async()=>(await state()).race.cars.a.distance).toBeGreaterThan(0);
  expect((await state()).paidCalls).toBe(0);expect((await state()).race.circuit).toBe(circuit);expect((await state()).engineerCalls.a).toBeGreaterThan(0);
  const denied=await request.get(`/api/rooms/${links.room}/links`);expect(denied.status()).toBe(403);await cb.close();await expect.poll(async()=>(await state()).connected.b).toBe(false);const tick=(await state()).race.tick;await a.waitForTimeout(250);expect((await state()).race.tick).toBe(tick);
  // Check the Worker-served 3D assets with the race paused.
  await a.goto(links.a);await a.bringToFront();
  await expect.poll(()=>a.evaluate(()=>{
   const stats=(window as Window&{__renderStats?:{modelsReady:boolean;modelError?:string}}).__renderStats;
   return {ready:stats?.modelsReady??false,error:stats?.modelError??null};
  }),{timeout:60_000}).toEqual({ready:true,error:null});expect(errors).toEqual([]);
 const client=new Client({name:'Worker mock verification',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',baseURL!)));const tools=await client.listTools(),open=tools.tools.find(t=>t.name==='open_grand_prix')!;const resource=await client.readResource({uri:getToolUiResourceUri(open)!});expect(resource.contents[0].mimeType).toBe('text/html;profile=mcp-app');expect(resource.contents[0]._meta).toMatchObject({ui:{csp:{connectDomains:[baseURL,baseURL!.replace(/^http/,'ws')],resourceDomains:[baseURL]}},'openai/widgetCSP':{redirect_domains:[baseURL]}});expect(resource.contents[0]._meta?.ui).not.toHaveProperty('csp.frameDomains');const created=await client.callTool({name:'open_grand_prix',arguments:{player:'a',matchup:'jev-vs-luna',circuit}});const invite=(created._meta as {invitation:string}).invitation;const joined=await client.callTool({name:'open_grand_prix',arguments:{invite}});expect(joined.isError).not.toBe(true);expect((joined.structuredContent as {circuit:string}).circuit).toBe(circuit);expect((joined.structuredContent as {matchup:string}).matchup).toBe('jev-vs-luna');expect((joined.structuredContent as {room:string}).room).toBe((created.structuredContent as {room:string}).room);await client.close();console.log('PASS: workerd assets, Durable Object fixed-step physics, both Jev intents, engineer radio, independent disconnect, owner authorization and MCP invitations; paid calls=0.');
 }finally{await ca.close();await cb.close();}
});
