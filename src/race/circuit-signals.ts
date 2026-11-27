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
 if(!track.night)for(const d of [1010,4180,track.LENGTH-840]){
  const site=track.pointAt(d,-40),orientation=track.tangentAt(d),floor=heightAt(d);
  for(const [geometry,mat,h] of [[new T.BoxGeometry(.65,6.2,.65),support,3.1],[new T.PlaneGeometry(8.8,3.85),imageMaterial,6.9]] as const){
   const mesh=new T.Mesh(geometry,mat);mesh.position.set(site.x,floor+h,site.z);mesh.rotation.y=Math.atan2(-orientation.z,orientation.x);scene.add(mesh);screens.push(mesh);
  }
 }
 const outline=Array.from({length:144},(_,i)=>track.pointAt(track.LENGTH*i/144));
 const minX=Math.min(...outline.map(p=>p.x)),minZ=Math.min(...outline.map(p=>p.z));
 const scale=Math.min(215/(Math.max(...outline.map(p=>p.x))-minX),172/(Math.max(...outline.map(p=>p.z))-minZ));
 let last='',lastSecond=-1;
 return {bind(m:T.MeshStandardMaterial){
  if(m.name.startsWith('GridLens'))lenses[Number(m.name.slice(8))]=m;
  if(m.name==='MarshalLED'){panels.push(m);m.emissive.set('#ffffff');m.map=board.map;m.emissiveMap=board.map;}
 },update(r:RenderRace){
  const lit=r.phase==='lights'?Math.max(0,Math.min(5,Math.ceil(5-(r.countdown??0)))):0;
  lenses.forEach((m,i)=>{m.emissive.setHex(i<lit?0xff1810:0x170100);m.emissiveIntensity=i<lit?3:.18;});
  const state=r.phase==='finished'?'FINISH':r.control?.marshalSignal??(r.control?.safetyCar?'SC':(r.control?.yellowUntil??0)>r.time?'YELLOW':'GREEN');
  if(state!==last){
   last=state;const ctx=board.ctx;ctx.fillStyle='#111817';ctx.fillRect(0,0,192,96);
   ctx.fillStyle=state==='GREEN'?'#26874b':state==='FINISH'?'#e4e7e3':state==='BLUE'?'#458bff':state==='RED'?'#ff5143':'#ffce2a';
   if(state==='FINISH'){for(let i=0;i<8;i++)for(let j=0;j<4;j++)if((i+j)%2===0)ctx.fillRect(i*24,j*24,24,24);}
   else{ctx.fillRect(0,0,192,96);ctx.fillStyle='#14241c';ctx.font='bold 42px Arial';ctx.textAlign='center';if(state==='DOUBLE YELLOW'){ctx.font='bold 34px Arial';ctx.fillText('DOUBLE',96,41);ctx.fillText('YELLOW',96,79);}
    else ctx.fillText(state,96,63);}
   ctx.fillStyle='rgba(0,0,0,.26)';
   for(let y=0;y<96;y+=4)ctx.fillRect(0,y,192,1);
   for(let x=0;x<192;x+=4)ctx.fillRect(x,0,1,96);
   board.map.needsUpdate=true;
  }
  if(Math.floor(r.time)===lastSecond)return;lastSecond=Math.floor(r.time);
  const ctx=tower.ctx;ctx.fillStyle='#10151a';ctx.fillRect(0,0,192,384);ctx.font='bold 22px monospace';ctx.fillStyle='#e9bb43';ctx.fillText('LIVE TIMING',12,29);
  const sorted=[r.cars.a,r.cars.b,...r.field??[]].map((c,i)=>({d:c.distance,code:contactNames[i]})).sort((a,b)=>b.d-a.d);
  sorted.slice(0,10).forEach((c,i)=>{ctx.fillStyle=i%2?'#202a32':'#142029';ctx.fillRect(6,42+i*33,180,30);ctx.fillStyle='#c9e6e2';ctx.fillText(String(i+1).padStart(2,'0')+' '+c.code,18,65+i*33);});
  tower.map.needsUpdate=true;
  if(screens.length){
   const c=live.ctx;c.fillStyle='#10171d';c.fillRect(0,0,512,224);c.fillStyle='#bd1634';c.fillRect(0,0,512,30);
   c.fillStyle='#ffffff';c.font='bold 20px Arial';c.fillText('MONZA   •   LIVE RACE ORDER',10,22);
   c.drawImage(ctx.canvas,6,43,180,198,9,36,239,181);
   const x=(v:number)=>274+(v-minX)*scale,z=(v:number)=>40+(v-minZ)*scale;
   c.beginPath();for(const [i,q] of outline.entries()){if(i)c.lineTo(x(q.x),z(q.z));else c.moveTo(x(q.x),z(q.z));}
   c.closePath();c.lineWidth=3;c.strokeStyle='#8d9f9d';c.stroke();
   for(const id of ['a','b'] as const){const q=track.pointAt(r.cars[id].distance);c.fillStyle=id==='a'?'#fa494e':'#0de0c9';c.beginPath();c.arc(x(q.x),z(q.z),5,0,2*Math.PI);c.fill();}
   live.map.needsUpdate=true;
  }
 },dispose(){for(const s of screens){s.removeFromParent();s.geometry.dispose();}support.dispose();imageMaterial.dispose();live.map.dispose();screen.removeFromParent();screen.geometry.dispose();screen.material.dispose();tower.map.dispose();board.map.dispose();}};
}
