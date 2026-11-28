import * as T from 'three';
import type {RenderRace} from './scene';
import type {Track} from './track';
import {contactNames} from './grid';

export function circuitSignals(scene:T.Scene,track:Track,heightAt:(station:number)=>number){
 const lenses:T.MeshStandardMaterial[]=[],panels:T.MeshStandardMaterial[]=[];
 const make=(w:number,h:number)=>{
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;return {ctx:canvas.getContext('2d')!,map};
 };
 const tower=make(192,384),board=make(192,96),station=track.LENGTH-40,point=track.pointAt(station,16.6),t=track.tangentAt(station);
 board.map.flipY=false;
 const screen=new T.Mesh(new T.PlaneGeometry(1.55,5.4),new T.MeshBasicMaterial({map:tower.map,side:T.DoubleSide}));
 screen.position.set(point.x,heightAt(station)+8,point.z);screen.rotation.y=Math.atan2(t.x,t.z)+Math.PI/2;scene.add(screen);
 const live=make(512,224),screens:T.Mesh[]=[],support=new T.MeshStandardMaterial({color:'#30383a',roughness:.65});
 const imageMaterial=new T.MeshBasicMaterial({map:live.map});
 const televisionSites:T.Vector3[]=[];
 for(const d of (track.night?[1520,3840,track.LENGTH-680]:[1010,4180,track.LENGTH-840])){
  const site=track.pointAt(d,-40),orientation=track.tangentAt(d),floor=heightAt(d);
  for(const [geometry,mat,h] of [[new T.BoxGeometry(.65,6.2,.65),support,3.1],[new T.PlaneGeometry(8.8,3.85),imageMaterial,6.9]] as const){
   const mesh=new T.Mesh(geometry,mat);mesh.position.set(site.x+orientation.z*(mat===support?.45:0),floor+h,site.z-orientation.x*(mat===support?.45:0));mesh.rotation.y=Math.atan2(-orientation.z,orientation.x);scene.add(mesh);screens.push(mesh);
   if(mat===imageMaterial)televisionSites.push(mesh.position);
  }
 }
 const outline=Array.from({length:144},(_,i)=>track.pointAt(track.LENGTH*i/144));
 const minX=Math.min(...outline.map(p=>p.x)),minZ=Math.min(...outline.map(p=>p.z));
 const scale=Math.min(215/(Math.max(...outline.map(p=>p.x))-minX),172/(Math.max(...outline.map(p=>p.z))-minZ));
 const monitors=make(512,256);monitors.map.flipY=false;
 const wallStart=track.pointAt(track.PIT_STOP-200+3*28,-13),wallEnd=track.pointAt(track.PIT_STOP-200+13*28,-13);
 const wallStartY=heightAt(track.PIT_STOP-200+3*28)+2,wallEndY=heightAt(track.PIT_STOP-200+13*28)+2;
 const wallX=wallEnd.x-wallStart.x,wallZ=wallEnd.z-wallStart.z,wallLengthSq=wallX*wallX+wallZ*wallZ;
 const trace=new Float32Array(96),dot={x:0,z:0},route=new Path2D();
 const mapScale=scale*.63;
 for(const [i,p] of outline.entries()){
  const x=297+(p.x-minX)*mapScale,y=18+(p.z-minZ)*mapScale;
  if(i)route.lineTo(x,y);else route.moveTo(x,y);
 }
 route.closePath();
 let traceIndex=0,lastWall=-Infinity,last='',lastSecond=-1;
 const exitLamps:Partial<Record<'PitExitStop'|'PitExitGo'|'PitExitBlue',T.MeshStandardMaterial>>={};
 const ranks=contactNames.map((code,i)=>({code,index:i,distance:0}));
 const leaderRoute=new Path2D();
 outline.forEach((p,i)=>{const x=274+(p.x-minX)*scale,y=40+(p.z-minZ)*scale;if(i)leaderRoute.lineTo(x,y);else leaderRoute.moveTo(x,y);});leaderRoute.closePath();
 const nearExit=(d:number)=>track.wrap(track.PIT_EXIT-d)<120;
 const byDistance=(a:typeof ranks[number],b:typeof ranks[number])=>b.distance-a.distance;
 let lastExit=-Infinity,lastTelevision=-Infinity;
 function televisionDue(camera:T.Vector3,now:number){
  if(lastTelevision===-Infinity||import.meta.env.MCP_APP!=='true')return true;
  if(now>=lastTelevision&&now-lastTelevision<500)return false;
  for(const site of televisionSites)if(site.distanceToSquared(camera)<600**2)return true;
  return false;
 }
 function updateWall(r:RenderRace,camera:T.Vector3,now:number){
  const along=T.MathUtils.clamp(((camera.x-wallStart.x)*wallX+(camera.z-wallStart.z)*wallZ)/wallLengthSq,0,1);
  if((camera.x-wallStart.x-along*wallX)**2+(camera.z-wallStart.z-along*wallZ)**2+(camera.y-wallStartY-along*(wallEndY-wallStartY))**2>=120**2)return;
  if(now>=lastWall&&now-lastWall<(import.meta.env.MCP_APP==='true'?500:250))return;
  lastWall=now;
  const ctx=monitors.ctx;ctx.fillStyle='#0b151e';ctx.fillRect(0,0,512,256);ctx.fillStyle='#76d7cf';ctx.font='bold 16px monospace';
  ctx.fillText('LIVE TIMING',8,19);ctx.fillText('CIRCUIT GPS',263,19);ctx.fillText('SPEED  /  KM/H',8,148);ctx.fillText('PIT STRATEGY',263,148);
  ctx.drawImage(tower.ctx.canvas,6,42,180,199,8,24,225,101);
  ctx.strokeStyle='#718a9a';ctx.lineWidth=2;ctx.stroke(route);
  const a=r.cars.a,b=r.cars.b;
  for(let i=0;i<2+(r.field?.length??0);i++){
   const car=i===0?a:i===1?b:r.field![i-2];track.pointAt(car.distance,0,dot);
   ctx.fillStyle=i===0?'#ff4a42':i===1?'#21f0d1':'#e3dd99';
   ctx.fillRect(295+(dot.x-minX)*mapScale,16+(dot.z-minZ)*mapScale,4,4);
  }
  trace[traceIndex]=a.speed;trace[48+traceIndex]=b.speed;traceIndex=(traceIndex+1)%48;
  for(let car=0;car<2;car++){
   ctx.strokeStyle=car?'#21d5c6':'#ff544f';ctx.beginPath();
   for(let i=0;i<48;i++){const x=8+i*5,y=245-trace[car*48+(traceIndex+i)%48]*.86;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}
   ctx.stroke();
  }
  ctx.fillStyle='#e8e9de';ctx.font='bold 17px monospace';
  ctx.fillText('HAM  '+(a.compound??'medium').toUpperCase(),264,174);
  ctx.fillText('RUS  '+(b.compound??'medium').toUpperCase(),264,197);
  ctx.fillStyle='#9ac7de';ctx.fillText('RAIN  '+(r.control?.rain??'dry').toUpperCase(),264,224);
  ctx.fillText('WET   '+Math.round((r.control?.wetness??0)*100)+'%',264,249);
  monitors.map.needsUpdate=true;
 }
 return {bind(m:T.MeshStandardMaterial){
  if(m.name.startsWith('GridLens'))lenses[Number(m.name.slice(8))]=m;
  if(m.name==='TimingScreen'){m.color.set('#ffffff');m.emissive.set('#ffffff');m.map=monitors.map;m.emissiveMap=monitors.map;m.emissiveIntensity=.74;}
  if(m.name==='PitExitStop'||m.name==='PitExitGo'||m.name==='PitExitBlue')exitLamps[m.name]=m;
  if(m.name==='SafetyBoard'){m.color.set('#ffffff');m.map=board.map;m.emissiveMap=board.map;m.emissive.set('#ffffff');m.emissiveIntensity=.45;}
  if(m.name==='MarshalLED'){panels.push(m);m.emissive.set('#ffffff');m.map=board.map;m.emissiveMap=board.map;}
 },update(r:RenderRace,camera:T.Vector3,now:number){
  const lit=r.phase==='lights'?Math.max(0,Math.min(5,Math.ceil(5-(r.countdown??0)))):0;
  lenses.forEach((m,i)=>{m.emissive.setHex(i<lit?0xff1810:0x170100);m.emissiveIntensity=i<lit?3:.18;});
  const state=r.phase==='finished'?'FINISH':r.control?.marshalSignal??(r.control?.safetyCar?'SC':(r.control?.yellowUntil??0)>r.time?'YELLOW':'GREEN');
  if(now<lastExit||now-lastExit>=250||state!==last){
   lastExit=now;const red=state==='RED'||r.phase==='lights';
   let blue=nearExit(r.cars.a.distance)||nearExit(r.cars.b.distance);
   for(let i=0;!blue&&i<(r.field?.length??0);i++)blue=nearExit(r.field![i].distance);
   if(exitLamps.PitExitStop)exitLamps.PitExitStop.emissiveIntensity=red?2.1:.035;
   if(exitLamps.PitExitGo)exitLamps.PitExitGo.emissiveIntensity=red?.035:2.1;
   if(exitLamps.PitExitBlue)exitLamps.PitExitBlue.emissiveIntensity=blue?2.1:.035;
  }
  if(state!==last){
   last=state;const ctx=board.ctx;ctx.fillStyle='#111817';ctx.fillRect(0,0,192,96);
   ctx.fillStyle=state==='GREEN'?'#26874b':(state==='FINISH'||state==='WHITE')?'#e4e7e3':state==='BLUE'?'#458bff':state==='RED'?'#ff5143':'#ffce2a';
   if(state==='FINISH'){for(let i=0;i<8;i++)for(let j=0;j<4;j++)if((i+j)%2===0)ctx.fillRect(i*24,j*24,24,24);}
   else{ctx.fillRect(0,0,192,96);ctx.fillStyle='#14241c';ctx.font='bold 42px Arial';ctx.textAlign='center';if(state==='DOUBLE YELLOW'){ctx.font='bold 34px Arial';ctx.fillText('DOUBLE',96,41);ctx.fillText('YELLOW',96,79);}
    else ctx.fillText(state,96,63);}
   ctx.fillStyle='rgba(0,0,0,.26)';
   for(let y=0;y<96;y+=4)ctx.fillRect(0,y,192,1);
   for(let x=0;x<192;x+=4)ctx.fillRect(x,0,1,96);
   board.map.needsUpdate=true;
  }
  if(Math.floor(r.time)===lastSecond){updateWall(r,camera,now);return state;}lastSecond=Math.floor(r.time);
  const ctx=tower.ctx;ctx.fillStyle='#10151a';ctx.fillRect(0,0,192,384);ctx.font='bold 22px monospace';ctx.fillStyle='#e9bb43';ctx.fillText('LIVE TIMING',12,29);
  const count=2+(r.field?.length??0);
  for(const row of ranks){
   const i=row.index;
   row.distance=i<count?(i===0?r.cars.a:i===1?r.cars.b:r.field![i-2]).distance:-Infinity;
  }
  ranks.sort(byDistance);
  for(let i=0;i<Math.min(10,count);i++){ctx.fillStyle=i%2?'#202a32':'#142029';ctx.fillRect(6,42+i*33,180,30);ctx.fillStyle='#c9e6e2';ctx.fillText(String(i+1).padStart(2,'0')+' '+ranks[i].code,18,65+i*33);}
  tower.map.needsUpdate=true;
  if(televisionDue(camera,now)){
   lastTelevision=now;
   const c=live.ctx;c.fillStyle='#10171d';c.fillRect(0,0,512,224);c.fillStyle='#bd1634';c.fillRect(0,0,512,30);
   c.fillStyle='#ffffff';c.font='bold 20px Arial';c.fillText(track.name.toUpperCase()+'   •   LIVE RACE ORDER',10,22);
   c.drawImage(ctx.canvas,6,43,180,198,9,36,239,181);
   c.lineWidth=3;c.strokeStyle='#8d9f9d';c.stroke(leaderRoute);
   for(let i=0;i<2;i++){track.pointAt(i?r.cars.b.distance:r.cars.a.distance,0,dot);c.fillStyle=i?'#0de0c9':'#fa494e';c.beginPath();c.arc(274+(dot.x-minX)*scale,40+(dot.z-minZ)*scale,5,0,2*Math.PI);c.fill();}
   live.map.needsUpdate=true;
  }
  updateWall(r,camera,now);return state;
 },dispose(){monitors.map.dispose();for(const s of screens){s.removeFromParent();s.geometry.dispose();}support.dispose();imageMaterial.dispose();live.map.dispose();screen.removeFromParent();screen.geometry.dispose();screen.material.dispose();tower.map.dispose();board.map.dispose();}};
}
