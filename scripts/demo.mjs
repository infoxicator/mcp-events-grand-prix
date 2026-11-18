import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22+ is required.');
const smoke=process.argv.includes('--smoke'),headless=!process.argv.includes('--headed')&&(smoke||process.env.DEMO_HEADLESS==='1');
const requestedMatchup=process.argv.find(a=>a.startsWith('--matchup='))?.split('=')[1];if(requestedMatchup&&!['jev-vs-jev','jev-vs-luna'].includes(requestedMatchup))throw new Error('Unknown race matchup');
const port=Number(process.env.PORT??5277),origin=`http://127.0.0.1:${port}`;
const contexts=[],folders=[];let server,stopping=false;
async function cleanup(){if(stopping)return;stopping=true;await Promise.allSettled(contexts.map(c=>c.close()));server?.kill('SIGTERM');await Promise.allSettled(folders.map(p=>rm(p,{recursive:true,force:true})));}
process.on('SIGINT',()=>void cleanup());process.on('SIGTERM',()=>void cleanup());
try{
  if(!existsSync(chromium.executablePath())){
    console.log('Installing Chromium for the three-window demo…');
    const installer=spawn(process.execPath,['node_modules/playwright/cli.js','install','chromium'],{stdio:'inherit'});
    await new Promise((resolve,reject)=>{installer.on('error',reject);installer.on('exit',code=>code===0?resolve():reject(new Error('Chromium install failed. Run npx playwright install chromium.')));});
  }
  // Refuse to attach to an unrelated process or silently take over an occupied port.
  if(await fetch(`${origin}/health`).then(()=>true).catch(()=>false))throw new Error(`Port ${port} is occupied. Stop the other server or set PORT=5278.`);
  server=spawn(process.execPath,['--import','tsx','server/index.ts'],{stdio:'inherit',env:{...process.env,...(requestedMatchup?{RACE_MATCHUP:requestedMatchup}:{}),JEV_MOCK:smoke?'1':process.env.JEV_MOCK??'1'}});
  let ready=false;for(let n=0;n<100;n++){if(server.exitCode!==null)throw new Error('Game server exited before startup.');try{const r=await fetch(`${origin}/health`);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!ready)throw new Error('Server did not become ready within 10 seconds.');
  let screenWidth=1440,screenHeight=960;
  const pages=[];
  for(const [index,seat] of ['a','spectate','b'].entries()){
    const folder=await mkdtemp(join(tmpdir(),'jev-grand-prix-'));folders.push(folder);
    const width=Math.max(410,Math.floor(screenWidth/3)),height=Math.max(720,screenHeight);
    const url=`${origin}/${seat==='spectate'?'?spectate':`?team=${seat}`}`;
    const context=await chromium.launchPersistentContext(folder,{headless,viewport:headless?{width:480,height:1000}:null,args:[`--app=${url}`,`--window-size=${width},${height}`,`--window-position=${index*width},0`,'--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});contexts.push(context);
    const page=context.pages().find(p=>p.url().startsWith(origin))??context.pages()[0]??await context.newPage();
    if(!page.url().startsWith(url))await page.goto(url);
    for(const blank of context.pages())if(blank!==page&&blank.url()==='about:blank')await blank.close();
    pages.push(page);
    if(index===0&&!headless){const size=await page.evaluate(()=>({width:screen.availWidth,height:screen.availHeight}));screenWidth=size.width;screenHeight=size.height;}
    if(!headless){try{const cdp=await context.newCDPSession(page);const {windowId}=await cdp.send('Browser.getWindowForTarget');await cdp.send('Browser.setWindowBounds',{windowId,bounds:{left:index*Math.floor(screenWidth/3),top:0,width:Math.max(410,Math.floor(screenWidth/3)),height:screenHeight,windowState:'normal'}});await cdp.detach();}catch{console.log(`Opened ${seat}; window positioning is unavailable on this desktop.`);}}
  }
  console.log('\nThree independent Chromium windows are connected: FERRARI | SPECTATOR | MERCEDES.\nRecord the spectator view; use Title sequence for the intro. Ctrl+C closes everything.\n');
  if(smoke){
    await pages[1].waitForFunction(()=>document.body.dataset.phase==='racing');
    await pages[1].waitForFunction(()=>window.__raceState?.intents.a>0&&window.__raceState?.intents.b>0);
    const health=await fetch(`${origin}/health`).then(r=>r.json());
    if(!health.connected.a||!health.connected.b)throw new Error('Player windows did not connect.');
    if(requestedMatchup&&health.matchup!==requestedMatchup)throw new Error('Requested matchup was not selected.');
    console.log(`DEMO SMOKE PASS: ${contexts.length} independent windows, both players connected, mock decisions visible, phase=racing, HTTP health OK.`);await cleanup();
  }else{
    await Promise.race(contexts.map(c=>new Promise(resolve=>c.once('close',resolve))));await cleanup();
  }
}catch(error){console.error(error.message);await cleanup();process.exitCode=1;}
