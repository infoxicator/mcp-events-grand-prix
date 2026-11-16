import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import asphaltURL from './assets/asphalt-color.jpg?url';
import normalURL from './assets/asphalt-normal.jpg?url';
import grassURL from './assets/grass-color.jpg?url';
import {getTrack,type Track} from './track';
const rand=(n:number)=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
export function buildScenery(scene:T.Scene,anisotropy:number,track:Track=getTrack()){
 const {LENGTH,pointAt,tangentAt,CORNERS,PIT_ENTRY,PIT_EXIT,pitOffset,trackHalfWidth,racingLineOffset}=track;
 const loader=new T.TextureLoader(),load=(url:string,srgb=true)=>{const t=loader.load(url);t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=anisotropy;if(srgb)t.colorSpace=T.SRGBColorSpace;return t;};
 const roadMap=load(asphaltURL),roadNormal=load(normalURL,false),grassMap=load(grassURL);
 const material=(color:string,roughness=.85)=>new T.MeshStandardMaterial({color,roughness});
 const asphalt=new T.MeshStandardMaterial({map:roadMap,normalMap:roadNormal,normalScale:new T.Vector2(.12,.12),color:'#999da2',roughness:.92});
 asphalt.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb=mix(vec3(.11),diffuseColor.rgb,.48);');};
 const grass=new T.MeshStandardMaterial({map:grassMap,color:'#93996f',roughness:1});
 // Broad nonrepeating colour variation on top of the measured ground texture.
 grass.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 groundPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\ngroundPosition=position;');shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 groundPosition;').replace('#include <map_fragment>','#include <map_fragment>\nfloat m=sin(groundPosition.x*.021)*sin(groundPosition.z*.017)+.4*sin(groundPosition.x*.13+groundPosition.z*.08);diffuseColor.rgb*=.92+m*.13;');};
 const gravelCanvas=document.createElement('canvas');gravelCanvas.width=gravelCanvas.height=256;const gc=gravelCanvas.getContext('2d')!;gc.fillStyle='#9f9583';gc.fillRect(0,0,256,256);for(let i=0;i<15000;i++){const v=110+Math.floor(rand(i)*80);gc.fillStyle=`rgb(${v},${v*.95},${v*.83})`;gc.fillRect(rand(i*7)*256,rand(i*11)*256,1+rand(i*13)*2,1+rand(i*17)*2);}const gravelTex=new T.CanvasTexture(gravelCanvas);gravelTex.wrapS=gravelTex.wrapT=T.RepeatWrapping;gravelTex.colorSpace=T.SRGBColorSpace;gravelTex.anisotropy=anisotropy;
 const white=material('#d5d3c7'),red=material('#a92822'),green=material('#426c58'),steel=material('#979d9c',.55),concrete=material('#aaa99e'),dark=material('#151a1e'),sand=new T.MeshStandardMaterial({color:'#bbb09b',map:gravelTex,roughness:1});
 const objects:T.Mesh[]=[];
 const mesh=(g:T.BufferGeometry,m:T.Material)=>{const o=new T.Mesh(g,m);o.receiveShadow=true;scene.add(o);objects.push(o);return o;};
 const box=(w:number,h:number,d:number,m:T.Material,x:number,y:number,z:number)=>{const o=mesh(new T.BoxGeometry(w,h,d),m);o.position.set(x,y,z);return o;};
 const floor=new T.PlaneGeometry(10000,10000);floor.rotateX(-Math.PI/2);const uv=floor.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*650,uv.getY(i)*650);mesh(floor,grass).position.set(0,-.05,0);
 function ribbon(left:number|((d:number)=>number),right:number|((d:number)=>number),m:T.Material,y=.01,start=0,end=LENGTH,uvScale=3){
  const v:number[]=[],uv:number[]=[],idx:number[]=[],count=Math.ceil((end-start)/2);
  for(let i=0;i<=count;i++){const d=start+(end-start)*i/count,l=typeof left==='number'?left:left(d),r=typeof right==='number'?right:right(d);for(const off of [l,r]){const p=pointAt(d,off);v.push(p.x,y,p.z);uv.push(off/uvScale,d/uvScale);}if(i<count){const j=i*2;idx.push(j,j+1,j+2,j+1,j+3,j+2);}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(v,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();m.side=T.DoubleSide;return mesh(g,m);
 }
 // 12m race surface, widening to 15m on the grid. The pit lane lies on the right.
 ribbon(d=>-trackHalfWidth(d),d=>trackHalfWidth(d),asphalt);
 for(const sign of [-1,1])ribbon(d=>sign*trackHalfWidth(d)-.08,d=>sign*trackHalfWidth(d)+.08,white,.025);
 ribbon(d=>pitOffset(d)-3.5,d=>pitOffset(d)+3.5,asphalt,.018,PIT_ENTRY,LENGTH+PIT_EXIT);
 ribbon(d=>pitOffset(d)-3.3,d=>pitOffset(d)-3.15,white,.028,PIT_ENTRY,LENGTH+PIT_EXIT);
 // Dark rubber laid into the actual racing line, separate from aggregate detail.
 const rubberCanvas=document.createElement('canvas');rubberCanvas.width=128;rubberCanvas.height=512;const rc=rubberCanvas.getContext('2d')!;const grad=rc.createLinearGradient(0,0,128,0);grad.addColorStop(0,'#00000000');grad.addColorStop(.35,'#16171635');grad.addColorStop(.65,'#16171635');grad.addColorStop(1,'#00000000');rc.fillStyle=grad;rc.fillRect(0,0,128,512);const rubberTexture=new T.CanvasTexture(rubberCanvas);rubberTexture.wrapT=T.RepeatWrapping;
 const rubber=new T.MeshBasicMaterial({map:rubberTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
 ribbon(d=>racingLineOffset(d)-1.9,d=>racingLineOffset(d)+1.9,rubber,.031,0,LENGTH,4);
 // Corner-specific gravel beds and segmented raised red/white kerbs.
 for(const corner of CORNERS){const start=corner.d-48,end=corner.d+62;for(const sign of [-1,1]){
  ribbon(d=>sign*(trackHalfWidth(d)+1.4),d=>sign*(trackHalfWidth(d)+5),green,.015,start,end);
  if(corner.name!=='Curva Grande')ribbon(d=>sign*(trackHalfWidth(d)+5),d=>sign*(trackHalfWidth(d)+5+17*Math.pow(Math.max(0,Math.sin(Math.PI*(d-start+35)/(end-start+65))),.45)),sand,-.005,start-35,end+30,2);
  for(let d=start;d<end;d+=2.5)ribbon(v=>sign*trackHalfWidth(v),v=>sign*(trackHalfWidth(v)+1.15),Math.floor((d-start)/2.5)%2?red:white,.045,d,d+2.5);
 }}
 // Start line and conventional staggered grid boxes, not an enormous chessboard.
 ribbon(d=>-trackHalfWidth(d),d=>trackHalfWidth(d),white,.04,0,.3);
 for(let i=0;i<20;i++){const d=-8-i*8,off=i%2?-3:3;ribbon(off-1.15,off+1.15,white,.035,d,d+.1);ribbon(off-1.15,off-1.06,white,.035,d-4,d);ribbon(off+1.06,off+1.15,white,.035,d-4,d);}
 // Continuous triple Armco with thin support posts and mesh safety fencing.
 const fenceCanvas=document.createElement('canvas');fenceCanvas.width=fenceCanvas.height=128;const fc=fenceCanvas.getContext('2d')!;fc.strokeStyle='#8a9193';fc.lineWidth=1;for(let i=-128;i<256;i+=16){fc.beginPath();fc.moveTo(i,0);fc.lineTo(i+128,128);fc.moveTo(i,0);fc.lineTo(i-128,128);fc.stroke();}const fenceTex=new T.CanvasTexture(fenceCanvas);fenceTex.wrapS=fenceTex.wrapT=T.RepeatWrapping;fenceTex.repeat.set(5,1);
 const fenceMat=new T.MeshStandardMaterial({map:fenceTex,transparent:false,alphaTest:.35,color:'#9ba3a5',roughness:.7,side:T.DoubleSide});
 function barrierPoint(d:number,side:number){let x=0,z=0;for(let i=-60;i<=60;i+=10){const p=pointAt(d+i);x+=p.x;z+=p.z;}const a=pointAt(d-60),b=pointAt(d+60),l=Math.hypot(b.x-a.x,b.z-a.z),off=side*30;return {x:x/13-(b.z-a.z)/l*off,z:z/13+(b.x-a.x)/l*off};}
 for(let d=0;d<LENGTH;d+=16)for(const side of [-1,1]){
  const a=barrierPoint(d,side),b=barrierPoint(d+16,side),p={x:(a.x+b.x)*.5,z:(a.z+b.z)*.5},length=Math.hypot(b.x-a.x,b.z-a.z),angle=Math.atan2(b.x-a.x,b.z-a.z);
  for(const h of [.36,.68,1]){const rail=box(.12,.22,length+.1,steel,p.x,h,p.z);rail.rotation.y=angle;}
  const post=box(.11,3.8,.11,steel,a.x,1.9,a.z);post.rotation.y=angle;
  const fence=mesh(new T.PlaneGeometry(length+.05,2.3),fenceMat);fence.position.set(p.x,2.3,p.z);fence.rotation.y=angle+Math.PI/2;
 }
 function sign(text:string,width:number,height:number,d:number,offset:number,y:number,bg='#18211e'){
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d')!;c.fillStyle=bg;c.fillRect(0,0,1024,256);c.fillStyle='#f4f3e9';c.font='bold 130px sans-serif';c.textAlign='center';c.fillText(text,512,178);const p=pointAt(d,offset),t=tangentAt(d),o=mesh(new T.PlaneGeometry(width,height),new T.MeshStandardMaterial({map:new T.CanvasTexture(canvas),roughness:.8,side:T.DoubleSide}));o.position.set(p.x,y,p.z);o.rotation.y=Math.atan2(t.x,t.z);return o;
 }
 for(const corner of CORNERS)if(corner.speed<75)for(const distance of [150,100,50])sign(String(distance),1.2,1.4,corner.d-distance,-9.5,1.1,'#e5e3d9').material=new T.MeshBasicMaterial({map:(()=>{const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d')!;ctx.fillStyle='#e8e6db';ctx.fillRect(0,0,128,128);ctx.fillStyle='#202422';ctx.font='bold 53px sans-serif';ctx.textAlign='center';ctx.fillText(String(distance),64,84);return new T.CanvasTexture(c);})(),side:T.DoubleSide});
 // Pit garages correctly sit beside the negative-offset pit lane; stands opposite.
 for(let i=0;i<14;i++){
  const d=LENGTH-380+i*32,t=tangentAt(d),angle=Math.atan2(t.x,t.z),p=pointAt(d,-31);
  const shell=box(15,6.5,31,concrete,p.x,3.25,p.z);shell.rotation.y=angle;
  const roof=box(17,.3,32,white,p.x,6.65,p.z);roof.rotation.y=angle;
  for(let j=0;j<3;j++){const door=pointAt(d-10+j*10,-23.4);const o=box(.06,3.7,7.8,dark,door.x,2,door.z);o.rotation.y=angle;}
  const glass=pointAt(d,-23.35);const o=box(.06,1.2,29,new T.MeshStandardMaterial({color:'#354d55',metalness:.55,roughness:.25}),glass.x,5.1,glass.z);o.rotation.y=angle;
 }
 for(let i=0;i<9;i++){const d=LENGTH-260+i*38,t=tangentAt(d),angle=Math.atan2(t.x,t.z);for(let row=0;row<9;row++){
  const p=pointAt(d,34+row*.8),o=box(.9,.23,36,row%3?steel:dark,p.x,1+row*.7,p.z);o.rotation.y=angle;
 }const p=pointAt(d,38),roof=box(13,.18,38,steel,p.x,9,p.z);roof.rotation.y=angle;for(const off of [32,44]){const q=pointAt(d,off);box(.17,9,.17,steel,q.x,4.5,q.z);}}
 for(const side of [-1,1]){const p=pointAt(0,side*9);box(.35,7.8,.35,steel,p.x,3.9,p.z);}sign('JEV  /  GRAND PRIX',18,1.6,0,0,7.2);
 for(let i=0;i<5;i++){const p=pointAt(-.3,(i-2)*.4);box(.28,.6,.15,dark,p.x,5.9,p.z);}
 // Batch scenery by material, spatially tiled so offscreen circuit sections are culled.
 scene.updateMatrixWorld(true);const batches=new Map<string,{m:T.Material;meshes:T.Mesh[]}>();
 for(const o of objects){const m=o.material as T.Material,key=m.uuid+':'+Math.floor(o.position.x/160)+':'+Math.floor(o.position.z/160);const b=batches.get(key)??{m,meshes:[]};b.meshes.push(o);batches.set(key,b);}
 for(const b of batches.values())if(b.meshes.length>1){const gs=b.meshes.map(o=>o.geometry.clone().applyMatrix4(o.matrixWorld)),g=mergeGeometries(gs);if(g){const merged=new T.Mesh(g,b.m);merged.receiveShadow=true;scene.add(merged);for(const o of b.meshes){o.removeFromParent();o.geometry.dispose();}}gs.forEach(g=>g.dispose());}
 // Broadleaf canopy impostors: irregular clusters of thousands of leaf marks, no cones.
 const leaf=document.createElement('canvas');leaf.width=leaf.height=512;const lc=leaf.getContext('2d')!;
 for(let i=0;i<5000;i++){const a=rand(i*3)*Math.PI*2,r=Math.sqrt(rand(i*3+1)),x=256+Math.cos(a)*r*205,y=256+Math.sin(a)*r*210;const edge=1+.14*Math.sin(a*7)+.1*Math.cos(a*11);if(r>edge)continue;const shade=30+Math.floor(rand(i*9)*33)+(1-y/512)*17;lc.fillStyle=`rgb(${shade*.8},${shade},${shade*.55})`;lc.beginPath();lc.ellipse(x,y,3+rand(i*7)*7,2+rand(i*8)*5,rand(i)*Math.PI,0,Math.PI*2);lc.fill();}
 const leafTex=new T.CanvasTexture(leaf);leafTex.colorSpace=T.SRGBColorSpace;
 const leaves=new T.MeshStandardMaterial({map:leafTex,alphaTest:.45,roughness:1,side:T.DoubleSide});
 // Several leaf clusters form a volume, including horizontal crowns visible from above.
 const gs:T.BufferGeometry[]=[];for(let i=0;i<18;i++){const a=rand(i*17)*Math.PI*2,r=Math.sqrt(rand(i*23))*4.3,y=7+rand(i*19)*9;const g=new T.PlaneGeometry(7.5,7.5);g.rotateY(a);g.rotateX((rand(i*29)-.5)*Math.PI);g.translate(Math.cos(a)*r,y,Math.sin(a)*r);gs.push(g);}const crossed=mergeGeometries(gs)!;gs.forEach(g=>g.dispose());
 // Distance to the rendered circuit (including curved segments), not only vertices.
 const samples=Array.from({length:Math.ceil(LENGTH/16)},(_,i)=>pointAt(i*16));
 const trees:T.Vector3[]=[];for(let i=0;i<2100;i++){const d=rand(i*5)*LENGTH,off=(i%2?1:-1)*(43+rand(i*7+1)*240),p=pointAt(d,off);if(Math.min(...samples.map(q=>Math.hypot(q.x-p.x,q.z-p.z)))<40)continue;trees.push(new T.Vector3(p.x,0,p.z));}
 // Tiled instances retain frustum culling across the 5.8km circuit.
 const tiles=new Map<string,T.Vector3[]>();for(const p of trees){const k=Math.floor(p.x/180)+':'+Math.floor(p.z/180),a=tiles.get(k)??[];a.push(p);tiles.set(k,a);}
 const dummy=new T.Object3D();let seed=0;for(const positions of tiles.values()){
  const crowns=new T.InstancedMesh(crossed,leaves,positions.length),trunks=new T.InstancedMesh(new T.CylinderGeometry(.18,.36,8,6),material('#51483c'),positions.length);
  for(let i=0;i<positions.length;i++){const s=.7+rand(seed++)*.75;dummy.position.copy(positions[i]);dummy.scale.set(s,s*(.9+rand(seed++)*.2),s);dummy.rotation.y=rand(seed++)*Math.PI;dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);crowns.setColorAt(i,new T.Color().setHSL(.18+rand(seed++)*.06,.12,.75+rand(seed++)*.2));dummy.position.y=3.7*s;dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);}
  crowns.castShadow=true;crowns.receiveShadow=true;scene.add(crowns,trunks);
 }
 return {textures:[roadMap,roadNormal,grassMap,leafTex,fenceTex,rubberTexture]};
}
