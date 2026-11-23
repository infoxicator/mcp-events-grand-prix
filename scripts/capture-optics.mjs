import {writeFile} from 'node:fs/promises';
export async function captureOptics({circuit,start,still,clip,draw,page,out,manifest}){
 const pass=process.env.OPTICS_PASS,seat=process.env.OPTICS_SEAT??'a';
 const save=async(name,frame,result)=>{
  manifest.stills[name]={frame,...result.meta};await writeFile(out+'/'+name+'.jpg',Buffer.from(result.bytes,'base64'));
 };
 async function sequence(name,fixture,count,keys,driver=seat){
  await start(fixture,driver);
  const trace=[];
  await clip(name,count,async f=>{
   const r=await draw(f),m=r.meta;
   trace.push({f,tick:m.tick,station:m.driverStation,steer:m.steering,brake:m.brake,g:m.lateralG,gear:m.gear,offset:m.offset,kerb:m.kerb});
   if(keys.includes(f))await save(name+'-'+f,f,r);
   return r;
  });
  if(fixture.startsWith('load-')){
   const peaks=[trace.reduce((a,b)=>a.steer<b.steer?a:b),trace.reduce((a,b)=>a.steer>b.steer?a:b)];
   // Decode peak stills from the recorded sequence to preserve camera/head history.
   manifest.clips[name].peaks=peaks;await writeFile(out+'/'+name+'-trace.json',JSON.stringify(trace));
  }
 }
 if(pass==='surface-probe'){
  await start('front');for(let f=0;f<101;f++)await page.evaluate(i=>window.drawShot(i),f);
  await page.evaluate(()=>{window.sampleLocations=[[1013/1920,527/1080],[1013/1920,529/1080],[1002/1920,531/1080],[995/1920,535/1080]];window.sampleShoulder=true});
  await still('sample-front',101);console.log(JSON.stringify(await page.evaluate(()=>window.shoulderHits)));
 }else if(pass==='peak'||pass==='probe'){
  for(const view of pass==='probe'?['onboard']:['onboard','exterior']){
   const name=seat+'-'+view;
   if(pass==='probe'){
    await start('matched-'+view,seat);
    for(let f=0;f<=120;f++){if(f===120){await page.evaluate(()=>{window.sampleShoulder=true});await still(name+'-120',f);console.log(await page.evaluate(()=>window.shoulderHits));}else await page.evaluate(i=>window.drawShot(i),f);}
   }else await sequence(name,'matched-'+view,182,[60,120,180]);
  }
 }else if(pass==='course'){
  const fix=circuit==='monza'?'approach':'strip';await sequence(circuit,fix,300,[40,110,235]);
 }else if(pass==='field'){
  await sequence('launch','grid',100,[30,60]);
  await sequence('transition','transition',260,[144,145,230,231]);
 }else if(pass==='six'){
  await sequence('six-constructors','six-cross',270,Array.from({length:6},(_,i)=>[i*45+14,i*45+34]).flat());
 }else if(pass==='skyline'){
  await start('wide-strip');await still('wide-strip',110);
 }else if(pass==='rear'){
  await sequence('rear-pack','rear-pack',100,[30,60,75]);
 }else if(pass==='load'){
  for(const driver of ['a','b'])for(const camera of ['cockpit','tcam'])await sequence(driver+'-'+camera,'load-'+camera,201,[],driver);
 }else if(pass==='hero'){
  await sequence('front','front',128,[100,101,102,110]);
  await page.evaluate(()=>window.studio());
  for(const s of ['a','b'])for(const angle of ['front','rear'])for(const finish of ['colour','clay']){
   const data=await page.evaluate(([s,a,f])=>{window.hero(s,a,f);return window.pixels('image/jpeg',.96)},[s,angle,finish]);
   await writeFile(out+'/'+s+'-'+angle+'-'+finish+'.jpg',Buffer.from(data,'base64'));
  }
 }else throw Error('Unknown optics capture '+pass);
 await writeFile(out+'/'+pass+'-'+circuit+'-'+seat+'.json',JSON.stringify(manifest,null,2));
}
