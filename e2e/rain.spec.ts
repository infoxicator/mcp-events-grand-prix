import {expect,test,type WebSocketRoute} from '@playwright/test';
import sharp from 'sharp';
import type {RaceState} from '../src/race/types';

for(const circuit of ['monza','las-vegas'] as const){
 test(`onboard rain, tyre spray and drying in ${circuit}`,async({page,request},info)=>{
  const {room}=await request.get('/api/default').then(r=>r.json());
  const state:RaceState=await request.get(`/api/rooms/${room}/status`).then(r=>r.json());
  const race=state.race;
  state.speed=1;state.connected={a:true,b:true};
  race.circuit=circuit;race.phase='racing';race.events=[];
  race.control={rain:'dry',wetness:0,revision:0,change:''};
  const failures:string[]=[];
  page.on('pageerror',e=>failures.push(e.message));
  page.on('console',m=>{if((m.type()==='error'&&/shader|webgl/i.test(m.text()))||/GL_INVALID|WebGL: INVALID/i.test(m.text()))failures.push(m.text());});
  let feed:WebSocketRoute;
  function pose(t:number,speed:number){
   const d=(circuit==='monza'?160:4050)+t*55;
   Object.assign(race.cars.a,{distance:d,offset:0,speed,gear:6});
   Object.assign(race.cars.b,{distance:d+16,offset:.75,speed,gear:6});
   race.field.forEach((car,i)=>Object.assign(car,{distance:d+40+i*13,offset:i%2?1:-1,speed}));
  }
  pose(0,0);
  await page.routeWebSocket('**/api/rooms/*/ws',ws=>ws.onMessage(raw=>{
   const m=JSON.parse(String(raw));
   if(m.type==='join'){feed=ws;ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));ws.send(JSON.stringify(state));}
   if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));
  }));
  await page.setViewportSize({width:960,height:600});
  await page.goto('/?spectate&camera=cockpit-a&visor&cameraDebug');
  await page.waitForFunction(()=>(window as any).__renderStats?.modelsReady);
  await page.keyboard.press('b');
  await expect(page.locator('body')).toHaveClass(/clean-feed/);
  const stats=()=>page.evaluate(()=>(window as any).__renderStats as {rainDrops:number;sprayPackets:number;lensBeads:number});
  const send=()=>{race.tick++;feed.send(JSON.stringify(state));};
  // Rain reaching a stationary driver's visor on clear track, before any water
  // has accumulated on the road. There are no wheel or wake emitters.
  const field=race.field;
  race.field=[];race.cars.b.distance=race.cars.a.distance-100;
  Object.assign(race.control,{rain:'moderate',wetness:0});race.time+=1;send();
  await expect(page.locator('#viewport')).toHaveClass(/visor-edge/);
  await expect.poll(async()=>(await stats()).lensBeads).toBeGreaterThan(3);
  expect((await stats()).rainDrops).toBeGreaterThan(0);
  expect((await stats()).sprayPackets).toBe(0);
  await page.waitForTimeout(1400);
  const parked=info.outputPath('stationary-visor.png');
  await page.locator('#viewport').screenshot({path:parked});
  await info.attach('Stationary visor in moderate rain',{path:parked,contentType:'image/png'});
  race.field=field;
  // Replay the same approach for each exposure. End on the same camera pose.
  let previousDensity=0;
  for(const [rain,wetness] of [['light',.24],['moderate',.58],['heavy',.94]] as const){
   Object.assign(race.control,{rain,wetness});
   const start=Date.now(),base=race.time+3;
   for(let t=0;t<1.35;){
    t=Math.min(1.35,(Date.now()-start)/1000);
    race.time=base+t;pose(t,55);send();
    await new Promise(resolve=>setTimeout(resolve,33));
   }
   await expect.poll(async()=>(await stats()).rainDrops).toBeGreaterThan(previousDensity);
   await expect.poll(async()=>(await stats()).sprayPackets).toBeGreaterThan(0);
   await expect.poll(async()=>(await stats()).lensBeads).toBeGreaterThan(0);
   previousDensity=(await stats()).rainDrops;
   const path=info.outputPath(rain+'.png');
   await page.locator('#viewport').screenshot({path});
   await info.attach(rain,{path,contentType:'image/png'});
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(async()=>(await stats()).rainDrops).toBe(0);
  expect((await stats()).lensBeads).toBeGreaterThan(0);
  expect((await stats()).sprayPackets).toBeGreaterThan(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect.poll(async()=>(await stats()).rainDrops).toBe(previousDensity);
  race.control.rain='dry';race.time+=.05;send();
  await expect.poll(async()=>(await stats()).rainDrops).toBe(0);
  expect((await stats()).sprayPackets).toBeGreaterThan(0);
  pose(1.35,0);race.time+=3;send();
  await expect.poll(async()=>(await stats()).sprayPackets).toBe(0);
  // From a fixed external camera the only moving water is falling rain.
  // Compare the actual image against the same shot with motion reduced.
  await page.keyboard.press('b');
  await page.locator('button[data-camera="trackside"]').click();
  await page.keyboard.press('b');
  race.field=[];Object.assign(race.control,{rain:'heavy',wetness:0});race.time+=1;send();
  await expect.poll(async()=>(await stats()).rainDrops).toBeGreaterThan(0);
  expect(await stats()).toMatchObject({lensBeads:0,sprayPackets:0});
  async function movingFraction(){
   const clip={x:250,y:150,width:520,height:250};
   const pixels=async()=>sharp(await page.screenshot({clip})).removeAlpha().raw().toBuffer();
   const a=await pixels();
   await page.waitForTimeout(140);
   const b=await pixels();
   let changed=0;
   for(let i=0;i<a.length;i+=3)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>48)changed++;
   return changed/(clip.width*clip.height);
  }
  const falling=await movingFraction();
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(async()=>(await stats()).rainDrops).toBe(0);
  const background=await movingFraction();
  await info.attach('Falling rain pixel coverage',{body:JSON.stringify({falling,background}),contentType:'application/json'});
  expect(falling).toBeGreaterThan(background+.003);
  expect(failures).toEqual([]);
 });
}
