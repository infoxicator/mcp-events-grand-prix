import {test,expect} from '@playwright/test';
import type {RaceState} from '../src/race/types';

test('default private watch runs 100% locally at 1x with zero server rooms or WebSockets',async({page})=>{
 let roomPosts=0,wsOpens=0;
 page.on('request',req=>{if(req.url().includes('/api/rooms')&&req.method()==='POST')roomPosts++;});
 page.on('websocket',()=>{wsOpens++;});
 await page.goto('/?watch&circuit=las-vegas');
 await page.waitForFunction(()=>document.body.dataset.connected==='true');
 expect(await page.evaluate(()=>(window as Window&{__raceState?:RaceState}).__raceState?.speed)).toBe(1);
 expect(roomPosts).toBe(0);
 expect(wsOpens).toBe(0);
 await expect(page.locator('#race-phase')).toHaveText('LOBBY');
 await expect(page.locator('.private-watch')).toHaveAttribute('href',/circuit=las-vegas/);
 await page.keyboard.press('Escape');await expect(page.locator('#clean-broadcast')).toBeVisible();
 await expect(page.locator('#country-flag')).toHaveAttribute('aria-label','United States');await page.keyboard.press('b');
 await page.keyboard.press('c');await page.locator('.audio-toggle').click();await expect(page.locator('.audio-toggle')).toHaveText('Mute sound');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Start race',exact:true}).click();
 await expect(page.locator('#lights')).toBeVisible();
 expect(roomPosts).toBe(0);
 expect(wsOpens).toBe(0);
});

test('online watch uses a single WebSocket, preserves the watch circuit and room on reload, and shares broadcast audio',async({page,browser})=>{
 let wsOpens=0;
 page.on('websocket',()=>{wsOpens++;});
 await page.goto('/?watch&online&circuit=las-vegas');
 await page.waitForFunction(()=>document.body.dataset.connected==='true');
 expect(await page.evaluate(()=>(window as Window&{__raceState?:RaceState}).__raceState?.speed)).toBe(1);
 expect(wsOpens).toBe(1);
 const room=new URL(page.url()).searchParams.get('room');
 await expect(page.locator('.private-watch')).toHaveAttribute('href',/circuit=las-vegas/);
 await page.reload();await page.waitForFunction(()=>document.body.dataset.connected==='true');
 await expect(page.locator('#race-phase')).toHaveText('LOBBY');
 await expect(page.getByRole('button',{name:'Start race',exact:true})).toBeEnabled();
 expect(new URL(page.url()).searchParams.get('room')).toBe(room);
 for(const size of [{width:1280,height:800},{width:1920,height:1080}]){
  await page.setViewportSize(size);await expect.poll(()=>page.locator('#viewport').boundingBox()).toEqual({x:0,y:0,...size});
  await page.keyboard.press('c');await expect(page.locator('.return-wall')).toBeVisible();await page.keyboard.press('Escape');
 }
 await page.keyboard.press('Escape');await expect(page.locator('#clean-broadcast')).toBeVisible();
 await expect(page.locator('#country-flag')).toHaveAttribute('aria-label','United States');await page.keyboard.press('b');
 await page.keyboard.press('c');await page.locator('.audio-toggle').click();await expect(page.locator('.audio-toggle')).toHaveText('Mute sound');
 const peer=await page.context().newPage();await peer.goto('/?room='+room+'&broadcast');
 await expect(peer.getByRole('button',{name:'Start race',exact:true})).toBeHidden();
 await expect(peer.locator('.broadcast-menu summary')).toBeVisible();
 await peer.keyboard.press('c');await expect(peer.locator('.broadcast-menu')).toHaveAttribute('open','');
 await peer.locator('.audio-toggle').click();await expect(peer.locator('.audio-toggle')).toHaveText('Sound in another tab');
 await page.locator('.audio-toggle').click();await peer.locator('.audio-toggle').click();await expect(peer.locator('.audio-toggle')).toHaveText('Mute sound');
 await peer.locator('.audio-toggle').click();await peer.close();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Start race',exact:true}).click();
 await expect(page.locator('#lights')).toBeVisible();
 const other=await browser.newPage();await other.goto('/?team=a');
 await expect(other.getByRole('link',{name:/World feed/})).toHaveAttribute('target','_blank');await other.close();
});

