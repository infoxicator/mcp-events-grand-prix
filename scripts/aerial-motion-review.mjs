// Deterministic camera, race timeline and packet delivery for a matched A/B film.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const [origin,out]=process.argv.slice(2);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false});
try {
 for(const circuit of ['monza','las-vegas']){
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  page.on('console',msg=>{if(/Shader Error|INVALID_OPERATION/.test(msg.text()))errors.push(msg.text())});
  await page.route('**/motion-review',r=>r.fulfill({contentType:'text/html',body:'<style>*{margin:0}#v{width:100vw;height:100vh}</style><div id="v"></div>'}));
  await page.goto(origin+'/motion-review');
  await page.evaluate(async circuit=>{
   const mod=n=>import('/src/race/'+n+'.ts');
   const source=await fetch('/src/race/scene.ts').then(r=>r.text());
   const T=await import(source.match(/from ["']([^"']*\/three\.js[^"']*)["']/)[1]);
   const [{createScene},{createRace},{getTrack},network]=await Promise.all(['scene','physics','track','network'].map(mod));
   const track=getTrack(circuit),scene=createScene(document.querySelector('#v'),track);
   const base=createRace(3,circuit),station=circuit==='monza'?690:3710;
   base.phase='racing';
   const tickAt=i=>4*i+Math.floor(i/2);
   function state(tick){
    const race=structuredClone(base);race.time=tick/120;race.tick=tick;
    [race.cars.a,race.cars.b,...race.field].forEach((c,j)=>Object.assign(c,{distance:station+(j<2?tick:tick-tick%4)*60/120-j*6,offset:j%2?1.6:-1.6,speed:60,gear:7}));
    return {race,speed:1,physicsHz:120,snapshotHz:30};
   }
   scene.setMode('helicopter');
   await new Promise((ok,fail)=>{const warm=()=>{scene.render(base,performance.now());if(scene.info.modelError)fail(Error(scene.info.modelError));else if(scene.info.modelsReady)ok();else requestAnimationFrame(warm);};warm();});
   const interpolate=network.createInterpolator();
   let index=0,latest,receipt;
   const arrival=i=>tickAt(i)*1000/120+[0,16,0,56,23,0,6,0][i%8];
   const canvas=document.querySelector('canvas');
   const pixels=(type,quality)=>canvas.toDataURL(type,quality).split(',')[1];
   window.frame=f=>{
    const now=f*1000/60;
    while(arrival(index)<=now+.00001){
     latest=state(tickAt(index));receipt=Math.max(receipt??0,arrival(index));interpolate.push?.(latest,receipt);index++;
    }
    const race=interpolate(latest,receipt,now);
    scene.render(race,50000+now);
    return {station:race.cars.a.distance,fieldStation:race.field[0].distance,pixels:f>=30?pixels('image/jpeg',.88):undefined};
   };
   let shift=0;const update=T.PerspectiveCamera.prototype.updateProjectionMatrix;
   T.PerspectiveCamera.prototype.updateProjectionMatrix=function(){
    if(this.name==='Race camera'){this.position.x+=shift;window.clipNear=this.near;}
    return update.call(this);
   };
   window.probe=delta=>{
    // Same race, time, light and orientation. Only the lens translates 5 mm.
    shift=delta;scene.setMode('helicopter');scene.render(state(160).race,54000);
    return {pixels:pixels('image/png'),near:window.clipNear};
   };
  },circuit);
  const encoder=spawn('ffmpeg',['-loglevel','error','-y','-f','image2pipe','-framerate','60','-vcodec','mjpeg','-i','-','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',out+'/'+circuit+'.mp4'],{stdio:['pipe','ignore','inherit']});
  const done=once(encoder,'close'),stations=[],fieldStations=[];
  for(let f=0;f<210;f++){
   const {station,fieldStation,pixels}=await page.evaluate(f=>window.frame(f),f);
   if(pixels){stations.push(station);fieldStations.push(fieldStation);if(!encoder.stdin.write(Buffer.from(pixels,'base64')))await once(encoder.stdin,'drain');}
  }
  encoder.stdin.end();if((await done)[0]!==0)throw Error('Encoder failed');
  const samples=stations.slice(1).map((d,i)=>d-stations[i]);
  const probe=await page.evaluate(()=>{window.probe(0);return window.probe(0)});
  await writeFile(out+'/'+circuit+'.png',Buffer.from(probe.pixels,'base64'));
  const shifted=await page.evaluate(()=>window.probe(.005));
  await writeFile(out+'/'+circuit+'-shift.png',Buffer.from(shifted.pixels,'base64'));
  if(errors.length)throw Error(errors.join('\n'));
  const fieldSteps=fieldStations.slice(1).map((d,i)=>d-fieldStations[i]);
  const stats={speedMps:60,framesPerSecond:60,near:probe.near,minStep:Math.min(...samples),maxStep:Math.max(...samples),minFieldStep:Math.min(...fieldSteps),maxFieldStep:Math.max(...fieldSteps),stations,fieldStations};
  await writeFile(out+'/'+circuit+'.json',JSON.stringify(stats,null,2)+'\n');
  console.log(circuit,stats.near,stats.minStep,stats.maxStep);
  await page.close();
 }
}finally{await browser.close();}
