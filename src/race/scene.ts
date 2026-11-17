import * as T from 'three';
import {assetBytes} from './embedded-glb';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import daylightURL from './assets/daylight.hdr.gz?url';
import {getTrack,type Track} from './track';
import {loadCircuit} from './circuit-model';
import {createSparks} from './sparks';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {createCar,type Finish} from './car-model';
import {createShowroom} from './showroom';

export type CameraMode='broadcast'|'cockpit-a'|'cockpit-b'|'helicopter'|'flythrough'|'detail'|'sphere'|'strip'|'showroom'|'tcam-a'|'tcam-b'|'chase'|'pits';
export interface RenderCar{distance:number;offset:number;speed:number;steering?:number;pit?:string;heading?:number;acceleration?:number;lateralG?:number;compound?:string;drs?:boolean;gear?:number;rpm?:number;ers?:number;lastLap?:number;bestLap?:number}
export interface RenderRace{cars:Record<'a'|'b',RenderCar>;time:number;phase:string}
export function createScene(container:HTMLElement,track:Track=getTrack()){
 const {pointAt,tangentAt}=track,night=track.night;
 const scene=new T.Scene();scene.background=new T.Color(night?'#02040d':'#c3ccd2');scene.fog=new T.FogExp2(night?'#02040d':'#c3ccd2',night?.00018:.00026);
 const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;renderer.info.autoReset=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
 container.append(renderer.domElement);renderer.domElement.setAttribute('aria-label',`Live 3D ${track.name} ${night?'night ':''}circuit`);
 const camera=new T.PerspectiveCamera(45,1,.06,5000),sun=new T.DirectionalLight(night?'#c9dfff':'#fff0d8',night?1.25:2.7);sun.position.set(-80,120,-50);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-65;sun.shadow.camera.right=65;sun.shadow.camera.top=65;sun.shadow.camera.bottom=-65;sun.shadow.camera.near=1;sun.shadow.camera.far=350;sun.shadow.normalBias=.025;sun.shadow.bias=-.00005;
 scene.add(sun,sun.target,new T.HemisphereLight(night?'#8a9fd0':'#dce6f0',night?'#101323':'#504c3e',night?.5:.65));
 const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment();let environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=night?.35:.45;room.dispose();let disposed=false;
 if(!night)assetBytes(daylightURL).then(b=>new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()).then(bytes=>{const hdr=new HDRLoader().parse(bytes),t=new T.DataTexture(hdr.data,hdr.width,hdr.height,T.RGBAFormat,hdr.type);t.magFilter=T.LinearFilter;t.minFilter=T.LinearFilter;t.needsUpdate=true;t.flipY=true;if(disposed){t.dispose();return;}t.mapping=T.EquirectangularReflectionMapping;scene.background=t;scene.backgroundIntensity=.8;scene.environment=pmrem.fromEquirectangular(t).texture;environment.dispose();scene.environmentIntensity=.65;scene.backgroundRotation.y=1.3;scene.environmentRotation.y=1.3;});
 const anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 const circuit=loadCircuit(scene,track,anisotropy),vegas=night?circuit:null;
 const sparks=night?createSparks(scene,track,circuit.heightAt):null;
 const lights=night?Array.from({length:4},()=>{const l=new T.PointLight('#d9eaff',420,70,2);scene.add(l);return l;}):[];
 const composer=night?new EffectComposer(renderer):null;let bloom:UnrealBloomPass|null=null;if(composer){composer.addPass(new RenderPass(scene,camera));bloom=new UnrealBloomPass(new T.Vector2(640,360),.20,.4,1.5);composer.addPass(bloom);composer.addPass(new OutputPass());}
 const cars={a:createCar('a'),b:createCar('b')};scene.add(cars.a.root,cars.b.root);
 const nightProbe=night?new T.WebGLCubeRenderTarget(64,{generateMipmaps:true,minFilter:T.LinearMipmapLinearFilter}):null,probeCamera=nightProbe?new T.CubeCamera(.5,1800,nightProbe):null;let probeDistance=-Infinity;
 const rearTarget=new T.WebGLRenderTarget(256,96),rearCamera=new T.PerspectiveCamera(58,256/96,.1,500);rearTarget.texture.wrapS=T.RepeatWrapping;rearTarget.texture.repeat.x=-1;let mirrorFrame=0;
 const studio=createShowroom(renderer);let finish:Finish='colour',turntable=true;const params=new URLSearchParams(location.search);
 const loading=document.createElement('div');loading.className='model-loading';loading.textContent='LOADING JGP–26';container.append(loading);Promise.all([cars.a.loaded,cars.b.loaded,circuit.loaded]).then(()=>{if(!disposed){loading.textContent=cars.a.error||cars.b.error||circuit.error?'3D ASSET UNAVAILABLE':'';loading.hidden=cars.a.ready&&cars.b.ready&&circuit.ready;}});
 let mode:CameraMode='broadcast',cameraLabel='TRACKSIDE',forceCut=0,lastShot=-1,anchorDistance=0;
 const look=new T.Vector3(),target=new T.Vector3(),desired=new T.Vector3();
 const carPosition=(c:RenderCar)=>{const q=pointAt(c.distance,c.offset);return new T.Vector3(q.x,circuit.heightAt(c.distance),q.z);};
 function render(race:RenderRace,now:number){
  renderer.info.reset();container.classList.toggle('visor-edge',params.has('visor')&&mode.startsWith('cockpit'));
  for(const id of ['a','b'] as const){const c=race.cars[id],p=carPosition(c),t=tangentAt(c.distance);cars[id].root.position.copy(p);cars[id].root.position.y=p.y+.035;cars[id].root.rotation.set(Math.atan2(circuit.heightAt(c.distance-3)-circuit.heightAt(c.distance+3),6),Math.atan2(t.x,t.z)+(c.heading??0),0,'YXZ');cars[id].update(c,mode===`cockpit-${id}`,mode==='showroom');}
  const focus=race.cars.a.distance>=race.cars.b.distance?'a':'b',c=race.cars[focus],p=carPosition(c),t=tangentAt(c.distance),elapsed=now/1000;
  circuit.update(race.time,p);sparks?.update(race);lights.forEach((light,i)=>{const d=Math.floor(c.distance/45)*45+(i<2?0:45),q=pointAt(d,i%2?7.5:-7.5);light.position.set(q.x,circuit.heightAt(d)+12.2,q.z);});
  sun.position.set(p.x-80,p.y+120,p.z-50);sun.target.position.copy(p);
  if(mode==='showroom'){
   studio.scene.add(cars.a.root);cars.a.root.position.set(0,0,0);cars.a.root.rotation.set(0,0,0);cars.a.update({...race.cars.a,steering:0,drs:false},true,true);
   const angle=params.get('angle')??'front';const pos=angle==='airbox'?new T.Vector3(-.6,1.2,.65):angle==='sidepod'?new T.Vector3(-1.8,.85,1.9):angle==='rear'?new T.Vector3(-2.7,3.4,-6.6):angle==='side'?new T.Vector3(-8.6,1.2,0):angle==='steering'?new T.Vector3(-.06,.77,-.34):angle==='wheel'?new T.Vector3(-2.2,.85,2.75):new T.Vector3(-5.3,2.8,5.3);
   if(turntable&&!params.has('angle'))pos.applyAxisAngle(new T.Vector3(0,1,0),elapsed*.10);camera.position.copy(pos);camera.lookAt(angle==='airbox'?new T.Vector3(0,.94,-.6):angle==='sidepod'?new T.Vector3(-.55,.54,.35):angle==='steering'?new T.Vector3(0,.51,.16):angle==='wheel'?new T.Vector3(-.83,.36,1.55):new T.Vector3(0,.42,0));camera.fov=angle==='steering'?50:angle==='wheel'?32:36;cameraLabel=`JGP–26 / STUDIO / ${finish.toUpperCase()}`;
  }else if(mode.startsWith('cockpit')||mode.startsWith('tcam')){
   const id=mode.endsWith('-a')?'a':'b',v=race.cars[id],q=carPosition(v),dir=tangentAt(v.distance),yaw=Math.atan2(dir.x,dir.z)+(v.heading??0);
   const tc=mode.startsWith('tcam'),height=tc?1.20:.70,back=tc?.70:.55;const shake=Math.min(v.speed/85,1)*.0016;
   camera.position.set(q.x-Math.sin(yaw)*back+Math.cos(elapsed*73)*shake,q.y+height+Math.sin(elapsed*91)*shake,q.z-Math.cos(yaw)*back);target.set(q.x+Math.sin(yaw)*12,circuit.heightAt(v.distance+12)+(tc?.55:.15),q.z+Math.cos(yaw)*12);camera.lookAt(target);camera.rotateZ(Math.sin(elapsed*43)*shake*.18);camera.fov=tc?65:68;cameraLabel=`${tc?'T-CAM':'ONBOARD'} / ${id==='a'?'VECTOR':'CHAOS'}`;
  }else if(mode==='sphere'&&vegas){const sp=vegas.spherePosition;camera.position.set(sp.x+190,88,sp.z+200);camera.lookAt(sp.x,42,sp.z);camera.fov=52;cameraLabel='SPHERE / NIGHT SESSION';
  }else if(mode==='strip'&&vegas){const q=track.project(-115.1718,36.1088),target=track.project(-115.1731,36.1157);camera.position.set(q.x,170,q.z);camera.lookAt(target.x,35,target.z);camera.fov=62;cameraLabel='THE STRIP / NIGHT AERIAL';
  }else if(mode==='pits'){
   const q=pointAt(track.LENGTH-160,65),a=pointAt(track.LENGTH-260,-20);camera.position.set(q.x,circuit.heightAt(track.LENGTH-160)+23,q.z);camera.lookAt(a.x,circuit.heightAt(track.LENGTH-260)+3,a.z);camera.fov=54;cameraLabel='PIT LANE / GRANDSTANDS';
  }else if(mode==='detail'){
   const root=cars.a.root;const angle=new URLSearchParams(location.search).get('angle')??'front';const pos=angle==='rear'?new T.Vector3(-4.4,1.75,-6.1):angle==='side'?new T.Vector3(-7,1.1,0):angle==='top'?new T.Vector3(.01,10,.01):new T.Vector3(-4.1,1.65,6.1);desired.copy(root.localToWorld(pos));camera.position.copy(desired);target.copy(root.position).add(new T.Vector3(0,.45,0));camera.lookAt(target);camera.fov=35;cameraLabel='CAR DETAIL / JGP–26';
  }else if(mode==='flythrough'){
   const fp=pointAt(elapsed*90,45),ahead=pointAt(elapsed*90+90);camera.position.set(fp.x,55,fp.z);camera.lookAt(ahead.x,0,ahead.z);camera.fov=48;cameraLabel=`${track.name.toUpperCase()} / CIRCUIT TOUR`;
  }else{
   const shot=mode==='chase'?0:mode==='helicopter'?2:(Math.floor(elapsed/11)+forceCut)%3;
   const gap=Math.abs(race.cars.a.distance-race.cars.b.distance),battle=gap<55;
   target.copy(p).y=p.y+.5;if(battle)target.lerp(carPosition(race.cars[focus==='a'?'b':'a']).add(new T.Vector3(0,.5,0)),.35);
   if(shot===0){desired.set(target.x-t.x*22-t.z*5,target.y+3.5,target.z-t.z*22+t.x*5);camera.fov=battle?52:38;cameraLabel='CHASE / STABILISED';}
   else if(shot===1){if(lastShot!==shot||Math.abs(c.distance-anchorDistance)>105)anchorDistance=c.distance+70;const anchor=pointAt(anchorDistance,19);desired.set(anchor.x,circuit.heightAt(anchorDistance)+2.8,anchor.z);const distance=desired.distanceTo(target);camera.fov=T.MathUtils.clamp(2*Math.atan((battle?14:7)/distance)*180/Math.PI,12,48);cameraLabel='TRACKSIDE / TELEPHOTO';}
   else{desired.set(target.x-t.x*75-t.z*100,target.y+190,target.z-t.z*75+t.x*100);camera.fov=55;cameraLabel='AERIAL / HELICAM';}
   // Fixed world-space trackside anchors, continuous tracking elsewhere; no grid snaps.
   camera.position.copy(desired);camera.lookAt(target);lastShot=shot;
  }
  if((mode.startsWith('cockpit')||mode.startsWith('tcam'))&&mirrorFrame++%6===0){
   const id=mode.endsWith('-a')?'a':'b',v=race.cars[id],q=carPosition(v),t=tangentAt(v.distance);
   rearCamera.position.set(q.x,q.y+.78,q.z);rearCamera.lookAt(q.x-t.x*25,q.y+.65,q.z-t.z*25);cars[id].root.visible=false;
   const oldTarget=renderer.getRenderTarget(),oldShadow=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;renderer.setRenderTarget(rearTarget);renderer.render(scene,rearCamera);renderer.setRenderTarget(oldTarget);renderer.shadowMap.autoUpdate=oldShadow;cars[id].root.visible=true;cars[id].setMirror(rearTarget.texture);
  }
  if(mode==='showroom'){cars.a.setMirror(null);cars.b.setMirror(null);}
  if(probeCamera&&circuit.ready&&mode!=='showroom'&&Math.abs(c.distance-probeDistance)>240){probeDistance=c.distance;probeCamera.position.set(p.x,p.y+2,p.z);const shadows=renderer.shadowMap.autoUpdate;scene.environment=environment.texture;renderer.shadowMap.autoUpdate=false;cars.a.root.visible=cars.b.root.visible=false;probeCamera.update(renderer,scene);cars.a.root.visible=cars.b.root.visible=true;renderer.shadowMap.autoUpdate=shadows;scene.environment=nightProbe!.texture;scene.environmentIntensity=.7;}
  camera.updateProjectionMatrix();if(mode==='showroom')renderer.render(studio.scene,camera);else{if(cars.a.root.parent!==scene)scene.add(cars.a.root);if(composer)composer.render();else renderer.render(scene,camera);}
 }
 const resize=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);composer?.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(container);
 return {render,setMode:(next:CameraMode)=>{mode=next;lastShot=-1;cars.a.setFinish(next==='showroom'?finish:'colour');},setFinish:(next:Finish)=>{finish=next;cars.a.setFinish(next);},setTurntable:(on:boolean)=>{turntable=on;},cut:()=>{forceCut++;},get label(){return cameraLabel;},get info(){return {...renderer.info.render,sparks:sparks?.active??0,circuit:track.id,modelsReady:cars.a.ready&&cars.b.ready&&circuit.ready,modelError:cars.a.error??cars.b.error??circuit.error,finish};},dispose:()=>{disposed=true;nightProbe?.dispose();rearTarget.dispose();circuit.dispose();loading.remove();cars.a.dispose();cars.b.dispose();scene.add(cars.a.root);studio.dispose();resize.disconnect();sparks?.dispose();composer?.passes.forEach(p=>p.dispose());composer?.dispose();const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();scene.traverse(o=>{if(o instanceof T.DirectionalLight||o instanceof T.PointLight||o instanceof T.SpotLight)o.shadow.dispose();if(o instanceof T.Mesh||o instanceof T.Sprite){if(o instanceof T.Mesh)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);if(m instanceof T.ShaderMaterial)for(const u of Object.values(m.uniforms))if(u.value instanceof T.Texture)textures.add(u.value);for(const value of Object.values(m))if(value instanceof T.Texture)textures.add(value);}}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());if(scene.background instanceof T.Texture)scene.background.dispose();scene.environment?.dispose();environment.dispose();pmrem.dispose();renderer.dispose();renderer.domElement.remove();}};
}
