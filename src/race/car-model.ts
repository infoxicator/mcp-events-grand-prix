import * as T from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {fingerCurl,poseForearms,bindGloveCompression} from './grip';
import {Suspension,wheelStations} from './suspension';
import type {Track} from './track';
import {embeddedGLB} from './embedded-glb';
import highURL from './assets/jgp26-high.glb.gz?url&inline';
import lowURL from './assets/jgp26-low.glb.gz?url&inline';
import aoURL from './assets/jgp26-ao.png?url&inline';
export const CAR_DIMENSIONS={wheelbase:3.6,width:2,length:5.62,tyreRadius:.36,frontAxle:1.55,rearAxle:-2.05};
export type Finish='colour'|'clay'|'wireframe';
// These millimetre-scale details already receive the Blender AO bake. They do
// not need a separate shadow draw in every window; major driver/car forms do.
const bakedDetailShadow=new Set(['MarkWhite','GloveStitch','GloveSuede','HelmetInk','HelmetVisor','Screen','Mirror','Titanium','ButtonRed','ButtonGreen','ButtonBlue','ButtonYellow','BrandBlue','BrandGold']);
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
function knit(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const c=canvas.getContext('2d')!;
 // Small alternating textile loops, distinct from the rigid carbon twill.
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){const row=Math.floor(y/8),u=(x+(row%2)*4)%8,v=y%8;const thread=Math.exp(-Math.pow((u-4-Math.sin(v/8*Math.PI)*2)/1.4,2));const n=150+85*thread+8*Math.sin(v*Math.PI);c.fillStyle=`rgb(${n},${n},${n})`;c.fillRect(x,y,1,1);}
 const t=new T.CanvasTexture(canvas);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(96,96);t.anisotropy=8;return t;
}
export interface CarTelemetry{distance:number;speed:number;offset?:number;heading?:number;steering?:number;drs?:boolean;compound?:string;acceleration?:number;lateralG?:number;pit?:string;gear?:number;rpm?:number;ers?:number;lastLap?:number;bestLap?:number}
function drawTelemetry(ctx:CanvasRenderingContext2D,c:CarTelemetry){
 const width=512,lapDelta=c.lastLap&&c.bestLap?c.lastLap-c.bestLap:0;
 ctx.fillStyle='#10161c';ctx.fillRect(0,0,width,256);
 function rect(x:number,y:number,w:number,h:number,color:string){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}
 function label(value:string,x:number,y:number,size:number,color:string,bold=false){
  ctx.fillStyle=color;ctx.font=(bold?'700 ':'500 ')+size+'px Arial, sans-serif';ctx.textAlign='left';ctx.fillText(value,x,y);
 }
 rect(0,0,512,10,'#23313d');
 const revs=T.MathUtils.clamp(((c.rpm??0)-6500)/5500,0,1);
 for(let i=0;i<24;i++)rect(i*21.4,0,18,10,i/24<revs?(i<14?'#57c899':i<20?'#ffc04a':'#ed5558'):'#28323b');
 rect(8,21,144,222,'#e1e6df');label('GEAR',20,51,26,'#34414a',true);label(String(c.gear??'N'),21,198,157,'#151c26',true);
 label('SPEED',171,45,22,'#acc5d0',true);label(String(Math.round(c.speed*3.6)),167,117,81,'#f2f5f3',true);label('km/h',370,112,32,'#a6b7c1');
 rect(170,132,332,2,'#40515d');label('DELTA',172,165,24,'#a6b7c1',true);
 label((lapDelta>=0?'+':'')+lapDelta.toFixed(3),283,170,39,lapDelta<=0?'#68d4a0':'#ff9b77',true);
 const charge=Math.round(c.ers??90);label('ERS',172,216,25,'#c0ced1',true);label(charge+'%',235,216,30,'#e0efef',true);
 rect(172,230,162,9,'#33414a');rect(172,230,1.62*T.MathUtils.clamp(charge,0,100),9,'#58b5c0');
 rect(357,190,144,50,c.drs?'#356d4d':'#2b3540');label(c.drs?'DRS ON':'DRS OFF',369,224,26,c.drs?'#beffd7':'#b0bcc1',true);
}
const compoundColors:Record<string,string>={soft:'#d63532',medium:'#d9ae37',hard:'#c7c6ba',intermediate:'#479655',wet:'#3f78b2'};
export function createCar(team:'a'|'b',track:Track){
 const suspension=new Suspension(),inverseBody=new T.Quaternion();
 const root=new T.Group(),chassis=new T.Group(),lod=new T.LOD();root.add(chassis);chassis.add(lod);
 const originals=new Map<T.Mesh,T.Material|T.Material[]>(),clay=new T.MeshStandardMaterial({color:'#deded9',roughness:.83,side:T.DoubleSide}),wire=new T.MeshBasicMaterial({color:'#15222b',side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}),lineMaterial=new T.LineBasicMaterial({color:'#9ab8ca',transparent:true,opacity:.7,depthWrite:false}),wireLines:T.LineSegments[]=[];
 const carbonMap=twill(),grainMap=grain(),fabricMap=knit(),tyreUniforms:{spin:{value:number};load:{value:number};shutter:{value:number};wheel:number}[]=[],aoMap=new T.TextureLoader().load(aoURL);aoMap.flipY=false;let ready=false,dead=false,finish:Finish='colour',error:string|null=null;
 const compression=new WeakMap<T.Group,{side:-1|1;meshes:T.Mesh[]}[]>();
 const fingerRigs=new WeakMap<T.Group,{node:T.Object3D;side:-1|1;digit:number}[]>();
 const sidewallInks:T.MeshPhysicalMaterial[]=[];
 const mirrors:T.MeshPhysicalMaterial[]=[];const rigs:T.Group[]=[],dashTextures:T.CanvasTexture[]=[],dashContexts:CanvasRenderingContext2D[]=[],lights:T.MeshBasicMaterial[][]=[];
 function setFinish(next:Finish){finish=next;wireLines.forEach(o=>o.visible=next==='wireframe');for(const [mesh,original] of originals)mesh.material=next==='colour'?original:next==='clay'?clay:wire;}
 const loaded=assets().then(models=>{if(dead)return;models.forEach((template,index)=>{
  const model=cloneSkeleton(template) as T.Group;const materials=new Map<T.Material,T.Material>();
  model.traverse(o=>{if(o instanceof T.Mesh){o.geometry=o.geometry.clone();const make=(original:T.MeshStandardMaterial)=>{const wheelRubber=original.name==='SlickRubber';let m=wheelRubber?undefined:materials.get(original);if(!m){const p=new T.MeshPhysicalMaterial({color:original.color,vertexColors:original.vertexColors,roughness:original.roughness,metalness:original.metalness,map:original.map,transparent:original.transparent,opacity:original.opacity});p.name=original.name;
   if(p.name==='Livery'){p.color.set(team==='a'?'#de091d':'#009694');p.roughness=.36;p.metalness=.025;p.clearcoat=.62;p.clearcoatRoughness=.18;p.specularIntensity=.53;p.roughnessMap=grainMap;p.bumpMap=grainMap;p.bumpScale=.000018;}
   if(p.name==='DeepLivery'){p.color.set(team==='a'?'#640c28':'#073749');p.clearcoat=.52;p.clearcoatRoughness=.20;}
   if(p.name==='CompoundInk'){sidewallInks.push(p);p.roughness=.81;}
   if(p.name==='Ivory'){p.roughness=.36;p.clearcoat=.42;p.clearcoatRoughness=.20;}
   if(p.name==='Ivory'&&team==='b'){p.color.set('#adbfc5');p.metalness=.65;p.roughness=.38;}
   if(p.name==='WheelDish'){p.color.set('#343c47');p.roughness=.29;p.metalness=.68;p.envMapIntensity=1.25;p.clearcoat=.1;}
   if(p.name==='BrakeDisc'){p.roughness=.65;p.metalness=.45;}
   if(p.name==='Sleeve'){p.bumpMap=fabricMap;p.bumpScale=.00024;p.color.set(team==='a'?'#851d2a':'#1c555c');p.roughness=.95;p.sheen=.4;}
   if(p.name==='AeroLaminate'){p.color.set('#1b1e23');p.bumpMap=carbonMap;p.bumpScale=.00009;p.roughness=.41;p.metalness=.06;p.clearcoat=.16;p.clearcoatRoughness=.31;p.specularIntensity=.58;p.envMapIntensity=.80;}
   if(p.name==='Carbon'){p.color.set('#292c30');p.bumpMap=carbonMap;p.bumpScale=.00022;p.roughnessMap=carbonMap;p.roughness=.32;p.metalness=.10;p.clearcoat=.1;p.specularIntensity=.65;p.envMapIntensity=.55;}
   if(p.name==='Mirror'){
    mirrors.push(p);o.geometry.computeBoundingBox();const bounds=o.geometry.boundingBox!,pos=o.geometry.getAttribute('position'),uv=new Float32Array(pos.count*2),mid=(bounds.min.x+bounds.max.x)/2;
    for(let i=0;i<pos.count;i++){const cx=pos.getX(i)<mid?bounds.min.x+.0875:bounds.max.x-.0875;uv[i*2]=.5+(pos.getX(i)-cx)/.175;uv[i*2+1]=(pos.getY(i)-bounds.min.y)/.038;}o.geometry.setAttribute('uv',new T.BufferAttribute(uv,2));
   }
   if(p.name==='GloveSuede'){p.roughness=.98;p.sheen=.6;p.sheenColor.set('#858a90');p.sheenRoughness=.95;p.bumpMap=grainMap;p.bumpScale=.00012;}
   if(p.name==='GlovePanel'){p.color.set(team==='a'?'#4c2028':'#17383f');p.roughness=.97;p.bumpMap=fabricMap;p.bumpScale=.00028;p.sheen=.15;}
   if(p.name==='GloveFabric'){p.color.set('#ffffff');p.roughness=.95;p.sheen=.24;p.sheenColor.set('#bda99b');}
   if(['GloveFabric','GloveSuede','GlovePanel','Sleeve'].includes(p.name)){
    // Work in fabric space to keep the weave independent of the packed AO atlas.
    // Attenuate subpixel threads in wider shots to avoid shimmer on moving hands.
    p.onBeforeCompile=shader=>{
     shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 clothPoint;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nclothPoint=position;');
     shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 clothPoint;')
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
       vec2 weaveCoord=vec2(dot(clothPoint,vec3(.84,.37,-.34)),dot(clothPoint,vec3(-.31,.52,.79)))*610.;
       float resolve=1.-smoothstep(.17,.8,max(fwidth(weaveCoord.x),fwidth(weaveCoord.y)));
       float weft=cos(6.28318*weaveCoord.x+1.2*sin(3.14159*weaveCoord.y))*cos(3.14159*weaveCoord.y);
       float nap=sin(dot(clothPoint,vec3(318.,-207.,89.)))*sin(dot(clothPoint,vec3(183.,103.,-142.)));
       diffuseColor.rgb*=1.+.034*nap;
       diffuseColor.rgb*=.96+.085*weft*resolve;
       roughnessFactor=clamp(roughnessFactor+.030*weft*resolve,.65,1.);
      `);
    };
    const textile=p.onBeforeCompile;
    if(p.name==='GloveFabric'&&team==='b')p.onBeforeCompile=(shader,renderer)=>{
     textile.call(p,shader,renderer);
     shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float teamInk=smoothstep(.018,.12,diffuseColor.r-max(diffuseColor.g,diffuseColor.b));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.018,.155,.175)*(diffuseColor.r/.44),teamInk);`);
    };
    p.customProgramCacheKey=()=>p.name==='GloveFabric'?'driver-shell-'+team:'woven-racewear';
   }
   if(p.name==='HelmetPaint'){p.color.set(team==='a'?'#e9ed24':'#e5edf0');p.roughness=.30;p.clearcoat=.5;p.clearcoatRoughness=.19;}
   if(p.name==='HelmetVisor'){p.roughness=.13;p.metalness=.65;p.clearcoat=.8;p.envMapIntensity=1.2;}
   if(p.name==='Rubber'||wheelRubber){p.color.set(p.map?'#ffffff':'#17181a');p.roughness=.87;p.bumpMap=grainMap;p.bumpScale=.00018;p.roughnessMap=grainMap;}
   if(wheelRubber){
    if(p.map)p.map.anisotropy=8;
    const u={spin:{value:0},load:{value:.008},shutter:{value:0},wheel:wheelStations.findIndex(w=>w.name===o.parent!.name)};tyreUniforms.push(u);
    p.onBeforeCompile=shader=>{// Sidewall mould lines and circumferential tread scrub are anchored to
     // tyre space, so their finish rotates with the wheel and survives LOD changes.
     shader.vertexShader=shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec3 tyrePoint;').replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntyrePoint=position;');
     shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying vec3 tyrePoint;').replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
       float r=length(tyrePoint.yz);
       float shoulder=smoothstep(.331,.359,r);
       float angle=atan(tyrePoint.z,tyrePoint.y);
       float scrub=.5+.5*sin(tyrePoint.x*970.0+2.8*sin(angle*7.0)+1.4*cos(angle*13.0+tyrePoint.x*25.0));
       float resolved=1.-smoothstep(.001,.006,fwidth(tyrePoint.x));
       float mould=abs(fract(r*148.0)-.5);
       float ring=(1.-smoothstep(.04,.05+fwidth(r)*150.,mould))*(1.-shoulder)*smoothstep(.236,.253,r);
       roughnessFactor=clamp(roughnessFactor-.11*shoulder+.08*(scrub-.5)*resolved,.60,.97);
       diffuseColor.rgb*=1.+.10*ring+shoulder*(.09+.13*(scrub-.5)*resolved);
      `);
     // Integrate the printed sidewall over a 1/240 s exposure. Only the
     // rotating ink changes; the stationary showroom retains the source print.
     shader.uniforms.shutterArc=u.shutter;
     shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform float shutterArc;').replace('#include <map_fragment>',`
       #ifdef USE_MAP
        vec4 ink=texture2D(map,vMapUv);
        vec2 radialUv=vMapUv-.5;
        vec2 dx=dFdx(vMapUv),dy=dFdy(vMapUv);
        if(shutterArc>.015 && dot(radialUv,radialUv)<.255){
         vec2 sweep=vec2(-radialUv.y,radialUv.x)*shutterArc/7.;
         // Supply the angular coverage of one tap to the anisotropic sampler.
         vec2 major=length(sweep)>length(dx)?sweep:dx;
         ink=vec4(0.);
         for(int tap=-3;tap<=3;tap++){
          float a=float(tap)*shutterArc/7.,cs=cos(a),sn=sin(a);
          vec2 uv=.5+mat2(cs,sn,-sn,cs)*radialUv;
          ink+=textureGrad(map,uv,major,dy)/7.;
         }
        }
        diffuseColor*=ink;
       #endif
      `);
     shader.uniforms.tyreSpin=u.spin;shader.uniforms.tyreLoad=u.load;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float tyreSpin;uniform float tyreLoad;').replace('#include <begin_vertex>',`#include <begin_vertex>
     float cs=cos(tyreSpin),sn=sin(tyreSpin);float worldY=position.y*cs-position.z*sn;
     float radial=length(position.yz);float contactWeight=(1.-smoothstep(-.36,-.28,worldY))*smoothstep(.23,.32,radial);
     float lift=max(0.,-.36+tyreLoad-worldY);transformed.y+=lift*cs;transformed.z-=lift*sn;
     transformed.x+=sign(position.x)*tyreLoad*.4*contactWeight;
    `);};p.customProgramCacheKey=()=> 'loaded-slick-shutter';
   }
   p.aoMap=['Mirror','MarkWhite','GloveFabric','GlovePanel','GloveSuede','GloveStitch','Sleeve'].includes(p.name)?null:aoMap;p.aoMapIntensity=p.name==='WheelDish'?.28:.65;p.side=T.DoubleSide;m=p;if(!wheelRubber)materials.set(original,m);
  }return m;};o.material=Array.isArray(o.material)?o.material.map(m=>make(m as T.MeshStandardMaterial)):make(o.material as T.MeshStandardMaterial);o.castShadow=!(Array.isArray(o.material)?o.material:[o.material]).every(m=>bakedDetailShadow.has(m.name));o.receiveShadow=true;originals.set(o,o.material);}});
  for(const name of team==='a'?['NumberB','HelmetNumberB']:['NumberA','HelmetNumberA']){const unused=model.getObjectByName(name);if(unused)unused.visible=false;}
  compression.set(model,([-1,1] as const).map(side=>({side,meshes:bindGloveCompression(model.getObjectByName(side<0?'HandL':'HandR')!,side)})));
  fingerRigs.set(model,([-1,1] as const).flatMap(side=>Array.from({length:5},(_,digit)=>({node:model.getObjectByName(`Finger${side<0?'L':'R'}${digit}`)!,side,digit})).filter(binding=>!!binding.node)));
  rigs.push(model);lod.addLevel(model,index===0?0:32);const meshes:T.Mesh[]=[];model.traverse(o=>{if(o instanceof T.Mesh)meshes.push(o);});for(const m of meshes){const lines=new T.LineSegments(new T.WireframeGeometry(m.geometry),lineMaterial);lines.renderOrder=1;lines.visible=false;m.add(lines);wireLines.push(lines);}
  const steering=model.getObjectByName('Steering');
  if(steering){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;const material=new T.MeshBasicMaterial({map:tex,toneMapped:false});const display=new T.Mesh(new T.PlaneGeometry(.182,.101),material);display.position.set(0,.025,-.025);display.rotation.y=Math.PI;steering.add(display);originals.set(display,material);dashTextures.push(tex);dashContexts.push(canvas.getContext('2d')!);
   const row:T.MeshBasicMaterial[]=[];for(let i=0;i<12;i++){const lm=new T.MeshBasicMaterial({color:'#14211a',toneMapped:false});const led=new T.Mesh(new T.SphereGeometry(.0028,8,4),lm);led.position.set((i-5.5)*.010,.078,-.025);steering.add(led);originals.set(led,lm);row.push(lm);}lights.push(row);
  }
 });ready=true;setFinish(finish);}).catch(e=>{error=String(e);console.error('Car asset failed',e);});
 let lastDash=-1;
 return {root,chassis,loaded,get ready(){return ready;},get error(){return error;},setFinish,setMirror(texture:T.Texture|null){for(const m of mirrors){if(m.map!==texture){m.map=texture;m.emissiveMap=texture;m.emissive.set(texture?'#ffffff':'#000000');m.emissiveIntensity=.7;m.roughness=texture?1:.08;m.metalness=texture?0:.9;m.needsUpdate=true;}}},
 update(c:CarTelemetry,onboard=false,studio=false,now=performance.now()){
  for(const ink of sidewallInks)ink.color.set(studio?'#b7b4a9':(compoundColors[c.compound?.toLowerCase()??'hard']??compoundColors.hard));
  suspension.update(track,c,now,studio);
  chassis.rotation.set(suspension.pitch,0,suspension.roll);chassis.position.y=suspension.heave;
  inverseBody.copy(chassis.quaternion).invert();
  const spin=studio?0:c.distance/CAR_DIMENSIONS.tyreRadius;
  for(const u of tyreUniforms){u.spin.value=spin;u.load.value=suspension.compression[u.wheel];u.shutter.value=studio?0:Math.min(1.3,Math.abs(c.speed)/(240*CAR_DIMENSIONS.tyreRadius));}
  for(const model of rigs){
   for(const [i,station] of wheelStations.entries()){
    const hub=model.getObjectByName(station.name);if(!hub)continue;
    // The sprung chassis moves around the hubs. Express the road-space pose
    // in the moving chassis frame so neither pitch nor roll lifts a tyre.
    const height=CAR_DIMENSIONS.tyreRadius-suspension.compression[i]+suspension.heights[i];
    hub.position.set(station.x,height-suspension.heave,station.z).applyQuaternion(inverseBody);
    hub.rotation.set(0,i<2?(c.steering??0):0,0);hub.rotateX(spin);hub.quaternion.premultiply(inverseBody);
   }
   const hands=model.getObjectByName('Hands');if(hands)hands.visible=!studio;
   const suit=model.getObjectByName('SuitBody');if(suit)suit.visible=!studio;
   for(const {node,side,digit} of fingerRigs.get(model)??[]){
    const pose=fingerCurl(side,digit,c.steering??0,c.distance,c.speed);node.rotation.y=pose.curl;node.rotation.z=pose.spread;
   }
   for(const {side,meshes} of compression.get(model)??[]){
    const pressure=T.MathUtils.clamp(.32+side*(c.steering??0)*1.65-Math.min(0,c.acceleration??0)*.014,0,1);
    for(const mesh of meshes)mesh.morphTargetInfluences![0]=pressure;
   }
   const h=model.getObjectByName('Helmet');if(h)h.visible=!onboard;
   const s=model.getObjectByName('Steering');if(s){s.rotation.z=-(c.steering??0)*3.6;
    poseForearms(model,s,!studio);
   }
   const d=model.getObjectByName('DRS');if(d)d.rotation.x=suspension.flap;
  }
  const stamp=Math.floor(performance.now()/100);if(stamp!==lastDash){lastDash=stamp;dashContexts.forEach((ctx,i)=>{drawTelemetry(ctx,c);if(studio){ctx.fillStyle='#020403';ctx.fillRect(0,0,512,256);}dashTextures[i].needsUpdate=true;});
   const rpm=studio?0:c.rpm??(c.speed?10500:0),n=Math.round(T.MathUtils.clamp((rpm-7500)/4500,0,1)*12);lights.forEach(row=>row.forEach((m,i)=>m.color.set(i<n?(i<4?'#36d45b':i<8?'#f33035':'#508aff'):'#112019')));
  }
 },dispose(){dead=true;for(const [mesh,original] of originals)mesh.material=original;wireLines.forEach(o=>o.geometry.dispose());lineMaterial.dispose();clay.dispose();wire.dispose();carbonMap.dispose();grainMap.dispose();fabricMap.dispose();aoMap.dispose();dashTextures.forEach(t=>t.dispose());}};
}
