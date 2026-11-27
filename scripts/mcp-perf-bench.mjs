// Build first. Run with node --import tsx scripts/mcp-perf-bench.mjs before|after.
// BENCH_CASE can select a single case. Each case uses a fresh browser context.
import {profileHost,installProfile} from './mcp-render-profile.mjs';
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createRace} from '../src/race/physics.ts';
import {getTrack} from '../src/race/track.ts';
import {BOX_OFFSET,pitBox} from '../src/race/pit-service.ts';

const folder='artifacts/perf-check/'+(process.argv[2]??'local');
const port=Number(process.env.PORT??5747),origin='http://127.0.0.1:'+port;
const duration=Number(process.env.BENCH_SECONDS??22)*1000;
function observe(shortSuspend,startupDiagnostics){
 if(shortSuspend){const timeout=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===20000?350:ms,...args);}
 // Three's devtools event gives access to counters without changing the bundle.
 const frames=[],pending=new Set(),contexts=[];
 const probe={frames,contexts,rafRuns:0,pending:()=>pending.size,generation:0,visibleAt:null};
 window.bench=probe;
 if(startupDiagnostics&&window.AudioContext){
  const events=probe.audio=[],clock=()=>performance.now(),Context=window.AudioContext;
  const route=Context.prototype.setSinkId;
  if(route)Context.prototype.setSinkId=function(id){
   const start=clock();
   return route.call(this,id).then(()=>{events.push({route:id,start,end:clock()});},err=>{
    events.push({route:id,start,end:clock(),error:err.name});throw err;
   });
  };
  window.AudioContext=new Proxy(Context,{construct(ctor,args){
   const start=clock();
   try{return Reflect.construct(ctor,args);}finally{events.push({open:args,start,end:clock()});}
  }});
 }
 const raf=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);
 window.requestAnimationFrame=cb=>{
  const id=raf(t=>{pending.delete(id);probe.rafRuns++;cb(t);});
  pending.add(id);return id;
 };
 window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id);};
 function stats(renderer){
  return {...renderer.info.memory,programs:renderer.info.programs?.length??0,calls:renderer.info.render.calls,
   triangles:renderer.info.render.triangles,lost:renderer.getContext().isContextLost()};
 }
 let ref,disposedStats;
 probe.gpu=()=>{const renderer=ref?.deref();return disposedStats??(renderer?stats(renderer):null);};
 window.__THREE_DEVTOOLS__=new EventTarget();
 window.__THREE_DEVTOOLS__.addEventListener('observe',({detail:r})=>{
  if(!r.isWebGLRenderer)return;
  contexts.push(performance.now());ref=new WeakRef(r);disposedStats=null;frames.length=0;probe.generation++;probe.visibleAt=null;
  const visibility=new MutationObserver(()=>{
   if(r.domElement.isConnected&&r.domElement.style.visibility===''){
    probe.visibleAt=performance.now();visibility.disconnect();
   }
  });
  visibility.observe(r.domElement,{attributes:true,attributeFilter:['style']});
  const dispose=r.dispose;
  r.dispose=function(){visibility.disconnect();dispose.call(this);queueMicrotask(()=>{disposedStats={...stats(this),programNames:this.info.programs?.map(p=>p.name)};});};
  const render=r.render;
  r.render=function(scene,camera){
   const main=camera.name==='Race camera'&&this.getRenderTarget()===null;
   const result=render.call(this,scene,camera);
   if(main)frames.push(performance.now());
   return result;
  };
 });
}
function counters({metrics}){
 return Object.fromEntries(metrics.filter(m=>['JSHeapUsedSize','Nodes','JSEventListeners'].includes(m.name)).map(m=>[m.name,m.value]));
}
function pacing(times){
 const dt=times.slice(1).map((v,i)=>v-times[i]).sort((a,b)=>a-b);
 if(dt.length<2)throw Error('Missing presented 3D frames');
 const p=q=>dt[Math.ceil(dt.length*q)-1];
 return {avgFps:1000*dt.length/(times.at(-1)-times[0]),minFps:1000/p(1),p95FrameMs:p(.95),p99FrameMs:p(.99),maxFrameMs:p(1)};
}
let browser,host,profileDir,closing;
function close(){
 return closing??=(async()=>{
  try{await browser?.close();}
  finally{host?.kill('SIGTERM');if(profileDir)await rm(profileDir,{recursive:true,force:true});}
 })();
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void close().finally(()=>process.exit(signal==='SIGINT'?130:143));});
try{
 await mkdir(folder,{recursive:true});
 if(await fetch(origin+'/health').then(()=>true).catch(()=>false))throw Error('Benchmark port occupied');
 const env={...process.env,PORT:String(port),MCP_HOST_PORT:String(port+1),RACE_SPEED:'4',JEV_MOCK:'1',ENGINEER_MOCK:'1',MCP_TEST_STRATEGY:'0'};
 delete env.MCP_SERVER_URL;
 profileDir=await profileHost(process.env.BENCH_HOST_CWD??process.cwd(),process.env.BENCH_DIST);
 host=spawn(process.execPath,['--import','tsx','scripts/mcp-host.ts','--start-game'],{cwd:profileDir,env,stdio:'inherit'});
 let online=false;
 for(let i=0;i<100&&!online;i++){
  if(host.exitCode!==null)throw Error('Local MCP host exited with code '+host.exitCode);
  online=await fetch(origin+'/health').then(r=>r.ok).catch(()=>false);
  if(!online)await delay(100);
 }
 if(!online)throw Error('Local game did not start at '+origin);
 browser=await chromium.launch({channel:'chromium',args:['--disable-renderer-backgrounding','--disable-background-timer-throttling']});
 const hardware=(await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo')).gpu.devices;
 for(const [name,circuit,width,height,drive,cycles,stress] of [
  ['monza-inline','monza',420,840,false,0],['monza-expanded','monza',1100,850,false,0],
  ['vegas-inline','las-vegas',420,840,false,0],['vegas-expanded','las-vegas',1100,850,false,0],
  ['drive','monza',1100,850,true,1],['lifecycle','monza',420,840,false,5],
  ['monza-inline-stress','monza',420,840,false,0,true],['vegas-expanded-stress','las-vegas',1100,850,false,0,true],
  ['drive-stress','monza',1100,850,true,0,true]]){
  if(process.env.BENCH_CASE&&!process.env.BENCH_CASE.split(',').includes(name))continue;
  const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:stress?2:1});
  try{
   // Init script order across registrations is unspecified.
   await ctx.addInitScript({content:'('+observe.toString()+')('+String(cycles===5)+','+String(process.env.BENCH_STARTUP_PROFILE==='1')+');('+installProfile.toString()+')();'});
   const page=await ctx.newPage(),cdp=await ctx.newCDPSession(page);
   const errors=[];
   page.on('pageerror',error=>{errors.push(String(error));console.error(error);});
   page.on('console',msg=>{if(msg.type()==='error'&&/shader|WebGL|asset failed/i.test(msg.text())){errors.push(msg.text());console.error(msg.text());}});
   await cdp.send('Performance.enable');
   const startupProfile=process.env.BENCH_STARTUP_PROFILE==='1';
   if(startupProfile){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
   if(stress)await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   let frozen=null,lastSocket;
   await page.routeWebSocket('**/api/rooms/*/ws',socket=>{
    const upstream=socket.connectToServer();
    upstream.onMessage(raw=>{if(!frozen)socket.send(raw);lastSocket=socket;});
   });
   await page.goto('http://127.0.0.1:'+(port+1)+'/?circuit='+circuit+'&driver='+(drive?'human':'autopilot'));
   const app=page.frameLocator('#app-frame').frameLocator('iframe');
   await app.locator('#mcp-accept:enabled').waitFor();
   await app.locator('input[name=circuit][value="'+circuit+'"]').evaluate(input=>input.click());
   await app.locator('input[name=driver][value="'+(drive?'human':'autopilot')+'"]').evaluate(input=>input.click());
   await app.locator('#mcp-accept').click();
   if(width===1100)await app.locator('#mcp-fullscreen').evaluate(b=>b.click());
   const frame=page.frames().find(f=>f.parentFrame()?.parentFrame());
   const ready=()=>frame.waitForFunction(()=>document.querySelector('canvas[aria-label]')?.style.visibility===''&&window.bench.frames.length>=2,null,{timeout:45000});
   await ready();
   if(startupProfile){
    await frame.waitForFunction(()=>bench.frames.length>=30);
    const {profile}=await cdp.send('Profiler.stop');
    await writeFile(folder+'/'+name+'.cpuprofile',JSON.stringify(profile));
    const startup=await frame.evaluate(()=>({
     contexts:bench.contexts,audio:bench.audio,firstFrames:bench.frames.slice(0,30),visible:bench.visibleAt,origin:performance.timeOrigin,
     resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/assets/')).map(r=>({file:new URL(r.name).pathname.split('/').at(-1),start:r.startTime,end:r.responseEnd})),
    }));
    await writeFile(folder+'/'+name+'-startup.json',JSON.stringify(startup,null,2));
   }
   await frame.waitForFunction(()=>window.__raceState?.race.phase==='racing');
   if(await frame.evaluate(()=>Boolean(window.__driveDebug))!==drive)throw Error('Wrong view');
   const start=await frame.evaluate(()=>{bench.begin();return performance.now();});
   const samples=[];
   const deadline=Date.now()+duration;
   do{
    await delay(Math.min(1000,Math.max(1,deadline-Date.now())));
    const perf=await cdp.send('Performance.getMetrics');
    samples.push({gpu:await frame.evaluate(()=>bench.gpu()),...counters(perf)});
   }while(Date.now()<deadline);
   const times=await frame.evaluate(()=>window.bench.frames);
   const rendered=times.filter(t=>t>=start);
   const metrics=async()=>{
    await cdp.send('HeapProfiler.collectGarbage');
    const perf=await cdp.send('Performance.getMetrics');
    return {...counters(perf),gpu:await frame.evaluate(()=>window.bench.gpu())};
   };
   const profile=await frame.evaluate(()=>bench.profile());
   if(!profile.frameCount)throw Error('Race scene profiling failed');
   const result={name,profile,deviceScaleFactor:stress?2:1,cpuRate:stress?4:1,circuit,width,height,duration,chromium:browser.version(),hardware,samples,timeTo3DMs:await frame.evaluate(()=>bench.visibleAt),frame2Ms:times[1]-times[0],startupMaxFrameMs:pacing(times.slice(0,30)).maxFrameMs,...pacing(rendered),...await metrics(),cycles:[]};
   for(let i=0;i<cycles;i++){
    await page.locator('#app-frame').evaluate(f=>f.style.transform='translateY(200vh)');
    await frame.waitForFunction(()=>document.documentElement.dataset.mcpHidden==='true',null,{polling:100});
    await delay(cycles===5?1500:20900);
    const hidden=await frame.evaluate(()=>({runs:bench.rafRuns,pendingRaf:bench.pending(),lost:bench.gpu()?.lost??true,canvases:document.querySelectorAll('canvas[aria-label]').length}));
    await delay(500);
    hidden.rafDelta=await frame.evaluate(n=>bench.rafRuns-n,hidden.runs);
    const suspended=await metrics();
    await page.locator('#app-frame').evaluate(f=>f.style.transform='');
    await ready();
    await delay(3000);
    result.cycles.push({cycle:i+1,hidden,suspended,resumed:await metrics()});
   }
   if(!cycles&&!stress){
    // Freeze the same race positions, radio line and pit-service clock for image review.
    frozen=await frame.evaluate(()=>window.__raceState);
    const race=frozen.race=createRace(5,circuit);
    Object.assign(race,{time:85,tick:10200,phase:'racing',leader:'a',events:[]});
    for(const [i,c] of [race.cars.a,race.cars.b,...race.field].entries())Object.assign(c,{distance:900-12*i,offset:0,speed:0,pit:'none'});
    frozen.latestChatRadio={a:{team:'a',id:981,time:85,lap:1,speaker:'ENGINEER',source:'live',strategist:'chatgpt',text:'Hold position. The pit window is open.',responseMs:0}};
    for(const [label,camera] of [['broadcast','broadcast'],...(name==='monza-expanded'?[['tower-radio','side'],['cockpit','cockpit-a'],['pit-stop','pits']]:[])]){
     if(label==='tower-radio'||label==='cockpit')await app.locator('#grid-toggle').evaluate(b=>b.click());
     if(camera==='pits')Object.assign(race.cars.a,{distance:pitBox(getTrack(circuit),'a'),offset:BOX_OFFSET,pit:'stopped',pitTime:1.2,totalStop:2.6});
     frozen.race.radio=[frozen.latestChatRadio.a];
     race.tick++;lastSocket.send(JSON.stringify(frozen));
     await app.locator('button[data-camera="'+camera+'"]').evaluate(b=>b.click());
     await delay(850);
     await page.screenshot({path:folder+'/'+name+'-'+label+'.png'});
    }
   }
   if(errors.length)throw Error(errors.join('\n'));
   await writeFile(folder+'/'+name+'.json',JSON.stringify(result,null,2)+'\n');
   console.log(name,result.avgFps,result.cycles.length);
  }finally{await ctx.close();}
 }
}finally{await close();}
