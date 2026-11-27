// Run with node --import tsx scripts/pit-garage-review.mjs <origin> <output directory>.
// Both renderer revisions receive the same 1× service, queue and release sequence.
import {chromium} from '@playwright/test';
import {createRace,stepRace} from '../src/race/physics.ts';
import {getTrack} from '../src/race/track.ts';
import {pitBox,pitRoute} from '../src/race/pit-service.ts';
import {opponents} from '../src/race/grid.ts';
import {mkdir,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
const [origin,out]=process.argv.slice(2);
await mkdir(out,{recursive:true});
const circuit=process.env.RACE_CIRCUIT??'monza';
const track=getTrack(circuit),race=createRace(3,circuit);race.phase='racing';
for(const c of [race.cars.a,race.cars.b,...race.field])c.finishTime=0;
for(const [code,approach,speed] of [['NOR',2,6],['VER',2,6],['PIA',12,9]]){
 const i=opponents.findIndex(e=>e.code===code),box=pitBox(track,opponents[i].team),distance=box-approach+(i%2)*track.LENGTH;
 Object.assign(race.field[i],{finishTime:null,distance,offset:pitRoute(track,distance,box),speed,pit:'entry'});
}
const frames=[];for(let i=0;i<300;i++){
 frames.push(structuredClone(race));for(let n=0;n<4;n++)stepRace(race);
}
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(/shader error|INVALID_OPERATION/i.test(m.text()))errors.push(m.text());});
 await page.route('**/garage-review',r=>r.fulfill({contentType:'text/html',body:'<style>*{margin:0}#v{width:100vw;height:100vh}</style><div id="v"></div>'}));
 await page.goto(origin+'/garage-review');
 await page.evaluate(async({frames,middle,circuit})=>{
  const source=await fetch('/src/race/scene.ts').then(r=>r.text());
  const T=await import(source.match(/from ["']([^"']*\/three\.js[^"']*)["']/)[1]);
  const {createScene}=await import('/src/race/scene.ts'),{getTrack}=await import('/src/race/track.ts'),{circuitHeight}=await import('/src/race/elevation.ts');
  const track=getTrack(circuit),scene=createScene(document.querySelector('#v'),track);
  let lens,aim,eyeHeight,aimHeight,fov;
  function camera(eye,edge,up,target,offset,height,angle){
   lens=track.pointAt(eye,edge);aim=track.pointAt(target,offset);
   eyeHeight=circuitHeight(circuit,eye)+up;aimHeight=circuitHeight(circuit,target)+height;fov=angle;
  }
  camera(middle-2,9,9,middle-2,-23,.85,42);
  window.inspectPit=name=>{
   const bay=middle-14;
   if(name==='timing-stand')camera(bay-4.6,-6,3.0,bay,-13.28,1.89,44);
   if(name==='idle-gantries')camera(bay+28,4,10,bay+84,-23,2.55,47);
   if(name==='crew')camera(bay+4.8,-17.55,2.12,bay,-23,1.17,42);
  };
  const update=T.PerspectiveCamera.prototype.updateProjectionMatrix;
  T.PerspectiveCamera.prototype.updateProjectionMatrix=function(){
   if(this.name==='Race camera'){this.position.set(lens.x,eyeHeight,lens.z);this.lookAt(aim.x,aimHeight,aim.z);this.fov=fov;}
   return update.call(this);
  };
  scene.setMode('pits');
  await new Promise((ok,fail)=>{function warm(){scene.render(frames[0],performance.now());if(scene.info.modelError)fail(Error(scene.info.modelError));else if(scene.info.modelsReady)ok();else requestAnimationFrame(warm);}warm();});
  const output=document.createElement('canvas');output.width=innerWidth;output.height=innerHeight;
  const ctx=output.getContext('2d'),raceCanvas=document.querySelector('canvas');
  window.repairFrame=()=>{
   const frame=structuredClone(frames[35]),box=track.PIT_STOP-200+28*7;
   Object.assign(frame.cars.a,{finishTime:null,pit:'stopped',distance:box,offset:-23,pitTime:2.04,totalStop:5.1,speed:0,damage:[.95,.95,0,0]});
   for(const c of frame.field){c.pit='none';c.distance=box+100;}
   frames.push(frame);
   camera(box+5.1,-18.4,2.3,box,-23,1.10,47);
   return window.draw(frames.length-1,'image/png');
  };
  window.draw=(i,type)=>{
   scene.render(frames[i],50000+i*1000/30);
   ctx.drawImage(raceCanvas,0,0,output.width,output.height);
   return output.toDataURL(type,.89).split(',')[1];
  };
 },{frames,circuit,middle:(pitBox(track,'McLaren')+pitBox(track,'Red Bull Racing'))/2});
 const encoder=spawn('ffmpeg',['-loglevel','error','-y','-f','image2pipe','-framerate','30','-vcodec','mjpeg','-i','-','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',out+'/double-stack.mp4'],{stdio:['pipe','ignore','inherit']});
 const done=once(encoder,'close');
 for(let i=0;i<frames.length;i++){
  const img=await page.evaluate(i=>window.draw(i,'image/jpeg'),i);
  if(!encoder.stdin.write(Buffer.from(img,'base64')))await once(encoder.stdin,'drain');
  const still=i===5?'entry':i===35?'parallel':i===75?'exit':null;
  if(still)await writeFile(out+'/'+still+'.png',Buffer.from(await page.evaluate(i=>window.draw(i,'image/png'),i),'base64'));
 }
 encoder.stdin.end();if((await done)[0])throw Error('Video encoding failed');
 for(const name of ['timing-stand','idle-gantries','crew']){
  const png=await page.evaluate(name=>{window.inspectPit(name);return window.draw(35,'image/png');},name);
  await writeFile(out+'/'+name+'.png',Buffer.from(png,'base64'));
 }
 const repair=await page.evaluate(()=>window.repairFrame());
 await writeFile(out+'/wing-repair.png',Buffer.from(repair,'base64'));
 if(errors.length)throw Error('Capture failed '+errors.join('\n'));
}finally{await browser.close();}
