import * as T from 'three';
import {embeddedGLB} from './embedded-glb';
import highURL from './assets/jgp26-high.glb?url&inline';
import lowURL from './assets/jgp26-low.glb?url&inline';
import aoURL from './assets/jgp26-ao.png?url&inline';
export const CAR_DIMENSIONS={wheelbase:3.6,width:2,length:5.62,tyreRadius:.36,frontAxle:1.55,rearAxle:-2.05};
export type Finish='colour'|'clay'|'wireframe';
let templates:Promise<T.Group[]>|undefined;
function assets(){return templates??=Promise.all([highURL,lowURL].map(url=>embeddedGLB(url).then(g=>g.scene)));}
function twill(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const c=canvas.getContext('2d')!;
 // 2-over / 2-under diagonal twill, with curved fibre bundles rather than checker squares.
 for(let y=0;y<128;y++)for(let x=0;x<128;x++){const a=Math.floor(x/8),b=Math.floor(y/8),over=((a-b)%4+4)%4<2;const v=over?x%8:y%8;const n=205+22*Math.sin(v/8*Math.PI)+2*Math.cos((over?y:x)*Math.PI);c.fillStyle=`rgb(${n},${n},${n})`;c.fillRect(x,y,1,1);}
 const t=new T.CanvasTexture(canvas);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(9,9);t.anisotropy=8;return t;
}
export interface CarTelemetry{distance:number;speed:number;steering?:number;drs?:boolean;compound?:string;acceleration?:number;lateralG?:number;pit?:string;gear?:number;rpm?:number;ers?:number;lastLap?:number;bestLap?:number}
export function createCar(team:'a'|'b'){
 const root=new T.Group(),chassis=new T.Group(),lod=new T.LOD();root.add(chassis);chassis.add(lod);
 const originals=new Map<T.Mesh,T.Material|T.Material[]>(),clay=new T.MeshStandardMaterial({color:'#deded9',roughness:.83,side:T.DoubleSide}),wire=new T.MeshBasicMaterial({color:'#15222b',side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}),lineMaterial=new T.LineBasicMaterial({color:'#9ab8ca',transparent:true,opacity:.7,depthWrite:false}),wireLines:T.LineSegments[]=[];
 const carbonMap=twill(),aoMap=new T.TextureLoader().load(aoURL);aoMap.flipY=false;let ready=false,dead=false,finish:Finish='colour',error:string|null=null;
 const rigs:T.Group[]=[],dashTextures:T.CanvasTexture[]=[],dashContexts:CanvasRenderingContext2D[]=[],lights:T.MeshBasicMaterial[][]=[];
 function setFinish(next:Finish){finish=next;wireLines.forEach(o=>o.visible=next==='wireframe');for(const [mesh,original] of originals)mesh.material=next==='colour'?original:next==='clay'?clay:wire;}
 const loaded=assets().then(models=>{if(dead)return;models.forEach((template,index)=>{
  const model=template.clone(true);const materials=new Map<T.Material,T.Material>();
  model.traverse(o=>{if(o instanceof T.Mesh){o.geometry=o.geometry.clone();const make=(original:T.MeshStandardMaterial)=>{let m=materials.get(original);if(!m){const p=new T.MeshPhysicalMaterial({color:original.color,roughness:original.roughness,metalness:original.metalness,map:original.map,transparent:original.transparent,opacity:original.opacity});p.name=original.name;
   if(p.name==='Livery'){p.color.set(team==='a'?'#bd071b':'#08a59b');p.roughness=.4;p.metalness=.08;p.clearcoat=.08;p.clearcoatRoughness=.4;}
   if(p.name==='Ivory'&&team==='b'){p.color.set('#adbfc5');p.metalness=.65;p.roughness=.38;}
   if(p.name==='Carbon'){p.color.set('#101318');p.bumpMap=carbonMap;p.bumpScale=.00022;p.roughnessMap=carbonMap;p.roughness=.52;p.metalness=.02;p.clearcoat=.04;p.specularIntensity=.3;p.envMapIntensity=.4;}
   if(p.name==='Rubber'){p.color.set('#17181a');p.roughness=.94;p.bumpMap=carbonMap;p.bumpScale=.0001;}
   p.aoMap=aoMap;p.aoMapIntensity=.72;p.side=T.DoubleSide;m=p;materials.set(original,m);
  }return m;};o.material=Array.isArray(o.material)?o.material.map(m=>make(m as T.MeshStandardMaterial)):make(o.material as T.MeshStandardMaterial);o.castShadow=true;o.receiveShadow=true;originals.set(o,o.material);}});
  const unused=model.getObjectByName(team==='a'?'NumberB':'NumberA');if(unused)unused.visible=false;
  rigs.push(model);lod.addLevel(model,index===0?0:32);const meshes:T.Mesh[]=[];model.traverse(o=>{if(o instanceof T.Mesh)meshes.push(o);});for(const m of meshes){const lines=new T.LineSegments(new T.WireframeGeometry(m.geometry),lineMaterial);lines.renderOrder=1;lines.visible=false;m.add(lines);wireLines.push(lines);}
  const steering=model.getObjectByName('Steering');
  if(steering){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;const material=new T.MeshBasicMaterial({map:tex,toneMapped:false});const display=new T.Mesh(new T.PlaneGeometry(.182,.101),material);display.position.set(0,.025,-.025);display.rotation.y=Math.PI;steering.add(display);originals.set(display,material);dashTextures.push(tex);dashContexts.push(canvas.getContext('2d')!);
   const row:T.MeshBasicMaterial[]=[];for(let i=0;i<12;i++){const lm=new T.MeshBasicMaterial({color:'#14211a',toneMapped:false});const led=new T.Mesh(new T.SphereGeometry(.0028,8,4),lm);led.position.set((i-5.5)*.010,.078,-.025);steering.add(led);originals.set(led,lm);row.push(lm);}lights.push(row);
  }
 });ready=true;setFinish(finish);}).catch(e=>{error=String(e);console.error('Car asset failed',e);});
 let lastDash=-1;
 return {root,chassis,loaded,get ready(){return ready;},get error(){return error;},setFinish,
 update(c:CarTelemetry,onboard=false,studio=false){
  for(const model of rigs){for(const name of ['FrontL','FrontR','RearL','RearR']){const w=model.getObjectByName(name);if(w){w.rotation.set(0,name.startsWith('Front')?(c.steering??0):0,0);w.rotateX(studio?0:c.distance/.36);}}
   const hands=model.getObjectByName('Hands');if(hands)hands.visible=!studio;
   const h=model.getObjectByName('Helmet');if(h)h.visible=!onboard;
   const s=model.getObjectByName('Steering');if(s)s.rotation.z=-(c.steering??0)*3.6;
   const d=model.getObjectByName('DRS');if(d)d.rotation.x=c.drs?-.43:0;
  }
  chassis.rotation.x=studio?0:T.MathUtils.clamp((c.acceleration??0)*.00045,-.018,.012);chassis.rotation.z=studio?0:T.MathUtils.clamp((c.lateralG??0)*-.003,-.015,.015);
  const stamp=Math.floor(performance.now()/100);if(stamp!==lastDash){lastDash=stamp;dashContexts.forEach((ctx,i)=>{ctx.fillStyle='#07100e';ctx.fillRect(0,0,512,256);ctx.strokeStyle='#536a61';ctx.lineWidth=2;ctx.strokeRect(7,7,498,242);ctx.fillStyle='#d5ffdb';ctx.font='bold 145px monospace';ctx.textAlign='left';ctx.fillText(String(c.gear??'N'),25,167);ctx.font='bold 65px monospace';ctx.fillText(String(Math.round(c.speed*3.6)).padStart(3,'0'),210,100);ctx.font='22px monospace';ctx.fillStyle='#8cac9c';ctx.fillText('KM/H',340,134);ctx.fillStyle=c.drs?'#79ff73':'#91a69d';ctx.fillText(c.drs?'DRS OPEN':'DRS CLOSED',210,177);ctx.font='24px monospace';ctx.fillText(`ERS ${Math.round(c.ers??90)}%`,25,226);const delta=c.lastLap&&c.bestLap?c.lastLap-c.bestLap:0;ctx.fillText(`Δ ${delta>=0?'+':''}${delta.toFixed(3)}`,272,226);if(studio){ctx.fillStyle='#020403';ctx.fillRect(0,0,512,256);}dashTextures[i].needsUpdate=true;});
   const rpm=studio?0:c.rpm??(c.speed?10500:0),n=Math.round(T.MathUtils.clamp((rpm-7500)/4500,0,1)*12);lights.forEach(row=>row.forEach((m,i)=>m.color.set(i<n?(i<4?'#36d45b':i<8?'#f33035':'#508aff'):'#112019')));
  }
 },dispose(){dead=true;for(const [mesh,original] of originals)mesh.material=original;wireLines.forEach(o=>o.geometry.dispose());lineMaterial.dispose();clay.dispose();wire.dispose();carbonMap.dispose();aoMap.dispose();dashTextures.forEach(t=>t.dispose());}};
}
