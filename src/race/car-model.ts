import {rigidCarParts} from './embedded-batches';
import {MeshResources} from './mesh-resources';
import {finishRotor} from './brake-rotor';
import {helmetLivery} from './helmet-livery';
import {compoundColors} from './grid';
import {posedGeometry,type InspectionPoses} from './inspection-pose';
import posesURL from './assets/inspection-poses.json.gz?url';
import {inspectionWire,shellGeometry,type InspectionShell} from './inspection-wire';
import {applyLivery,liveryAtlas} from './liveries';
import {grid,playerEntry} from './grid';
import {bindBodyDamage} from './damaged-body';
import {damageLevel} from './crashes';
import type {PanelDamage} from './types';
import * as T from 'three';
import {shapeBody} from './constructor-form';
import {constructorKit,trimMesh} from './constructor-trim';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {fingerCurl,poseForearms,bindGloveCompression} from './grip';
import {jackLift,cornerService} from './pit-service';
import {Suspension,wheelStations} from './suspension';
import type {Track} from './track';
import {embeddedGLB,gzipBytes} from './embedded-glb';
import highURL from './assets/jgp26-high.glb.gz?url';
import raceHighURL from './assets/jgp26-race-high.glb.gz?url';
import raceLowURL from './assets/jgp26-race-low.glb.gz?url';
import wireURL from './assets/jgp26-wire-shell.json.gz?url';
import contactURL from './assets/jgp26-contact.png?url';
import aoURL from './assets/jgp26-ao.png?url';
export const CAR_DIMENSIONS={wheelbase:3.6,width:2,length:5.62,tyreRadius:.36,frontAxle:1.55,rearAxle:-2.05};
export type Finish='colour'|'clay'|'wireframe';
// These millimetre-scale details already receive the Blender AO bake. They do
// not need a separate shadow draw in every window; major driver/car forms do.
const bakedDetailShadow=new Set(['MarkWhite','FenceInk','BankInk','VisorInk','FlapInk','FoilInk','BodyInk','NoseBadgeInk','GloveStitch','GloveSuede','HelmetInk','HelmetVisor','Screen','Mirror','Titanium','ButtonRed','ButtonGreen','ButtonBlue','ButtonYellow','BrandBlue','BrandGold']);
let raceHighTemplate:Promise<T.Group>|undefined;
let raceLowTemplate:Promise<T.Group>|undefined;
let inspectionHighTemplate:Promise<T.Group>|undefined;
let sharedAoMap:T.Texture|undefined;
let sharedFlake:T.DataTexture|undefined;
let sharedMaps:{carbonMap:T.CanvasTexture;weaveNormal:T.DataTexture;grainMap:T.CanvasTexture;fabricMap:T.CanvasTexture}|undefined;
let sharedWireShell:Promise<InspectionShell>|undefined;
function getAoMap(){
 if(!sharedAoMap){sharedAoMap=new T.TextureLoader().load(aoURL);sharedAoMap.flipY=false;sharedAoMap.channel=1;sharedAoMap.userData.shared=true;}
 return sharedAoMap;
}
function getSharedMaps(){
 if(!sharedMaps){
  const carbonMap=twill(),grainMap=grain(),fabricMap=knit();
  const source=carbonMap.image as HTMLCanvasElement,n=source.width,albedo=source.getContext('2d')!.getImageData(0,0,n,n).data;
  const fibers=new Uint8Array(n*n*4),normal=new T.Vector3();
  const at=(i:number,j:number)=>albedo[4*((i+n)%n+n*((j+n)%n))];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const k=4*(x+n*y);
   normal.set((at(x-1,y)-at(x+1,y))*.016,(at(x,y-1)-at(x,y+1))*.016,1).normalize();
   fibers[k]=(normal.x+1)*127.5;fibers[k+1]=(normal.y+1)*127.5;fibers[k+2]=(normal.z+1)*127.5;fibers[k+3]=255;
  }
  const weaveNormal=new T.DataTexture(fibers,n,n);weaveNormal.wrapS=weaveNormal.wrapT=T.RepeatWrapping;
  weaveNormal.repeat.copy(carbonMap.repeat);weaveNormal.magFilter=T.LinearFilter;weaveNormal.minFilter=T.LinearMipmapLinearFilter;weaveNormal.generateMipmaps=true;weaveNormal.anisotropy=import.meta.env.MCP_APP==='true'?4:8;weaveNormal.needsUpdate=true;weaveNormal.userData.shared=true;
  carbonMap.userData.shared=grainMap.userData.shared=fabricMap.userData.shared=true;
  sharedMaps={carbonMap,weaveNormal,grainMap,fabricMap};
 }
 return sharedMaps;
}
function loadWireShell(){
 return sharedWireShell??=gzipBytes(wireURL).then(bytes=>JSON.parse(new TextDecoder().decode(bytes)) as InspectionShell);
}
function loadTemplate(url:string){
 return embeddedGLB(url,true).then(g=>{
  g.scene.traverse(o=>{
   if(!(o instanceof T.Mesh))return;
   o.geometry.userData.shared=true;
   for(const m of Array.isArray(o.material)?o.material:[o.material]){
    for(const v of Object.values(m))if(v instanceof T.Texture)v.userData.shared=true;
   }
  });
  return g.scene;
 });
}
function assets(withInternals:boolean){
 const high=withInternals?(inspectionHighTemplate??=loadTemplate(highURL)):(raceHighTemplate??=loadTemplate(raceHighURL));
 const low=raceLowTemplate??=loadTemplate(raceLowURL);
 return Promise.all([high,low]);
}
export function prepareRaceCars(){
 return Promise.all([assets(false),constructorKit()]);
}
function fabricTexture(size:number,repeat:number,sample:(x:number,y:number)=>number){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
 const ctx=canvas.getContext('2d')!,image=ctx.createImageData(size,size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const offset=4*(y*size+x),value=Math.round(sample(x,y));
  image.data[offset]=image.data[offset+1]=image.data[offset+2]=value;image.data[offset+3]=255;
 }
 ctx.putImageData(image,0,0);
 const t=new T.CanvasTexture(canvas);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(repeat,repeat);
 t.anisotropy=import.meta.env.MCP_APP==='true'?4:8;return t;
}
function grain(){
 let seed=26;
 return fabricTexture(128,48,()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return 238+((seed>>>24)%17);});
}
function twill(){
 const n=256,canvas=document.createElement('canvas');canvas.width=canvas.height=n;
 const ctx=canvas.getContext('2d')!,image=ctx.createImageData(n,n);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const over=((x>>4)-(y>>4)+16)%4<2,across=over?x:y,along=over?y:x;
  const bundle=Math.sin((across%16+.5)*Math.PI/16),strand=Math.cos(across*Math.PI*.5);
  const k=(x+n*y)*4;
  image.data[k]=193+22*bundle+4*strand;
  image.data[k+1]=255*(.25+.30*(1-bundle));
  image.data[k+2]=130+65*bundle+10*Math.cos(along*Math.PI);
  image.data[k+3]=255;
 }
 ctx.putImageData(image,0,0);
 const map=new T.CanvasTexture(canvas);map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.setScalar(20);map.anisotropy=4;return map;
}
function microflake(){
 if(sharedFlake)return sharedFlake;
 const n=128,bytes=new Uint8Array(n*n*4);let seed=37;
 for(let i=0;i<bytes.length;i+=4){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  bytes[i]=112+(seed&31);bytes[i+1]=112+((seed>>8)&31);bytes[i+2]=254;bytes[i+3]=255;
 }
 const map=new T.DataTexture(bytes,n,n);map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.setScalar(20);
 map.magFilter=T.LinearFilter;map.minFilter=T.LinearMipmapLinearFilter;map.generateMipmaps=true;
 map.needsUpdate=true;map.userData.shared=true;return sharedFlake=map;
}
function knit(){
 return fabricTexture(64,96,(x,y)=>{
  const row=Math.floor(y/8),u=(x+(row%2)*4)%8,v=y%8,thread=Math.exp(-Math.pow((u-4-Math.sin(v/8*Math.PI)*2)/1.4,2));
  return 150+85*thread+8*Math.sin(v*Math.PI);
 });
}
export interface CarTelemetry{wear?:number;flag?:string;damage?:PanelDamage;distance:number;speed:number;offset?:number;heading?:number;steering?:number;drs?:boolean;compound?:string;acceleration?:number;lateralG?:number;pit?:string;pitTime?:number;totalStop?:number;instruction?:{tyre?:string;ers?:string};ersPowerKw?:number;temperature?:number;lap?:number;brakeBias?:number;splits?:number[];bestSectors?:number[];sector?:number;gear?:number;rpm?:number;ers?:number;lastLap?:number;bestLap?:number}
function drawTelemetry(ctx:CanvasRenderingContext2D,c:CarTelemetry,studio:boolean){
 const rect=(x:number,y:number,w:number,h:number,color:string)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
 function label(text:string,x:number,y:number,size:number,color:string,numeric=false){
  ctx.fillStyle=color;ctx.font='700 '+size+'px '+(numeric?'Oxanium':'"Space Grotesk"')+', sans-serif';ctx.fillText(text,x,y);
 }
 rect(0,0,512,256,'#03090e');
 if(studio){label('JGP   /   SYSTEM READY',36,113,35,'#afdadc');label('STANDBY',36,166,24,'#72a4ad');return;}
 const pit=c.pit&&c.pit!=='none',charge=Math.round(c.ers??0),sector=((c.sector??0)+2)%3;
 const split=c.splits?.[sector],best=c.bestSectors?.[sector],delta=split&&best?split-best:undefined;
 label('L'+((c.lap??0)+1),12,28,24,'#bccbd3');label('BB '+(c.brakeBias??56)+'%',105,28,24,'#bccbd3');
 rect(307,0,205,39,pit?'#f6b358':c.drs?'#7feaaf':'#49626e');
 label(pit?'PIT LIMITER':c.drs?'DRS OPEN':'ERS '+charge+'%',318,29,24,'#09141a');
 label(String(c.gear??'N'),14,162,145,'#f0f6f1',true);
 label(String(Math.round(c.speed*3.6)),154,116,78,'#e5f3f2',true);label('KM/H',368,115,24,'#92a6b0');
 label('S'+(sector+1)+'  '+(delta===undefined?'—':(delta>=0?'+':'')+delta.toFixed(3)),158,158,27,'#d3dfe4');
 rect(160,168,329,6,'#34434c');rect(324+(delta!==undefined&&delta<0?-Math.min(160,-delta*80):0),168,Math.min(160,Math.abs(delta??0)*80),6,(delta??0)<=0?'#65d598':'#eb8468');
 for(const [i,corner] of ['FL','FR','RL','RR'].entries()){
  const x=5+i*127;rect(x,188,120,64,'#17262d');label(corner,x+6,211,20,'#91d2c7');
  label(Math.round(c.temperature??85)+'°',x+40,211,19,'#cae3dd');
  label(Math.round(100*(1-(c.wear??0)))+'%',x+8,244,27,'#edf0f1',true);
 }
}
export function createCar(team:'a'|'b',track:Track,paintSheet:T.Texture,sceneMorph:(source:T.BufferGeometry)=>T.BufferGeometry,surfaceWater={value:0},reviewPose?:string,progress=1){
 const lift={front:0,rear:0,dropBounce:0};
 const suspension=new Suspension(),inverseBody=new T.Quaternion();
 const root=new T.Group(),chassis=new T.Group(),lod=new T.LOD();root.add(chassis);chassis.add(lod);
 if(import.meta.env.MCP_APP==='true'){
  const selectLevel=lod.update;
  lod.update=function(camera){
   selectLevel.call(this,camera);
   // The main camera, mirror and lake reflection can select different rigs
   // in one frame. Refresh the newly selected rig before Three submits it.
   const selected=this.levels[this.getCurrentLevel()]?.object;
   if(selected?.userData.deferredPose)selected.updateMatrixWorld(true);
  };
 }
 let shell:InspectionShell|undefined,poses:InspectionPoses|undefined,posed=false;
 let contact:T.Mesh<T.PlaneGeometry,T.ShaderMaterial>|undefined;
 if(import.meta.env.MCP_APP!=='true'){
  const tex=new T.TextureLoader().load(contactURL);tex.flipY=false;
  contact=new T.Mesh(new T.PlaneGeometry(4,7),new T.ShaderMaterial({
   uniforms:{contactMap:{value:tex},strength:{value:0}},transparent:true,depthWrite:false,
   vertexShader:'varying vec2 st;void main(){st=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:'uniform sampler2D contactMap;uniform float strength;varying vec2 st;void main(){gl_FragColor=vec4(0.,0.,0.,strength*(1.-texture2D(contactMap,st).r));}'
  }));
  contact.rotation.x=-Math.PI/2;contact.position.y=.009;root.add(contact);
 }
 const cowlStripPower={value:0};
 const owned=new MeshResources();
 const pairs=new Map<T.Mesh,{rest:T.BufferGeometry;inspection:T.BufferGeometry}>();
 const instruments:T.Mesh[]=[];
 const wireSurfaces:T.Mesh[]=[];
 const usesShell=(mesh:T.Mesh)=>!!shell&&(mesh.name==='Chassis_TwoToneCover'||mesh.parent?.name==='Chassis_TwoToneCover');
 const rainLights=new Set<T.MeshPhysicalMaterial>();
 const wheelSurface=(mesh:T.Mesh)=>/^(Front|Rear)[LR]_(SlickRubber|Rubber|WheelDish)$/.test(mesh.name);
 const isPrint=(mesh:T.Mesh)=>/^(ConformalDecals|Number[AB])_|_(VisorInk|MarkWhite|BrandBlue|BrandGold|CompoundInk)$/.test(mesh.name);
 const originals=new Map<T.Mesh,T.Material|T.Material[]>(),wireLines:T.LineSegments[]=[];
 const tyreWear={value:0};
 const {carbonMap,weaveNormal,grainMap,fabricMap}=getSharedMaps(),tyreUniforms:{spin:{value:number};load:{value:number};shutter:{value:number};grooves:{value:number};wheel:number}[]=[],aoMap=getAoMap();let ready=false,dead=false,finish:Finish='colour',error:string|null=null;
 type FinishMaterials={wireWheel:T.MeshStandardMaterial;wireCover:T.MeshStandardMaterial;wheelGrid:T.LineBasicMaterial;wirePrint:T.MeshBasicMaterial;clay:T.MeshStandardMaterial;wire:T.MeshStandardMaterial;lineMaterial:T.LineBasicMaterial;shellSurface:T.MeshStandardMaterial;shellGrid:T.LineBasicMaterial;floorSurface:T.MeshStandardMaterial;floorLines:T.LineBasicMaterial;fenceSurface:T.MeshStandardMaterial};
 let finishMats:FinishMaterials|undefined;
 function getFinishMaterials():FinishMaterials{
  if(finishMats)return finishMats;
  const wireWheel=new T.MeshStandardMaterial({color:'#5c7282',emissive:'#586c7b',emissiveIntensity:.38,transparent:true,opacity:.72,side:T.DoubleSide,roughness:.88,metalness:.03,envMapIntensity:.38,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  const wireCover=wireWheel.clone();wireCover.color.set('#95a6b0');wireCover.opacity=1;wireCover.transparent=false;wireCover.depthWrite=true;
  // Keep the two shoulder courses attached to the actual tyre section in every pose.
  wireWheel.onBeforeCompile=shader=>{
   shader.vertexShader=shader.vertexShader.replace('#include <common>',
    '#include <common>\nattribute float sectionRadius;\nvarying float tyreRadiusAtVertex;')
    .replace('#include <begin_vertex>','#include <begin_vertex>\ntyreRadiusAtVertex=sectionRadius;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float tyreRadiusAtVertex;')
    .replace('#include <opaque_fragment>',`
     float course=min(abs(tyreRadiusAtVertex-.266),abs(tyreRadiusAtVertex-.351));
     float feather=max(.0006,fwidth(tyreRadiusAtVertex)*.5);
     float ink=1.0-smoothstep(.001-feather,.001+feather,course);
     outgoingLight=mix(outgoingLight,vec3(.60,.73,.83),ink*.71);
     #include <opaque_fragment>
    `);
  };
  const wheelGrid=new T.LineBasicMaterial({color:'#bdcfda',transparent:true,opacity:.33,depthWrite:false});
  const wirePrint=new T.MeshBasicMaterial({visible:false});
  const clay=new T.MeshStandardMaterial({color:'#ebe7dd',roughness:.53,side:T.DoubleSide});
  clay.aoMap=aoMap;clay.aoMapIntensity=.57;
  if(reviewPose==='breakdown')clay.color.multiplyScalar(1.12);
  const wire=new T.MeshStandardMaterial({color:'#4d6371',roughness:.82,metalness:.08,envMapIntensity:.28,transparent:true,opacity:.65,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  const lineMaterial=new T.LineBasicMaterial({color:'#bad1df',transparent:true,opacity:.57,depthWrite:false});
  const shellSurface=wire.clone(),shellGrid=lineMaterial.clone();
  const floorSurface=wire.clone(),floorLines=lineMaterial.clone();
  const fenceSurface=wire.clone();fenceSurface.color.set('#18232c');fenceSurface.opacity=.96;
  const releasedFloor=reviewPose==='exploded'||reviewPose==='breakdown';
  if(releasedFloor){
   wireWheel.color.set('#a4b8c4');wireCover.color.set('#b3c3c9');wireWheel.opacity=.90;
   lineMaterial.opacity=.308;
  }
  wireWheel.color.multiplyScalar(.67);wireCover.color.multiplyScalar(.67);
  if(!releasedFloor){
   fenceSurface.color.multiplyScalar(1.3379);fenceSurface.opacity=0.7175;
   wire.opacity=.61;
   lineMaterial.opacity=.48;
   wireWheel.opacity=0.9200;wireWheel.color.multiplyScalar(.87);wireWheel.emissiveIntensity=0.2300;
   wireCover.color.multiplyScalar(.89);
  }
  // The opaque shoulder and thin, bright grid are separately visible on the near wheel.
  shellGrid.opacity=releasedFloor?.308:.30;
  shellSurface.color.multiplyScalar(releasedFloor?1.33:1.4215);shellSurface.opacity=releasedFloor?.793:0.8100;
  floorSurface.color.multiplyScalar(releasedFloor?.77:.47);
  floorSurface.opacity=releasedFloor?.12:.76;
  floorLines.opacity=releasedFloor?.22:0.2900;
  for(const material of [wire,shellSurface]){
   material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
     float grazing=pow(1.0-abs(dot(normalize(normal),normalize(vViewPosition))),3.6);
     outgoingLight=mix(outgoingLight,vec3(.56,.70,.80),grazing*.76);
     #ifdef USE_COLOR
     float nose=1.0-smoothstep(.50,.94,vColor.r);
     outgoingLight*=mix(1.0,.51,nose);
     diffuseColor.a=mix(diffuseColor.a,.87,nose);
     #endif
     #include <opaque_fragment>
    `);
   };
  }
  shellSurface.vertexColors=true;shellGrid.vertexColors=false;
  finishMats={wireWheel,wireCover,wheelGrid,wirePrint,clay,wire,lineMaterial,shellSurface,shellGrid,floorSurface,floorLines,fenceSurface};
  return finishMats;
 }
 function ensureTyreRadii(){
  for(const rig of rigs){
   rig.traverse(node=>{
    if(!(node instanceof T.Mesh)||!wheelSurface(node)||node.name.endsWith('_WheelDish'))return;
    const geometry=node.geometry;
    if(geometry.hasAttribute('sectionRadius'))return;
    const positions=geometry.getAttribute('position');
    const radii=Float32Array.from({length:positions.count},(_,i)=>Math.hypot(positions.getY(i),positions.getZ(i)));
    geometry.setAttribute('sectionRadius',new T.BufferAttribute(radii,1));
   });
  }
 }
 const compression=new WeakMap<T.Group,{side:-1|1;meshes:T.Mesh[]}[]>();
 const fingerRigs=new WeakMap<T.Group,{node:T.Object3D;side:-1|1;digit:number}[]>();
 const compoundInk={value:new T.Color()};
 let tyreContacts:T.Mesh|undefined;
 // Fine cockpit fittings are hidden below the coaming in external race shots.
 const linkageMeshes:T.Mesh[]=[],frontFlaps:T.Mesh[]=[],paddles:T.Mesh[]=[];
 let lastGear=0,shiftTime=-Infinity,shiftSide=1;
 const cockpitFittings:T.Mesh[]=[],neckPivot=new T.Vector3();
 const heroSheet=team==='b'&&import.meta.env.MCP_APP!=='true'?liveryAtlas([playerEntry(team)],3):null;
 const helmetMap=helmetLivery(team),discHeat={value:0};
 let wheelBrand:T.CanvasTexture|undefined;
 const lampColor=new T.Color(),rams:T.Mesh[]=[];
 let brakeHeat=0,lastHeatTime=0;
 // Keep the map shader variant stable when the rear camera supplies its first image.
 const mirrorFallback=import.meta.env.MCP_APP==='true'?new T.DataTexture(new Uint8Array([255,255,255,255]),1,1):null;
 if(mirrorFallback){mirrorFallback.needsUpdate=true;owned.textures.add(mirrorFallback);}
 const mirrorFaces=new Set<T.Mesh>(),mirrors:T.MeshPhysicalMaterial[]=[];
 type RigNodes={model:T.Group;hubs:(T.Object3D|undefined)[];knuckles:(T.Object3D|undefined)[];hands:T.Object3D|undefined;suit:T.Object3D|undefined;helmet:T.Object3D|undefined;steering:T.Object3D|undefined;drs:T.Object3D|undefined};
 const rigidUpdates:ReturnType<typeof rigidCarParts>[]=[];
 const rigs:T.Group[]=[],rigNodes:RigNodes[]=[],dashTextures:T.CanvasTexture[]=[],dashContexts:CanvasRenderingContext2D[]=[],lights:T.InstancedMesh[]=[];
 const deformations:((panels:PanelDamage)=>void)[]=[];
 const intact:PanelDamage=[0,0,0,0];let previousPanels:PanelDamage=intact;
 function attachWireShell(){
  if(!shell||wireSurfaces.length||dead||!ready)return;
  const {shellSurface,shellGrid,lineMaterial}=getFinishMaterials();
  for(const rig of rigs){
   const geo=shellGeometry(shell);
   if(posed&&poses&&reviewPose&&rig===rigs[0]){
    const cut=posedGeometry(geo.surface,poses,reviewPose,'shell',progress);
    geo.surface.dispose();geo.grid.dispose();geo.surface=cut;
    geo.grid=inspectionWire(cut,true);
   }
   const surface=new T.Mesh(geo.surface,shellSurface),grid=new T.LineSegments(geo.grid,geo.grid.hasAttribute('color')?shellGrid:lineMaterial);
   grid.renderOrder=1;surface.add(grid);rig.getObjectByName('Chassis')!.add(surface);
   surface.visible=finish==='wireframe';grid.visible=finish==='wireframe';
   wireSurfaces.push(surface);wireLines.push(grid);
  }
 }
 let loadingWireShell=false;
 function setFinish(next:Finish){
  finish=next;
  if(next==='colour'&&!finishMats)return;
  // The race views never display triangle edges. Extract them only when
  // the studio requests wireframe, then retain them for subsequent toggles.
  const fm=next==='colour'?finishMats:getFinishMaterials();
  if(next==='wireframe'&&ready){
   ensureTyreRadii();
   if(team==='a'&&!shell&&!loadingWireShell){
    loadingWireShell=true;
    void loadWireShell().then(data=>{shell=data;attachWireShell();}).catch(()=>{loadingWireShell=false;});
   }else if(shell&&!wireSurfaces.length)attachWireShell();
  }
  if(next==='wireframe'&&ready&&!wireLines.length&&fm){
   for(const mesh of originals.keys()){
    if(isPrint(mesh)||usesShell(mesh))continue;
    const wheel=wheelSurface(mesh),floorGrid=mesh.name==='Floor_Carbon';
    const diagonals=wheel||floorGrid||/^(Chassis_AeroLaminate|Chassis_Upper_flap_laminate|Chassis_FrontFenceLaminate|Chassis_RearAero|DRS_Carbon)$/.test(mesh.name);
    const grid=inspectionWire(mesh.geometry,diagonals,mesh.name.endsWith('_WheelDish')?3:wheel||floorGrid?2:1);
    const lines=new T.LineSegments(grid,wheel?fm.wheelGrid:floorGrid?fm.floorLines:fm.lineMaterial);
    lines.renderOrder=1;mesh.add(lines);wireLines.push(lines);
   }
  }
  wireSurfaces.forEach(o=>o.visible=next==='wireframe');
  wireLines.forEach(o=>o.visible=next==='wireframe');
  for(const [mesh,original] of originals)mesh.material=next==='colour'?original:!fm?original:next==='clay'?(/_(NoseBadgeInk|VisorInk|BankInk|FenceInk|FoilInk|FlapInk|BodyInk)$/.test(mesh.name)?fm.wirePrint:fm.clay):(isPrint(mesh)||usesShell(mesh))?fm.wirePrint:mesh.name==='Chassis_PortRecess'?original:mesh.name.endsWith('_WheelDish')?fm.wireCover:wheelSurface(mesh)?fm.wireWheel:mesh.name==='Floor_Carbon'?fm.floorSurface:mesh.name==='Floor_FloorFence'?fm.fenceSurface:fm.wire;
 }
 function setInspection(active:boolean){
  if(!poses||!reviewPose||posed===active)return;
  posed=active;
  cowlStripPower.value=active&&reviewPose==='service'?3.92:0;
  for(const [mesh,geo] of pairs)mesh.geometry=active?geo.inspection:geo.rest;
  for(const line of wireLines.splice(0)){line.removeFromParent();line.geometry.dispose();}
  for(const surface of wireSurfaces.splice(0)){surface.removeFromParent();surface.geometry.dispose();}
  setFinish(finish);
 }
 const bodyGroups=new Set(['Chassis','Floor','ConformalDecals','NumberA','NumberB','DRS']);
 const loaded=Promise.all([assets(!!reviewPose),constructorKit(),team==='a'&&reviewPose?loadWireShell():undefined,reviewPose?gzipBytes(posesURL).then(b=>JSON.parse(new TextDecoder().decode(b)) as InspectionPoses):undefined]).then(([models,kit,inspection,poseData])=>{if(dead)return;shell=inspection;poses=poseData;tyreContacts=trimMesh(kit,'Contact','#ffffff');root.add(tyreContacts);models.forEach((template,index)=>{
  const model=cloneSkeleton(template) as T.Group;const materials=new Map<T.Material,T.Material>();
  const hand=model.getObjectByName('HandR');
  hand?.updateWorldMatrix(true,false);
  const garmentRest=hand?.matrixWorld.clone().invert();
  model.traverse(o=>{if(o instanceof T.Mesh){const parent=(o.parent?.name??'').split('_')[0];
   if(/^(Steering_(Brushed button bezel|Button|MarkWhite|VisorInk|Screen|Titanium)|Chassis_(Seat pan laminate|Knee bolster)|SuitBody_(Button|Titanium))/.test(o.name))cockpitFittings.push(o);
   let ancestor:T.Object3D|null=o.parent,inBody=bodyGroups.has(parent);
   while(!inBody&&ancestor&&ancestor!==model){if(bodyGroups.has(ancestor.name.split('_')[0])){inBody=true;break;}ancestor=ancestor.parent;}
   if(inBody||(index===0&&reviewPose)){o.geometry=o.geometry.clone();o.geometry.userData={...o.geometry.userData,shared:false};}
   else if(Object.keys(o.geometry.morphAttributes).length)o.geometry=sceneMorph(o.geometry);
   if(team==='b'&&['Chassis','Floor','ConformalDecals','NumberA','NumberB','DRS'].includes(parent))shapeBody(o.geometry,-1,parent==='DRS');if((Array.isArray(o.material)?o.material:[o.material]).some((m:T.Material)=>m.name==='Mirror'))mirrorFaces.add(o);const make=(original:T.MeshStandardMaterial)=>{const wheelRubber=original.name==='SlickRubber';const wheelRotor=original.name==='BrakeDisc'&&/^(Front|Rear)[LR]_/.test(o.name);let m=wheelRubber||wheelRotor?undefined:materials.get(original);if(!m){const p=new T.MeshPhysicalMaterial({color:original.color,vertexColors:original.vertexColors,roughness:original.roughness,metalness:original.metalness,map:original.map,transparent:original.transparent,opacity:original.opacity});p.name=original.name;
   if(p.name==='Livery'){p.color.set(team==='a'?'#cf101e':'#545f66');p.roughness=team==='a'?.39:.32;p.metalness=team==='a'?.045:.48;p.clearcoat=team==='a'?.43:.70;p.clearcoatRoughness=team==='a'?.23:.145;p.specularIntensity=team==='a'?.45:.63;p.bumpMap=grainMap;p.bumpScale=.000018;}
   if(p.name==='DeepLivery'){p.color.set(team==='a'?'#640c28':'#17262c');p.roughness=.40;p.clearcoat=.54;p.clearcoatRoughness=.22;}
   if(p.name==='Ivory'){p.roughness=.36;p.clearcoat=.42;p.clearcoatRoughness=.20;}
   if(p.name==='Ivory'&&team==='b'){p.color.set('#20292c');p.metalness=.48;p.roughness=.46;
    // The cockpit coaming sees the road luminaire at grazing incidence.
    // A thin satin finish keeps its silver/teal base visible around the glint.
    p.clearcoat=.11;p.clearcoatRoughness=.29;p.specularIntensity=.36;}
   if(p.name==='FrontFenceLaminate'){p.color.set(team==='a'?'#27282b':'#343a40').multiplyScalar(1.079);p.roughness=.50;p.specularIntensity=.38;p.envMapIntensity=.82;}
   if(p.name==='Turned shaft steel'){
    p.roughness=0.880;p.metalness*=.82;p.envMapIntensity=3.630;p.color.multiplyScalar(2.05);
   }
   if(p.name==='Transmission alloy'){p.color.multiplyScalar(3.90);p.roughness=0.375;}
   if(p.name==='Machined intake bell'){p.roughness=0.440;p.specularIntensity=.45;p.envMapIntensity=0.580;p.color.multiplyScalar(1.79);}
   if(p.name==='PortRecess'){p.color.multiplyScalar(0.967);p.envMapIntensity=2.1;}
   if(p.name==='Endplate lamp lens'||p.name==='TailOptic'){p.emissive.set('#ff1b09');rainLights.add(p);}
   if(p.name==='Ground steel'){p.roughness=0.765;p.envMapIntensity=.74;p.color.multiplyScalar(0.563);}
   if(p.name==='Machined gear web'){p.roughness=0.675;p.color.multiplyScalar(0.853);}
   if(p.name==='RearFenceCarbon'){p.roughness=.46;p.metalness=.17;p.specularIntensity=.40;p.envMapIntensity=.67;}
   if(p.name==='CowlingEdge'){p.side=T.DoubleSide;p.clearcoat=.48;p.clearcoatRoughness=.22;}
   if(p.name==='Cockpit liner'){p.roughness=.76;p.specularIntensity=.19;p.envMapIntensity=.56;}
   if(p.name==='Knee bolster'){p.specularIntensity=.21;p.envMapIntensity=.45;}
   if(p.name==='Seat edge satin')p.roughness*= 1.3379;
   if(p.name==='Seat pan laminate'){p.specularIntensity=.28;p.envMapIntensity=.40;}
   if(p.name==='SeatFoam'){p.specularIntensity=.24;p.envMapIntensity=.38;p.bumpMap=grainMap;p.bumpScale=.00018;p.sheen=.20;}
   if(p.name==='WheelDish'){p.color.set('#434850');p.roughness=.36;p.metalness=.58;p.envMapIntensity=1.1;p.clearcoat=.065;}
   if(/Carbon|[Ll]aminate|HaloComposite|FloorFence|Wheel graphite brow|Cockpit liner/.test(p.name)&&!p.map){
    p.map=carbonMap;p.normalMap=weaveNormal;p.normalScale.setScalar(.105);
    p.onBeforeCompile=shader=>{
     shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      vec3 fibre=texture2D(map,vMapUv).rgb;diffuseColor.rgb*=fibre.r*(.96+.06*fibre.b);`)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,fibre.g,.45);')
      .replace('#include <normal_fragment_maps>',T.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;',
       'mapN.xy *= normalScale*(1.-smoothstep(1.,9.,vViewPosition.z));'));
    };
    p.customProgramCacheKey=()=>'packed-carbon';
   }
   if(p.name==='Camera ID')p.color.set(team==='b'?'#d3ff16':'#17181a');
   if(p.name==='HaloInk'){p.transparent=false;p.alphaTest=.4;}
   if(p.name==='Livery'&&import.meta.env.MCP_APP!=='true'){
    p.clearcoatNormalMap=microflake();p.clearcoatNormalScale.setScalar(.08);
   }
   if(wheelRotor){
    if(!o.geometry.hasAttribute('rotorPlane')){
     o.updateMatrix();const pos=o.geometry.getAttribute('position'),plane=new Float32Array(pos.count*2),v=new T.Vector3();
     for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).applyMatrix4(o.matrix);plane[i*2]=v.y;plane[i*2+1]=v.z;}
     o.geometry.setAttribute('rotorPlane',new T.BufferAttribute(plane,2));
    }
    p.roughness=.65;p.metalness=.45;finishRotor(p,discHeat,o.name.startsWith('Rear')?.55:1);
   }
   if(p.name==='Sleeve'){p.bumpMap=fabricMap;p.bumpScale=.00024;p.color.set(team==='a'?'#851d2a':'#293337');p.roughness=.95;p.sheen=.4;}
   if(p.name==='AeroLaminate'||p.name==='Upper flap laminate'){p.color.set(team==='a'?'#15191d':'#343a40');p.roughness=.55;p.metalness=.08;p.clearcoat=.07;p.clearcoatRoughness=.42;p.specularIntensity=.29;p.envMapIntensity=.64;}
   if(p.name==='AeroLaminate')p.color.multiplyScalar(1.505);
   if(p.name==='Upper flap laminate'){p.color.multiplyScalar(1.248);p.specularIntensity=.21;}
   if(p.name==='Nose lower laminate'){p.color.multiplyScalar(1.778);p.specularIntensity=.22;p.envMapIntensity=.49;}
   if(p.name==='Carbon'||p.name==='FloorFence'){p.color.set('#3d4145');p.roughness=.55;p.metalness=.085;p.clearcoat=.055;p.specularIntensity=.46;p.envMapIntensity=.78;}
   if(p.name==='VisorInk'&&team==='b'){
    if(!wheelBrand){const plate=document.createElement('canvas');plate.width=1024;plate.height=240;const ink=plate.getContext('2d')!;
     ink.font='italic bold 130px Arial';ink.textAlign='center';ink.fillStyle='#dce4e5';ink.fillText('AMG PETRONAS',512,166,965);
     wheelBrand=new T.CanvasTexture(plate);wheelBrand.colorSpace=T.SRGBColorSpace;wheelBrand.anisotropy=import.meta.env.MCP_APP==='true'?4:8;}
    p.map=wheelBrand;p.transparent=true;p.alphaTest=.04;
   }
   if(p.name==='BankInk'){p.color.multiplyScalar(1.329);p.specularIntensity=.28;}
   if(p.name==='FlapInk'||p.name==='BodyInk'){
    p.color.set('#ffffff');p.specularIntensity=.12;p.roughness=.67;p.depthWrite=false;
    if(p.map)p.map.anisotropy=import.meta.env.MCP_APP==='true'?4:8;
   }
   if(p.name==='GripRubber'){p.roughness*=1.27;p.color.multiplyScalar(1.9);}
   if(p.name==='Wheel graphite brow'){p.roughness*=1.1880;p.color.multiplyScalar(.78);p.specularIntensity=.32;p.envMapIntensity=.45;}
   if(p.name==='HaloComposite'){p.color.set('#41464b');p.roughness=.39;p.metalness=.18;p.clearcoat=.18;p.clearcoatRoughness=.36;}
   if(p.name.startsWith('Button')){p.roughness=.44;p.clearcoat=.20;p.clearcoatRoughness=.30;}
   if(p.name==='Mirror'){
    if(mirrorFallback)p.map=p.emissiveMap=mirrorFallback;
    mirrors.push(p);o.geometry.computeBoundingBox();const bounds=o.geometry.boundingBox!,pos=o.geometry.getAttribute('position'),uv=new Float32Array(pos.count*2),mid=(bounds.min.x+bounds.max.x)/2;
    for(let i=0;i<pos.count;i++){
     const left=pos.getX(i)>mid,cx=left?bounds.max.x-.0875:bounds.min.x+.0875;
     const u=T.MathUtils.clamp(.5+(pos.getX(i)-cx)/.175,.002,.998);
     uv[i*2]=(left?0:.5)+u*.5;
     uv[i*2+1]=T.MathUtils.clamp((pos.getY(i)-bounds.min.y)/.038,.004,.996);
    }o.geometry.setAttribute('uv',new T.BufferAttribute(uv,2));
   }
   if(p.name==='GloveSuede'){p.roughness=.64;p.sheen=.20;p.sheenColor.set('#858a90');p.sheenRoughness=.95;p.bumpMap=grainMap;p.bumpScale=.00012;}
   if(p.name==='GlovePanel'){p.color.set(team==='a'?'#4c2028':'#17383f');p.roughness=.73;p.bumpMap=fabricMap;p.bumpScale=.00028;p.sheen=.15;}
   if(p.name==='GloveFabric'){p.color.set('#ffffff');p.roughness=.95;p.sheen=.24;p.sheenColor.set('#bda99b');}
   if(['GloveFabric','GloveSuede','GlovePanel','Sleeve'].includes(p.name)){
    // Work in fabric space to keep the weave independent of the packed AO atlas.
    // Attenuate subpixel threads in wider shots to avoid shimmer on moving hands.
    p.onBeforeCompile=shader=>{
     shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 clothPoint;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nclothPoint=position;');
     shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 clothPoint;')
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
       vec2 weaveCoord=vec2(dot(clothPoint,vec3(.84,.37,-.34)),dot(clothPoint,vec3(-.31,.52,.79)))*440.;
       float resolve=1.-smoothstep(.17,.8,max(fwidth(weaveCoord.x),fwidth(weaveCoord.y)));
       float weft=cos(6.28318*weaveCoord.x+1.2*sin(3.14159*weaveCoord.y))*cos(3.14159*weaveCoord.y);
       float nap=sin(dot(clothPoint,vec3(318.,-207.,89.)))*sin(dot(clothPoint,vec3(183.,103.,-142.)));
       diffuseColor.rgb*=1.+.034*nap;
       diffuseColor.rgb*=1.+.135*weft*resolve;
       roughnessFactor=clamp(roughnessFactor+.030*weft*resolve,.65,1.);
      `);
    };
    const textile=p.onBeforeCompile;
    if(p.name==='GloveFabric')p.onBeforeCompile=(shader,renderer)=>{
     textile.call(p,shader,renderer);
     shader.uniforms.garmentRest={value:garmentRest};
     shader.vertexShader='uniform mat4 garmentRest;\n'+shader.vertexShader.replace('clothPoint=position;',
      'clothPoint=(garmentRest*vec4(abs(position.x),position.yz,1.)).xyz;');
     shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float teamInk=smoothstep(.018,.12,diffuseColor.r-max(diffuseColor.g,diffuseColor.b));
      ${team==='b'?'diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.018,.155,.175)*(diffuseColor.r/.44),teamInk);':''}
      float wristY=-.062+.057*smoothstep(-.105,-.022,clothPoint.z);
      vec2 radial=vec2((abs(clothPoint.x)-.209)/.033,(clothPoint.y-wristY)/.044);
      float hem=clothPoint.z+.094+.006*radial.y/max(length(radial),.001);
      float aa=max(.00018,fwidth(hem)*.65);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.69,.67,.58),.84*(1.-smoothstep(.001-aa,.001+aa,abs(hem))));`);
    };
    p.customProgramCacheKey=()=>p.name==='GloveFabric'?'driver-shell-'+team:'woven-racewear';
   }
   if(p.name==='HelmetPaint'){p.map=helmetMap;p.color.set('#ffffff');p.metalness=.31;p.roughness=.29;p.clearcoat=1;p.clearcoatRoughness=.19;
    // The dome uses a planar island across its pole. Its ellipsoid normal
    // gives the same continuous highlight on the full and simplified mesh.
    p.onBeforeCompile=shader=>{
     shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
      if(uv.y < .5) {
       vec2 rim=(vec2(uv.x-.5,.25-uv.y))/.247;
       objectNormal=normalize(vec3(rim.x/.155,sqrt(max(0.,1.-dot(rim,rim)))/.101,rim.y/(rim.y>0.?.177:.175)));
      }`);
    };p.customProgramCacheKey=()=>'helmet-crown-normal';
   }
   if(p.name==='HelmetVisor'){p.color.set(team==='a'?'#3a2b23':'#192a42');p.iridescence=.87;p.iridescenceIOR=1.35;p.roughness=.095;p.metalness=.50;p.ior=1.58;p.clearcoat=1;p.clearcoatRoughness=.07;p.envMapIntensity=1.32;}
   if(p.name==='Rubber'||wheelRubber){p.color.set(p.map?'#ffffff':'#17181a');p.roughness=wheelRubber?.64:.87;p.bumpMap=grainMap;p.bumpScale=.00018;p.roughnessMap=grainMap;}
   if(wheelRubber){
    p.roughnessMap=null;p.roughness=.89;p.metalness=0;p.specularIntensity=.37;p.ior=1.47;
    if(p.map)p.map.anisotropy=import.meta.env.MCP_APP==='true'?4:8;
    const u={spin:{value:0},load:{value:.008},shutter:{value:0},grooves:{value:0},wheel:wheelStations.findIndex(w=>w.name===o.parent!.name)};tyreUniforms.push(u);
    p.onBeforeCompile=shader=>{// Sidewall mould lines and circumferential tread scrub are anchored to
     // tyre space, so their finish rotates with the wheel and survives LOD changes.
     shader.uniforms.surfaceWater=surfaceWater;shader.uniforms.compoundInk=compoundInk;shader.uniforms.tyreGrooves=u.grooves;shader.uniforms.tyreWear=tyreWear;
     shader.vertexShader=shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec3 tyrePoint;').replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntyrePoint=position;');
     shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform float surfaceWater; uniform vec3 compoundInk; uniform float tyreGrooves,tyreWear; varying vec3 tyrePoint;').replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
       float r=length(tyrePoint.yz);
       float shoulder=smoothstep(.331,.359,r);
       float angle=atan(tyrePoint.z,tyrePoint.y);
       float scrub=.5+.5*sin(tyrePoint.x*970.0+2.8*sin(angle*7.0)+1.4*cos(angle*13.0+tyrePoint.x*25.0));
       float resolved=1.-smoothstep(.001,.006,fwidth(tyrePoint.x));
       float mould=abs(fract(r*148.0)-.5);
       float ring=(1.-smoothstep(.04,.05+fwidth(r)*150.,mould))*(1.-shoulder)*smoothstep(.236,.253,r);
       // The moulded outer wall has a wider sheen than a clear-coated
       // panel. The scuffed contact belt stays diffuse under a direct lamp.
       float bandAA=max(.0004,fwidth(r));
       float band=1.-smoothstep(.003,.003+bandAA,abs(r-.316));
       diffuseColor.rgb=mix(diffuseColor.rgb,compoundInk,band*printedArc);
       float tread=smoothstep(.343,.358,r);
       float grain=sin(tyrePoint.x*1800.+4.*cos(angle*61.))*sin(angle*529.);
       roughnessFactor+=.045*grain*resolved*tread;
       diffuseColor.rgb*=1.-.16*tyreWear*shoulder*resolved*(.5+.5*grain);
       roughnessFactor=clamp(roughnessFactor-.16*shoulder+.18*tread+.065*(scrub-.5)*resolved,.70,.96);
       float treadPhase=angle*20./6.283185+abs(tyrePoint.x)*4.;
       float channel=1.-smoothstep(.055,.12+fwidth(treadPhase),abs(fract(treadPhase)-.5));
       float circum=1.-smoothstep(.06,.16,abs(fract(tyrePoint.x*19.)-.5));
       float groove=tread*max(channel*min(1.,tyreGrooves),circum*max(0.,tyreGrooves-1.));
       diffuseColor.rgb*=1.-.76*groove;
       roughnessFactor=max(.32,roughnessFactor-.32*groove-.13*tyreWear*tread);
       float film=surfaceWater*(.26+.69*tread);
       roughnessFactor=mix(roughnessFactor,.20+.09*scrub*resolved,film);
       diffuseColor.rgb*=1.-.30*film;
       diffuseColor.rgb*=1.+.10*ring+shoulder*(.09+.13*(scrub-.5)*resolved);
      `);
     shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`
      #ifdef USE_BUMPMAP
       float channelDepth=-groove*mix(.0032,.0051,clamp(tyreGrooves-1.,0.,1.))*(1.-.55*tyreWear);
       float rubberHeight=channelDepth+.00019*grain*tread*resolved+.00010*ring;
       normal=perturbNormalArb(-vViewPosition,normal,vec2(dFdx(rubberHeight),dFdy(rubberHeight)),faceDirection);
      #endif`);
     // Integrate the printed sidewall over a 1/240 s exposure. Only the
     // rotating ink changes; the stationary showroom retains the source print.
     shader.uniforms.shutterArc=u.shutter;
     shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform float shutterArc;').replace('#include <map_fragment>',`
       vec2 sideDirection=tyrePoint.yz/max(length(tyrePoint.yz),.0001);
       float sector=sideDirection.y*sideDirection.y;
       float sectorAA=max(.006,fwidth(sector));
       float printedArc=smoothstep(.52-sectorAA,.52+sectorAA,sector);
       #ifdef USE_MAP
        vec4 ink=texture2D(map,vMapUv);
        vec2 radialUv=vMapUv-.5;
        vec2 dx=dFdx(vMapUv),dy=dFdy(vMapUv);
        if(shutterArc>.015 && dot(radialUv,radialUv)<.255){
         vec2 sweep=vec2(-radialUv.y,radialUv.x)*shutterArc/7.;
         // Supply the angular coverage of one tap to the anisotropic sampler.
         vec2 major=length(sweep)>length(dx)?sweep:dx;
         ink=vec4(0.);printedArc=0.;
         for(int tap=-3;tap<=3;tap++){
          float a=float(tap)*shutterArc/7.,cs=cos(a),sn=sin(a);
          mat2 turn=mat2(cs,sn,-sn,cs);
          vec2 uv=.5+turn*radialUv;
          float phase=(turn*sideDirection).y;
          printedArc+=smoothstep(.52-sectorAA,.52+sectorAA,phase*phase)/7.;
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
   p.aoMap=['Mirror','MarkWhite','BankInk','BodyInk','FlapInk','VisorInk','GloveFabric','GlovePanel','GloveSuede','GloveStitch','Sleeve'].includes(p.name)?null:aoMap;p.aoMapIntensity=p.name==='HelmetPaint'?.10:p.name==='WheelDish'?.28:p.name==='PortRecess'?.10:.65;p.side=T.DoubleSide;m=p;owned.material(p);if(!wheelRubber&&!wheelRotor)materials.set(original,m);
  }return m;};o.material=Array.isArray(o.material)?o.material.map(m=>make(m as T.MeshStandardMaterial)):make(o.material as T.MeshStandardMaterial);o.castShadow=!(Array.isArray(o.material)?o.material:[o.material]).every(m=>bakedDetailShadow.has(m.name));o.receiveShadow=!(o.name==='Helmet_HelmetPaint');originals.set(o,o.material);}});
  model.updateMatrixWorld(true);
  model.traverse(node=>{
   if(!(node instanceof T.Mesh))return;
   if(node.name.endsWith('_ActuatorRam')){
    owned.geometries.add(node.geometry);
    const geometry=node.geometry.clone(),pos=geometry.getAttribute('position'),delta=new Float32Array(pos.count*3),p=new T.Vector3(),q=new T.Vector3();
    const hinge=new T.Vector3(0,.87,-2.42),axis=new T.Vector3(1,0,0),end=new T.Vector3(0,.89,-2.46);
    const throwVector=end.clone().sub(hinge).applyAxisAngle(axis,-.43).add(hinge).sub(end);
    for(let i=0;i<pos.count;i++){p.fromBufferAttribute(pos,i);node.localToWorld(p);q.copy(p).addScaledVector(throwVector,T.MathUtils.clamp((-2.32-p.z)/.14,0,1));node.worldToLocal(q);delta.set([q.x-pos.getX(i),q.y-pos.getY(i),q.z-pos.getZ(i)],3*i);}
    geometry.userData={...geometry.userData,shared:false};geometry.morphTargetsRelative=true;geometry.morphAttributes.position=[new T.BufferAttribute(delta,3)];node.geometry=geometry;node.updateMorphTargets();rams.push(node);
   }
   if(node.name.includes('MovingFlap')||node.name.includes('ShiftPaddle')){
    const sign=node.name.includes('Left')?-1:1;
    node.userData.hinge=node.name.includes('MovingFlap')?new T.Vector3(sign*.45,.21,2.22):new T.Vector3(sign*.095,0,.034);
    node.userData.restOrigin=node.position.clone();
    node.userData.restOrientation=node.quaternion.clone();
   }
   if(node.name.includes('ShiftPaddle')){paddles.push(node);node.userData.restYaw=node.rotation.y;}
   if(node.name.includes('MovingFlap')){frontFlaps.push(node);node.userData.restPitch=node.rotation.x;}
   if(!node.name.includes('SuspensionCarbon'))return;
   owned.geometries.add(node.geometry);
   const geo=node.geometry.clone(),pos=geo.getAttribute('position'),morphs=Array.from({length:6},()=>new Float32Array(pos.count*3));
   const pt=new T.Vector3(),tip=new T.Vector3(),toRig=node.matrixWorld,fromRig=toRig.clone().invert();
   for(let i=0;i<pos.count;i++){
    pt.fromBufferAttribute(pos,i).applyMatrix4(toRig);
    const corner=(pt.z>0?0:2)+(pt.x>0?1:0);
    const weight=T.MathUtils.clamp((Math.abs(pt.x)-.17)/.57,0,1);
    if(corner<2){
     const axle=wheelStations[corner];
     tip.copy(pt);tip.x+=(pt.z-axle.z)*weight;tip.z-=(pt.x-axle.x)*weight;
     tip.applyMatrix4(fromRig);const yaw=morphs[4+corner];yaw[3*i]=tip.x-pos.getX(i);yaw[3*i+1]=tip.y-pos.getY(i);yaw[3*i+2]=tip.z-pos.getZ(i);
    }
    tip.copy(pt);tip.y+=weight;
    tip.applyMatrix4(fromRig);morphs[corner][3*i]=tip.x-pos.getX(i);morphs[corner][3*i+1]=tip.y-pos.getY(i);morphs[corner][3*i+2]=tip.z-pos.getZ(i);
   }
   geo.userData={...geo.userData,shared:false};geo.morphTargetsRelative=true;geo.morphAttributes.position=morphs.map(a=>new T.BufferAttribute(a,3));
   node.geometry=geo;node.updateMorphTargets();linkageMeshes.push(node);
  });
  if(team==='a'&&reviewPose)model.traverse(node=>{
   if(!(node instanceof T.Mesh)||!node.geometry.hasAttribute('_cowllacquer'))return;
   const innerLaminate=(exterior:T.MeshPhysicalMaterial)=>{
    const material=exterior.clone();
    material.onBeforeCompile=shader=>{
     shader.uniforms.cowlCarbon={value:carbonMap};
     shader.vertexShader=shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute float _cowllacquer; varying float cowlCoverage; varying vec2 cowlUV;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\ncowlCoverage=_cowllacquer;cowlUV=uv*20.;');
     shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying float cowlCoverage; varying vec2 cowlUV; uniform sampler2D cowlCarbon;')
      .replace('#include <color_fragment>',`#include <color_fragment>
       if(!gl_FrontFacing)diffuseColor.rgb=mix(vec3(.022,.024,.028)*texture2D(cowlCarbon,cowlUV).r,vec3(.66,.010,.018),cowlCoverage);`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
       if(!gl_FrontFacing)roughnessFactor=mix(.52,.20,cowlCoverage);`);
     // Blender links this grazing softbox to the exposed fairings. A global
     // studio light would also wash out the diffuser, gear teeth and endplate.
     if(reviewPose==='service'){
      shader.uniforms.cowlStripPower=cowlStripPower;
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
       '#include <common>\nuniform float cowlStripPower;')
       .replace('#include <lights_fragment_end>',`
        #if NUM_RECT_AREA_LIGHTS > 0
         if(cowlStripPower>0.){
          vec3 source=vec3(-1.85,1.65,-3.25);
          vec3 normalToLamp=normalize(source-vec3(0.,1.12,-2.40));
          vec3 horizontal=normalize(cross(vec3(0.,1.,0.),normalToLamp));
          RectAreaLight strip;
          strip.position=(viewMatrix*vec4(source,1.)).xyz;
          strip.halfWidth=mat3(viewMatrix)*horizontal*1.35;
          strip.halfHeight=mat3(viewMatrix)*cross(normalToLamp,horizontal)*.275;
          strip.color=cowlStripPower*vec3(1.,.94,.87);
          RE_Direct_RectArea(strip,geometryPosition,geometryNormal,geometryViewDir,
                             geometryClearcoatNormal,material,reflectedLight);
          source=vec3(.61,.29,-1.36);
          normalToLamp=normalize(source-vec3(.267,1.08,-1.80));
          vec3 stripAxis=vec3(.35,.20,.62);
          horizontal=normalize(stripAxis-normalToLamp*dot(stripAxis,normalToLamp));
          strip.position=(viewMatrix*vec4(source,1.)).xyz;
          strip.halfWidth=mat3(viewMatrix)*horizontal*.375;
          strip.halfHeight=mat3(viewMatrix)*cross(normalToLamp,horizontal)*.039;
          strip.color=vec3(cowlStripPower*2.1);
          RE_Direct_RectArea(strip,geometryPosition,geometryNormal,geometryViewDir,
                             geometryClearcoatNormal,material,reflectedLight);
         }
        #endif
        #include <lights_fragment_end>`);
     }
    };
    material.customProgramCacheKey=()=>reviewPose==='service'?'service-cowl-lacquer':'cowl-lacquer';
    return material;
   };
   node.material=Array.isArray(node.material)?node.material.map(innerLaminate):innerLaminate(node.material);
   originals.set(node,node.material);
  });
  if(reviewPose==='service'){
   const diffuser=model.getObjectByName('Floor_Carbon');
   if(diffuser instanceof T.Mesh && diffuser.material instanceof T.MeshPhysicalMaterial){
    const laminate=diffuser.material.clone();
    laminate.color.multiplyScalar(.86);
    laminate.roughness=.54;
    diffuser.material=laminate;
    originals.set(diffuser,laminate);
   }
  }
  for(const name of team==='a'?['NumberB','HelmetNumberB']:['NumberA','NumberB','HelmetNumberA']){const unused=model.getObjectByName(name);if(unused)unused.visible=false;}
  // The Ferrari export carries its own closed wheel covers and projected print.
  if(team==='b'){
   for(const wheel of wheelStations){
    const pivot=model.getObjectByName(wheel.name)!;
    const dish=pivot.getObjectByName(wheel.name+'_WheelDish');
    if(dish)dish.visible=false;
    const spokes=trimMesh(kit,'ForgedSpokes','#888b8e');
    spokes.scale.x=Math.sign(wheel.x);spokes.position.x=spokes.scale.x*(wheel.z>0?.305:.405)/2;
    spokes.receiveShadow=true;pivot.add(spokes);originals.set(spokes,spokes.material);
   }
   const oldMarks=model.getObjectByName('Chassis_MarkWhite');if(oldMarks)oldMarks.visible=false;
   const shoulder=trimMesh(kit,'BodyMercedes','#00998f');
   shoulder.receiveShadow=true;model.getObjectByName('Chassis')!.add(shoulder);originals.set(shoulder,shoulder.material);
   const aero=trimMesh(kit,'W17Aero','#394148');
   const laminate=aero.material as T.MeshStandardMaterial;
   laminate.roughness=.39;laminate.metalness=.13;
   aero.castShadow=true;aero.receiveShadow=true;model.getObjectByName('Chassis')!.add(aero);originals.set(aero,aero.material);
   model.updateMatrixWorld(true);
   const wrapMaterials=new Map<T.Material,T.MeshStandardMaterial>(),bodyPoint=new T.Vector3();
   model.getObjectByName('ConformalDecals')!.visible=false;
   model.getObjectByName('Chassis')!.traverse(node=>{
    if(!(node instanceof T.Mesh))return;
    const wrap=(mat:T.Material)=>{
     const endplate=['Carbon','AeroLaminate','FrontFenceLaminate'].includes(mat.name)||node===aero;
     if(!endplate&&!['Livery','DeepLivery','Ivory'].includes(mat.name)&&node!==shoulder)return mat;
     if(!node.geometry.hasAttribute('liveryPoint')){
      const pos=node.geometry.getAttribute('position'),coords=new Float32Array(pos.count*3);
      for(let i=0;i<pos.count;i++)bodyPoint.fromBufferAttribute(pos,i).applyMatrix4(node.matrixWorld).toArray(coords,i*3);
      const normalMatrix=new T.Matrix3().getNormalMatrix(node.matrixWorld),normals=new Int8Array(pos.count*3);
      const sourceNormals=node.geometry.getAttribute('normal');
      for(let i=0;i<pos.count;i++)bodyPoint.fromBufferAttribute(sourceNormals,i).applyNormalMatrix(normalMatrix).multiplyScalar(127).round().toArray(normals,i*3);
      node.geometry.setAttribute('liveryNormal',new T.BufferAttribute(normals,3,true));
      node.geometry.setAttribute('liveryPoint',new T.BufferAttribute(coords,3));
     }
     let wrapped=wrapMaterials.get(mat);
     if(!wrapped){wrapped=(mat as T.MeshStandardMaterial).clone();wrapped.onBeforeCompile=mat.onBeforeCompile;wrapped.customProgramCacheKey=mat.customProgramCacheKey.bind(mat);applyLivery(wrapped,heroSheet??paintSheet,false,grid.indexOf(playerEntry(team)),endplate);wrapMaterials.set(mat,wrapped);}
     return wrapped;
    };
    node.material=Array.isArray(node.material)?node.material.map(wrap):wrap(node.material);originals.set(node,node.material);
   });
  }
  const changing=new Set<T.Mesh>(cockpitFittings);
  for(const group of ['Chassis','Floor','ConformalDecals','NumberA','NumberB','DRS']){
   for(const part of model.getObjectByName(group)?.children??[]){
    if(!(part instanceof T.Mesh)&&!part.name.startsWith(group+'_'))continue;
    part.traverse(node=>{
     if(node instanceof T.Mesh){const deform=bindBodyDamage(node);if(deform){deformations.push(deform);changing.add(node);}}
    });
   }
  }
  compression.set(model,([-1,1] as const).map(side=>{const hand=model.getObjectByName(side<0?'HandL':'HandR');return {side,meshes:hand?bindGloveCompression(hand,side,sceneMorph):[]};}));
  fingerRigs.set(model,([-1,1] as const).flatMap(side=>Array.from({length:5},(_,digit)=>({node:model.getObjectByName(`Finger${side<0?'L':'R'}${digit}`)!,side,digit})).filter(binding=>!!binding.node)));
  if(index===0&&poses&&reviewPose){
   const data=poses,name=reviewPose;
   model.traverse(o=>{
    if(!(o instanceof T.Mesh))return;
    const rest=o.geometry,inspection=posedGeometry(rest,data,name,rest.userData.inspectionPart,progress);
    if(inspection!==rest)pairs.set(o,{rest,inspection});
   });
   if(!pairs.size)throw new Error('Missing inspection bindings for '+name);
  }
  if(import.meta.env.MCP_APP==='true'){
   model.traverse(o=>{
    if(!(o instanceof T.Mesh))return;
    // Separate caliper ribs sit inside the wheel dish. The distant model
    // also omits small camera fittings and individual cockpit transfers.
    if(o.name.endsWith('Knuckle_Centrelock gunmetal')||
      (index>0&&/^(Helmet_(MarkWhite|Titanium)|HelmetNumber[AB]_Titanium|Chassis_(ButtonRed|Camera ID|Rubber|HaloInk)|(?:Front|Rear)[LR]Knuckle_(Titanium|Cavity))$/.test(o.name)))o.visible=false;
    // Wheel hubs, arm joints and fingers animate their children through the
    // hierarchy. Only the flap and paddle meshes change their local pose.
    if(!o.children.length&&!o.userData.hinge&&!(o instanceof T.SkinnedMesh)){
     o.updateMatrix();o.matrixAutoUpdate=false;
    }
    const g=o.geometry;if(!g.boundingSphere)g.computeBoundingSphere();
    const radius=g.boundingSphere!.radius*o.matrixWorld.getMaxScaleOnAxis();
    if(radius<.025)o.castShadow=false;
    if(radius<.12||/Glove|Stitch|Knuckle|Caliper|Centrelock|Button|VisorInk|Number[A-B]/.test(o.name))o.layers.set(1);
   });
   rigidUpdates.push(rigidCarParts(model,changing));
   const updatePose=model.updateMatrixWorld;
   model.updateMatrixWorld=function(force){
    if(!this.visible){this.userData.deferredPose=true;return;}
    updatePose.call(this,force||this.userData.deferredPose);
    this.userData.deferredPose=false;
   };
  }
  rigs.push(model);lod.addLevel(model,index===0?0:32);
  rigNodes.push({
   model,
   knuckles:wheelStations.map(s=>model.getObjectByName(s.name+'Knuckle')),
   hubs:wheelStations.map(s=>model.getObjectByName(s.name)),
   hands:model.getObjectByName('Hands'),
   suit:model.getObjectByName('SuitBody'),
   helmet:model.getObjectByName('Helmet'),
   steering:model.getObjectByName('Steering'),
   drs:model.getObjectByName('DRS'),
  });
  const steering=index===0?model.getObjectByName('Steering'):undefined;
  if(steering){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;const material=new T.MeshBasicMaterial({map:tex,toneMapped:false});const display=new T.Mesh(new T.PlaneGeometry(.151,.084),material);display.position.set(-.012,.012,-.025);display.rotation.y=Math.PI;steering.add(display);instruments.push(display);originals.set(display,material);dashTextures.push(tex);dashContexts.push(canvas.getContext('2d')!);
   const glass=new T.Mesh(display.geometry,new T.MeshPhysicalMaterial({color:'#10161a',roughness:.12,metalness:.42,transparent:true,opacity:.095,depthWrite:false,clearcoat:1,clearcoatRoughness:.09}));
   glass.position.copy(display.position);glass.position.z-=.0009;glass.rotation.copy(display.rotation);steering.add(glass);instruments.push(glass);originals.set(glass,glass.material);
   const ledGeo=new T.SphereGeometry(.0037,10,6);
   const materialLED=new T.MeshBasicMaterial({toneMapped:false});
   const lamps=new T.InstancedMesh(ledGeo,materialLED,21);
   const placement=new T.Matrix4();
   for(let i=0;i<21;i++){
    if(i<15)placement.makeTranslation(-.012+(7-i)*.0085,.060,-.039);
    else placement.makeTranslation(-.012+(i<18?-1:1)*.089,.021+(i%3)*.011,-.041);
    lamps.setMatrixAt(i,placement);
    lamps.setColorAt(i,lampColor.set(i<15?'#112019':'#172021'));
   }
   lamps.instanceColor!.setUsage(T.DynamicDrawUsage);
   steering.add(lamps);instruments.push(lamps);originals.set(lamps,materialLED);lights.push(lamps);
  }
 });ready=true;setFinish(finish);}).catch(e=>{error=String(e);console.error('Car asset failed',e);});
 const hingeDelta=new T.Vector3(),hingeRotation=new T.Quaternion();
 function placeAtHinge(node:T.Mesh){
  const {hinge,restOrigin,restOrientation}=node.userData;
  hingeRotation.copy(restOrientation).invert().premultiply(node.quaternion);
  hingeDelta.copy(restOrigin).sub(hinge).applyQuaternion(hingeRotation);
  node.position.copy(hinge).add(hingeDelta);
 }
 let lastInk='';
 let dashKey='',lastDash=-1,lastLodLevel=-1,lastCockpitDetail:boolean|undefined;
 return {root,chassis,loaded,setLodRange(range:number){if(lod.levels[1])lod.levels[1].distance=range;},get ready(){return ready;},get error(){return error;},setFinish,setMirrorVisible(visible:boolean){for(const mirror of mirrorFaces)mirror.visible=visible;},setMirror(texture:T.Texture|null){for(const m of mirrors){const map=texture??mirrorFallback;if(m.map!==map){const recompile=!!m.map!==!!map;m.map=map;m.emissiveMap=map;m.emissive.set(texture?'#ffffff':'#000000');m.emissiveIntensity=.7;m.roughness=texture?.16:.08;m.metalness=texture?.40:.9;m.clearcoat=.72;m.ior=1.47;if(recompile)m.needsUpdate=true;}}},
 update(c:CarTelemetry,onboard=false,studio=false,now=performance.now(),showDash=onboard||studio,flag=c.flag,highQuality=true){
  jackLift(c,lift);
  const liftHeight=(lift.front+lift.rear)*.5;
  if(contact){contact.visible=!studio&&highQuality;contact.material.uniforms.strength.value=.57*(1.-T.MathUtils.clamp(liftHeight/.12,0,1));}
  setInspection(studio);
  const damage=c.damage,damaged=!!damage&&(damage[0]>0||damage[1]>0||damage[2]>0||damage[3]>0);
  for(const update of rigidUpdates)update(studio,damaged);
  const flashing=!studio&&(surfaceWater.value>.08||c.instruction?.ers==='harvest'||(c.ersPowerKw??0)<0||(c.ers??90)<1||(c.pit&&c.pit!=='none')||(c.acceleration??0)<-10);
  for(const light of rainLights)light.emissiveIntensity=flashing?(now%250<115?4.6:.06):light.name==='TailOptic'?.90:.26;
  // Three selects the LOD during the draw, after the camera has moved. A cut to
  // onboard must hide the head in either LOD before that first draw.
  for(const {helmet} of rigNodes)if(helmet){
   helmet.visible=!onboard;
   const g=studio?0:T.MathUtils.clamp(c.lateralG??0,-5,5);
   const yaw=studio?0:T.MathUtils.clamp((c.steering??0)*.62+g*.020,-.26,.26);
   helmet.rotation.set(studio?0:T.MathUtils.clamp(-(c.acceleration??0)*.004,0,.12),yaw,-g*.019,'YXZ');
   // Rotate around the collar. The Blender parent origin is below and ahead of it.
   const neck=neckPivot.set(0,.635,-.315);
   helmet.position.set(0,.025,.15).add(neck).sub(neck.applyQuaternion(helmet.quaternion));
  }
  const cockpitDetail=studio||showDash;
  if(ready&&cockpitDetail!==lastCockpitDetail){
   for(const mesh of cockpitFittings)mesh.visible=cockpitDetail;
   lastCockpitDetail=cockpitDetail;
  }
  const showInstruments=showDash;
  for(const mesh of instruments)mesh.visible=showInstruments;
  if(tyreContacts)tyreContacts.visible=!studio&&liftHeight<.025;
  const panels=studio?intact:c.damage??intact;
  if(ready&&panels!==previousPanels&&panels.some((value,index)=>value!==previousPanels[index])){
   for(const deform of deformations)deform(panels);
   previousPanels=panels;
  }
  tyreWear.value=studio?0:T.MathUtils.clamp(c.wear??0,0,1);
  const service=c.pit==='stopped'&&!studio,seconds=c.pitTime??0;
  const compound=service&&seconds>1.66?(c.instruction?.tyre??c.compound):c.compound;
  const ink=studio?'#b7b4a9':(compoundColors[compound??'hard']??compoundColors[compound?.toLowerCase()??'hard']??compoundColors.hard);
  if(ink!==lastInk){compoundInk.value.set(ink);lastInk=ink;}
  suspension.update(track,c,now,studio);
  chassis.rotation.set(suspension.pitch+(studio?0:(lift.rear-lift.front)/3.6),0,suspension.roll);chassis.position.y=suspension.heave+(studio?0:liftHeight+lift.dropBounce);
  for(const ram of rams)ram.morphTargetInfluences![0]=suspension.flap/-.43;
  const bodyPitch=Math.sin(suspension.pitch),bodyRoll=Math.sin(suspension.roll),steerYaw=studio?0:Math.sin(c.steering??0);
  for(const node of linkageMeshes){
   const weights=node.morphTargetInfluences!;
   for(let i=0;i<4;i++)weights[i]=studio?0:-suspension.compression[i]-suspension.heave+suspension.heights[i]+wheelStations[i].z*bodyPitch-wheelStations[i].x*bodyRoll;
   weights[4]=weights[5]=steerYaw;
  }
  for(const node of frontFlaps){
   node.rotation.x=node.userData.restPitch+(studio?0:suspension.flap*.38);
   placeAtHinge(node);
   const left=node.name.includes('Left');node.visible=studio||(c.damage?.[left?1:0]??0)<.92;
  }
  if(c.gear!==undefined&&c.gear!==lastGear){shiftSide=c.gear>lastGear?1:-1;shiftTime=now;lastGear=c.gear;}
  for(const paddle of paddles){paddle.rotation.y=paddle.userData.restYaw+(studio?0:(paddle.name.includes('Left')?-1:1)===shiftSide?shiftSide*.18*Math.max(0,1-(now-shiftTime)/120):0);placeAtHinge(paddle);}
  inverseBody.copy(chassis.quaternion).invert();
  const thermalStep=Math.min(.1,Math.max(0,(now-lastHeatTime)/1000));lastHeatTime=now;
  const heatTarget=studio?0:Math.min(1,Math.max(0,-(c.acceleration??0)/23)*Math.min(1,c.speed/32));
  brakeHeat+=(heatTarget-brakeHeat)*(1-Math.exp(-thermalStep*(heatTarget>brakeHeat?5:.26)));
  discHeat.value=studio?0:Math.max(brakeHeat,service?.46*Math.exp(-seconds/4):0);
  const spin=studio?0:c.distance/CAR_DIMENSIONS.tyreRadius;
  for(const u of tyreUniforms){u.grooves.value=compound==='wet'?2:compound==='intermediate'?1:0;u.spin.value=spin;u.load.value=suspension.compression[u.wheel];u.shutter.value=studio?0:Math.min(1.3,Math.abs(c.speed)/(240*CAR_DIMENSIONS.tyreRadius));}
  const activeLevel=studio?0:Math.max(0,Math.min(rigNodes.length-1,lod.getCurrentLevel()));
  const updateAll=lastLodLevel!==activeLevel;
  lastLodLevel=activeLevel;
  for(let r=0;r<rigNodes.length;r++){
   if(!updateAll&&r!==activeLevel)continue;
   const {model,hubs,knuckles,hands,suit,steering,drs}=rigNodes[r];
   for(let i=0;i<wheelStations.length;i++){
    const station=wheelStations[i],hub=hubs[i];if(!hub)continue;
    // The sprung chassis moves around the hubs. Express the road-space pose
    // in the moving chassis frame so neither pitch nor roll lifts a tyre.
    const height=CAR_DIMENSIONS.tyreRadius-suspension.compression[i]+suspension.heights[i];
    const uncovered=service&&cornerService(seconds,i).off;
    if(hub.userData.uncovered!==uncovered){
     for(const part of hub.children){
      const replacedCover=team==='b'&&part.name.endsWith('_WheelDish');
      const smallFitting=import.meta.env.MCP_APP==='true'&&r>0&&/_(ButtonBlue|ButtonRed|ButtonYellow|Centrelock gunmetal)$/.test(part.name);
      part.visible=!replacedCover&&!smallFitting&&(!uncovered||part.name.includes('BrakeDisc'));
     }
     hub.userData.uncovered=uncovered;
    }
    hub.position.set(station.x,height-suspension.heave,station.z).applyQuaternion(inverseBody);
    hub.rotation.set(0,i<2?(c.steering??0):0,0);hub.quaternion.premultiply(inverseBody);
    const knuckle=knuckles[i];
    if(knuckle){knuckle.position.copy(hub.position);knuckle.quaternion.copy(hub.quaternion);}
    hub.rotateX(spin);
   }
   if(hands)hands.visible=!studio;
   if(suit)suit.visible=!studio;
   if(cockpitDetail){
    for(const {node,side,digit} of fingerRigs.get(model)??[]){
     const pose=fingerCurl(side,digit,c.steering??0,c.distance,c.speed);node.rotation.y=pose.curl;node.rotation.z=pose.spread;
    }
    for(const {side,meshes} of compression.get(model)??[]){
     const pressure=T.MathUtils.clamp(.32+side*(c.steering??0)*1.65-Math.min(0,c.acceleration??0)*.014,0,1);
     for(const mesh of meshes)mesh.morphTargetInfluences![0]=pressure;
    }
   }
   if(steering){steering.rotation.z=-(c.steering??0)*3.6;
    poseForearms(model,steering,!studio);
   }
   if(drs)drs.rotation.x=suspension.flap;
  }
  if(dashContexts.length&&showDash){
   const stamp=Math.floor(now*15/1000);
   if(stamp!==lastDash){
    lastDash=stamp;
    const key=studio?'studio':[c.gear,Math.round(c.speed*3.6),Math.ceil(T.MathUtils.clamp(((c.rpm??0)-6500)/5500,0,1)*24),Math.round(damageLevel(c.damage)*100),c.lastLap,c.bestLap,Math.round(c.ers??90),c.drs,c.lap,c.pit,c.temperature&&Math.round(c.temperature),Math.round((c.wear??0)*100),c.sector,c.splits?.[(((c.sector??0)+2)%3)],c.brakeBias].join('/');
    if(key!==dashKey)for(let i=0;i<dashContexts.length;i++){
     const ctx=dashContexts[i];
     drawTelemetry(ctx,c,studio);
     dashTextures[i].needsUpdate=true;
    }
    dashKey=key;
    const rpm=studio?0:c.rpm??(c.speed?10500:0),n=Math.round(T.MathUtils.clamp((rpm-7500)/4500,0,1)*15);
    const flagColor=!studio&&now%560<360?(flag==='yellow'?'#ffcb1a':flag==='blue'?'#3681ff':flag==='red'?'#ff3530':'#172021'):'#172021';
    for(const lamps of lights){
     for(let j=0;j<lamps.count;j++){
      const flash=rpm>11520&&now%160>80;
      const color=j>=15?flagColor:j>=n||flash?'#112019':j<5?'#33ff66':j<10?'#ff202a':'#8264ff';
      const lit=j<15?j<n&&!flash:flagColor!=='#172021';
      lamps.setColorAt(j,lampColor.set(color).multiplyScalar(lit?3.1:1));
     }
     lamps.instanceColor!.needsUpdate=true;
    }
   }
  }
 },dispose(){
  if(dead)return;
  dead=true;
  owned.collect(root);
  root.removeFromParent();
  for(const material of originals.values())for(const m of Array.isArray(material)?material:[material])owned.material(m);
  for(const pair of pairs.values()){owned.geometries.add(pair.rest);owned.geometries.add(pair.inspection);}
  if(finishMats)for(const m of Object.values(finishMats))owned.material(m);
  for(const texture of [heroSheet,helmetMap,wheelBrand,...dashTextures])if(texture)owned.textures.add(texture);
  owned.dispose();root.clear();originals.clear();pairs.clear();
 }};
}
