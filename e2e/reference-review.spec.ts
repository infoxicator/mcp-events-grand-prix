import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import views from '../src/race/assets/review-views.json' with {type:'json'};
import type {RaceState} from '../src/race/types';

declare global {
 interface Window {
  __renderStats?:{modelsReady:boolean;modelError:string|null;finish:string};
 }
}

test('exported Ferrari in every registered inspection view and finish',async({page,request})=>{
 const output=process.env.CAR_MATRIX_DIR;
 test.skip(!output,'Set CAR_MATRIX_DIR to capture the full comparison set');
 test.setTimeout(8*60_000);
 await mkdir(output!,{recursive:true});
 const {room}=await request.get('/api/default').then(r=>r.json());
 const fixture:RaceState=await request.get('/api/rooms/'+room+'/status').then(r=>r.json());
 fixture.race.circuit='monza';fixture.connected={a:true,b:true};fixture.race.phase='racing';
 fixture.mode='mock';fixture.race.tick=1000;fixture.race.time=10;
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>ws.onMessage(raw=>{
  const msg=JSON.parse(String(raw));
  if(msg.type==='join'){
   ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));
   ws.send(JSON.stringify(fixture));
  }
  if(msg.type==='ping')ws.send(JSON.stringify({type:'pong',sent:msg.sent}));
 }));
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const width=Number(process.env.CAR_REVIEW_WIDTH??1080);
 await page.setViewportSize({width,height:width*3/4});
 const records=[];
 for(const name of Object.keys(views)){
  if(process.env.CAR_REVIEW_VIEWS&&!process.env.CAR_REVIEW_VIEWS.split(',').includes(name))continue;
  await page.goto('/?spectate&camera=showroom&review='+name);
  await page.waitForFunction(()=>!!window.__renderStats?.modelsReady||!!window.__renderStats?.modelError);
  expect(await page.evaluate(()=>window.__renderStats?.modelError)).toBeNull();
  await expect(page.locator('#waiting')).toBeHidden();
  // Give the WebGL viewport the same 4:3 sensor area as the Blender camera.
  await page.addStyleTag({content:'#viewport{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:1000!important} #viewport>:not(canvas){visibility:hidden!important}'});
  for(const finish of ['colour','clay','wireframe']){
   await page.locator('[data-finish="'+finish+'"]').evaluate((el:HTMLButtonElement)=>el.click());
   await page.waitForFunction(f=>window.__renderStats?.finish===f,finish);
   await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
   await page.locator('#viewport canvas').screenshot({path:join(output!,name+'-'+finish+'.png')});
   records.push({view:name,finish,stats:await page.evaluate(()=>window.__renderStats)});
  }
  if(name==='parts'){
   await page.locator('#exit-studio').evaluate((el:HTMLButtonElement)=>el.click());
   await expect(page.locator('#camera-name')).not.toContainText('STUDIO');
  }
 }
 expect(errors).toEqual([]);
 await writeFile(join(output!,'captures.json'),JSON.stringify(records,null,2));
});
