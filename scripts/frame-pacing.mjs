// Run against a built local server. Snapshots come from the game integrator;
// each window renders the same 1x sequence with its normal UI and scene.
import {chromium} from '@playwright/test';
import {installGpuActivationLog} from './gl-activation-log.mjs';
import {traceHitches} from './chromium-hitch-trace.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRace,stepRace} from '../src/race/physics.ts';
import {pitBox,BOX_OFFSET,pitRoute} from '../src/race/pit-service.ts';
import {opponents} from '../src/race/grid.ts';
import {getTrack} from '../src/race/track.ts';

const origin=process.env.REVIEW_ORIGIN??'http://127.0.0.1:5286';
const out=process.env.REVIEW_OUT??'artifacts/slice-review';
let {room}=await fetch(origin+'/api/default').then(r=>r.json());
let status=await fetch(origin+'/api/rooms/'+room+'/status'),roomQuery='';
if(status.status===404){
 // A long-lived review server can still serve the build after its default
 // room expires. Create a separate fixture room, without resetting any seats.
 const created=await fetch(origin+'/api/rooms',{method:'POST',headers:{Origin:origin}});
 if(!created.ok)throw Error('Could not create a pacing fixture room ('+created.status+')');
 room=(await created.json()).room;roomQuery='&room='+encodeURIComponent(room);
 status=await fetch(origin+'/api/rooms/'+room+'/status');
}
if(!status.ok)throw Error('No pacing fixture state ('+status.status+')');
const fixture=await status.json();
const samples=[];
function framesFor(scenario){
 const circuit=scenario==='launch'?'monza':'las-vegas',track=getTrack(circuit),r=createRace(3,circuit);
 r.phase='racing';
 if(scenario==='strip'||scenario==='impact'){
  for(const [i,c] of [...Object.values(r.cars),...r.field].entries())Object.assign(c,{distance:3800-i*9,speed:65});
 }
 if(scenario==='pit-replay'){
  const box=pitBox(track,'Ferrari');
  Object.assign(r.cars.a,{distance:box-1.2,offset:BOX_OFFSET,pit:'entry',speed:3});r.cars.a.instruction.tyre='hard';
  r.cars.b.distance=box+170;
  for(const [i,c] of r.field.entries())Object.assign(c,{distance:box+25-i*10,speed:47});
 }
 if(scenario==='double-stack'){
  for(const c of [r.cars.a,r.cars.b,...r.field])c.finishTime=0;
  for(const [i,c] of Object.values(r.cars).entries())Object.assign(c,{distance:pitBox(track,'McLaren')-9-i*8,offset:-18});
  for(const [code,approach,speed] of [['NOR',2,6],['VER',2,6],['PIA',12,9]]){
   const i=opponents.findIndex(e=>e.code===code),box=pitBox(track,opponents[i].team),distance=box-approach+(i%2)*track.LENGTH;
   Object.assign(r.field[i],{finishTime:null,distance,offset:pitRoute(track,distance,box),speed,pit:'entry'});
  }
 }
 const frames=[];
 for(let i=0;i<120*10;i++){
  if(scenario==='impact'&&i===240)r.cars.a.intent.offset=16;
  stepRace(r);if(i%4===0)frames.push(structuredClone(r));
 }
 if(scenario==='double-stack'&&!frames.some(f=>f.field.filter(c=>c.pit==='stopped').length===2))throw Error('Workload missed simultaneous service');
 if(scenario==='pit-replay'&&!frames.some(f=>f.cars.a.pit==='stopped'))throw Error('Workload missed Ferrari service');
 if(scenario==='impact'&&!frames.some(f=>f.events.some(e=>e.kind==='collision'&&e.message.includes('BARRIER'))))throw Error('Impact workload missed the wall');
 return frames;
}
function summary(ms){
 const sorted=[...ms].sort((a,b)=>a-b),percent=p=>+sorted[Math.min(sorted.length-1,Math.floor(p*sorted.length))].toFixed(2);
 return {frames:ms.length,meanFps:+(1000*ms.length/ms.reduce((a,b)=>a+b,0)).toFixed(1),
  p50Ms:percent(.5),p95Ms:percent(.95),p99Ms:percent(.99),maxMs:percent(1),over25ms:ms.filter(n=>n>25).length,over33ms:ms.filter(n=>n>33.4).length,over50ms:ms.filter(n=>n>50).length};
}
const scenarios=process.env.REVIEW_SCENARIOS?.split(',')??['launch','strip','pit-replay'];
const viewCounts=process.env.REVIEW_VIEWS?.split(',').map(Number)??[1,3];
if(viewCounts.some(count=>count!==1&&count!==3))throw Error('Expected one or three windows');
for(const views of viewCounts)for(const scenario of scenarios){
 const frames=framesFor(scenario),browsers=[],pages=[],feeds=[];const errors=[],profilers=[];let timer;
 try{
  for(let i=0;i<views;i++){
   const browser=await chromium.launch({headless:false,args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--window-size=1940,1160']});browsers.push(browser);
   const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});pages.push(page);
   if(process.env.REVIEW_GL_EVENTS==='1')await page.addInitScript(installGpuActivationLog);
   if(process.env.REVIEW_COLD_PROFILE){
    const session=await page.context().newCDPSession(page);
    await session.send('Profiler.enable');await session.send('Profiler.start');profilers.push(session);
   }
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(trace=>{
    // Drive the real renderer at a 60 Hz target on variable-refresh displays.
    // Keep the native pulse stream for comparison, including missed frames.
    const nativeFrame=window.requestAnimationFrame.bind(window),callbacks=new Map();
    let handle=0,next=0,last=0;
    window.requestAnimationFrame=fn=>{callbacks.set(++handle,fn);return handle;};
    window.cancelAnimationFrame=id=>callbacks.delete(id);
    window.reviewFrames=[];window.nativeIntervals=[];window.transitions=[];window.slowNative=[];window.reviewStart=0;window.reviewEvents=[];const observedEvents=new Set();
    const contexts=new WeakSet(),getContext=HTMLCanvasElement.prototype.getContext;
    window.sceneContexts=0;
    HTMLCanvasElement.prototype.getContext=function(...args){
     const context=getContext.apply(this,args);
     if(args[0]==='webgl2'&&context&&!contexts.has(context)){contexts.add(context);window.sceneContexts++;}
     return context;
    };
    if(PerformanceObserver.supportedEntryTypes.includes('longtask')){
     window.reviewLongTasks=[];
     new PerformanceObserver(list=>{for(const task of list.getEntries()){
      if(window.reviewStart&&task.startTime>=window.reviewStart)window.reviewLongTasks.push({
       atMs:task.startTime-window.reviewStart,duration:task.duration,name:task.name});
     }}).observe({type:'longtask'});
    }
    let lastMode='',gl,ext,cubeFaces=0,lastPulse=0,lastDraw=null;
    window.reviewLongFrames=[];
    if(PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')){
     new PerformanceObserver(list=>{for(const entry of list.getEntries()){
      if(!window.reviewStart||entry.startTime<window.reviewStart)continue;
      window.reviewLongFrames.push({atMs:entry.startTime-window.reviewStart,duration:entry.duration,
       blockingDuration:entry.blockingDuration,
       renderStartMs:entry.renderStart-window.reviewStart,layoutStartMs:entry.styleAndLayoutStart-window.reviewStart,
       paintMs:entry.paintTime?entry.paintTime-window.reviewStart:null,presentedMs:entry.presentationTime?entry.presentationTime-window.reviewStart:null,
       scripts:entry.scripts.map(s=>({invoker:s.invoker,duration:s.duration}))});
     }}).observe({type:'long-animation-frame'});
    }
    let loading=null;window.bootNative=[];
    if(PerformanceObserver.supportedEntryTypes.includes('element')){
     new PerformanceObserver(list=>{
      for(const entry of list.getEntries())if(entry.identifier==='race-loading'&&entry.renderTime)window.loadingPaint=entry.renderTime;
     }).observe({type:'element',buffered:true});
    }
    const pending=[];
    if(trace){
     window.reviewDraws=[];
     const attach=WebGL2RenderingContext.prototype.framebufferTexture2D;
     WebGL2RenderingContext.prototype.framebufferTexture2D=function(target,attachment,face,texture,level){
      if(face>=this.TEXTURE_CUBE_MAP_POSITIVE_X&&face<=this.TEXTURE_CUBE_MAP_NEGATIVE_Z)cubeFaces++;
      return attach.call(this,target,attachment,face,texture,level);
     };
    }
    function pulse(now){
     const wall=performance.now(),delta=now-last;const mode=window.__renderStats?.cameraMode;
     if(last)window.nativeIntervals.push(delta);last=now;
     if(!window.readySeen&&window.nativeIntervals.length&&delta>0)window.bootNative.push({endingAtMs:now,ms:delta});
     if(!window.loadingSeen){
      loading??=document.querySelector('.model-loading');
      if(loading&&!loading.hidden&&loading.getBoundingClientRect().width>0)window.loadingSeen=now;
     }
     if(!window.readySeen&&window.__renderStats?.modelsReady)window.readySeen=now;
     if(window.reviewStart){
      const race=window.__raceState?.race;
      for(const e of race?.events??[]){
       if((e.kind==='collision'||e.kind==='overtake')&&!observedEvents.has(e.id)){
        observedEvents.add(e.id);window.reviewEvents.push({atMs:now-window.reviewStart,raceTime:e.time,tick:race.tick,kind:e.kind,message:e.message});
       }
      }
     }
     if(mode&&mode!==lastMode){window.transitions.push({atMs:now-window.reviewStart,from:lastMode,to:mode});lastMode=mode;}
     if(delta>33.4)window.slowNative.push({endingAtMs:now-window.reviewStart,ms:delta,wallGapMs:wall-lastPulse,dispatchLagMs:wall-now,visibility:document.visibilityState,lastDraw,mode,mirrorMs:window.__renderStats?.mirrorMs,mainMs:window.__renderStats?.mainMs});
     lastPulse=wall;
     if(now>=next-1){
      if(!next||now-next>17)next=now;
      next+=1000/60;
      const timed=trace&&window.reviewStart>0;
      const started=performance.now();
      let query=null;
      if(timed){
       if(!gl){gl=document.querySelector('#viewport canvas')?.getContext('webgl2');ext=gl?.getExtension('EXT_disjoint_timer_query_webgl2');}
       if(ext){
        while(pending.length&&gl.getQueryParameter(pending[0].query,gl.QUERY_RESULT_AVAILABLE)){
         const sample=pending.shift();
         if(!gl.getParameter(ext.GPU_DISJOINT_EXT))sample.draw.gpuMs=gl.getQueryParameter(sample.query,gl.QUERY_RESULT)/1e6;
         gl.deleteQuery(sample.query);
        }
        query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
       }
       cubeFaces=0;
      }
      const batch=[...callbacks];
      for(const [id,fn] of batch){if(callbacks.delete(id))fn(now);}
      lastDraw={atMs:now-window.reviewStart,cpuMs:performance.now()-started,tick:window.__raceState?.race.tick};
      if(timed){
       if(query)gl.endQuery(ext.TIME_ELAPSED_EXT);
       const draw={atMs:now-window.reviewStart,lagMs:started-now,cpuMs:performance.now()-started,cubeFaces,
        tick:window.__raceState?.race.tick,mainMs:window.__renderStats?.mainMs,mirrorMs:window.__renderStats?.mirrorMs};
       if(query)pending.push({query,draw});window.reviewDraws.push(draw);
      }
     }
     nativeFrame(pulse);
    }
    let previous=performance.now();
    function record(now){window.reviewFrames.push(now-previous);previous=now;requestAnimationFrame(record);}
    requestAnimationFrame(record);nativeFrame(pulse);
   },process.env.REVIEW_TRACE==='1');
   await page.routeWebSocket('**/api/rooms/*/ws',ws=>ws.onMessage(raw=>{const m=JSON.parse(String(raw));
    if(m.type==='ping')ws.send(JSON.stringify({type:'pong',sent:m.sent}));
    if(m.type==='join'){feeds[i]=ws;ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));
     ws.send(JSON.stringify({...fixture,race:frames[0],connected:{a:true,b:true},speed:1}));}
   }));
   const camera=(views===1?process.env.REVIEW_CAMERA:undefined)??(i===0?(scenario==='impact'?'detail':scenario==='strip'?'strip':'broadcast'):i===1?'cockpit-a':'cockpit-b');
   await page.goto(origin+'/?broadcast&cameraDebug&camera='+camera+roomQuery);
  }
  const startup=await Promise.all(pages.map(async page=>{
   await page.waitForFunction(()=>!!window.readySeen,{},{timeout:90000});
   return page.evaluate(()=>({ms:window.readySeen,loadingAt:window.loadingPaint??window.loadingSeen,loadingMethod:window.loadingPaint?'element paint':'first visible rAF',contexts:window.sceneContexts,intervals:window.reviewFrames.slice(),bootNative:window.bootNative,native:window.bootNative.map(f=>f.ms),slow:window.slowNative.filter(frame=>frame.ms>50&&frame.endingAtMs<=window.readySeen),canvas:[document.querySelector('#viewport canvas').width,document.querySelector('#viewport canvas').height]}));
  }));
  if(profilers.length){
   await mkdir(out,{recursive:true});
   await Promise.all(profilers.map(async(session,i)=>{
    const {profile}=await session.send('Profiler.stop');
    for(const n of profile.nodes)n.callFrame.url=n.callFrame.url.split(/[?#]/)[0];
    await writeFile(out+'/startup-'+views+'-'+scenario+'-'+i+'.json',JSON.stringify(profile));
    await session.detach();
   }));
  }
  await pages[0].waitForTimeout(700);
  const gpu=await (await browsers[0].newBrowserCDPSession()).send('SystemInfo.getInfo');
  const traceCase=process.env.REVIEW_CHROMIUM_TRACE;
  const allCaptures=(traceCase==='all'||traceCase==='all:'+views+':'+scenario)?await Promise.all(browsers.map(traceHitches)):null;
  const capture=(traceCase==='1'||traceCase===views+':'+scenario)?await traceHitches(browsers.at(-1)):null;
  for(const page of pages)await page.evaluate(()=>{window.reviewFrames=[];window.nativeIntervals=[];window.slowNative=[];window.transitions=[];window.reviewStart=performance.mark('jev-measure-start').startTime;});
  const start=performance.now();
  if(scenario==='pit-replay')feeds[0].send(JSON.stringify({type:'replay',frames:frames.slice(0,165)}));
  const tick=()=>{const idx=Math.min(frames.length-1,Math.floor((performance.now()-start)*.03)),msg=JSON.stringify({...fixture,race:frames[idx],connected:{a:true,b:true},speed:1});for(const ws of feeds)ws.send(msg);};
  timer=setInterval(tick,1000/30);tick();await pages[0].waitForTimeout(8000);
  if(scenario==='launch')await pages[0].waitForFunction(()=>window.transitions.some(c=>c.to==='tcam-a'),{},{timeout:12000});
  clearInterval(timer);
  const measured=await Promise.all(pages.map(p=>p.evaluate(()=>window.reviewFrames.slice(1))));
  const native=await Promise.all(pages.map(p=>p.evaluate(()=>window.nativeIntervals.slice(1))));
  if(errors.length)throw Error(errors.join('\n'));
  const result={views,scenario,cameraOverride:views===1?process.env.REVIEW_CAMERA:undefined,viewport:[1920,1080],targetHz:60,native:native.map(summary),nativeIntervalsMs:native,cuts:await Promise.all(pages.map(p=>p.evaluate(()=>({transitions:window.transitions,slow:window.slowNative,longTasks:window.reviewLongTasks,events:window.reviewEvents,gpuActivations:window.gpuActivations,longFrames:window.reviewLongFrames,draws:window.reviewDraws})))),gpu:gpu.gpu.devices.map(d=>d.deviceString),startup:startup.map(x=>({readyMs:Math.round(x.ms),loadingAtMs:x.loadingAt,nativeTimeline:x.bootNative,loadingTimestamp:x.loadingMethod,contexts:x.contexts,canvas:x.canvas,...summary(x.intervals.filter(x=>x>0)),native:summary(x.native),nativeAbove50:x.slow})),steady:measured.map(summary),intervalsMs:measured};
  if(allCaptures)result.chromiumWindows=await Promise.all(allCaptures.map((finish,i)=>finish(result.cuts[i].slow)));
  if(capture)result.chromium=await capture(result.cuts.at(-1).slow);
  samples.push(result);await mkdir(out,{recursive:true});await writeFile(out+'/frame-pacing.json',JSON.stringify(samples,null,2));console.log(views,scenario,result.steady);
 }finally{clearInterval(timer);await Promise.all(browsers.map(b=>b.close()));}
}
