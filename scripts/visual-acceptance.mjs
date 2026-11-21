// Compare two Vite checkouts with identical state, camera, exposure and frame times.
// Run with node scripts/visual-acceptance.mjs <origin> <output-directory>.
import {captureOptics} from './capture-optics.mjs';
import {installStripMeter} from './strip-photometry.mjs';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const [origin,out]=process.argv.slice(2);
if(!origin||!out)throw Error('Expected origin and output directory');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false,args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
const manifest={width:1920,height:1080,fps:30,stills:{},clips:{}};
try{
 const monzaOnly=['REVIEW_GRID_ONLY','REVIEW_LAP_ONLY','REVIEW_DAMAGE_ONLY','REVIEW_DETAIL_ONLY','REVIEW_EXTRAS_ONLY'].some(key=>process.env[key]);
 for(const circuit of process.env.OPTICS_CIRCUIT?[process.env.OPTICS_CIRCUIT]:(process.env.REVIEW_METER||process.env.REVIEW_POOL_SEAT==='b')?['las-vegas']:monzaOnly?['monza']:['monza','las-vegas']){
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/shader error|INVALID_OPERATION/i.test(m.text()))errors.push(m.text())});
  await page.route('**/visual-review',r=>r.fulfill({contentType:'text/html',body:'<style>*{margin:0}#v{width:100vw;height:100vh}.model-loading{display:none}</style><div id=v></div>'}));
  if(process.env.REVIEW_METER)await page.addInitScript(installStripMeter);
  if((process.env.OPTICS_SEAT??process.env.REVIEW_POOL_SEAT)==='b')await page.addInitScript(()=>history.replaceState(null,'','?subject=b'));
  await page.goto(origin+'/visual-review');
  await page.evaluate(async id=>{
   const mod=n=>import('/src/race/'+n+'.ts');
   const source=await fetch('/src/race/scene.ts').then(r=>r.text());
   const T=await import(source.match(/from ["']([^"']*\/three\.js[^"']*)["']/)[1]);
   const [{createScene},{getTrack},{createRace,stepRace},{circuitHeight},{pitBox,pitRoute}]=await Promise.all(['scene','track','physics','elevation','pit-service'].map(mod));
   const {kerbHeight,wheelStations}=await mod('suspension');
   const track=getTrack(id),v=document.querySelector('#v'),scene=createScene(v,track);
   window.prepareStripMeter?.(T);
   const after=T.Scene.prototype.onAfterRender;
   T.Scene.prototype.onAfterRender=function(renderer,world,camera){
    after.apply(this,arguments);
    if(!window.sampleShoulder||camera.far!==5000)return;
    window.sampleShoulder=false;
    const caster=new T.Raycaster();caster.far=18;
    const close=[];world.traverseVisible(o=>{if(o.isMesh&&!o.isInstancedMesh&&o.parent&&o.parent.type!=='Scene')close.push(o);});
    window.shoulderHits=(window.sampleLocations??[[.055,.57]]).map(([x,y])=>{
     caster.setFromCamera(new T.Vector2(x*2-1,1-y*2),camera);
     return caster.intersectObjects(close,false).slice(0,4).map(h=>({name:h.object.name,mat:h.object.material.name,dist:h.distance,xyz:h.object.worldToLocal(h.point.clone()).toArray()}));
    });
   };
   const pt=(d,x,y)=>{const q=track.pointAt(d,x);return new T.Vector3(q.x,circuitHeight(id,d)+y,q.z)};
   let lastFrontDamage,lock=null,current='',state,script=[],tick=0;
   const original=T.PerspectiveCamera.prototype.updateProjectionMatrix;
   T.PerspectiveCamera.prototype.updateProjectionMatrix=function(){
    if(lock&&this.far===5000){this.position.copy(lock[0]);this.up.set(0,1,0);this.lookAt(lock[1]);this.fov=lock[2];}
    return original.call(this);
   };
   function mode(m){if(m!==current){scene.setMode(m);current=m;}}
   function base(d,speed){
    state=createRace(3,id);state.phase='racing';state.time=42;
    for(const [i,c] of [state.cars.a,state.cars.b,...state.field].entries())Object.assign(c,{distance:d-i*9,offset:i===0?0:i%2?2.7:-2.7,speed});
   }
   window.startShot=(name,seat='a')=>{
    lock=null;current='';script=[];tick=0;
    if(name==='launch'||name==='grid'||name==='rear-pack'||name==='six-cross'){state=createRace(3,id);state.phase='racing';}
    else base(id==='monza'?656:3430,id==='monza'?75:67);
    if(name==='pack'){
     base(id==='monza'?866:3841,62);const d=state.cars.a.distance;
     Object.assign(state.cars.a,{offset:-.7});Object.assign(state.cars.b,{distance:d+12,offset:.6});
     state.field.forEach((c,i)=>Object.assign(c,{distance:d+21+16*i,offset:i%2?-1.4:1.3}));
    }
    if(name.startsWith('profile-')||name.startsWith('quarter-')){
     const i=Number(name.split('-')[1]);state.field[i].distance=840;state.field[i].offset=0;
    }
    if(name==='lap')base(0,73);
    if(name==='approach'||name.startsWith('load-'))base(779,73);
    if(name.startsWith('load-')){
     state.field=[];Object.assign(state.cars[seat],{distance:779,offset:0});
     state.cars[seat==='a'?'b':'a'].distance=400;
    }
    if(name==='transition')base(780,60);
    if(name==='pool'){
     base(3657.5,65);
     if(seat==='b'){Object.assign(state.cars.b,{distance:3657.5,offset:0});Object.assign(state.cars.a,{distance:3648.5,offset:2.7});}
    }
    if(name.startsWith('overlap')){
     base(810,50);
     for(const [i,c] of state.field.entries()){c.distance=840-i*4.9;c.offset=(i%3-1)*1.35;}
     if(name==='overlap-wheels'){state.field.forEach((c,i)=>c.distance=620-i*7);[10,18,0,2].forEach((i,n)=>{state.field[i].distance=840-n*5.9;state.field[i].offset=(n%2-.5)*2.9;});}
    }
    if(name==='steer')base(830,0);
    if(name.startsWith('impact-')){
     // A short, genuinely simulated approach before each asymmetric contact.
     const [station,speed,gap,offset,rivalSpeed]={
      'impact-left':[750,72,44,1.6,15],'impact-right':[1120,86,44,-2.2,15],
      'impact-rear':[1120,21,-36,1.1,85]
     }[name];
     base(station,speed);state.field=[];
     Object.assign(state.cars.b,{distance:station+gap,offset,speed:rivalSpeed});
    }
    if(name==='service'){base(pitBox(track,'a')-1,3);state.field=[];Object.assign(state.cars.a,{offset:pitRoute(track,state.cars.a.distance,pitBox(track,'a')),pit:'entry',damage:[...lastFrontDamage]});}
    const snapshot=()=>structuredClone(state);
    script.push(snapshot());
    if(!['steer','pack'].includes(name)&&!name.startsWith('profile-')&&!name.startsWith('quarter-')){
     for(let f=1;f<=(name==='lap'?7200:300);f++){
      for(let k=0;k<4;k++){
       if(name.startsWith('load-')){
        const c=state.cars[seat];c.intent.offset=c.distance>845&&c.distance<963?4:0;
       }
       stepRace(state);
      }
      script.push(snapshot());
      if(name==='lap'&&state.cars.a.distance>=track.LENGTH)break;
     }
     if(name==='lap'){
      if(state.cars.a.distance<track.LENGTH)throw Error('T-cam lap did not finish');
      window.lapFrames=script.length;
     }
    }
    if(name==='impact-left')lastFrontDamage=script.at(-1).cars.a.damage;
    if(name.startsWith('matched-')&&seat==='a')for(const frame of script){
     const {a,b}=frame.cars;frame.cars={a:{...b,team:'a'},b:{...a,team:'b'}};
    }
    window.drawShot=(f,steering=0)=>{
     const r=script[Math.min(f,script.length-1)],a=r.cars.a,b=r.cars.b;
     lock=null;
     if(name.startsWith('matched-')){
      // Both constructors get the actual #63 trajectory from the reviewed onboard fixture.
      const c=r.cars[seat];
      if(name==='matched-onboard')mode('cockpit-'+seat);
      else if(name==='matched-edge'){mode('detail');lock=[pt(c.distance+13,c.offset-6.5,3.1),pt(c.distance,c.offset+2.5,.65),52];}
      else{mode('detail');lock=[pt(c.distance+5.4,c.offset+3.8,1.32),pt(c.distance,c.offset,.44),36];}
     }else if(name.startsWith('load-'))mode(name.slice(5)+'-'+seat);
     else if(name==='pool'){
      // Optical tracking rig at 65 m/s through the 3,690 m lamp station.
      // Keep lane, lens and car orientation identical on both builds.
      const focus=r.cars[seat];focus.distance=3657.5+65*f/30;focus.offset=-3.3;focus.heading=0;focus.speed=65;
      mode('detail');lock=[pt(focus.distance+5.4,focus.offset+3.8,1.32),pt(focus.distance,focus.offset,.44),36];
     }else if(name.startsWith('overlap')){
      const d=name==='overlap-wheels'?r.field[18].distance:r.field[1].distance;
      mode('detail');lock=name==='overlap-wheels'?[pt(d+28,12.8,2.3),pt(d,0,.54),23]:[pt(d+45,6.8,2.45),pt(d,0,.61),18];
     }else if(name==='steer'){r.cars[seat].steering=steering;mode('cockpit-'+seat);}
     else if(name==='rettifilo'||name==='lap'||name==='onboard')mode(name==='onboard'?'cockpit-b':'tcam-a');
     else if(name==='helmet'){mode('detail');lock=[pt(a.distance+1.6,a.offset+.7,1.38),pt(a.distance-.27,a.offset,.79),32];}
     else if(name==='approach'){
      mode('chase');lock=[pt(a.distance-7,a.offset+1.5,2.8),pt(a.distance+23,a.offset,.8),59];
     }else if(name==='transition'){
      mode(f<75?'chase':'trackside');
      if(f>=75){const lead=r.field[0];lock=[pt(991,7.7,1.5),pt(lead.distance,lead.offset,.48),39];}
     }else if(name==='front'){mode('detail');}
     else if(name==='strip'||name==='pack'){
      mode('trackside');const focus=b.distance>a.distance?b:a;
      const fixed=id==='monza'?905:3880;
      const eye=pt(fixed,track.trackHalfWidth(fixed)+1.15,1.38),target=pt(focus.distance,focus.offset,.55);
      lock=[eye,target,T.MathUtils.clamp(T.MathUtils.radToDeg(2*Math.atan(4.9/eye.distanceTo(target))),17,55)];
     }else if(name==='wide-strip'){
      mode('trackside');lock=[pt(3900,37,21),pt(3640,-38,36),58];
     }else if(name==='six-cross'){
      const car=r.field[13+Math.min(5,Math.floor(f/45))];
      const step=f%45,dist=22+step*.59;
      mode('trackside');lock=[pt(car.distance-dist*.945,car.offset-dist*.31,2.5+dist*.085),pt(car.distance,car.offset,.58),15.8];
     }else if(name==='rear-pack'){
      const tail=r.field.at(-1).distance;
      mode('trackside');lock=[pt(tail-76,-13,4.1),pt(tail+32,0,.70),13.5];
     }else if(name==='grid'){
      mode('trackside');lock=[pt(-155,18.5,8.1),pt(-72,0,.45),39];
     }else if(name==='launch'){
      mode('chase');const focus=a.distance;lock=[pt(focus-35,19,4.8),pt(focus-21,0,.52),43];
     }else if(name==='cross'){
      mode(f<90?'chase':'trackside');if(f>=90){const fixed=id==='monza'?920:3850;lock=[pt(fixed,8.2,1.4),pt(a.distance,a.offset,.6),34];}
     }else if(name.startsWith('quarter-')){
      mode('detail');lock=[pt(879,13.2,2.35),pt(840,0,.53),40];
     }else if(name.startsWith('profile-')){
      mode('detail');lock=[pt(887,5.7,1.4),pt(840,0,.53),31];
     }else if(name.startsWith('impact-')){
      mode('detail');const d=a.distance;
      const reverse=name==='impact-rear'?-1:1;
      const range=f<52?9:9+32*Math.sin(Math.PI*Math.min(1,(f-52)/110))**2;
      lock=[pt(d+reverse*range*.85,a.offset+Math.min(6.8,range*.64),1.55+range*.045),pt(d,a.offset,.46),f<52?33:30];
     }else if(name==='service')mode('pits');
     scene.render(r,50000+f*1000/30);
     let projected;
     if(name==='grid'||name==='rear-pack'||name==='six-cross'||name==='transition'&&lock){
      const camera=new T.PerspectiveCamera(lock[2],16/9,.06,5000);
      camera.position.copy(lock[0]);camera.lookAt(lock[1]);camera.updateMatrixWorld();
      projected=r.field.map((c,index)=>{
       const points=[];
       for(const z of [-2.72,2.85])for(const x of [-1,1])for(const h of [0,1.18]){
        const v=pt(c.distance+z,c.offset+x,h).project(camera);points.push([(1+v.x)*960,(1-v.y)*540]);
       }
       return {index,left:Math.floor(Math.min(...points.map(p=>p[0]))),right:Math.ceil(Math.max(...points.map(p=>p[0]))),
        top:Math.floor(Math.min(...points.map(p=>p[1]))),bottom:Math.ceil(Math.max(...points.map(p=>p[1])))};
      });
     }
     const driver=r.cars[seat],cs=Math.cos(driver.heading),sn=Math.sin(driver.heading);
     const kerb=name.startsWith('load-')?Math.max(...wheelStations.map(w=>kerbHeight(track,driver.distance+w.z*cs-w.x*sn,driver.offset-w.x*cs-w.z*sn))):undefined;
     return {projected,kerb,driverStation:r.cars[seat].distance,brake:r.cars[seat].brake,lateralG:r.cars[seat].lateralG,offset:r.cars[seat].offset,tick:r.tick,station:a.distance,steering:r.cars[seat].steering,damage:a.damage??[0,0,0,0],service:a.pit,gear:r.cars[seat].gear,ready:scene.info.modelsReady,error:scene.info.modelError};
    };
   };
   window.startShot('pack');await new Promise((ok,fail)=>{function warm(){const i=window.drawShot(0);if(i.error)fail(Error(i.error));else if(i.ready)ok();else requestAnimationFrame(warm);}warm();});
   window.pixels=(type,quality)=>v.querySelector('canvas').toDataURL(type,quality).split(',')[1];
   window.studio=async()=>{
    scene.dispose();v.replaceChildren();const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1920,1080);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;v.appendChild(renderer.domElement);
    const [{createShowroom},{createCar},{liveryAtlas}]=await Promise.all(['showroom','car-model','liveries'].map(mod));
    const room=createShowroom(renderer),atlas=liveryAtlas(),cars={a:createCar('a',track,atlas),b:createCar('b',track,atlas)};
    await Promise.all(Object.values(cars).map(c=>c.loaded));const camera=new T.PerspectiveCamera(36,16/9,.06,100);
    window.hero=(seat,angle,finish,panels)=>{
     const car=cars[seat];if(!car.ready)throw Error(car.error);
     for(const c of Object.values(cars))c.root.removeFromParent();room.scene.add(car.root);
     car.update({...state.cars[seat],speed:0,distance:0,steering:0,damage:undefined},false,true,50000);
     if(panels)car.update({...state.cars[seat],speed:0,distance:0,steering:0,pit:'none',damage:panels},false,false,50000);
     car.setFinish(finish);
     if(angle==='halo'){
      camera.position.set(.30,2.42,.90);camera.lookAt(0,.73,.035);
     }else if(angle==='wing'){
      camera.position.set(2.15,.57,3.18);camera.lookAt(.54,.20,2.46);
     }else if(angle==='diffuser'){
      camera.position.set(1.38,.53,-4.64);camera.lookAt(0,.36,-2.40);
     }else{camera.position.set(-3.7,1.55,angle==='front'?5.8:-5.8);camera.lookAt(0,.44,0);}
     renderer.render(room.scene,camera);
    };
   };
  },circuit);
  const start=(name,seat)=>page.evaluate(([n,s])=>window.startShot(n,s),[name,seat]);
  const capture=(frame,steering=0,quality=.90)=>page.evaluate(([f,s,q])=>{
   const meta=window.drawShot(f,s);
   return {meta,bytes:window.pixels('image/jpeg',q)};
  },[frame,steering,quality]);
  const still=async(name,f=0,steer=0)=>{
   const {meta,bytes}=await capture(f,steer,.96);
   manifest.stills[name]=meta;
   await writeFile(out+'/'+name+'.jpg',Buffer.from(bytes,'base64'));
  };
  const clip=async(name,count,draw)=>{
   const encoder=spawn('ffmpeg',['-loglevel','error','-y','-f','image2pipe','-framerate','30','-vcodec','mjpeg','-i','-','-c:v','libx264','-preset','fast','-crf','21','-maxrate','12M','-bufsize','8M','-pix_fmt','yuv420p','-movflags','+faststart',out+'/'+name+'.mp4']);
   let first,last;const events=[];
   for(let f=0;f<count;f++){
    const {meta,bytes}=await draw(f);if(!first)first=meta;
    if(last&&(String(meta.damage)!==String(last.damage)||meta.service!==last.service))events.push({frame:f,...meta});
    last=meta;if(!encoder.stdin.write(Buffer.from(bytes,'base64')))await once(encoder.stdin,'drain');
   }
   encoder.stdin.end();if((await once(encoder,'exit'))[0]!==0)throw Error('ffmpeg failed');
   manifest.clips[name]={frames:count,first,last,events};
  };
  const draw=f=>capture(f);
  const detailViews=async()=>{
   await page.evaluate(()=>window.studio());
   for(const seat of ['a','b'])for(const angle of ['halo','wing','diffuser']){
    const bytes=await page.evaluate(([s,a])=>{window.hero(s,a,'clay');return window.pixels('image/jpeg',.96);},[seat,angle]);
    await writeFile(out+'/hero-'+seat+'-'+angle+'-clay.jpg',Buffer.from(bytes,'base64'));
   }
  };
  if(process.env.OPTICS_PASS){await captureOptics({circuit,start,still,clip,draw,page,out,manifest});await page.close();if(errors.length)throw Error(errors.join('\n'));continue;}
  if(process.env.REVIEW_METER){
   const peak=process.env.OPTICS_PEAK_METER==='1';
   await start(peak?(process.env.OPTICS_EDGE?'matched-edge':'matched-exterior'):'pool',process.env.REVIEW_POOL_SEAT??'a');const readings={};
   let nextFrame=0;
   for(const f of peak?[60,120,180]:[5,15,25]){
    if(peak)await page.evaluate(([from,to])=>{for(let i=from;i<to;i++)window.drawShot(i)},[nextFrame,f]);
    nextFrame=f+1;
    if(process.env.OPTICS_EDGE)await still('edge-'+f,f);
    readings[f]=await page.evaluate(frame=>{window.measureStrip=true;const state=window.drawShot(frame);return {state,linear:window.stripMeterResult()};},f);
   }
   await writeFile(out+'/photometry.json',JSON.stringify(readings,null,2));
   await page.close();if(errors.length)throw Error(errors.join('\n'));continue;
  }
  if(process.env.REVIEW_NIGHT_MATERIALS){
   if(circuit==='las-vegas'){
    await start('pool',process.env.REVIEW_POOL_SEAT??'a');
    for(const f of [5,15,25])await still('lamp-'+f,f);
    await clip('lamp-pass',90,draw);
    if(process.env.REVIEW_POOL_SEAT!=='b'){await start('pack');await still('strip-paint');}
   }else{
    await start('overlap');await still('overlap',0);await still('overlap-moving',9);await start('overlap-wheels');await still('overlap-wheels',0);
    await start('front');await still('monza-finish',110);
   }
   await writeFile(out+'/shots.json',JSON.stringify(manifest,null,2));
   await page.close();if(errors.length)throw Error(errors.join('\n'));continue;
  }
  if(process.env.REVIEW_DETAIL_ONLY){await detailViews();await page.close();if(errors.length)throw Error(errors.join('\n'));continue;}
  if(process.env.REVIEW_LAP_ONLY){
   if(circuit==='monza'){
    await start('lap');await clip('monza-lap-tcam',await page.evaluate(()=>window.lapFrames),draw);
    await detailViews();
    await writeFile(out+'/lap-shots.json',JSON.stringify(manifest,null,2));
   }
   await page.close();if(errors.length)throw Error(errors.join('\n'));continue;
  }
  if(process.env.REVIEW_GRID_ONLY){
   if(circuit==='monza'){
    await start('grid');
    for(const frame of [0,30,60,85,115])await still('grid-'+frame,frame);
    await writeFile(out+'/grid-shots.json',JSON.stringify(manifest,null,2));
   }
   await page.close();if(errors.length)throw Error(errors.join('\n'));continue;
  }
  if(process.env.REVIEW_DAMAGE_ONLY){
   if(circuit==='monza'){
    for(const name of ['impact-left','impact-right','impact-rear','service']){
     await start(name);await clip(name,name==='service'?150:170,draw);
    }
    const damaged=manifest.clips['impact-left'].last.damage,repaired=manifest.clips.service.last.damage;
    if(!damaged.some(Boolean)||repaired.some(Boolean))throw Error('Expected simulated damage and a completed repair');
    await page.evaluate(()=>window.studio());
    let intact;
    for(const [name,panels] of [['intact',[0,0,0,0]],['impact',damaged],['repaired',repaired]]){
     const bytes=Buffer.from(await page.evaluate(values=>{
      window.hero('a','front','colour',values);return window.pixels('image/png');
     },panels),'base64');
     if(name==='intact')intact=bytes;
     if((name==='impact'&&bytes.equals(intact))||(name==='repaired'&&!bytes.equals(intact)))throw Error('Unexpected matched '+name+' frame');
     await writeFile(out+'/'+name+'.png',bytes);
    }
    await writeFile(out+'/damage-shots.json',JSON.stringify(manifest,null,2));
   }
   await page.close();if(errors.length)throw Error(errors.join('\n'));continue;
  }
  if(circuit==='monza'){
   for(const name of ['approach','transition']){
    await start(name);await still('monza-'+name,50);await clip('monza-'+name,300,draw);
   }
   for(const i of [0,1,2]){await start('quarter-'+i);await still('quarter-'+i);}
  }
  if(process.env.REVIEW_EXTRAS_ONLY){if(circuit==='monza')await writeFile(out+'/approach-shots.json',JSON.stringify(manifest,null,2));await page.close();if(errors.length)throw Error(errors.join('\n'));continue;}
  for(const name of circuit==='monza'?['launch','rettifilo','front','cross']:['strip','onboard']){
   await start(name);await still(circuit+'-'+name,name==='launch'?85:110);
   if(['rettifilo','strip'].includes(name)){await still(circuit+'-'+name+'-entry',40);await still(circuit+'-'+name+'-exit',235);}
   await clip(circuit+'-'+name,300,draw);
  }
  await start('pack');await still(circuit+'-pack');
  if(circuit==='monza'){
   await start('helmet');await still('reverse-tcam');
   for(const i of [0,1,2]){await start('profile-'+i);await still('field-'+i);}
   for(const seat of ['a','b']){
    await start('steer',seat);for(const [k,v] of [['centre',0],['half-left',-.21],['left',-.42],['half-right',.21],['right',.42]])await still('steer-'+seat+'-'+k,0,v);
    await clip('steer-'+seat,181,f=>capture(f,.42*Math.sin(f*Math.PI/90)));
   }
   for(const name of ['impact-left','impact-right','impact-rear','service']){
    await start(name);await clip(name,name==='service'?150:170,draw);
   }
   await page.evaluate(()=>window.studio());
   for(const seat of ['a','b'])for(const angle of ['front','rear'])for(const finish of ['colour','clay']){
    const bytes=await page.evaluate(([s,a,f])=>{window.hero(s,a,f);return window.pixels('image/jpeg',.96);},[seat,angle,finish]);
    await writeFile(out+'/hero-'+seat+'-'+angle+'-'+finish+'.jpg',Buffer.from(bytes,'base64'));
   }
  }
  if(errors.length)throw Error(errors.join('\n'));
  await page.close();console.log(circuit,'captured');await writeFile(out+'/shots.json',JSON.stringify(manifest,null,2));
 }
}finally{await browser.close();}
