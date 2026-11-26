/** Local headed Mac GPU measurement. No provider requests; isolated mock server. */
import {chromium} from '@playwright/test';import {spawn} from 'node:child_process';import {writeFile} from 'node:fs/promises';
const uncapped=process.env.PERF_UNCAPPED==='1',independent=process.env.PERF_DEMO_PROCESSES==='1',browsers=[];
const single=process.env.PERF_SINGLE==='1',controllers=[];
async function connectSingleWindowDrivers(origin){
 // Both seats run the normal networking/decision loop with no extra WebGL windows.
 const {tsImport}=await import('tsx/esm/api');
 const {connect}=await tsImport('../src/race/network.ts',import.meta.url);
 const {WebSocket}=await import('ws');
 globalThis.WebSocket=class extends WebSocket {constructor(url){super(url,{origin});}};
 const links=await fetch(origin+'/api/default').then(r=>r.json());
 for(const team of ['a','b']){
  const token=new URLSearchParams(new URL(links[team]).hash.slice(1)).get('token');
  controllers.push(connect(team,{origin,room:links.room,token}));
 }
}
const views=single?['?spectate']:['?team=a','?team=b','?spectate'];
const port=Number(process.env.PORT??5577),origin=`http://127.0.0.1:${port}`;let server,browser;
try{if(await fetch(origin+'/health').then(()=>true).catch(()=>false))throw new Error(`Port ${port} is occupied`);server=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{env:{...process.env,PORT:String(port),JEV_MOCK:'1',ENGINEER_MOCK:'1',RACE_SPEED:'4'},stdio:'inherit'});for(let i=0;i<100;i++){if(await fetch(origin+'/health').then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
 if(single)await connectSingleWindowDrivers(origin);
 const launchOptions={headless:false,args:[...(uncapped?['--disable-frame-rate-limit','--disable-gpu-vsync']:[]),'--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']};browser=await chromium.launch(launchOptions);browsers.push(browser);if(independent)for(let i=1;i<views.length;i++)browsers.push(await chromium.launch(launchOptions));const cdp=await browser.newBrowserCDPSession(),gpu=await cdp.send('SystemInfo.getInfo');const contexts=await Promise.all(views.map((_,i)=>(browsers[i]??browser).newContext({viewport:{width:1100,height:850}}))),pages=await Promise.all(contexts.map(c=>c.newPage()));await Promise.all(pages.map((p,i)=>p.goto(origin+'/'+views[i])));await pages.at(-1).getByRole('button',{name:'Start race',exact:true}).click();await pages.at(-1).waitForFunction(()=>window.__raceState?.race.phase==='racing');await Promise.all(pages.map(p=>p.waitForFunction(()=>window.__renderStats?.modelsReady)));await pages.at(-1).waitForTimeout(3500);
 const samples=[];for(let i=0;i<50;i++){samples.push(await Promise.all(pages.map(p=>p.evaluate(()=>window.__renderStats))));await pages.at(-1).waitForTimeout(500);}
 const report={date:new Date().toISOString(),topology:single?'one broadcast window':independent?'three independent browser processes (demo topology)':'three contexts in one browser',framePacing:uncapped?'uncapped GPU capacity':'display-synchronised',gpu:gpu.gpu.devices.map(d=>d.deviceString),viewport:{width:1100,height:850},mode:'mock',circuit:process.env.RACE_CIRCUIT??'monza',samples,health:await fetch(origin+'/health').then(r=>r.json())};await writeFile(`artifacts/performance${single?'-single':''}${process.env.RACE_CIRCUIT==='las-vegas'?'-vegas':''}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));const averages=views.map((_,i)=>samples.reduce((sum,row)=>sum+row[i].fps,0)/samples.length);console.log(single?'Average FPS, Broadcast:':'Average FPS, Vector / Chaos / Broadcast:',averages.map(x=>x.toFixed(1)).join(' / '));const minimum=samples.reduce((min,row)=>Math.min(min,...row.map(view=>view.fps)),Infinity);console.log('Minimum sampled smoothed FPS:',minimum.toFixed(1));if(averages.some(f=>f<60)||minimum<60)throw new Error('Rendering below 60 FPS');
}finally{for(const controller of controllers)controller.close();await Promise.allSettled(browsers.map(b=>b.close()));server?.kill('SIGTERM');}
