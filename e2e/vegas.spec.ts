import {test,expect,type WebSocketRoute} from '@playwright/test';
import sharp from 'sharp';
import type {RaceState} from '../src/race/types';
import {mkdir} from 'node:fs/promises';
test('Las Vegas night scene renders Sphere, Strip, cockpit and skid sparks without missing assets or shader errors',async({page,request})=>{
 const links=await request.get('/api/default').then(r=>r.json());const fixture:RaceState=await request.get(`/api/rooms/${links.room}/status`).then(r=>r.json());fixture.race.circuit='las-vegas';fixture.connected={a:true,b:true};fixture.race.phase='racing';fixture.race.tick=1000;fixture.race.time=35;fixture.mode='mock';fixture.paidCalls=0;
 const errors:string[]=[],assets:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400&&/\.(jpg|hdr|js|css)/.test(r.url()))assets.push(r.url());});
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>{ws.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.type==='join'){ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));ws.send(JSON.stringify(fixture));}if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));});});
 await mkdir('artifacts',{recursive:true});
 for(const [name,distance,camera] of [['sphere',1800,'◉ Sphere'],['strip',4370,'↗ The Strip'],['aerial',4370,'↗ Aerial'],['cockpit',1350,'44 Onboard'],['sparks',4300,'◉ Broadcast']] as const){
  fixture.race.cars.a.distance=distance;fixture.race.cars.b.distance=distance-15;for(const c of Object.values(fixture.race.cars)){c.offset=0;c.speed=90;c.pit='none';c.gear=8;}
  await page.goto('/?spectate');await expect(page.locator('body')).toHaveAttribute('data-circuit','las-vegas');await page.getByRole('button',{name:camera,exact:true}).click();await page.waitForFunction(()=>!!(window as any).__renderStats?.modelsReady);await page.waitForTimeout(600);await page.screenshot({path:`artifacts/vegas-${name}.png`});
  if(name==='sparks')await expect.poll(()=>page.evaluate(()=>(window as unknown as {__renderStats:{sparks:number}}).__renderStats.sparks)).toBeGreaterThan(0);
 }
 await expect(page.locator('#circuit-name')).toHaveText('LAS VEGAS');expect(errors).toEqual([]);expect(assets).toEqual([]);expect(fixture.paidCalls).toBe(0);
});

test('owner switches day and night scenes without losing the shared room or retaining extra canvases',async({page,request,browser})=>{
 const links=await request.get('/api/default').then(r=>r.json()),other=await browser.newContext(),spectator=await other.newPage(),errors:string[]=[];for(const p of [page,spectator])p.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(links.owner.replace('#','&team=a#'));await spectator.goto(links.b);await expect(page.getByLabel('Circuit',{exact:true})).toBeEnabled();await expect(spectator.getByLabel('Circuit',{exact:true})).toBeDisabled();
  for(const circuit of ['las-vegas','monza','las-vegas','monza']){
   await page.getByLabel('Circuit',{exact:true}).selectOption(circuit);
   for(const p of [page,spectator]){await expect(p.locator('body')).toHaveAttribute('data-circuit',circuit);await expect(p.locator('body')).toHaveAttribute('data-room',links.room);await expect(p.locator('#viewport canvas')).toHaveCount(1);await expect.poll(()=>p.evaluate(()=>(window as unknown as {__renderStats:{circuit:string}}).__renderStats.circuit)).toBe(circuit);await expect.poll(()=>p.evaluate(()=>(window as any).__renderStats?.modelsReady)).toBe(true);}
   await expect(page.getByRole('button',{name:'Start race',exact:true})).toBeEnabled();
   await expect(page.locator('#lights')).toBeHidden();
   if(circuit==='las-vegas'){await page.getByRole('button',{name:'◉ Sphere',exact:true}).click();}else await expect(page.locator('#camera-name')).not.toContainText('SPHERE');
  }
  expect(errors).toEqual([]);expect((await request.get(`/api/rooms/${links.room}/status`).then(r=>r.json())).paidCalls).toBe(0);
 }finally{await other.close();}
});

