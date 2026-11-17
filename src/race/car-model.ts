import * as T from 'three';
import {embeddedGLB} from './embedded-glb';
import highURL from './assets/jgp26-high.glb.gz?url&inline';
import lowURL from './assets/jgp26-low.glb.gz?url&inline';
import aoURL from './assets/jgp26-ao.png?url&inline';
export const CAR_DIMENSIONS={wheelbase:3.6,width:2,length:5.62,tyreRadius:.36,frontAxle:1.55,rearAxle:-2.05};
export type Finish='colour'|'clay'|'wireframe';
let templates:Promise<T.Group[]>|undefined;
function assets(){return templates??=Promise.all([highURL,lowURL].map(url=>embeddedGLB(url,true).then(g=>g.scene)));}
function grain(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const c=canvas.getContext('2d')!;
 let seed=26;for(let y=0;y<128;y++)for(let x=0;x<128;x++){seed=(Math.imul(seed,1664525)+1013904223)|0;const v=238+((seed>>>24)%17);c.fillStyle=`rgb(${v},${v},${v})`;c.fillRect(x,y,1,1);}
 const t=new T.CanvasTexture(canvas);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(48,48);t.anisotropy=8;return t;
}
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
 const carbonMap=twill(),grainMap=grain(),tyreUniforms:{spin:{value:number};load:{value:number};side:number;front:boolean}[]=[],aoMap=new T.TextureLoader().load(aoURL);aoMap.flipY=false;let ready=false,dead=false,finish:Finish='colour',error:string|null=null;
 const mirrors:T.MeshPhysicalMaterial[]=[];const rigs:T.Group[]=[],dashTextures:T.CanvasTexture[]=[],dashContexts:CanvasRenderingContext2D[]=[],lights:T.MeshBasicMaterial[][]=[];
 function setFinish(next:Finish){finish=next;wireLines.forEach(o=>o.visible=next==='wireframe');for(const [mesh,original] of originals)mesh.material=next==='colour'?original:next==='clay'?clay:wire;}
 const loaded=assets().then(models=>{if(dead)return;models.forEach((template,index)=>{
  const model=template.clone(true);const materials=new Map<T.Material,T.Material>();
  model.traverse(o=>{if(o instanceof T.Mesh){o.geometry=o.geometry.clone();const make=(original:T.MeshStandardMaterial)=>{const wheelRubber=original.name==='Rubber'&&!!o.parent?.name.match(/^(Front|Rear)[LR]$/);let m=wheelRubber?undefined:materials.get(original);if(!m){const p=new T.MeshPhysicalMaterial({color:original.color,roughness:original.roughness,metalness:original.metalness,map:original.map,transparent:original.transparent,opacity:original.opacity});p.name=original.name;
   if(p.name==='Livery'){p.color.set(team==='a'?'#bd071b':'#08a59b');p.roughness=.38;p.metalness=.16;p.clearcoat=.15;p.clearcoatRoughness=.35;p.specularIntensity=.65;p.roughnessMap=grainMap;p.bumpMap=grainMap;p.bumpScale=.000018;}
   if(p.name==='Ivory'&&team==='b'){p.color.set('#adbfc5');p.metalness=.65;p.roughness=.38;}
   if(p.name==='Carbon'){p.color.set('#101318');p.bumpMap=carbonMap;p.bumpScale=.00022;p.roughnessMap=carbonMap;p.roughness=.38;p.metalness=.12;p.clearcoat=.12;p.specularIntensity=.65;p.envMapIntensity=.7;}
   if(p.name==='Mirror'){
    mirrors.push(p);o.geometry.computeBoundingBox();const bounds=o.geometry.boundingBox!,pos=o.geometry.getAttribute('position'),uv=new Float32Array(pos.count*2),mid=(bounds.min.x+bounds.max.x)/2;
    for(let i=0;i<pos.count;i++){const cx=pos.getX(i)<mid?bounds.min.x+.0875:bounds.max.x-.0875;uv[i*2]=.5+(pos.getX(i)-cx)/.175;uv[i*2+1]=(pos.getY(i)-bounds.min.y)/.038;}o.geometry.setAttribute('uv',new T.BufferAttribute(uv,2));
   }
   if(p.name==='GloveFabric'){p.roughness=.87;p.bumpMap=carbonMap;p.bumpScale=.00007;p.sheen=.3;p.sheenColor.set('#bcb9b1');p.sheenRoughness=.9;}
   if(p.name==='Rubber'){p.color.set('#17181a');p.roughness=.94;p.bumpMap=grainMap;p.bumpScale=.00018;p.roughnessMap=grainMap;}
   if(p.name==='Rubber'&&o.parent?.name.match(/^(Front|Rear)[LR]$/)){
    const u={spin:{value:0},load:{value:.008},side:o.parent.name.endsWith('L')?-1:1,front:o.parent.name.startsWith('Front')};tyreUniforms.push(u);
    p.onBeforeCompile=shader=>{shader.uniforms.tyreSpin=u.spin;shader.uniforms.tyreLoad=u.load;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float tyreSpin;uniform float tyreLoad;').replace('#include <begin_vertex>',`#include <begin_vertex>
     float cs=cos(tyreSpin),sn=sin(tyreSpin);float worldY=position.y*cs-position.z*sn;
     float radial=length(position.yz);float contactWeight=(1.-smoothstep(-.36,-.28,worldY))*smoothstep(.23,.32,radial);
     float lift=max(0.,-.36+tyreLoad-worldY);transformed.y+=lift*cs;transformed.z-=lift*sn;
     transformed.x+=sign(position.x)*tyreLoad*.4*contactWeight;
    `);};p.customProgramCacheKey=()=> 'loaded-slick-v1';
   }
   p.aoMap=['Mirror','MarkWhite'].includes(p.name)?null:aoMap;p.aoMapIntensity=p.name==='GloveFabric'?.15:.72;p.side=T.DoubleSide;m=p;if(!wheelRubber)materials.set(original,m);
  }return m;};o.material=Array.isArray(o.material)?o.material.map(m=>make(m as T.MeshStandardMaterial)):make(o.material as T.MeshStandardMaterial);o.castShadow=true;o.receiveShadow=true;originals.set(o,o.material);}});
  const unused=model.getObjectByName(team==='a'?'NumberB':'NumberA');if(unused)unused.visible=false;
  rigs.push(model);lod.addLevel(model,index===0?0:32);const meshes:T.Mesh[]=[];model.traverse(o=>{if(o instanceof T.Mesh)meshes.push(o);});for(const m of meshes){const lines=new T.LineSegments(new T.WireframeGeometry(m.geometry),lineMaterial);lines.renderOrder=1;lines.visible=false;m.add(lines);wireLines.push(lines);}
  const steering=model.getObjectByName('Steering');
  if(steering){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;const material=new T.MeshBasicMaterial({map:tex,toneMapped:false});const display=new T.Mesh(new T.PlaneGeometry(.182,.101),material);display.position.set(0,.025,-.025);display.rotation.y=Math.PI;steering.add(display);originals.set(display,material);dashTextures.push(tex);dashContexts.push(canvas.getContext('2d')!);
   const row:T.MeshBasicMaterial[]=[];for(let i=0;i<12;i++){const lm=new T.MeshBasicMaterial({color:'#14211a',toneMapped:false});const led=new T.Mesh(new T.SphereGeometry(.0028,8,4),lm);led.position.set((i-5.5)*.010,.078,-.025);steering.add(led);originals.set(led,lm);row.push(lm);}lights.push(row);
  }
 });ready=true;setFinish(finish);}).catch(e=>{error=String(e);console.error('Car asset failed',e);});
 let lastDash=-1;
 return {root,chassis,loaded,get ready(){return ready;},get error(){return error;},setFinish,setMirror(texture:T.Texture|null){for(const m of mirrors){if(m.map!==texture){m.map=texture;m.emissiveMap=texture;m.emissive.set(texture?'#ffffff':'#000000');m.emissiveIntensity=.7;m.roughness=texture?1:.08;m.metalness=texture?0:.9;m.needsUpdate=true;}}},
 update(c:CarTelemetry,onboard=false,studio=false){
  for(const u of tyreUniforms){u.spin.value=studio?0:c.distance/.36;u.load.value=T.MathUtils.clamp(.007+(studio?0:c.speed*c.speed*.0000012+(u.front?1:-1)*-(c.acceleration??0)*.00022+u.side*(c.lateralG??0)*.0012),.003,.024);}
  for(const model of rigs){for(const name of ['FrontL','FrontR','RearL','RearR']){const w=model.getObjectByName(name);if(w){w.position.y=.36-T.MathUtils.clamp(.007+(studio?0:c.speed*c.speed*.0000012+(name.startsWith('Front')?1:-1)*-(c.acceleration??0)*.00022+(name.endsWith('L')?-1:1)*(c.lateralG??0)*.0012),.003,.024);w.rotation.set(0,name.startsWith('Front')?(c.steering??0):0,0);w.rotateX(studio?0:c.distance/.36);}}
   const hands=model.getObjectByName('Hands');if(hands)hands.visible=!studio;
   const h=model.getObjectByName('Helmet');if(h)h.visible=!onboard;
   const s=model.getObjectByName('Steering');if(s)s.rotation.z=-(c.steering??0)*3.6;
   const d=model.getObjectByName('DRS');if(d)d.rotation.x=c.drs?-.43:0;
  }
  chassis.rotation.x=studio?0:T.MathUtils.clamp((c.acceleration??0)*.00045,-.018,.012);chassis.rotation.z=studio?0:T.MathUtils.clamp((c.lateralG??0)*-.003,-.015,.015);
  const stamp=Math.floor(performance.now()/100);if(stamp!==lastDash){lastDash=stamp;dashContexts.forEach((ctx,i)=>{ctx.fillStyle='#07100e';ctx.fillRect(0,0,512,256);ctx.strokeStyle='#536a61';ctx.lineWidth=2;ctx.strokeRect(7,7,498,242);ctx.fillStyle='#d5ffdb';ctx.font='bold 145px monospace';ctx.textAlign='left';ctx.fillText(String(c.gear??'N'),25,167);ctx.font='bold 65px monospace';ctx.fillText(String(Math.round(c.speed*3.6)).padStart(3,'0'),210,100);ctx.font='22px monospace';ctx.fillStyle='#8cac9c';ctx.fillText('KM/H',340,134);ctx.fillStyle=c.drs?'#79ff73':'#91a69d';ctx.fillText(c.drs?'DRS OPEN':'DRS CLOSED',210,177);ctx.font='24px monospace';ctx.fillText(`ERS ${Math.round(c.ers??90)}%`,25,226);const delta=c.lastLap&&c.bestLap?c.lastLap-c.bestLap:0;ctx.fillText(`Δ ${delta>=0?'+':''}${delta.toFixed(3)}`,272,226);if(studio){ctx.fillStyle='#020403';ctx.fillRect(0,0,512,256);}dashTextures[i].needsUpdate=true;});
   const rpm=studio?0:c.rpm??(c.speed?10500:0),n=Math.round(T.MathUtils.clamp((rpm-7500)/4500,0,1)*12);lights.forEach(row=>row.forEach((m,i)=>m.color.set(i<n?(i<4?'#36d45b':i<8?'#f33035':'#508aff'):'#112019')));
  }
 },dispose(){dead=true;for(const [mesh,original] of originals)mesh.material=original;wireLines.forEach(o=>o.geometry.dispose());lineMaterial.dispose();clay.dispose();wire.dispose();carbonMap.dispose();grainMap.dispose();aoMap.dispose();dashTextures.forEach(t=>t.dispose());}};
}
