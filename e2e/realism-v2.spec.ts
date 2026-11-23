import {test,expect} from '@playwright/test';
import type {RaceState} from '../src/race/types';
import {mkdir,writeFile} from 'node:fs/promises';
test('Blender cars, onboard, studio finishes and live camera transitions',async({page,request})=>{
 const links=await request.get('/api/default').then(r=>r.json());const fixture:RaceState=await request.get(`/api/rooms/${links.room}/status`).then(r=>r.json());
 fixture.race.circuit='monza';fixture.connected={a:true,b:true};fixture.race.phase='racing';fixture.race.tick=1000;fixture.race.time=10;fixture.mode='mock';fixture.paidCalls=0;
 for(const [id,c] of Object.entries(fixture.race.cars)){c.distance=id==='a'?4220:4204;c.offset=0;c.speed=72;c.gear=7;c.rpm=11000;c.ers=67;c.steering=.012;c.heading=0;c.acceleration=0;c.lateralG=0;}
 const errors:string[]=[],failed:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>{ws.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.type==='join'){ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));ws.send(JSON.stringify(fixture));}if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));});});
 await mkdir(`artifacts/${process.env.CAR_REVIEW_DIR??'realism-v2'}`,{recursive:true});await page.setViewportSize({width:1440,height:1080});
 const records:{name:string;stats:unknown}[]=[];
 async function shot(name:string,camera:string,angle='front'){
  await page.goto(`/?spectate&camera=${camera}&angle=${angle}`);await page.waitForFunction(()=>!!(window as any).__renderStats?.modelsReady);await expect(page.locator('#waiting')).toBeHidden();
  await page.evaluate(()=>{document.querySelector<HTMLElement>('#viewport')!.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:1000';});await page.waitForLoadState('networkidle');await page.waitForTimeout(500);
  await page.locator('#viewport').screenshot({path:`artifacts/${process.env.CAR_REVIEW_DIR??'realism-v2'}/${name}.png`});records.push({name,stats:await page.evaluate(()=>(window as any).__renderStats)});
 }
 if(!process.env.ONBOARD_ONLY){
 await shot('front-beauty','showroom');await shot('halo-closeup','showroom','halo');await shot('airbox-closeup','showroom','airbox');await shot('sidepod-closeup','showroom','sidepod');await shot('rear-three-quarter','showroom','rear');await shot('diffuser','showroom','diffuser');
 await page.getByRole('button',{name:'Wireframe',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__renderStats.finish)).toBe('wireframe');
 await page.locator('#viewport').screenshot({path:`artifacts/${process.env.CAR_REVIEW_DIR??'realism-v2'}/diffuser-wire.png`});
 await shot('side-profile','showroom','side');await shot('wheel-closeup','showroom','wheel');await shot('steering-closeup','showroom','steering');await shot('showroom-colour','showroom');
 for(const finish of ['Clay','Wireframe']){await page.getByRole('button',{name:finish,exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__renderStats.finish)).toBe(finish.toLowerCase());await page.waitForTimeout(250);await page.locator('#viewport').screenshot({path:`artifacts/${process.env.CAR_REVIEW_DIR??'realism-v2'}/showroom-${finish.toLowerCase()}.png`});}
 await page.getByRole('button',{name:'Back to race'}).click();await expect(page.locator('#camera-name')).not.toContainText('STUDIO');await expect(page.locator('.studio-controls')).toBeHidden();
 }
 await shot('chase','chase');await shot('cockpit-onboard','cockpit-a');await shot('tcam','tcam-a');
 fixture.race.cars.a.steering=.20;await shot('onboard-left-lock','cockpit-a');fixture.race.cars.a.steering=-.20;await shot('onboard-right-lock','cockpit-a');fixture.race.cars.a.steering=.012;
 // Match the supplied 738×375 broadcast reference without cropping or stretching.
 // A second car ahead makes forward orientation and sightlines unambiguous.
 await page.setViewportSize({width:1476,height:750});fixture.race.cars.b.distance=fixture.race.cars.a.distance+8;
 for(const camera of ['tcam-a','cockpit-a','tcam-b','cockpit-b']){
  await shot(`wide-${camera}`,camera);
  const clean=await page.addStyleTag({content:'#viewport > :not(canvas){visibility:hidden!important}'});
  await page.locator('#viewport > canvas').screenshot({path:`artifacts/${process.env.CAR_REVIEW_DIR??'realism-v2'}/clean-${camera}.png`});
  await clean.evaluate(el=>el.parentNode?.removeChild(el));
  expect(await page.locator('#viewport').getAttribute('data-camera')).toBe(camera);
 }
 for(const [name,steering] of [['left',.20],['right',-.20]] as const){fixture.race.cars.a.steering=steering;await shot(`wide-cockpit-${name}`,'cockpit-a');}
 for(const [name,steering] of [['left',.42],['right',-.42]] as const){fixture.race.cars.a.steering=steering;await shot(`full-lock-${name}`,'cockpit-a');}
 fixture.race.cars.a.steering=.20;await shot('tcam-turning','tcam-a');
 const cleanTurn=await page.addStyleTag({content:'#viewport > :not(canvas){visibility:hidden!important}'});
 await page.locator('#viewport > canvas').screenshot({path:`artifacts/${process.env.CAR_REVIEW_DIR??'realism-v2'}/clean-tcam-turning.png`});await cleanTurn.evaluate(el=>el.parentNode?.removeChild(el));
 fixture.race.cars.a.steering=.012;
 // Both choices remain available through the controls, including the second team.
 await page.locator('[data-camera="cockpit-a"]').click();await expect(page.locator('#viewport')).toHaveAttribute('data-camera','cockpit-a');
 await page.locator('[data-camera="tcam-b"]').click();await expect(page.locator('#viewport')).toHaveAttribute('data-camera','tcam-b');
 await page.getByRole('button',{name:'Showroom',exact:true}).click();await expect(page.locator('.studio-controls')).toBeVisible();await page.getByRole('button',{name:'Pause rotation'}).click();await expect(page.getByRole('button',{name:'Rotate',exact:true})).toBeVisible();
 expect(errors).toEqual([]);expect(failed).toEqual([]);expect(fixture.paidCalls).toBe(0);await writeFile(`artifacts/${process.env.CAR_REVIEW_DIR??'realism-v2'}/render-stats.json`,JSON.stringify(records,null,2));
});
