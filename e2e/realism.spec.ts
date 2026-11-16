import {test,expect} from '@playwright/test';
import type {RaceState} from '../src/race/types';
import {mkdir} from 'node:fs/promises';
test('detailed cars render from front and rear, with textured aerial and cockpit views',async({page,request})=>{
 const links=await request.get('/api/default').then(r=>r.json());const fixture:RaceState=await request.get(`/api/rooms/${links.room}/status`).then(r=>r.json());
 fixture.race.circuit='monza';fixture.connected={a:true,b:true};fixture.race.phase='racing';fixture.race.tick=1000;fixture.race.time=10;fixture.mode='mock';fixture.paidCalls=0;
 const errors:string[]=[],failedAssets:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&/\.(jpg|hdr|js|css)/.test(r.url()))failedAssets.push(r.url());});
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>{ws.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.type==='join'){ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));ws.send(JSON.stringify(fixture));}if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));});});
 await mkdir('artifacts',{recursive:true});
 for(const angle of ['front','rear','side']){
  fixture.race.cars.a.distance=0;fixture.race.cars.a.offset=-2;fixture.race.cars.b.distance=-12;fixture.race.cars.b.offset=2;
  await page.goto(`/?spectate&camera=detail&angle=${angle}`);await expect(page.locator('#camera-name')).toContainText('CAR DETAIL');await expect(page.locator('#waiting')).toBeHidden();await page.waitForLoadState('networkidle');
  await page.evaluate(()=>{const viewport=document.querySelector<HTMLElement>('#viewport')!;viewport.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:1000';});await page.waitForTimeout(500);
  await page.locator('#viewport').screenshot({path:`artifacts/realism-car-${angle}.png`});
 }
 fixture.race.cars.a.distance=4220;fixture.race.cars.b.distance=4204;for(const c of Object.values(fixture.race.cars)){c.offset=0;c.speed=72;c.gear=7;c.throttle=.8;}
 await page.goto('/?spectate');await page.getByRole('button',{name:'↗ Aerial',exact:true}).click();await expect(page.locator('#camera-name')).toContainText('AERIAL');await page.waitForLoadState('networkidle');await page.screenshot({path:'artifacts/realism-aerial.png'});
 await page.getByRole('button',{name:'44 Onboard',exact:true}).click();await expect(page.locator('#camera-name')).toContainText('ONBOARD');await page.screenshot({path:'artifacts/realism-cockpit.png'});
 expect(errors).toEqual([]);expect(failedAssets).toEqual([]);expect(fixture.paidCalls).toBe(0);
});
