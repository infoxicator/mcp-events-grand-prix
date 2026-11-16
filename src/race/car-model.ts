import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** Original 2025-style ground-effect single seater. All dimensions in metres.
 * +Z is forward, 3.6m wheelbase, 2m envelope, 720mm tyre diameter / 18in rims.
 * No downloaded team model, logos or restricted game assets. */
export const CAR_DIMENSIONS={wheelbase:3.6,width:2,length:5.55,tyreRadius:.36,frontAxle:1.55,rearAxle:-2.05};
type Section=[z:number,halfWidth:number,bottom:number,top:number,centreX?:number];
export function loft(sections:Section[],segments=32){
 const points:number[]=[],uv:number[]=[],indices:number[]=[];
 for(let j=0;j<sections.length;j++){const [z,w,b,t,x=0]=sections[j];for(let i=0;i<=segments;i++){const a=i/segments*Math.PI*2;points.push(x+Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**.82*w,(b+t)/2+Math.sign(Math.sin(a))*Math.abs(Math.sin(a))**.85*(t-b)/2,z);uv.push(i/segments,j/(sections.length-1));if(j<sections.length-1&&i<segments){const k=j*(segments+1)+i;indices.push(k,k+1,k+segments+1,k+1,k+segments+2,k+segments+1);}}}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(points,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
function tube(points:number[][],r:number){return new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),Math.max(12,points.length*8),r,8,false);}
function canvasTexture(draw:(c:CanvasRenderingContext2D)=>void,w=1024,h=256){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d')!);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t;}
export function createCar(team:'a'|'b'){
 const root=new T.Group(),chassis=new T.Group();root.add(chassis);
 const orange=team==='a',colour=orange?'#f15c20':'#666be4',light=orange?'#ffd6aa':'#d4dcff';
 const weave=canvasTexture(c=>{c.fillStyle='#323437';c.fillRect(0,0,64,64);for(let x=0;x<64;x+=4)for(let y=0;y<64;y+=4){c.fillStyle=(x/4+y/4)%2?'#434548':'#202225';c.fillRect(x,y,3,3);}},64,64);weave.wrapS=weave.wrapT=T.RepeatWrapping;weave.repeat.set(10,10);
 const paint=new T.MeshPhysicalMaterial({color:colour,metalness:.25,roughness:.34,clearcoat:.7,clearcoatRoughness:.25});
 const carbon=new T.MeshStandardMaterial({color:'#35383c',map:weave,metalness:.22,roughness:.46});
 const black=new T.MeshStandardMaterial({color:'#080a0d',roughness:.68});
 const metal=new T.MeshStandardMaterial({color:'#727982',metalness:.85,roughness:.27});
 const accent=new T.MeshPhysicalMaterial({color:light,roughness:.3,metalness:.25});
 const tyre=new T.MeshStandardMaterial({color:'#191b1e',roughness:.86});
 const add=(g:T.BufferGeometry,m:T.Material,p:T.Object3D=chassis)=>{const o=new T.Mesh(g,m);o.castShadow=true;o.receiveShadow=true;p.add(o);return o;};
 const box=(w:number,h:number,d:number,m:T.Material,x:number,y:number,z:number,p:T.Object3D=chassis)=>{const o=add(new T.BoxGeometry(w,h,d),m,p);o.position.set(x,y,z);return o;};
 const rod=(a:number[],b:number[],r=.018,m:T.Material=carbon,p:T.Object3D=chassis)=>add(tube([a,b],r),m,p);
 // Underfloor tunnels, raised diffuser, stepped edges and exposed carbon plank.
 add(loft([[-2.48,.55,.12,.3],[-2.2,.72,.075,.22],[-1.2,.88,.075,.16],[.3,.9,.075,.15],[.9,.7,.1,.18],[1.15,.38,.13,.2]],16),carbon);
 for(const sign of [-1,1]){
  add(loft([[-2.4,.025,.13,.36,sign*.54],[-1.4,.025,.08,.19,sign*.79],[.55,.025,.09,.19,sign*.88],[.9,.015,.13,.2,sign*.68]],10),carbon);
  for(let i=0;i<4;i++)box(.018,.14,.55,carbon,sign*(.2+i*.11),.2,-2.18);
 }
 // Sculpted monocoque and long raised nose, separate from the open cockpit.
 add(loft([[.37,.32,.19,.65],[.7,.34,.2,.67],[1.15,.26,.22,.57],[1.8,.17,.24,.45],[2.45,.12,.19,.31],[2.77,.08,.18,.26],[2.82,.01,.2,.22]]),paint);
 add(loft([[-2.2,.14,.17,.31],[-1.5,.35,.18,.47],[-.8,.4,.2,.56],[-.5,.4,.21,.58]],24),carbon);
 // Cockpit sidewalls leave an actual opening around the driver.
 for(const sign of [-1,1]){
  add(loft([[-.74,.13,.28,.68,sign*.29],[-.3,.115,.27,.64,sign*.36],[.1,.1,.24,.64,sign*.37],[.42,.11,.23,.65,sign*.29]],20),paint);
  // Undercut sidepods with a pronounced shoulder and coke-bottle taper.
  add(loft([[-1.92,.06,.22,.31,sign*.32],[-1.5,.17,.22,.43,sign*.45],[-.9,.29,.23,.54,sign*.53],[-.35,.31,.3,.65,sign*.55],[.1,.28,.37,.67,sign*.56],[.38,.21,.43,.64,sign*.56],[.45,.13,.46,.57,sign*.54]],24),paint);
  const inlet=add(new T.CircleGeometry(1,32),black);inlet.scale.set(.157,.055,1);inlet.position.set(sign*.54,.515,.455);
  rod([sign*.72,.62,.35],[sign*.78,.53,-.5],.018,accent);
  for(let i=0;i<9;i++){const louvre=box(.19,.012,.027,black,sign*.55,.58-i*.008,-.55-i*.065);louvre.rotation.z=sign*.2;}
  box(.23,.04,.15,carbon,sign*.6,.72,.38);rod([sign*.32,.61,.35],[sign*.59,.72,.38],.014);
  const mirror=box(.17,.032,.01,metal,sign*.6,.725,.3);mirror.rotation.y=sign*.13;
 }
 // Engine spine, roll hoop intake and shark fin, continuous curved sections.
 add(loft([[-2.13,.04,.25,.38],[-1.8,.12,.29,.53],[-1.3,.2,.3,.75],[-.95,.23,.32,.95],[-.7,.2,.48,1.05],[-.54,.1,.76,1.06]],28),paint);
 const intake=add(new T.SphereGeometry(1,24,12),black);intake.scale.set(.105,.13,.025);intake.position.set(0,.89,-.51);
 box(.018,.21,.88,carbon,0,.7,-1.45);box(.31,.055,.055,accent,0,1.09,-.67);box(.095,.1,.12,carbon,0,1.04,-.65);
 // Multi-element front wing follows a swept span with raised outboard sections.
 function wing(span:number,z:number,y:number,chord:number,m:T.Material,p:T.Object3D=chassis,sweep=.14){
  // Cambered surface in span x / chord z.
  const v:number[]=[],uv:number[]=[],idx:number[]=[];const nx=32,ny=10;
  for(let i=0;i<=nx;i++){const x=(i/nx-.5)*span,tip=Math.pow(Math.abs(x)/(span/2),2);for(let j=0;j<=ny;j++){const u=j/ny;v.push(x,y+.028*Math.sin(u*Math.PI)+tip*.07,z+(u-.5)*chord-tip*sweep);uv.push(i/nx,u);if(i<nx&&j<ny){const k=i*(ny+1)+j;idx.push(k,k+1,k+ny+1,k+1,k+ny+2,k+ny+1);}}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(v,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();const o=add(g,m,p);o.material.side=T.DoubleSide;return o;
 }
 for(let i=0;i<4;i++)wing(1.98-i*.025,2.64-i*.13,.15+i*.035,.18,i===3?paint:carbon);
 for(const sign of [-1,1]){add(loft([[2.28,.018,.16,.36,sign*.97],[2.65,.018,.16,.31,sign*.98],[2.82,.01,.16,.22,sign*.96]],12),paint);rod([sign*.11,.21,2.4],[sign*.13,.32,2.32],.025);}
 // Thin Monza rear wing, beam wing, endplates and hydraulic DRS actuator.
 const rearFlap=new T.Group();rearFlap.position.set(0,.88,-2.38);chassis.add(rearFlap);
 wing(1.61,-2.32,.76,.32,carbon,chassis,.02);wing(1.58,0,0,.23,paint,rearFlap,.025);
 wing(1.15,-2.22,.37,.18,carbon,chassis,.02);
 for(const sign of [-1,1]){add(loft([[-2.57,.02,.65,.95,sign*.79],[-2.22,.02,.55,.94,sign*.79],[-2.04,.015,.5,.72,sign*.77]],14),paint);rod([sign*.15,.28,-2.15],[sign*.15,.8,-2.3],.025);}
 rod([0,.76,-2.23],[0,.92,-2.34],.023,metal);
 const exhaust=add(new T.CylinderGeometry(.055,.055,.25,20,1,true),metal);exhaust.rotation.x=Math.PI/2;exhaust.position.set(0,.45,-2.3);
 const rainLight=box(.1,.065,.025,new T.MeshStandardMaterial({color:'#d71610',emissive:'#ed1408',emissiveIntensity:.7}),0,.22,-2.5);
 // Halo ring and angled central pylon: not a floating torus.
 add(tube([[-.37,.66,-.48],[-.4,.87,-.3],[-.36,.94,.1],[-.23,.94,.48],[0,.92,.61],[.23,.94,.48],[.36,.94,.1],[.4,.87,-.3],[.37,.66,-.48]],.035),carbon);
 rod([0,.61,.72],[0,.92,.61],.032);
 // Driver shoulders, helmet shell, visor and HANS / cockpit padding.
 const shoulders=add(new T.SphereGeometry(1,20,12),black);shoulders.scale.set(.25,.15,.21);shoulders.position.set(0,.51,-.25);
 const helmet=add(new T.SphereGeometry(.153,32,24),new T.MeshPhysicalMaterial({color:orange?'#d6f13c':'#f1edf7',roughness:.22,clearcoat:1}));helmet.scale.y=1.1;helmet.position.set(0,.77,-.25);
 const visor=add(new T.SphereGeometry(.155,32,16,Math.PI*.15,Math.PI*.7,Math.PI*.33,Math.PI*.26),new T.MeshPhysicalMaterial({color:'#202c38',metalness:.7,roughness:.12}));visor.position.copy(helmet.position);
 const steering=new T.Group();steering.position.set(0,.59,.19);chassis.add(steering);box(.31,.12,.035,carbon,0,0,0,steering);
 for(const s of [-1,1]){const handle=add(new T.TorusGeometry(.067,.021,8,16,Math.PI*1.5),black,steering);handle.position.x=s*.15;handle.rotation.z=s>0?-.7:2.4;}
 box(.12,.065,.005,new T.MeshBasicMaterial({color:'#709a86'}),0,.01,.022,steering);
 // Wishbones, push/pull rods, brake ducts, rotating slicks, wheel covers and sidewall lettering.
 const wheels:T.Group[]=[],pivots:T.Group[]=[],compoundMaterials:T.MeshBasicMaterial[]=[];
 for(const front of [true,false])for(const sign of [-1,1]){
  const z=front?1.55:-2.05,x=sign*(front?.835:.795),width=front?.305:.405;
  for(const y of [.25,.46])for(const shift of [-.34,.28])rod([sign*.22,y,z+shift],[x,.36,z],.017);
  rod([sign*.2,front?.53:.25,z-.23],[x,.4,z],.022);rod([sign*.16,.36,z+.25],[x,.36,z+.06],.014);
  const pivot=new T.Group();pivot.position.set(x,.36,z);root.add(pivot);pivots.push(pivot);const spin=new T.Group();pivot.add(spin);wheels.push(spin);
  const profile=[new T.Vector2(.235,-width/2),new T.Vector2(.31,-width/2),new T.Vector2(.35,-width*.42),new T.Vector2(.36,-width*.3),new T.Vector2(.36,width*.3),new T.Vector2(.35,width*.42),new T.Vector2(.31,width/2),new T.Vector2(.235,width/2)];
  const rubber=add(new T.LatheGeometry(profile,64),tyre,spin);rubber.rotation.z=Math.PI/2;
  for(const side of [-1,1]){
   const cover=add(new T.CylinderGeometry(.228,.228,.012,48),carbon,spin);cover.rotation.z=Math.PI/2;cover.position.x=side*(width/2-.014);
   const rim=add(new T.TorusGeometry(.227,.009,8,48),metal,spin);rim.rotation.y=Math.PI/2;rim.position.x=side*width/2;
   const nut=add(new T.CylinderGeometry(.038,.038,.028,12),metal,spin);nut.rotation.z=Math.PI/2;nut.position.x=side*(width/2+.01);
   const label=canvasTexture(c=>{c.translate(256,256);c.strokeStyle='#ffffff';c.lineWidth=3;c.beginPath();c.arc(0,0,218,0,Math.PI*2);c.stroke();c.font='italic bold 27px sans-serif';c.textAlign='center';c.fillStyle='#ffffff';c.fillText('JEV RACING',0,-177);c.font='bold 19px sans-serif';c.fillText('GRAND PRIX',0,188);},512,512);
   const material=new T.MeshBasicMaterial({map:label,color:'#ffdf45',transparent:true,depthWrite:false,side:T.DoubleSide});compoundMaterials.push(material);
   const decal=add(new T.PlaneGeometry(.72,.72),material,spin);decal.rotation.y=Math.PI/2;decal.position.x=side*(width/2+.018);decal.castShadow=false;
  }
  const duct=box(.1,.16,.25,black,-sign*.18,0,.11,pivot);
 }
 // Original team marks, number panels and wing branding.
 const decal=(label:string,w:number,h:number,pos:number[],rotation:number[],bg?:string)=>{const texture=canvasTexture(c=>{if(bg){c.fillStyle=bg;c.fillRect(0,0,1024,256);}c.fillStyle='#f3f5f6';c.font='italic bold 155px sans-serif';c.textAlign='center';c.fillText(label,512,182);});const o=add(new T.PlaneGeometry(w,h),new T.MeshStandardMaterial({map:texture,transparent:true,depthWrite:false,roughness:.45,side:T.DoubleSide}));o.position.set(...pos as [number,number,number]);o.rotation.set(...rotation as [number,number,number]);o.castShadow=false;};
 for(const s of [-1,1])decal(orange?'VECTOR':'CHAOS',.82,.14,[s*.865,.5,-.25],[0,s*Math.PI/2,0]);
 decal('jev',.32,.17,[0,.65,.8],[-Math.PI/2,0,Math.PI]);decal(orange?'07':'23',.22,.35,[0,.47,1.52],[-Math.PI/2-.13,0,Math.PI]);decal('JEV GRAND PRIX',1.35,.14,[0,.91,-2.39],[-Math.PI/2,0,Math.PI]);
 // Merge only static chassis geometry by exact material identity; moving pieces stay separate.
 chassis.updateMatrixWorld(true);const batches=new Map<T.Material,T.Mesh[]>();chassis.traverse(o=>{if(o instanceof T.Mesh&&o.parent===chassis&&!Array.isArray(o.material)){const list=batches.get(o.material)??[];list.push(o);batches.set(o.material,list);}});
 for(const [m,objects] of batches){if(objects.length<2)continue;const gs=objects.map(o=>o.geometry.clone().applyMatrix4(o.matrix));const merged=mergeGeometries(gs);if(merged){for(const o of objects){o.removeFromParent();o.geometry.dispose();}add(merged,m);}gs.forEach(g=>g.dispose());}

 return {root,chassis,update(c:{distance:number;speed:number;steering?:number;drs?:boolean;compound?:string;acceleration?:number;lateralG?:number;pit?:string},onboard=false){
  const angle=c.distance/.36;for(let i=0;i<4;i++){wheels[i].rotation.x=angle;pivots[i].rotation.y=i<2?(c.steering??0):0;}
  rearFlap.rotation.x=c.drs?-.43:0;steering.rotation.z=-(c.steering??0)*3.6;helmet.visible=!onboard;visor.visible=!onboard;
  chassis.rotation.x=T.MathUtils.clamp((c.acceleration??0)*.00045,-.018,.012);chassis.rotation.z=T.MathUtils.clamp((c.lateralG??0)*-.003,-.015,.015);
  const comp=c.compound==='soft'?'#f74b4b':c.compound==='hard'?'#eeeee5':'#efc838';compoundMaterials.forEach(m=>m.color.set(comp));rainLight.visible=c.pit!=='none'||Math.sin(c.distance*.03)>-.2;
 }};
}
