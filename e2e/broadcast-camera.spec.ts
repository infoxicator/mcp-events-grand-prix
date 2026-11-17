import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {BROADCAST_SHOTS} from '../src/race/broadcast-camera';

for(const circuit of ['monza','las-vegas'] as const)test(`broadcast rotates through both onboards and external shots, with manual hold (${circuit})`,async({page,request})=>{
 const out=`artifacts/broadcast-rotation/${circuit}`;await mkdir(out,{recursive:true});
 const links=await request.get('/api/default').then(r=>r.json()),fixture=await request.get(`/api/rooms/${links.room}/status`).then(r=>r.json());
 fixture.race.circuit=circuit;fixture.race.phase='racing';fixture.connected={a:true,b:true};fixture.mode='mock';fixture.paidCalls=0;
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let timer:ReturnType<typeof setInterval>|undefined;
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>ws.onMessage(raw=>{
  const m=JSON.parse(String(raw));if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));
  if(m.type==='join'){
   ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));const start=Date.now();
   const send=()=>{const t=(Date.now()-start)/1000;fixture.race.time=t;fixture.race.tick++;
    fixture.race.events=[{id:1+Math.floor(t),time:t,kind:'overtake',team:'a',message:'Battle continues'}];
    for(const id of ['a','b'])Object.assign(fixture.race.cars[id],{distance:100+t*45+(id==='a'?10:0),speed:45,offset:id==='a'?-.5:.5,gear:6,rpm:10000});
    ws.send(JSON.stringify(fixture));};send();timer=setInterval(send,33);
  }
 }));
 const current=()=>page.evaluate(()=>(window as any).__renderStats.cameraMode);
 try{
  await page.goto('/?spectate&cameraDebug');await page.waitForFunction(()=>!!(window as any).__renderStats?.modelsReady);
  await page.evaluate(()=>{document.querySelector<HTMLElement>('#viewport')!.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:1000';});
  await page.locator('button[data-camera="broadcast"]').click();
  await page.evaluate(()=>{const w=window as any;w.__shots=[];w.__recordShots=true;function frame(now:number){const mode=w.__renderStats?.cameraMode;if(w.__shots.at(-1)?.mode!==mode)w.__shots.push({mode,now});if(w.__recordShots)requestAnimationFrame(frame);}requestAnimationFrame(frame);});
  const captured=new Set<string>();
  for(const shot of BROADCAST_SHOTS){
   await expect.poll(current,{timeout:12000,intervals:[100]}).toBe(shot.mode);
   await expect(page.locator('button[data-camera="broadcast"]')).toHaveClass(/selected/);
   if(!captured.has(shot.mode)){await page.waitForTimeout(300);await page.locator('#viewport').screenshot({path:`${out}/${shot.mode}.png`});captured.add(shot.mode);}
  }
  await expect.poll(current,{timeout:12000,intervals:[100]}).toBe('side');
  const shots=await page.evaluate(()=>{const w=window as any;w.__recordShots=false;return w.__shots as {mode:string;now:number}[];});
  expect(shots.map(s=>s.mode)).toEqual([...BROADCAST_SHOTS.map(s=>s.mode),'side']);
  for(let i=1;i<shots.length;i++)expect(shots[i].now-shots[i-1].now).toBeGreaterThanOrEqual(BROADCAST_SHOTS[i-1].seconds*1000-150);
  await page.locator('button[data-camera="side"]').click();await page.waitForTimeout(10000);expect(await current()).toBe('side');
  await page.locator('button[data-camera="cockpit-b"]').click();await expect.poll(current).toBe('cockpit-b');
  await page.locator('button[data-camera="broadcast"]').click();await expect.poll(current).toBe('side');
  expect(errors).toEqual([]);expect(fixture.paidCalls).toBe(0);
  await writeFile(`${out}/shots.json`,JSON.stringify({shots,errors,paidCalls:fixture.paidCalls,manualHold:true},null,2)+'\n');
 }finally{if(timer)clearInterval(timer);}
});
