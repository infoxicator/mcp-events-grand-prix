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
const track=getTrack('monza'),race=createRace(3,'monza');race.phase='racing';
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
 await page.evaluate(async({frames,middle})=>{
  const source=await fetch('/src/race/scene.ts').then(r=>r.text());
  const T=await import(source.match(/from ["']([^"']*\/three\.js[^"']*)["']/)[1]);
  const {createScene}=await import('/src/race/scene.ts'),{getTrack}=await import('/src/race/track.ts'),{circuitHeight}=await import('/src/race/elevation.ts');
  const track=getTrack('monza'),scene=createScene(document.querySelector('#v'),track);
  const lens=track.pointAt(middle-2,9),aim=track.pointAt(middle-2,-23),height=circuitHeight('monza',middle);
  const update=T.PerspectiveCamera.prototype.updateProjectionMatrix;
  T.PerspectiveCamera.prototype.updateProjectionMatrix=function(){
   if(this.far===5000){this.position.set(lens.x,height+9,lens.z);this.lookAt(aim.x,height+.85,aim.z);this.fov=42;}
   return update.call(this);
  };
  scene.setMode('pits');
  await new Promise((ok,fail)=>{function warm(){scene.render(frames[0],performance.now());if(scene.info.modelError)fail(Error(scene.info.modelError));else if(scene.info.modelsReady)ok();else requestAnimationFrame(warm);}warm();});
  window.draw=(i,type)=>{scene.render(frames[i],50000+i*1000/30);return document.querySelector('canvas').toDataURL(type,.89).split(',')[1];};
 },{frames,middle:(pitBox(track,'McLaren')+pitBox(track,'Red Bull Racing'))/2});
 const encoder=spawn('ffmpeg',['-loglevel','error','-y','-f','image2pipe','-framerate','30','-vcodec','mjpeg','-i','-','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',out+'/double-stack.mp4'],{stdio:['pipe','ignore','inherit']});
 const done=once(encoder,'close');
 for(let i=0;i<frames.length;i++){
  const img=await page.evaluate(i=>window.draw(i,'image/jpeg'),i);
  if(!encoder.stdin.write(Buffer.from(img,'base64')))await once(encoder.stdin,'drain');
  if(i===35)await writeFile(out+'/parallel.png',Buffer.from(await page.evaluate(i=>window.draw(i,'image/png'),i),'base64'));
 }
 encoder.stdin.end();if((await done)[0]||errors.length)throw Error('Capture failed '+errors.join('\n'));
}finally{await browser.close();}