test('provisional classification, replay completion and onboard cuts keep the world feed coherent',async({page,request})=>{
 const {room}=await request.get('/api/default').then(r=>r.json()),s=await request.get('/api/rooms/'+room+'/status').then(r=>r.json());
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/GL_INVALID_OPERATION|shader error/i.test(m.text()))errors.push(m.text());});
 s.connected={a:true,b:true};s.race.phase='racing';s.race.cars.a.finishTime=348.283;s.race.cars.b.finishTime=352.292;
 for(const [i,c] of s.race.field.entries())if(i<15)c.finishTime=319+i;
 const replay=structuredClone(s.race);replay.cars.a.finishTime=null;replay.cars.b.finishTime=null;
 let update=()=>{};
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>ws.onMessage(raw=>{
  const m=JSON.parse(String(raw));if(m.type==='join'){ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));update=()=>{s.race.tick++;ws.send(JSON.stringify(s));};update();}
  if(m.type==='replay')ws.send(JSON.stringify({type:'replay',frames:Array(36).fill(replay)}));
  if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));
 }));
 await page.goto('/?spectate');await page.waitForFunction(()=>!!(window as any).__renderStats?.modelsReady);
 await expect(page.locator('#provisional-summary')).toContainText('5 running');await page.locator('#provisional-summary').click();
 await expect(page.locator('#provisional-rows>div')).toHaveCount(22);await expect(page.locator('#results')).toBeHidden();
 for(const camera of ['cockpit-a','cockpit-b','cockpit-a','broadcast']){
  await page.locator('[data-camera="'+camera+'"]').filter({hasNot:page.locator('canvas')}).last().click();await page.waitForTimeout(450);
 }
 s.race.phase='finished';s.race.field.forEach((c:{finishTime:number|null},i:number)=>{c.finishTime??=490+i;});update();
 await expect(page.locator('#result-rows>div')).toHaveCount(22);
 for(const manual of [true,false]){
  await page.locator('#results-replay').click();await expect(page.locator('body')).toHaveAttribute('data-replay','true');
  if(manual)await page.locator('#replay-button').click();
  await expect(page.locator('body')).toHaveAttribute('data-replay','false');
  await expect(page.locator('#results')).toBeVisible();await expect(page.locator('#replay-button')).toHaveText('↶ Instant replay');
 }
 expect(errors).toEqual([]);
});

for(const hostname of ['localhost','127.0.0.1'])test('private watch boot stays on '+hostname,async({page,baseURL})=>{
 const url=new URL(baseURL!);url.hostname=hostname;url.search='?watch&online&circuit=las-vegas';
 // A night join should allocate just the displayed WebGL scene.
 await page.addInitScript(()=>{
  const canvases=new Set<HTMLCanvasElement>(),get=HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(window,'__webglScenes',{get:()=>canvases.size});
  HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,...args:Parameters<typeof get>){
   const context=Reflect.apply(get,this,args);
   if(args[0]==='webgl2'&&context)canvases.add(this);
   return context;
  } as typeof get;
 });
 await page.goto(url.href);await page.waitForFunction(()=>document.body.dataset.connected==='true');
 await page.waitForFunction(()=>!!(window as any).__renderStats?.modelsReady);
 expect(await page.evaluate(()=>(window as any).__webglScenes)).toBe(1);
 expect(new URL(page.url()).hostname).toBe(hostname);await expect(page.locator('#grand-prix-name')).toContainText(/LAS VEGAS/i);
 await page.route('**/api/rooms?**',r=>r.fulfill({status:503,body:'unavailable'}));
 await page.goto(url.href);await expect(page.locator('#app')).toContainText('The race could not be opened');
 await expect(page.locator('#app')).not.toContainText(/token=|replaceState|http:/);
});
