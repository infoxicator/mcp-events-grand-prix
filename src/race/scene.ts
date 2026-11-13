import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import { LENGTH, pointAt, tangentAt, CORNERS, SECTORS, PIT_ENTRY, PIT_EXIT, pitOffset, wrap, centreline } from './track';
export type CameraMode='broadcast'|'cockpit-a'|'cockpit-b'|'helicopter'|'flythrough';
export interface RenderCar {distance:number;offset:number;speed:number;steering?:number;pit?:string}
export interface RenderRace {cars:Record<'a'|'b',RenderCar>;time:number;phase:string}
const colours={a:0xff6335,b:0x8b9dff};
export function createScene(container:HTMLElement){
 const scene=new T.Scene();scene.background=new T.Color('#a3c5ce');scene.fog=new T.Fog('#b1c8cc',500,3000);
 const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;container.append(renderer.domElement);renderer.domElement.setAttribute('aria-label','Live 3D Monza circuit');
 const camera=new T.PerspectiveCamera(55,1,.1,8000),sun=new T.DirectionalLight('#ffe2b1',3.2);sun.position.set(-500,800,250);scene.add(sun,new T.HemisphereLight('#d4efff','#5d7650',2));
 const mat=(c:T.ColorRepresentation,roughness=.8)=>new T.MeshStandardMaterial({color:c,roughness,metalness:.08});
 const asphalt=mat('#343e42'),white=mat('#e7e8df'),red=mat('#dd473b'),green=mat('#448573'),barrier=mat('#b9c4c2'),dark=mat('#171d23');
 function mesh(g:T.BufferGeometry,m:T.Material,x=0,y=0,z=0){const o=new T.Mesh(g,m);o.position.set(x,y,z);scene.add(o);return o;}
 function box(w:number,h:number,d:number,m:T.Material,x=0,y=0,z=0){return mesh(new T.BoxGeometry(w,h,d),m,x,y,z);}
 mesh(new T.PlaneGeometry(12000,12000),mat('#597f58'),400,-.08,-300).rotation.x=-Math.PI/2;
 function ribbon(left:number,right:number,m:T.Material,y:number=.01,start=0,end=LENGTH,pit=false){
  const vertices:number[]=[],indices:number[]=[];const count=Math.ceil((end-start)/4);
  for(let i=0;i<=count;i++){const d=start+(end-start)*i/count,shift=pit?pitOffset(d):0;for(const off of [left+shift,right+shift]){const p=pointAt(d,off);vertices.push(p.x,y,p.z);}if(i<count){const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();const material=m.clone();material.side=T.DoubleSide;mesh(g,material);
 }
 ribbon(-24,24,mat('#82917d'),-.025);ribbon(-11,11,asphalt);ribbon(-8.9,-8.6,white,.025);ribbon(8.6,8.9,white,.025);
 ribbon(-5,5,asphalt,.018,PIT_ENTRY,LENGTH+PIT_EXIT,true);ribbon(-5,-4.7,white,.035,PIT_ENTRY,LENGTH+PIT_EXIT,true);
 for(const corner of CORNERS){const start=corner.d-95,end=corner.d+110;ribbon(11,20,mat('#adab90'),.001,start,end);for(let d=start;d<end;d+=8){ribbon(-12.6,-10.8,Math.floor(d/8)%2?red:white,.04,d,d+8);ribbon(10.8,12.6,Math.floor(d/8)%2?red:white,.04,d,d+8);}ribbon(12.8,15.5,green,.035,start,end);}
 for(const d of SECTORS.slice(1,-1))ribbon(-11,11,mat('#f9d36c'),.05,d,d+.7);
 for(let i=0;i<20;i++)for(let j=0;j<4;j++){const p=pointAt(i*.8,(j-1.5)*5.5);const tile=box(5.5,.025,.8,(i+j)%2?white:dark,p.x,.06,p.z);tile.rotation.y=-Math.atan2(tangentAt(0).z,tangentAt(0).x)+Math.PI/2;}
 for(let d=0;d<LENGTH;d+=32){for(const side of [-1,1]){const p=pointAt(d,side*25);const wall=box(1.2,1.4,31,barrier,p.x,.7,p.z);const t=tangentAt(d);wall.rotation.y=Math.atan2(t.x,t.z);}}
 // Instanced parkland: 1,500 trees in two draw calls, deterministic positions.
 const treeCount=1500,trunks=new T.InstancedMesh(new T.CylinderGeometry(.5,.8,5,5),mat('#635347'),treeCount),crowns=new T.InstancedMesh(new T.ConeGeometry(5,13,6),mat('#294f40'),treeCount),dummy=new T.Object3D();
 for(let i=0;i<treeCount;i++){const d=(i*137.507)%LENGTH,off=(i%2?1:-1)*(40+(Math.sin(i*53.3)*.5+.5)*300),p=pointAt(d,off),scale=.7+(Math.sin(i*23)*.5+.5)*.8;const nearest=Math.min(...centreline.slice(1).map((q,j)=>{const a=centreline[j],dx=q.x-a.x,dz=q.z-a.z,k=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));return Math.hypot(p.x-a.x-dx*k,p.z-a.z-dz*k);}));dummy.position.set(p.x,2.5,p.z);dummy.scale.setScalar(nearest<65?0:scale);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);dummy.position.y=10*scale;dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);}scene.add(trunks,crowns);
 // Grandstands, paddock and pit garages on the main straight.
 for(let i=0;i<12;i++){const d=wrap(-180+i*45),p=pointAt(d,-45),t=tangentAt(d),stand=new T.Group();stand.position.set(p.x,0,p.z);stand.rotation.y=Math.atan2(t.x,t.z);scene.add(stand);
  for(let row=0;row<6;row++){const seats=new T.Mesh(new T.BoxGeometry(16,1.2,39),mat(row%2?'#a5b4bb':'#485e6a'));seats.position.set(0,1+row*1.2,row*0);seats.scale.x=1-row*.11;stand.add(seats);}const roof=new T.Mesh(new T.BoxGeometry(21,.5,43),white);roof.position.y=10;stand.add(roof);
  const gp=pointAt(d,34),garage=box(19,7,39,mat('#c1c5bb'),gp.x,3.5,gp.z);garage.rotation.y=Math.atan2(t.x,t.z);}
 const gantryPoint=pointAt(0),gantry=new T.Group();gantry.position.set(gantryPoint.x,0,gantryPoint.z);gantry.rotation.y=Math.atan2(tangentAt(0).x,tangentAt(0).z);scene.add(gantry);
 for(const x of [-14,14]){const leg=new T.Mesh(new T.BoxGeometry(.7,12,.7),barrier);leg.position.set(x,6,0);gantry.add(leg);}const banner=new T.Mesh(new T.BoxGeometry(29,3,1),dark);banner.position.y=11;gantry.add(banner);
 const signs=document.createElement('canvas');signs.width=1024;signs.height=128;const sc=signs.getContext('2d')!;sc.fillStyle='#161d23';sc.fillRect(0,0,1024,128);sc.font='bold italic 76px sans-serif';sc.fillStyle='#faf4e9';sc.textAlign='center';sc.fillText('JEV  /  GRAND PRIX',512,88);const sign=new T.Mesh(new T.PlaneGeometry(27,2.8),new T.MeshBasicMaterial({map:new T.CanvasTexture(signs),side:T.DoubleSide}));sign.position.set(0,11,-.55);gantry.add(sign);
 function car(team:'a'|'b'){
  const root=new T.Group(),body=mat(colours[team],.28),carbon=mat('#10171c',.4),chrome=mat('#d5e0de',.22);
  const part=(w:number,h:number,d:number,m:T.Material,x:number,y:number,z:number)=>{const o=new T.Mesh(new T.BoxGeometry(w,h,d),m);o.position.set(x,y,z);root.add(o);return o;};
  part(1.3,.42,3.8,body,0,.48,0);part(.5,.3,2.1,body,0,.37,2.05);part(2.05,.12,.6,carbon,0,.2,2.8);part(1.9,.2,.45,body,0,1.05,-2.25);part(1.85,.13,.5,carbon,0,.17,-2.15);part(.8,.7,1.2,body,0,.8,-.9);part(.75,.08,.8,carbon,0,.86,.1);
  for(const x of [-1,1])for(const z of [-1.65,1.65]){const wheel=new T.Mesh(new T.CylinderGeometry(.4,.4,.4,14),carbon);wheel.rotation.z=Math.PI/2;wheel.position.set(x,.4,z);root.add(wheel);const ring=new T.Mesh(new T.TorusGeometry(.3,.025,4,16),mat('#edc43c'));ring.rotation.y=Math.PI/2;ring.position.set(x*1.22,.4,z);root.add(ring);part(.9,.05,.08,chrome,x*.5,.4,z);}
  // Halo: camera sits inside the safety hoop; central pillar stays in view.
  const halo=new T.Mesh(new T.TorusGeometry(.54,.045,6,24,Math.PI*1.7),carbon);halo.rotation.x=Math.PI/2;halo.position.set(0,1.16,.18);root.add(halo);part(.055,.45,.07,carbon,0,.94,.7);
  const helmet=new T.Mesh(new T.SphereGeometry(.19,12,8),mat(team==='a'?'#e8fc69':'#f6c6ff'));helmet.position.set(0,1.02,-.15);root.add(helmet);
  scene.add(root);return root;
 }
 // Batch immutable scenery by material to keep three simultaneous views practical.
 scene.updateMatrixWorld(true);const groups=new Map<string,{material:T.Material;geometries:T.BufferGeometry[];objects:T.Mesh[]}>();scene.traverse(o=>{if(!(o instanceof T.Mesh)||o instanceof T.InstancedMesh)return;const m=o.material as T.MeshStandardMaterial;if(Array.isArray(m))return;const key=(m.color?.getHexString()??'')+m.side+('roughness' in m?m.roughness:'')+(m.map?.uuid??'');let g=groups.get(key);if(!g){g={material:m,geometries:[],objects:[]};groups.set(key,g);}g.geometries.push(o.geometry.clone().applyMatrix4(o.matrixWorld));g.objects.push(o);});for(const g of groups.values()){const merged=mergeGeometries(g.geometries);if(merged){for(const o of g.objects){o.removeFromParent();o.geometry.dispose();}scene.add(new T.Mesh(merged,g.material));}g.geometries.forEach(v=>v.dispose());}
 const cars={a:car('a'),b:car('b')};let mode:CameraMode='broadcast',cameraLabel='HELICOPTER',lastCut=0,forceCut=0;const look=new T.Vector3(),target=new T.Vector3(),desired=new T.Vector3();
 function render(race:RenderRace,now:number){
  for(const id of ['a','b'] as const){const c=race.cars[id],p=pointAt(c.distance,c.offset+(c.pit&&c.pit!=='none'?pitOffset(c.distance):0)),t=tangentAt(c.distance);cars[id].position.set(p.x,.06,p.z);cars[id].rotation.y=Math.atan2(t.x,t.z);}
  const focus=race.cars.a.distance>=race.cars.b.distance?'a':'b',c=race.cars[focus],p=pointAt(c.distance),t=tangentAt(c.distance),elapsed=now/1000;
  if(mode.startsWith('cockpit')){const id=mode==='cockpit-a'?'a':'b',v=race.cars[id],q=pointAt(v.distance,v.offset+(v.pit&&v.pit!=='none'?pitOffset(v.distance):0)),dir=tangentAt(v.distance);camera.position.set(q.x+dir.x*.12,1.34,q.z+dir.z*.12);const ahead=pointAt(v.distance+55,v.offset);camera.lookAt(ahead.x,1.15,ahead.z);camera.fov=78;cameraLabel=`ONBOARD / ${id==='a'?'VECTOR':'CHAOS'}`;
  }else if(mode==='flythrough'){const d=elapsed*160,fp=pointAt(d,60),ahead=pointAt(d+140);camera.position.set(fp.x,95,fp.z);camera.lookAt(ahead.x,0,ahead.z);camera.fov=58;cameraLabel='MONZA / CIRCUIT TOUR';
  }else{
   const shot=mode==='helicopter'?2:(Math.floor(elapsed/9)+forceCut)%3;
   if(shot===0){desired.set(p.x-t.x*17-t.z*7,6,p.z-t.z*17+t.x*7);const ahead=pointAt(c.distance+18);target.set(ahead.x,.6,ahead.z);cameraLabel='CHASE CAM';}
   else if(shot===1){const anchor=pointAt(Math.floor(c.distance/160)*160+110,18);desired.set(anchor.x,4.5,anchor.z);target.set(p.x,.5,p.z);cameraLabel='TRACKSIDE';}
   else{desired.set(p.x+110,160,p.z+95);target.set(p.x,0,p.z);cameraLabel='HELICOPTER';}
   if(lastCut!==shot){camera.position.copy(desired);look.copy(target);lastCut=shot;}else{camera.position.lerp(desired,.12);look.lerp(target,.15);}camera.lookAt(look);camera.fov=shot===2?48:55;
  }
  camera.updateProjectionMatrix();renderer.render(scene,camera);
 }
 const resize=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(container);
 return {render,setMode:(next:CameraMode)=>{mode=next;},cut:()=>{forceCut++;},get label(){return cameraLabel;},get info(){return renderer.info.render;},dispose:()=>{resize.disconnect();scene.traverse(o=>{const m=o as T.Mesh;if(m.geometry)m.geometry.dispose();if(m.material)for(const v of Array.isArray(m.material)?m.material:[m.material]){for(const value of Object.values(v))if(value instanceof T.Texture)value.dispose();v.dispose();}});renderer.dispose();renderer.domElement.remove();}};
}