test('Sphere runs its wordmark, turns toward passing field cars and waves the finish flag',async({page,request},info)=>{
 const {room}=await request.get('/api/default').then(r=>r.json());
 const state:RaceState=await request.get('/api/rooms/'+room+'/status').then(r=>r.json());
 const race=state.race;
 Object.assign(state,{speed:1,connected:{a:true,b:true}});
 Object.assign(race,{circuit:'las-vegas',phase:'racing',time:1,tick:120,events:[]});
 for(const car of [race.cars.a,race.cars.b,...race.field])Object.assign(car,{distance:0,speed:0,offset:0});
 const errors:string[]=[];let feed:WebSocketRoute;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>ws.onMessage(raw=>{
  const msg=JSON.parse(String(raw));
  if(msg.type==='join'){feed=ws;ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));ws.send(JSON.stringify(state));}
  if(msg.type==='ping')ws.send(JSON.stringify({type:'pong',sent:msg.sent}));
 }));
 await page.setViewportSize({width:960,height:600});
 await page.goto('/?spectate&camera=sphere');
 await page.waitForFunction(()=>(window as any).__renderStats?.modelsReady);
 await page.keyboard.press('b');
 const send=(dt:number)=>{
  race.time+=dt;race.tick=Math.round(race.time*120);feed.send(JSON.stringify(state));
 };
 async function capture(name?:string){
  const path=name?info.outputPath(name+'.png'):undefined;
  const png=await page.locator('#viewport').screenshot({path});
  if(name&&path)await info.attach(name,{path,contentType:'image/png'});
  // The dedicated lens is fixed. Measure the actual LEDs, including where
  // the whites of the mascot's eyes land as the unfeatured field car drives by.
  const width=300;
  const pixels=await sharp(png).extract({left:330,top:200,width,height:120}).removeAlpha().raw().toBuffer();
  let yellow=0,red=0,white=0,whiteX=0,cyan=0;
  for(let i=0;i<pixels.length;i+=3){
   const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
   if(r>190&&g>125&&r>b+95&&g>b+56)yellow++;
   if(g>125&&b>190&&r<g*.75)cyan++;
   if(r>160&&r>g*1.6&&r>b*1.38)red++;
   if(Math.min(r,g,b)>189&&Math.max(r,g,b)-Math.min(r,g,b)<38){white++;whiteX+=(i/3)%width;}
  }
  return {red,yellow,white,cyan,eyeX:whiteX/Math.max(1,white)};
 }
 await page.waitForTimeout(1000);
 const logo=await capture('wordmark');
 expect(logo.red).toBeGreaterThan(750);expect(logo.yellow).toBeLessThan(200);
 const passer=race.field[0];passer.distance=1670;send(1);
 await page.waitForTimeout(1800);
 const left=await capture('look-left');
 expect(left.yellow).toBeGreaterThan(14000);
 passer.speed=52;
 for(let step=0;step<80;step++){
  passer.distance+=passer.speed*.05;send(.05);await page.waitForTimeout(50);
 }
 passer.speed=0;send(.1);await page.waitForTimeout(600);
 const right=await capture('look-right');
 expect(right.yellow).toBeGreaterThan(14000);expect(right.eyeX-left.eyeX).toBeGreaterThan(65);
 // Hold a field car in front of the display through the next programme.
 passer.distance=1760;send(1);
 await expect.poll(async()=>(await capture()).cyan,{timeout:24000,intervals:[1200]}).toBeGreaterThan(3200);
 await page.waitForTimeout(850);
 const helmet=await capture('racing-helmet');
 expect(helmet.cyan).toBeGreaterThan(3200);expect(helmet.yellow).toBeGreaterThan(1200);
 passer.distance=1850;send(1);await page.waitForTimeout(1500);
 const turned=await capture('helmet-tracking');expect(turned.cyan).toBeGreaterThan(3000);
 passer.finishTime=race.time;send(1);await page.waitForTimeout(2000);
 const flag=await capture('chequered');
 expect(flag.yellow).toBeLessThan(200);expect(flag.white).toBeGreaterThan(logo.white+2000);
 expect(errors).toEqual([]);
});
