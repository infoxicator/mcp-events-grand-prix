import * as T from 'three';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import daylightURL from './assets/daylight.hdr?url';
import {pointAt,tangentAt} from './track';
import {createCar} from './car-model';
import {buildScenery} from './scenery';
export type CameraMode='broadcast'|'cockpit-a'|'cockpit-b'|'helicopter'|'flythrough'|'detail';
export interface RenderCar{distance:number;offset:number;speed:number;steering?:number;pit?:string;heading?:number;acceleration?:number;lateralG?:number;compound?:string;drs?:boolean}
export interface RenderRace{cars:Record<'a'|'b',RenderCar>;time:number;phase:string}
export function createScene(container:HTMLElement){
 const scene=new T.Scene();scene.background=new T.Color('#c3ccd2');scene.fog=new T.FogExp2('#c3ccd2',.00026);
 const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
 container.append(renderer.domElement);renderer.domElement.setAttribute('aria-label','Live 3D Monza circuit');
 const camera=new T.PerspectiveCamera(45,1,.06,5000),sun=new T.DirectionalLight('#fff0d8',2.7);sun.position.set(-80,120,-50);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-65;sun.shadow.camera.right=65;sun.shadow.camera.top=65;sun.shadow.camera.bottom=-65;sun.shadow.camera.near=1;sun.shadow.camera.far=350;sun.shadow.normalBias=.025;sun.shadow.bias=-.00005;
 scene.add(sun,sun.target,new T.HemisphereLight('#dce6f0','#504c3e',.65));
 const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment();let environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=.45;room.dispose();let disposed=false;
 new HDRLoader().load(daylightURL,t=>{if(disposed){t.dispose();return;}t.mapping=T.EquirectangularReflectionMapping;scene.background=t;scene.backgroundIntensity=.8;scene.environment=pmrem.fromEquirectangular(t).texture;environment.dispose();scene.environmentIntensity=.65;scene.backgroundRotation.y=1.3;scene.environmentRotation.y=1.3;});
 buildScenery(scene,Math.min(8,renderer.capabilities.getMaxAnisotropy()));
 const cars={a:createCar('a'),b:createCar('b')};scene.add(cars.a.root,cars.b.root);
 let mode:CameraMode='broadcast',cameraLabel='TRACKSIDE',forceCut=0,lastShot=-1,anchorDistance=0;
 const look=new T.Vector3(),target=new T.Vector3(),desired=new T.Vector3();
 const carPosition=(c:RenderCar)=>{const q=pointAt(c.distance,c.offset);return new T.Vector3(q.x,0,q.z);};
 function render(race:RenderRace,now:number){
  for(const id of ['a','b'] as const){const c=race.cars[id],p=carPosition(c),t=tangentAt(c.distance);cars[id].root.position.copy(p);cars[id].root.position.y=.035;cars[id].root.rotation.y=Math.atan2(t.x,t.z)+(c.heading??0);cars[id].update(c,mode===`cockpit-${id}`);}
  const focus=race.cars.a.distance>=race.cars.b.distance?'a':'b',c=race.cars[focus],p=carPosition(c),t=tangentAt(c.distance),elapsed=now/1000;
  sun.position.set(p.x-80,120,p.z-50);sun.target.position.set(p.x,0,p.z);
  if(mode.startsWith('cockpit')){
   const id=mode==='cockpit-a'?'a':'b',v=race.cars[id],q=carPosition(v),dir=tangentAt(v.distance),yaw=Math.atan2(dir.x,dir.z)+(v.heading??0);
   camera.position.set(q.x-Math.sin(yaw)*.18,1.02,q.z-Math.cos(yaw)*.18);target.set(q.x+Math.sin(yaw)*50,1.0,q.z+Math.cos(yaw)*50);camera.lookAt(target);camera.fov=73;cameraLabel=`ONBOARD / ${id==='a'?'VECTOR':'CHAOS'}`;
  }else if(mode==='detail'){
   const root=cars.a.root;const angle=new URLSearchParams(location.search).get('angle')??'front';const pos=angle==='rear'?new T.Vector3(-4.4,1.75,-6.1):angle==='side'?new T.Vector3(-7,1.1,0):angle==='top'?new T.Vector3(.01,10,.01):new T.Vector3(-4.1,1.65,6.1);desired.copy(root.localToWorld(pos));camera.position.copy(desired);target.copy(root.position).add(new T.Vector3(0,.45,0));camera.lookAt(target);camera.fov=35;cameraLabel='CAR DETAIL / 2025 SPEC';
  }else if(mode==='flythrough'){
   const fp=pointAt(elapsed*90,45),ahead=pointAt(elapsed*90+90);camera.position.set(fp.x,55,fp.z);camera.lookAt(ahead.x,0,ahead.z);camera.fov=48;cameraLabel='MONZA / CIRCUIT TOUR';
  }else{
   const shot=mode==='helicopter'?2:(Math.floor(elapsed/11)+forceCut)%3;
   const gap=Math.abs(race.cars.a.distance-race.cars.b.distance),battle=gap<55;
   target.copy(p).y=.5;if(battle)target.lerp(carPosition(race.cars[focus==='a'?'b':'a']).add(new T.Vector3(0,.5,0)),.35);
   if(shot===0){desired.set(p.x-t.x*11-t.z*4.5,2.65,p.z-t.z*11+t.x*4.5);camera.fov=battle?47:38;cameraLabel='CHASE / STABILISED';}
   else if(shot===1){if(lastShot!==shot||Math.abs(c.distance-anchorDistance)>105)anchorDistance=c.distance+70;const anchor=pointAt(anchorDistance,19);desired.set(anchor.x,2.8,anchor.z);const distance=desired.distanceTo(target);camera.fov=T.MathUtils.clamp(2*Math.atan((battle?14:7)/distance)*180/Math.PI,12,48);cameraLabel='TRACKSIDE / TELEPHOTO';}
   else{desired.set(target.x-t.x*25-t.z*30,40,target.z-t.z*25+t.x*30);camera.fov=battle?40:30;cameraLabel='AERIAL / HELICAM';}
   // Fixed world-space trackside anchors, continuous tracking elsewhere; no grid snaps.
   camera.position.copy(desired);camera.lookAt(target);lastShot=shot;
  }
  camera.updateProjectionMatrix();renderer.render(scene,camera);
 }
 const resize=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(container);
 return {render,setMode:(next:CameraMode)=>{mode=next;lastShot=-1;},cut:()=>{forceCut++;},get label(){return cameraLabel;},get info(){return renderer.info.render;},dispose:()=>{disposed=true;resize.disconnect();const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();scene.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const value of Object.values(m))if(value instanceof T.Texture)textures.add(value);}}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());if(scene.background instanceof T.Texture)scene.background.dispose();scene.environment?.dispose();environment.dispose();pmrem.dispose();renderer.dispose();renderer.domElement.remove();}};
}
