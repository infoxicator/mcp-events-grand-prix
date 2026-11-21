import {test,expect} from '@playwright/test';
import type {RaceState} from '../src/race/types';
import {mkdir,writeFile} from 'node:fs/promises';

for(const circuit of ['monza','las-vegas'] as const)test(`manual side camera holds a steady shot at ${circuit} through anchors, gaps, timers and overtakes`,async({browser,request})=>{
 const out=`artifacts/${process.env.SIDE_REVIEW_DIR||'steady-side/recordings'}`;await mkdir(out,{recursive:true});
 const links=await request.get('/api/default').then(r=>r.json());
 const fixture:RaceState=await request.get(`/api/rooms/${links.room}/status`).then(r=>r.json());
 fixture.speed=1;fixture.race.circuit=circuit;fixture.connected={a:true,b:true};fixture.race.phase='racing';fixture.race.events=[];fixture.mode='mock';fixture.paidCalls=0;
 const context=await browser.newContext({viewport:{width:1280,height:800},recordVideo:{dir:out,size:{width:1280,height:800}}});
 const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let start=0,timer:ReturnType<typeof setInterval>|undefined;
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>{ws.onMessage(raw=>{
  const m=JSON.parse(String(raw));if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));
  if(m.type==='join'){
   ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));
   const update=()=>{
    const t=start?(Date.now()-start)/1000:0,d=(circuit==='monza'?60:4250)+t*35;
    fixture.race.time=t;fixture.race.tick++;fixture.race.events=[{id:1+Math.floor(t),time:t,kind:'overtake',team:t%2<1?'a':'b',message:'Mock battle event: camera must hold its shot'}];
    for(const [id,c] of Object.entries(fixture.race.cars)){
     c.distance=d+(id==='a'?1:-1)*30*Math.sin(t*.5);c.offset=(id==='a'?-.8:.8)+Math.sin(t*6)*.25;
     c.speed=start?35:0;c.gear=7;c.steering=0;c.heading=0;c.acceleration=0;c.lateralG=0;
    }
    ws.send(JSON.stringify(fixture));
   };update();timer=setInterval(update,33);
  }
 });});
 try{
  await page.goto('/?spectate&camera=side&cameraDebug');await page.waitForFunction(()=>!!(window as any).__renderStats?.modelsReady);
  await page.evaluate(()=>{document.querySelector<HTMLElement>('#viewport')!.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:1000';});
  await page.waitForTimeout(500);start=Date.now();
  const samples=await page.evaluate(()=>new Promise<{time:number;position:number[];quaternion:number[];target:number[];label:string;fov:number}[]>(resolve=>{
   const samples:{time:number;position:number[];quaternion:number[];target:number[];label:string;fov:number}[]=[],start=performance.now();
   function frame(now:number){const s=(window as any).__renderStats;if(now-start>700)samples.push({time:now,position:s.cameraPosition,quaternion:s.cameraQuaternion,target:s.cameraTarget,label:s.cameraLabel,fov:s.cameraFov});if(now-start<13500)requestAnimationFrame(frame);else resolve(samples);}requestAnimationFrame(frame);
  }));
  let maxAngularRate=0,maxStep=0,maxLinearSpeed=0;
  for(let i=1;i<samples.length;i++){
   const a=samples[i-1],b=samples[i],dt=(b.time-a.time)/1000;
   const dot=Math.min(1,Math.abs(a.quaternion.reduce((n,v,j)=>n+v*b.quaternion[j],0)));
   maxAngularRate=Math.max(maxAngularRate,2*Math.acos(dot)/dt);
   const step=Math.hypot(...b.position.map((v,j)=>v-a.position[j]));maxStep=Math.max(maxStep,step);maxLinearSpeed=Math.max(maxLinearSpeed,step/dt);
  }
  const first=samples[0],last=samples.at(-1)!,travel=Math.hypot(...last.target.map((v,j)=>v-first.target[j]));
  await page.locator('#viewport').screenshot({path:`${out}/${circuit}-straight.png`});
  await writeFile(`${out}/${circuit}-motion.json`,JSON.stringify({circuit,samples,travel,maxAngularRate,maxStep,maxLinearSpeed,errors,paidCalls:fixture.paidCalls},null,2)+'\n');
  expect(samples.length).toBeGreaterThan(100);expect(travel).toBeGreaterThan(300);
  expect(maxAngularRate).toBeLessThan(.10);expect(maxLinearSpeed).toBeLessThan(100);
  expect([...new Set(samples.map(s=>s.label))]).toEqual(['SIDE / STABILISED']);expect([...new Set(samples.map(s=>s.fov))]).toEqual([48]);expect(errors).toEqual([]);expect(fixture.paidCalls).toBe(0);
 }finally{if(timer)clearInterval(timer);const video=page.video();await context.close();await video?.saveAs(`${out}/${circuit}-straight.webm`);await video?.delete();}
});
