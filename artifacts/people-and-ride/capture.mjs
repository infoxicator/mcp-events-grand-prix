import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const [port,out,items='marshal,crowd,crew,road,rear,ride,driver,normal']=process.argv.slice(2);
const b=await chromium.launch({headless:false,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{
 const p=await b.newPage({viewport:{width:960,height:600},deviceScaleFactor:1});const errors=[];
 p.on('pageerror',e=>errors.push(e.stack||e.message));p.on('requestfailed',r=>console.log('request',r.url().slice(0,190),r.failure()?.errorText));p.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+JSON.stringify(m.location()))});
 for(const item of items.split(',')){
  const [view,circuit='monza']=item.split(':');await mkdir(out+'/'+item.replace(':','-'),{recursive:true});
  await p.goto('http://127.0.0.1:'+port+'/artifacts/people-and-ride/stage.html?view='+view+'&angle=side&circuit='+circuit);
  await p.waitForFunction(()=>window.ready,{},{timeout:90000});
  await p.waitForLoadState('networkidle');
  const frames=['finish','marshal','crew','crowd','ride','driver'].includes(view)?48:1;
  for(let i=0;i<frames;i++){
   const d=2537+i*45/24;
   const args=['ride','driver'].includes(view)?[i/24,d,4.65+1.18*Math.sin(i/47*Math.PI)]:[i/24+1.1];
   await p.evaluate(a=>window.draw(...a),args);
   await p.locator('canvas').screenshot({path:out+'/'+item.replace(':','-')+'/'+String(i).padStart(3,'0')+'.jpg',type:'jpeg',quality:93});
  }
  console.log(item,frames);
 }
 if(errors.length)throw Error(errors.join('\n'));
}finally{await b.close()}
