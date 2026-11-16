import {test,expect} from '@playwright/test';
import type {RaceState} from '../src/race/types';
import {mkdir,writeFile} from 'node:fs/promises';
test('Blender cars, onboard, studio finishes and live camera transitions',async({page,request})=>{
 const links=await request.get('/api/default').then(r=>r.json());const fixture:RaceState=await request.get(`/api/rooms/${links.room}/status`).then(r=>r.json());
 fixture.race.circuit='monza';fixture.connected={a:true,b:true};fixture.race.phase='racing';fixture.race.tick=1000;fixture.race.time=10;fixture.mode='mock';fixture.paidCalls=0;
 for(const [id,c] of Object.entries(fixture.race.cars)){c.distance=id==='a'?4220:4204;c.offset=0;c.speed=72;c.gear=7;c.rpm=11000;c.ers=67;c.steering=.012;}
 const errors:string[]=[],failed:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>{ws.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.type==='join'){ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));ws.send(JSON.stringify(fixture));}if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));});});
 await mkdir(`artifacts/${process.env.CAR_REVIEW_DIR??'realism-v2'}`,{recursive:true});await page.setViewportSize({width:1440,height:1080});
 const records:{name:string;stats:unknown}[]=[];
 async function shot(name:string,camera:string,angle='front'){
  await page.goto(`/?spectate&camera=${camera}&angle=${angle}`);await page.waitForFunction(()=>!!(window as any).__renderStats?.modelsReady);await expect(page.locator('#waiting')).toBeHidden();
  await page.evaluate(()=>{document.querySelector<HTMLElement>('#viewport')!.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:1000';});await page.waitForLoadState('networkidle');await page.waitForTimeout(500);
  await page.locator('#viewport').screenshot({path:`artifacts/${process.env.CAR_REVIEW_DIR??'realism-v2'}/${name}.png`});records.push({name,stats:await page.evaluate(()=>(window as any).__renderStats)});
 }
 await shot('front-beauty','showroom');await shot('rear-three-quarter','showroom','rear');await shot('side-profile','showroom','side');await shot('wheel-closeup','showroom','wheel');await shot('steering-closeup','showroom','steering');await shot('showroom-colour','showroom');
 for(const finish of ['Clay','Wireframe']){await page.getByRole('button',{name:finish,exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__renderStats.finish)).toBe(finish.toLowerCase());await page.waitForTimeout(250);await page.locator('#viewport').screenshot({path:`artifacts/${process.env.CAR_REVIEW_DIR??'realism-v2'}/showroom-${finish.toLowerCase()}.png`});}
 await page.getByRole('button',{name:'Back to race'}).click();await expect(page.locator('#camera-name')).not.toContainText('STUDIO');await expect(page.locator('.studio-controls')).toBeHidden();
 await shot('chase','chase');await shot('cockpit-onboard','cockpit-a');await shot('tcam','tcam-a');
 await page.getByRole('button',{name:'Showroom',exact:true}).click();await expect(page.locator('.studio-controls')).toBeVisible();await page.getByRole('button',{name:'Pause rotation'}).click();await expect(page.getByRole('button',{name:'Rotate',exact:true})).toBeVisible();
 expect(errors).toEqual([]);expect(failed).toEqual([]);expect(fixture.paidCalls).toBe(0);await writeFile(`artifacts/${process.env.CAR_REVIEW_DIR??'realism-v2'}/render-stats.json`,JSON.stringify(records,null,2));
});
