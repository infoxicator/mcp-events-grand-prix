// Capture the production HUD using controlled broadcast snapshots and a live local drive.
// Run against a built game and its MCP test host: node scripts/ui-review.mjs GAME HOST OUT
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
const {getTrack}=await tsImport('../src/race/track.ts',import.meta.url);

const [game,host,out='artifacts/run6-ui-review']=process.argv.slice(2);
if(!game||!host)throw Error('Expected game origin, MCP host origin and optional output directory');
await mkdir(out,{recursive:true});
const {room}=await fetch(game+'/api/default').then(r=>r.json());
const initial=await fetch(game+'/api/rooms/'+room+'/status').then(r=>r.json());
const browser=await chromium.launch({headless:false});
const layout=[],errors=[];
const desktop={width:1440,height:900},standard={width:1280,height:720},benchmark={width:1100,height:850};
function monitor(page){
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(/shader error|INVALID_OPERATION/i.test(m.text()))errors.push(m.text());});
}
async function capture(page,name,folder=out){
 await mkdir(folder,{recursive:true});
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:join(folder,name+'.png'),animations:'allow'});
 console.log(name,page.viewportSize());
}
async function broadcast(circuit){
 const page=await browser.newPage({viewport:desktop});
 monitor(page);
 const state=structuredClone(initial),r=state.race;
 Object.assign(state,{mode:'mock',connected:{a:true,b:true},speed:1});
 Object.assign(r,{circuit,phase:'racing',time:105,tick:12600,events:[]});
 const distance=getTrack(circuit).LENGTH+(circuit==='monza'?866:3841);
 for(const [i,c] of [r.cars.a,r.cars.b,...r.field].entries()){
  Object.assign(c,{distance:distance+(i===0?0:i===1?-9:27-i*11),offset:i%2?-1.1:1.2,speed:65,lap:1});
 }
 for(const c of Object.values(r.cars))Object.assign(c,{rpm:10800,speedTrap:313,gear:6,throttle:.87,brake:0,ers:72,tyreAge:1.4,wear:.085,temperature:90,lapStart:83,lastLap:83.682,bestLap:83.682,pit:'none',splitColours:['purple','green','yellow']});
 let feed;
 const send=()=>{r.tick+=12;r.time+=.1;feed.send(JSON.stringify(state));};
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>ws.onMessage(raw=>{
  const msg=JSON.parse(String(raw));
  if(msg.type==='join'){feed=ws;ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));send();}
  if(msg.type==='ping')ws.send(JSON.stringify({type:'pong',sent:msg.sent}));
 }));
 try{
  await page.goto(game+'/?spectate&camera=broadcast');
  await page.waitForFunction(()=>window.__renderStats?.modelsReady);
  for(let i=0;i<61;i++){
   r.cars.a.speed=61+7*Math.cos(i/9)+2.2*Math.sin(i/4);
   send();await page.waitForTimeout(110);
  }
  for(const size of [desktop,standard]){
   const folder=size===desktop?out:join(out,'1280x720');
   await page.setViewportSize(size);
   r.phase='racing';r.time=111;for(const c of [r.cars.a,r.cars.b,...r.field])c.finishTime=null;
   send();
   for(const [camera,name] of circuit==='monza'?[['broadcast','broadcast-monza'],['cockpit-a','cockpit-monza'],['tcam-a','tcam-monza'],['showroom','showroom']]:[['broadcast','broadcast-vegas']]){
    await page.locator('button[data-camera="'+camera+'"]').click();
    send();await page.waitForTimeout(600);
    if(camera!=='showroom'){
     const metrics=await page.evaluate(()=>{
      const rect=s=>document.querySelector(s).getBoundingClientRect();
      const rows=[...document.querySelectorAll('.camera-controls button')].filter(b=>b.offsetWidth).map(b=>b.getBoundingClientRect().y);
      return {railTop:rect('.camera-controls').top,canvasBottom:rect('#viewport canvas').bottom,rows:[...new Set(rows)],telemetryBottom:rect('.telemetry-strip').bottom};
     });
     layout.push({name,...size,...metrics});
     assert.equal(metrics.rows.length,1,name+' camera rail must stay on one row');
     assert(metrics.railTop>=metrics.canvasBottom,name+' camera controls entered the picture');
     if(camera==='tcam-a')await page.locator('.tcam-timing').waitFor({state:'visible'});
    }
    await capture(page,name,folder);
    if(camera==='showroom')await page.locator('#exit-studio').click();
   }
   if(circuit==='monza'){
    const cars=[r.cars.a,r.cars.b,...r.field],grid=[initial.race.cars.a,initial.race.cars.b,...initial.race.field];
    const running=cars.map(c=>({...c}));
    cars.forEach((c,i)=>Object.assign(c,grid[i]));
    r.phase='lights';r.time=0;r.countdown=2;send();await page.locator('#lights').waitFor({state:'visible'});
    assert.equal(await page.locator('#lights i.lit').count(),4);await capture(page,'lights-gantry',folder);
    cars.forEach((c,i)=>Object.assign(c,running[i]));
    r.phase='finished';r.time=280;for(const [i,c] of [r.cars.a,r.cars.b,...r.field].entries())c.finishTime=252.63+i*1.28;
    send();await page.locator('#results').waitFor({state:'visible'});
    assert.equal(await page.locator('.result-row').count(),22);await capture(page,'results-screen',folder);
   }
  }
  r.phase='racing';send();
  await page.locator('#viewport').evaluate(v=>Object.assign(v.style,{position:'fixed',inset:0,width:'100vw',height:'100vh',zIndex:1000}));
  await page.locator('button[data-camera="side"]').click({timeout:3000});
  const fullscreen=await page.locator('.camera-controls').boundingBox();
  assert(fullscreen && fullscreen.y+fullscreen.height<=page.viewportSize().height,'Fullscreen camera rail outside screen');
  layout.push({name:'fullscreen-'+circuit,...fullscreen});
 }finally{await page.close();}
}
async function drive(hudOnly=false){
 const page=await browser.newPage({viewport:desktop});monitor(page);
 try{
  await page.goto(game+'/?drive&circuit=monza');
  await page.waitForFunction(()=>!document.querySelector('#drive-start-btn')?.disabled);
  for(const size of hudOnly?[]:[desktop,standard]){
   await page.setViewportSize(size);await capture(page,'drive-lobby',size===desktop?out:join(out,'1280x720'));
  }
  await page.locator('#drive-start-btn').click();
  await page.waitForFunction(()=>window.__raceState?.race.phase==='racing');
  await page.locator('#drive-cam-btn').click();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1800);
  for(const size of hudOnly?[standard]:[standard,benchmark,desktop]){
   await page.setViewportSize(size);
   for(const tab of ['pit','room','car']){
    await page.locator('button[data-mfd="'+tab+'"]').click();
    const metrics=await page.evaluate(()=>{
     const edge=s=>{const {top,bottom}=document.querySelector(s).getBoundingClientRect();return {top,bottom};};
     const code=document.querySelector('.is-player .drive-st-code');
     const label=document.createRange();label.selectNodeContents(code.firstChild);
     const text=label.getBoundingClientRect(),badge=code.querySelector('small').getBoundingClientRect();
     const inline=text.right<=badge.left+1 && text.top<badge.bottom && badge.top<text.bottom;
     return {inline,timing:edge('.drive-timing'),lastRow:edge('.drive-st-row:last-child'),map:edge('.drive-minimap'),mfd:edge('.drive-mfd')};
    });
    layout.push({name:'drive',tab,...size,...metrics});
    assert(metrics.inline,'Player badge wraps below the driver code');
    assert(metrics.timing.bottom<=metrics.map.top && metrics.map.bottom<=metrics.mfd.top,'Drive overlays overlap');
    assert(metrics.lastRow.bottom<=metrics.timing.bottom+1,'Standings cropped');
   }
   await capture(page,'drive-hud-'+size.width+'x'+size.height);
  }
  await page.keyboard.up('KeyW');
 }finally{await page.close();}
}
async function review(){
 if(process.env.REVIEW_DRIVE_HUD){await drive(true);return;}
 await broadcast('monza');await broadcast('las-vegas');await drive();
 const page=await browser.newPage({viewport:desktop});monitor(page);
 await page.goto(host+'/');
 const app=page.frameLocator('#app-frame').frameLocator('iframe');
 await app.locator('html[data-mcp-ready=true]').waitFor({state:'attached'});
 if(!await app.locator('#mcp-menu').isVisible())await app.locator('#mcp-menu-toggle').click();
 await app.locator('#mcp-setup').waitFor({state:'visible'});
 for(const size of [desktop,standard]){
  await page.setViewportSize(size);await capture(page,'mcp-setup',size===desktop?out:join(out,'1280x720'));
 }
}
try{
 await review();
 assert.deepEqual(errors,[]);
 await writeFile(join(out,'layout-checks.json'),JSON.stringify({layout,errors},null,2)+'\n');
}finally{await browser.close();}
