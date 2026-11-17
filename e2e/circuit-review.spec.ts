import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test('circuit review: fixed straight, signature corner, aerial and pit views',async({page,request})=>{
 const links=await request.get('/api/default').then(r=>r.json());const fixture=await request.get(`/api/rooms/${links.room}/status`).then(r=>r.json());
 fixture.connected={a:true,b:true};fixture.race.phase='racing';fixture.mode='mock';fixture.paidCalls=0;
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>{ws.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.type==='join'){ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));ws.send(JSON.stringify(fixture));}if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));});});
 await page.setViewportSize({width:1440,height:980});
 for(const circuit of ['monza','las-vegas'] as const){
  fixture.race.circuit=circuit;const track={LENGTH:circuit==='monza'?5800:6228,CORNERS:[{d:5280}]},dir=`artifacts/${process.env.CIRCUIT_REVIEW_DIR??`circuits-v2/${process.env.REVIEW_ROUND??'round-3'}`}/${circuit}`;await mkdir(dir,{recursive:true});
  for(const [name,cam,d] of [['straight-chase','chase',track.LENGTH-80],['signature-onboard','cockpit-a',circuit==='monza'?track.CORNERS.at(-1)!.d-80:1340],['aerial','helicopter',circuit==='monza'?track.CORNERS.at(-1)!.d:1780],['pit-grandstand','pits',track.LENGTH-160],...(circuit==='las-vegas'?[['strip-landmarks','strip',4000] as const]:[])] as const){
   for(const id of ['a','b'])Object.assign(fixture.race.cars[id],{distance:d-(id==='b'?20:0),offset:0,speed:55,gear:6,rpm:10300});
   await page.goto(`/?spectate&camera=${cam}&angle=rear`);await page.waitForFunction(()=>!!(window as any).__renderStats?.modelsReady);await expect(page.locator('#waiting')).toBeHidden();
   await page.evaluate(()=>document.querySelector<HTMLElement>('#viewport')!.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:1000');await page.waitForTimeout(1800);await page.locator('#viewport').screenshot({path:`${dir}/${name}.png`});
  }
 }
 expect(errors).toEqual([]);
});
