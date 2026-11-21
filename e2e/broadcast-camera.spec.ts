import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {getTrack} from '../src/race/track';
import {BOX_OFFSET,pitBox} from '../src/race/pit-service';
import {BROADCAST_SHOTS} from '../src/race/broadcast-camera';

for(const circuit of ['monza','las-vegas'] as const)test(`broadcast rotates through both onboards and external shots, with manual hold (${circuit})`,async({page,request})=>{
 const out=`artifacts/broadcast-rotation/${circuit}`;await mkdir(out,{recursive:true});
 const links=await request.get('/api/default').then(r=>r.json()),fixture=await request.get(`/api/rooms/${links.room}/status`).then(r=>r.json());
 fixture.speed=1;fixture.race.circuit=circuit;fixture.race.phase='racing';fixture.connected={a:true,b:true};fixture.mode='mock';fixture.paidCalls=0;
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

test('broadcast holds the active pit crew through overlapping Ferrari and Mercedes stops',async({page,request})=>{
 const {room}=await request.get('/api/default').then(r=>r.json());
 const fixture=await request.get(`/api/rooms/${room}/status`).then(r=>r.json());
 const {a,b}=fixture.race.cars;
 // Monza game stations in metres from the timing line.
 const track=getTrack('monza'),ferrariBox=pitBox(track,'Ferrari'),mercedesBox=pitBox(track,'Mercedes');
 fixture.race.circuit='monza';fixture.race.phase='racing';fixture.connected={a:true,b:true};
 Object.assign(a,{pit:'none',distance:100,speed:40});
 Object.assign(b,{pit:'entry',distance:mercedesBox-15,speed:10,offset:-18});
 let send:undefined|(()=>void);
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>ws.onMessage(raw=>{
  const m=JSON.parse(String(raw));
  if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));
  if(m.type==='join'){
   ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));
   send=()=>{fixture.race.tick++;fixture.race.time+=.1;ws.send(JSON.stringify(fixture));};send();
  }
 }));
 await page.goto('/?spectate&cameraDebug');
 await page.waitForFunction(()=>!!(window as any).__renderStats?.modelsReady);
 const label=page.locator('#camera-name');
 await expect(label).toHaveText('PIT BOX / MERCEDES');
 Object.assign(b,{distance:mercedesBox,pit:'stopped',speed:0,offset:BOX_OFFSET,pitTime:.7});
 Object.assign(a,{distance:ferrariBox,pit:'stopped',speed:0,pitTime:.2,offset:BOX_OFFSET});
 send!();await expect(page.locator('body')).toHaveAttribute('data-tick',String(fixture.race.tick));
 await expect(label).toHaveText('PIT BOX / MERCEDES');
 Object.assign(b,{distance:mercedesBox+17,pit:'exit',speed:12});send!();
 await expect(label).toHaveText('PIT BOX / FERRARI');
 await page.locator('button[data-camera="side"]').click();
 await expect(label).toContainText('SIDE');
 await page.locator('button[data-camera="pits"]').click();
 await expect(label).toHaveText('PIT BOX / FERRARI');
});

for(const circuit of ['monza','las-vegas'] as const)test('two neighbouring field constructors service cars together at '+circuit,async({page,request})=>{
 const {opponents}=await import('../src/race/grid');
 const {room}=await request.get('/api/default').then(r=>r.json());
 const fixture=await request.get('/api/rooms/'+room+'/status').then(r=>r.json()),track=getTrack(circuit);
 fixture.connected={a:true,b:true};fixture.speed=1;
 Object.assign(fixture.race,{circuit,phase:'racing',time:100,tick:12000});
 const set=(code:string,delta:number,phase:string,remaining:number)=>{
  const index=opponents.findIndex(e=>e.code===code);
  Object.assign(fixture.race.field[index],{distance:pitBox(track,opponents[index].team)+delta,
   offset:BOX_OFFSET,pit:phase,service:remaining,speed:0,finishTime:null});
 };
 set('NOR',0,'stopped',1.6);set('PIA',-7.5,'entry',0);set('VER',0,'stopped',1.9);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(/shader error|INVALID_OPERATION/i.test(m.text()))errors.push(m.text());});
 let send:()=>void=()=>{};
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>ws.onMessage(raw=>{
  const m=JSON.parse(String(raw));if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));
  if(m.type==='join'){ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));send=()=>ws.send(JSON.stringify(fixture));send();}
 }));
 await page.setViewportSize({width:1920,height:1080});
 await page.goto('/?spectate&camera=pits&cameraDebug');
 await page.waitForFunction(()=>!!(window as any).__renderStats?.modelsReady);
 await page.evaluate(()=>{document.querySelector<HTMLElement>('#viewport')!.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:1000';});
 await expect(page.locator('#waiting')).toBeHidden();
 const label=page.locator('#camera-name');
 await expect(label).toHaveText('PIT BOX / RED BULL RACING');
 const out='artifacts/constructor-pits';await mkdir(out,{recursive:true});
 await page.locator('#viewport').screenshot({path:out+'/'+circuit+'-parallel.png'});
 set('VER',24,'exit',0);fixture.race.tick+=120;fixture.race.time+=1;send();
 await expect(label).toHaveText('PIT BOX / MCLAREN');
 await page.locator('#viewport').screenshot({path:out+'/'+circuit+'-stack.png'});
 expect(errors).toEqual([]);
});
