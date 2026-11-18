import {createField} from './field-model';
import type {FieldCar} from './grid';
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
import {pitCrew} from './pit-crew';
import {pitBox} from './pit-service';
import {createShowroom} from './showroom';
import {BroadcastDirector} from './broadcast-camera';
import {DriverHead,onboardLens} from './onboard-camera';
import {TrackingCameraRig,AERIAL_CAMERA,SIDE_CAMERA,CHASE_CAMERA} from './tracking-camera';

export type CameraMode='broadcast'|'side'|'cockpit-a'|'cockpit-b'|'helicopter'|'flythrough'|'detail'|'sphere'|'strip'|'showroom'|'tcam-a'|'tcam-b'|'chase'|'pits';
export interface RenderCar{distance:number;offset:number;speed:number;steering?:number;pit?:string;pitTime?:number;instruction?:{tyre?:string};heading?:number;acceleration?:number;lateralG?:number;compound?:string;drs?:boolean;gear?:number;rpm?:number;ers?:number;lastLap?:number;bestLap?:number}
export interface RenderRace{field?:FieldCar[];laps?:number;cars:Record<'a'|'b',RenderCar>;time:number;phase:string}
export function createScene(container:HTMLElement,track:Track=getTrack()){
 const {pointAt,tangentAt}=track,night=track.night;
 const scene=new T.Scene();scene.background=new T.Color(night?'#02040d':'#c3ccd2');scene.fog=new T.FogExp2(night?'#02040d':'#c3ccd2',night?.00024:.00083);
 const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;renderer.info.autoReset=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
 container.append(renderer.domElement);renderer.domElement.setAttribute('aria-label',`Live 3D ${track.name} ${night?'night ':''}circuit`);
 const camera=new T.PerspectiveCamera(45,1,.06,5000),sun=new T.DirectionalLight(night?'#c9dfff':'#fff0d8',night?1.25:2.7);sun.position.set(-80,120,-50);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-65;sun.shadow.camera.right=65;sun.shadow.camera.top=65;sun.shadow.camera.bottom=-65;sun.shadow.camera.near=1;sun.shadow.camera.far=350;sun.shadow.normalBias=.025;sun.shadow.bias=-.00005;
 scene.add(sun,sun.target,new T.HemisphereLight(night?'#8a9fd0':'#dce6f0',night?'#101323':'#504c3e',night?.5:.65));
 const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment();let environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=night?.35:.45;room.dispose();let disposed=false;
 if(!night)assetBytes(daylightURL).then(b=>new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()).then(bytes=>{const hdr=new HDRLoader().parse(bytes),t=new T.DataTexture(hdr.data,hdr.width,hdr.height,T.RGBAFormat,hdr.type);t.magFilter=T.LinearFilter;t.minFilter=T.LinearFilter;t.needsUpdate=true;t.flipY=true;if(disposed){t.dispose();return;}t.mapping=T.EquirectangularReflectionMapping;scene.background=t;scene.backgroundIntensity=.8;scene.environment=pmrem.fromEquirectangular(t).texture;environment.dispose();scene.environmentIntensity=.65;scene.backgroundRotation.y=1.3;scene.environmentRotation.y=1.3;});
 if(night){
  // Equirectangular city sky. Warm scattered light stays near the skyline.
  const sky=document.createElement('canvas');sky.width=1024;sky.height=256;
  const ctx=sky.getContext('2d')!;const pixels=ctx.createImageData(sky.width,sky.height);
  for(let y=0;y<sky.height;y++)for(let x=0;x<sky.width;x++){
   const elev=(.5-y/sky.height)*Math.PI,az=x/sky.width*Math.PI*2;
   const haze=Math.exp(-Math.max(0,elev)*6.8),stripGlow=.60+.40*Math.cos(az-1.4)**4;
   const index=(y*sky.width+x)*4;
   pixels.data[index]=10+37*haze*stripGlow;pixels.data[index+1]=16+29*haze*stripGlow;
   pixels.data[index+2]=31+21*haze;pixels.data[index+3]=255;
  }
  ctx.putImageData(pixels,0,0);const skyMap=new T.CanvasTexture(sky);
  skyMap.colorSpace=T.SRGBColorSpace;skyMap.mapping=T.EquirectangularReflectionMapping;
  scene.background=skyMap;scene.fog=new T.FogExp2('#363741',.00034);
 }
 const anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 const circuit=loadCircuit(scene,track,anisotropy),vegas=night?circuit:null;
 const crew=pitCrew(scene,track);
 const sparks=night?createSparks(scene,track,circuit.heightAt):null;
 // Warm architectural spill is fixed to the two resort facades, independent of the car.
 if(night)for(const [lon,lat] of [[-115.1757,36.1127],[-115.1693,36.1212]]){const q=track.project(lon,lat);const light=new T.PointLight('#ffc584',6500,230,2);light.position.set(q.x,24,q.z);scene.add(light);}
 const floodlightCandela=1050;
 const lights=night?Array.from({length:4},()=>{const l=new T.SpotLight('#d9eaff',floodlightCandela,76,1.22,.76,2);scene.add(l,l.target);return l;}):[];
 const composer=night?new EffectComposer(renderer):null;let bloom:UnrealBloomPass|null=null;if(composer){composer.addPass(new RenderPass(scene,camera));bloom=new UnrealBloomPass(new T.Vector2(640,360),.11,.18,1.65);composer.addPass(bloom);composer.addPass(new OutputPass());}
 const cars={a:createCar('a',track),b:createCar('b',track)};scene.add(cars.a.root,cars.b.root);
 const nightProbe=night?new T.WebGLCubeRenderTarget(64,{generateMipmaps:true,minFilter:T.LinearMipmapLinearFilter}):null,probeCamera=nightProbe?new T.CubeCamera(.5,1800,nightProbe):null;let probeDistance=-Infinity;
 const rearTarget=new T.WebGLRenderTarget(256,96),rearCamera=new T.PerspectiveCamera(58,256/96,.1,500);rearTarget.texture.wrapS=T.RepeatWrapping;rearTarget.texture.repeat.x=-1;let mirrorFrame=0;
 const studio=createShowroom(renderer);let finish:Finish='colour',turntable=true;const params=new URLSearchParams(location.search);
 const field=createField(track,circuit.heightAt);scene.add(field.root);
 const loading=document.createElement('div');loading.className='model-loading';loading.textContent='LOADING JGP–26';container.append(loading);Promise.all([cars.a.loaded,cars.b.loaded,circuit.loaded,crew.loaded,field.loaded]).then(()=>{if(!disposed){loading.textContent=cars.a.error||cars.b.error||circuit.error||crew.error||field.error?'3D ASSET UNAVAILABLE':'';loading.hidden=cars.a.ready&&cars.b.ready&&circuit.ready&&crew.ready&&field.ready;}});
 let selectedMode:CameraMode='broadcast',activeMode:CameraMode='side',cameraLabel='SIDE / STABILISED';
 const director=new BroadcastDirector(),driverHead=new DriverHead(),mountRotation=new T.Quaternion();
 const aerial=new TrackingCameraRig(AERIAL_CAMERA),side=new TrackingCameraRig(SIDE_CAMERA),chase=new TrackingCameraRig(CHASE_CAMERA),target=new T.Vector3(),desired=new T.Vector3();
 const carPosition=(c:RenderCar)=>{const q=pointAt(c.distance,c.offset);return new T.Vector3(q.x,circuit.heightAt(c.distance),q.z);};
 function render(race:RenderRace,now:number){
  const mode=selectedMode==='broadcast'?director.update(now):selectedMode;
  if(mode!==activeMode){aerial.reset();side.reset();chase.reset();driverHead.reset();activeMode=mode;}
  renderer.info.reset();container.classList.toggle('visor-edge',params.has('visor')&&mode.startsWith('cockpit'));
  for(const id of ['a','b'] as const){const c=race.cars[id],p=carPosition(c),t=tangentAt(c.distance);cars[id].root.position.copy(p);cars[id].root.position.y=p.y+.026;cars[id].root.rotation.set(Math.atan2(circuit.heightAt(c.distance-3)-circuit.heightAt(c.distance+3),6),Math.atan2(t.x,t.z)+(c.heading??0),0,'YXZ');cars[id].update(c,mode===`cockpit-${id}`,mode==='showroom',now);}
  for(const id of ['a','b'] as const)crew.update(id,race.cars[id]);
  const onboard=mode.startsWith('cockpit')||mode.startsWith('tcam');
  const leader=race.cars.a.distance>=race.cars.b.distance?'a':'b';
  const focus=onboard?(mode.endsWith('-b')?'b':'a'):mode==='detail'?'a':leader;
  const c=race.cars[focus],p=carPosition(c),elapsed=now/1000;
  // Resolve the shadow of fingers wrapped around the rim. Keep the larger
  // shadow footprint for external views of the field and trackside scenery.
  const extent=mode.startsWith('cockpit')?8:onboard||mode==='detail'?22:65;
  if(sun.shadow.camera.right!==extent){
   Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent});
   sun.shadow.camera.updateProjectionMatrix();
   sun.shadow.normalBias=extent===8?.0009:extent===22?.003:.025;
   sun.shadow.radius=extent===8?2:1;
  }
  const chequered=race.phase==='finished'||(race.phase==='racing'&&race.laps!==undefined&&Math.max(race.cars.a.distance,race.cars.b.distance)>=race.laps*track.LENGTH);
  circuit.people.update(elapsed,cars.a.root.position,cars.b.root.position,race.phase==='racing'&&race.cars.a.distance<track.LENGTH,race.phase==='racing'&&race.cars.b.distance<track.LENGTH,chequered);
  circuit.update(race.time,p);sparks?.update(race);
  if(night){
   // The exported fixtures are 45 m apart with a shorter span at the timing line.
   const station=track.wrap(c.distance),row=Math.floor(station/45)*45,next=Math.min(row+45,track.LENGTH);
   const travel=(station-row)/(next-row);
   lights.forEach((light,i)=>{
    const d=i<2?row:track.wrap(next),side=i%2?1:-1,q=pointAt(d,side*7.5),aim=pointAt(d,side*1.9);
    const h=circuit.heightAt(d);
    light.position.set(q.x,h+12.47,q.z);light.target.position.set(aim.x,h,aim.z);
    light.intensity=floodlightCandela*(1-T.MathUtils.smoothstep(i<2?travel:1-travel,.59,1));
    // The upper pair illuminates the service apron from the visible garage fascias.
    // Reuse the race light budget and keep lights local to an occupied box.
    if(i>=2){
     const primary=i===2?'a':'b',alternate=primary==='a'?'b':'a';
     for(const team of [primary,alternate] as const){
      const car=race.cars[team];if(!car.pit||car.pit==='none')continue;
      const box=car.pit==='stopped'?track.wrap(car.distance):pitBox(track,team);
      const delta=track.wrap(car.distance-box+track.LENGTH/2)-track.LENGTH/2;
      if(delta < -32||delta>20)continue;
      const housing=pointAt(box+(i===2?-4.5:4.5),-24.5),service=pointAt(box,-17);
      light.position.set(housing.x,circuit.heightAt(box)+4.12,housing.z);
      light.target.position.set(service.x,circuit.heightAt(box)+.65,service.z);
      light.intensity=190;break;
     }
    }
   });
  }
  sun.position.set(p.x-80,p.y+120,p.z-50);sun.target.position.copy(p);
  if(mode==='showroom'){
   studio.scene.add(cars.a.root);cars.a.root.position.set(0,0,0);cars.a.root.rotation.set(0,0,0);cars.a.update({...race.cars.a,steering:0,drs:false},true,true,now);
   const angle=params.get('angle')??'front';const pos=angle==='halo'?new T.Vector3(-1.0,1.08,-1.1):angle==='airbox'?new T.Vector3(-.6,1.2,.65):angle==='sidepod'?new T.Vector3(-1.8,.85,1.9):angle==='rear'?new T.Vector3(-2.7,3.4,-6.6):angle==='side'?new T.Vector3(-8.6,1.2,0):angle==='steering'?new T.Vector3(-.06,.83,-.34):angle==='wheel'?new T.Vector3(-2.2,.85,2.75):new T.Vector3(-4.85,2.75,4.95);
   if(turntable&&!params.has('angle'))pos.applyAxisAngle(new T.Vector3(0,1,0),elapsed*.10);camera.position.copy(pos);camera.lookAt(angle==='halo'?new T.Vector3(-.25,.70,-.48):angle==='airbox'?new T.Vector3(0,.94,-.6):angle==='sidepod'?new T.Vector3(-.55,.54,.35):angle==='steering'?new T.Vector3(0,.57,.16):angle==='wheel'?new T.Vector3(-.83,.36,1.55):new T.Vector3(0,.42,angle==='front'?.43:0));camera.fov=angle==='steering'?50:angle==='wheel'?32:['side','front','rear'].includes(angle)?T.MathUtils.clamp(2*T.MathUtils.radToDeg(Math.atan(Math.tan(Math.PI/10)*(4/3)/camera.aspect)),23,66):36;cameraLabel=`JGP–26 / STUDIO / ${finish.toUpperCase()}`;
  }else if(mode.startsWith('cockpit')||mode.startsWith('tcam')){
   const id=mode.endsWith('-a')?'a':'b',v=race.cars[id];
   const tc=mode.startsWith('tcam'),{height,back,pitch,fov,offset}=onboardLens(tc);
   const mount=cars[id].chassis;
   mount.updateWorldMatrix(true,false);
   // Read the line the driver will see in half a second, in the car's frame.
   const here=pointAt(v.distance),ahead=pointAt(v.distance+Math.max(7,v.speed*.55));
   const tangent=tangentAt(v.distance),dx=ahead.x-here.x,dz=ahead.z-here.z;
   const roadAngle=Math.atan2(dx*tangent.z-dz*tangent.x,dx*tangent.x+dz*tangent.z)-(v.heading??0);
   if(!tc)driverHead.update(now,roadAngle,v.steering??0,v.speed,v.acceleration??0,v.lateralG??0);
   const eyeX=offset+(tc?0:driverHead.lateral),eyeZ=-back+(tc?0:driverHead.forward);
   const yaw=tc?0:driverHead.yaw;
   camera.position.copy(mount.localToWorld(desired.set(eyeX,height,eyeZ)));
   mount.localToWorld(target.set(eyeX+12*Math.sin(yaw),height-12*Math.tan(T.MathUtils.degToRad(pitch)),eyeZ+12*Math.cos(yaw)));
   camera.up.set(0,1,0).applyQuaternion(mount.getWorldQuaternion(mountRotation));camera.lookAt(target);
   camera.up.set(0,1,0);
   if(!tc)camera.rotateZ(driverHead.roll);
   camera.fov=fov;cameraLabel=`${tc?'T-CAM':'ONBOARD'} / ${id==='a'?'FERRARI':'MERCEDES'}`;
  }else if(mode==='sphere'&&vegas){const sp=vegas.spherePosition;camera.position.set(sp.x+190,88,sp.z+200);camera.lookAt(sp.x,42,sp.z);camera.fov=52;cameraLabel='SPHERE / NIGHT SESSION';
  }else if(mode==='strip'&&vegas){const q=track.project(-115.1719,36.1093),target=track.project(-115.1730,36.1145);camera.position.set(q.x,117,q.z);camera.lookAt(target.x,30,target.z);camera.fov=59;cameraLabel='THE STRIP / NIGHT AERIAL';
  }else if(mode==='pits'){
   const service=(['a','b'] as const).find(id=>{
    const v=race.cars[id],delta=track.wrap(v.distance-pitBox(track,id)+track.LENGTH/2)-track.LENGTH/2;
    return v.pit==='stopped'||(v.pit==='entry'&&delta>-16&&delta<1)||(v.pit==='exit'&&delta>=0&&delta<14);
   });
   if(service){
    const box=race.cars[service].pit==='stopped'?track.wrap(race.cars[service].distance):pitBox(track,service),q=pointAt(box+5.8,-12.9),a=pointAt(box,-18);
    camera.position.set(q.x,circuit.heightAt(box)+3.5,q.z);camera.lookAt(a.x,circuit.heightAt(box)+.76,a.z);
    camera.fov=47;cameraLabel='PIT BOX / '+service.toUpperCase();
   }else{
    const q=pointAt(track.LENGTH-126,night?20.0:30.5),a=pointAt(track.LENGTH-178,-26);camera.position.set(q.x,circuit.heightAt(track.LENGTH-126)+8.8,q.z);camera.lookAt(a.x,circuit.heightAt(track.LENGTH-178)+4.1,a.z);camera.fov=46;cameraLabel='PIT LANE / GRANDSTANDS';
   }
  }else if(mode==='detail'){
   const root=cars.a.root;const angle=new URLSearchParams(location.search).get('angle')??'front';const pos=angle==='rear'?new T.Vector3(-4.4,1.75,-6.1):angle==='side'?new T.Vector3(-7,1.1,0):angle==='top'?new T.Vector3(.01,10,.01):new T.Vector3(-4.1,1.65,6.1);desired.copy(root.localToWorld(pos));camera.position.copy(desired);target.copy(root.position).add(new T.Vector3(0,.45,0));camera.lookAt(target);camera.fov=35;cameraLabel='CAR DETAIL / JGP–26';
  }else if(mode==='flythrough'){
   const fp=pointAt(elapsed*90,45),ahead=pointAt(elapsed*90+90);camera.position.set(fp.x,55,fp.z);camera.lookAt(ahead.x,0,ahead.z);camera.fov=48;cameraLabel=`${track.name.toUpperCase()} / CIRCUIT TOUR`;
  }else{
   // Each external shot follows continuously for its entire hold: no moving
   // trackside anchors, leader-swap jumps or gap-triggered zoom changes.
   const rig=mode==='helicopter'?aerial:mode==='chase'?chase:side;
   const pose=rig.update(track,race.cars.a,race.cars.b,circuit.heightAt,now);
   camera.position.copy(pose.position);target.copy(pose.target);camera.lookAt(target);camera.fov=rig.lens.fov;
   cameraLabel=mode==='helicopter'?'AERIAL / HELICAM':mode==='chase'?'CHASE / STABILISED':'SIDE / STABILISED';
  }
  camera.updateProjectionMatrix();field.update(race.field,camera,p,onboard&&mirrorFrame%6===0);
  if((mode.startsWith('cockpit')||mode.startsWith('tcam'))&&mirrorFrame++%6===0){
   const id=mode.endsWith('-a')?'a':'b',v=race.cars[id],q=carPosition(v),t=tangentAt(v.distance);
   rearCamera.position.set(q.x,q.y+.78,q.z);rearCamera.lookAt(q.x-t.x*25,q.y+.65,q.z-t.z*25);cars[id].root.visible=false;
   const oldTarget=renderer.getRenderTarget(),oldShadow=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;renderer.setRenderTarget(rearTarget);renderer.render(scene,rearCamera);renderer.setRenderTarget(oldTarget);renderer.shadowMap.autoUpdate=oldShadow;cars[id].root.visible=true;cars[id].setMirror(rearTarget.texture);
  }
  if(mode==='showroom'){cars.a.setMirror(null);cars.b.setMirror(null);}
  if(probeCamera&&circuit.ready&&mode!=='showroom'&&Math.abs(c.distance-probeDistance)>240){probeDistance=c.distance;probeCamera.position.set(p.x,p.y+2,p.z);const shadows=renderer.shadowMap.autoUpdate;scene.environment=environment.texture;renderer.shadowMap.autoUpdate=false;cars.a.root.visible=cars.b.root.visible=false;probeCamera.update(renderer,scene);cars.a.root.visible=cars.b.root.visible=true;renderer.shadowMap.autoUpdate=shadows;scene.environment=nightProbe!.texture;scene.environmentIntensity=.7;}
  if(mode==='showroom')renderer.render(studio.scene,camera);else{if(cars.a.root.parent!==scene)scene.add(cars.a.root);if(composer)composer.render();else renderer.render(scene,camera);}
 }
 const resize=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);composer?.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(container);
 return {render,setMode:(next:CameraMode)=>{selectedMode=next;director.reset();aerial.reset();side.reset();chase.reset();cars.a.setFinish(next==='showroom'?finish:'colour');},setFinish:(next:Finish)=>{finish=next;cars.a.setFinish(next);},setTurntable:(on:boolean)=>{turntable=on;},get label(){return cameraLabel;},get info(){return {...renderer.info.render,...(params.has('cameraDebug')?{cameraMode:activeMode,selectedCamera:selectedMode,cameraLabel,cameraFov:camera.fov,cameraPosition:camera.position.toArray(),cameraQuaternion:camera.quaternion.toArray(),cameraTarget:target.toArray()}:{}),sparks:sparks?.active??0,circuit:track.id,modelsReady:cars.a.ready&&cars.b.ready&&circuit.ready&&crew.ready&&field.ready,modelError:cars.a.error??cars.b.error??circuit.error??crew.error??field.error,finish};},dispose:()=>{disposed=true;nightProbe?.dispose();rearTarget.dispose();crew.dispose();field.dispose();circuit.dispose();loading.remove();cars.a.dispose();cars.b.dispose();scene.add(cars.a.root);studio.dispose();resize.disconnect();sparks?.dispose();composer?.passes.forEach(p=>p.dispose());composer?.dispose();const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();scene.traverse(o=>{if(o instanceof T.DirectionalLight||o instanceof T.PointLight||o instanceof T.SpotLight)o.shadow.dispose();if(o instanceof T.Mesh||o instanceof T.Sprite){if(o instanceof T.Mesh)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);if(m instanceof T.ShaderMaterial)for(const u of Object.values(m.uniforms))if(u.value instanceof T.Texture)textures.add(u.value);for(const value of Object.values(m))if(value instanceof T.Texture)textures.add(value);}}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());if(scene.background instanceof T.Texture)scene.background.dispose();scene.environment?.dispose();environment.dispose();pmrem.dispose();renderer.dispose();renderer.domElement.remove();}};
}
