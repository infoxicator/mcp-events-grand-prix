import {test,expect} from '@playwright/test';
import type {RaceState} from '../src/race/types';
import {mkdir} from 'node:fs/promises';
test('Las Vegas night scene renders Sphere, Strip, cockpit and skid sparks without missing assets or shader errors',async({page,request})=>{
 const links=await request.get('/api/default').then(r=>r.json());const fixture:RaceState=await request.get(`/api/rooms/${links.room}/status`).then(r=>r.json());fixture.race.circuit='las-vegas';fixture.connected={a:true,b:true};fixture.race.phase='racing';fixture.race.tick=1000;fixture.race.time=35;fixture.mode='mock';fixture.paidCalls=0;
 const errors:string[]=[],assets:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400&&/\.(jpg|hdr|js|css)/.test(r.url()))assets.push(r.url());});
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>{ws.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.type==='join'){ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));ws.send(JSON.stringify(fixture));}if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));});});
 await mkdir('artifacts',{recursive:true});
 for(const [name,distance,camera] of [['sphere',1800,'◉ Sphere'],['strip',4370,'↗ The Strip'],['aerial',4370,'↗ Aerial'],['cockpit',1350,'07 Onboard'],['sparks',4300,'◉ Broadcast']] as const){
  fixture.race.cars.a.distance=distance;fixture.race.cars.b.distance=distance-15;for(const c of Object.values(fixture.race.cars)){c.offset=0;c.speed=90;c.pit='none';c.gear=8;}
  await page.goto('/?spectate');await expect(page.locator('body')).toHaveAttribute('data-circuit','las-vegas');await page.getByRole('button',{name:camera,exact:true}).click();await page.waitForLoadState('networkidle');await page.waitForTimeout(600);await page.screenshot({path:`artifacts/vegas-${name}.png`});
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
   for(const p of [page,spectator]){await expect(p.locator('body')).toHaveAttribute('data-circuit',circuit);await expect(p.locator('body')).toHaveAttribute('data-room',links.room);await expect(p.locator('#viewport canvas')).toHaveCount(1);await expect.poll(()=>p.evaluate(()=>(window as unknown as {__renderStats:{circuit:string}}).__renderStats.circuit)).toBe(circuit);}
   if(circuit==='las-vegas'){await expect(page.locator('#waiting')).toBeHidden();await expect(page.locator('#lights')).toBeHidden();await page.getByRole('button',{name:'◉ Sphere',exact:true}).click();}else await expect(page.locator('#camera-name')).not.toContainText('SPHERE');
  }
  expect(errors).toEqual([]);expect((await request.get(`/api/rooms/${links.room}/status`).then(r=>r.json())).paidCalls).toBe(0);
 }finally{await other.close();}
});
