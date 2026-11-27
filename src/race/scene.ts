import {MeshResources} from './mesh-resources';
import {surfaceEffects} from './surface-effects';
import {impactEffects} from './impact-effects';
import {liveryAtlas} from './liveries';
import {createField} from './field-model';
import type {FieldCar} from './grid';
import * as T from 'three';
import {gzipBytes} from './embedded-glb';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import stripReflectionURL from './assets/strip-reflection.hdr.gz?url';
import daylightURL from './assets/daylight.hdr.gz?url';
import {getTrack,type Track} from './track';
import {loadCircuit} from './circuit-model';
import {createRaceWeather} from './race-weather';
import {createSparks} from './sparks';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {SunLight} from 'three/addons/lights/SunLight.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {createCar,prepareRaceCars,type Finish} from './car-model';
import {pitCrew} from './pit-crew';
import {BOX_OFFSET,garageVisits,garageBay,pitBox,type Constructor,type GarageVisit} from './pit-service';
import {createShowroom} from './showroom';
import reviewViews from './assets/review-views.json';
import referenceCameras from './assets/reference-cameras.json';
import {BroadcastDirector} from './broadcast-camera';
import {kerbHeight} from './suspension';
import {DriverHead,onboardLens} from './onboard-camera';
import {createRacingLine,type RacingLineMode} from './racing-line';
import {TrackingCameraRig,AERIAL_CAMERA,SIDE_CAMERA,CHASE_CAMERA} from './tracking-camera';
import {createSafetyCar} from './safety-car-model';
import type {RaceControl} from './race-control';

export type CameraMode='broadcast'|'side'|'cockpit-a'|'cockpit-b'|'helicopter'|'flythrough'|'detail'|'sphere'|'strip'|'showroom'|'tcam-a'|'tcam-b'|'chase'|'pits'|'trackside'|'chase-a'|'chase-b'|'nose-a'|'nose-b';
export interface RenderCar{brake?:number;throttle?:number;lockup?:number;lastImpact?:{time:number;source:string};distance:number;offset:number;speed:number;steering?:number;pit?:string;pitTime?:number;totalStop?:number;instruction?:{tyre?:string};heading?:number;acceleration?:number;lateralG?:number;compound?:string;drs?:boolean;gear?:number;rpm?:number;ers?:number;lastLap?:number;bestLap?:number}
export interface RenderRace{countdown?:number;field?:FieldCar[];control?:RaceControl;laps?:number;cars:Record<'a'|'b',RenderCar>;time:number;phase:string}
const embeddedHDR=new Map<string,Promise<ReturnType<HDRLoader['parse']>>>();
function reflectionData(url:string,signal:AbortSignal|undefined,embedded:boolean){
 if(!embedded)return gzipBytes(url,signal).then(bytes=>new HDRLoader().parse(bytes));
 let data=embeddedHDR.get(url);
 if(!data){
  data=gzipBytes(url).then(bytes=>new HDRLoader().parse(bytes)).catch(error=>{embeddedHDR.delete(url);throw error;});
  embeddedHDR.set(url,data);
 }
 return data;
}
export function prepareEmbeddedRace(night:boolean){
 // Start shared downloads while the selected race session connects.
 void Promise.allSettled([prepareRaceCars(),reflectionData(night?stripReflectionURL:daylightURL,undefined,true)]);
}
export function createScene(container:HTMLElement,track:Track=getTrack()){
 const loadingAssets=new AbortController();
 const {pointAt,tangentAt}=track,night=track.night,embedded=import.meta.env.MCP_APP==='true';
 const scene=new T.Scene();scene.background=new T.Color(night?'#02040d':'#c3ccd2');scene.fog=new T.FogExp2(night?'#02040d':'#c3ccd2',night?.00024:.00083);
 const renderer=new T.WebGLRenderer({antialias:!embedded,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,embedded?1:1.5));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;renderer.info.autoReset=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
 renderer.domElement.style.visibility='hidden';container.append(renderer.domElement);renderer.domElement.setAttribute('aria-label',`Live 3D ${track.name} ${night?'night ':''}circuit`);
 const camera=new T.PerspectiveCamera(45,1,.06,night?7500:5000),sun=night||embedded?new T.DirectionalLight(night?'#c9dfff':'#fff0d8',night?1.17:2.7):new SunLight('#fff0d8',2.7);sun.position.set(-80,120,-50);sun.castShadow=true;sun.shadow.mapSize.setScalar(embedded?1024:2048);sun.shadow.camera.left=-65;sun.shadow.camera.right=65;sun.shadow.camera.top=65;sun.shadow.camera.bottom=-65;sun.shadow.camera.near=1;sun.shadow.camera.far=350;sun.shadow.normalBias=.025;sun.shadow.bias=-.00005;
 camera.name='Race camera';
 if(embedded){camera.layers.enable(1);sun.shadow.camera.layers.enable(1);sun.shadow.camera.layers.enable(2);}
 const hemisphere=new T.HemisphereLight(night?'#8a9fd0':'#dce6f0',night?'#101323':'#504c3e',night?.5:.65);scene.add(sun,hemisphere);if(sun instanceof T.DirectionalLight)scene.add(sun.target);else{sun.position.set(-80,89,-50);sun.shadow.camera.far=200;sun.shadow.mapSize.setScalar(1024);}
 const pmrem=new T.PMREMGenerator(renderer);let environment:T.WebGLRenderTarget|undefined,disposed=false;
 let reflectionError:string|null=null;
 const loadReflections=()=>reflectionData(night?stripReflectionURL:daylightURL,loadingAssets.signal,embedded).then(hdr=>{
  if(disposed)return;
  const map=new T.DataTexture(hdr.data,hdr.width,hdr.height,T.RGBAFormat,hdr.type);
  map.mapping=T.EquirectangularReflectionMapping;map.magFilter=T.LinearFilter;map.minFilter=T.LinearFilter;map.flipY=true;map.needsUpdate=true;
  environment=pmrem.fromEquirectangular(map);scene.environment=environment.texture;
  scene.environmentIntensity=night?.82:.65;
  if(night)map.dispose();
  else{scene.background=map;scene.backgroundIntensity=.8;scene.backgroundRotation.y=1.3;scene.environmentRotation.y=1.3;}
 }).catch(error=>{reflectionError=String(error);});
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
 const anisotropy=Math.min(embedded?4:8,renderer.capabilities.getMaxAnisotropy());
 const darkBlue=new T.Color(0x7b9bea),flagWhite=new T.Color(0xd9e1ff);
 const surfaceWater={value:0};
 const circuit=loadCircuit(scene,track,anisotropy,surfaceWater,embedded&&renderer.extensions.has('WEBGL_multi_draw')),vegas=night?circuit:null;
 let crew=embedded?undefined:pitCrew(scene,track);
 const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
 const dryFog=scene.fog.color.clone(),rainFog=new T.Color(night?'#495365':'#a0abb3');
 const dryDensity=scene.fog.density,drySun=sun.intensity;
 const surfaceFx=surfaceEffects(scene,track,circuit.heightAt);
 const impacts=impactEffects(scene,track,circuit.heightAt);
 const sparks=createSparks(scene,track,circuit.heightAt);
 // Warm architectural spill is fixed to the two resort facades, independent of the car.
 if(night)for(const [lon,lat] of [[-115.1757,36.1127],[-115.1693,36.1212]]){const q=track.project(lon,lat);const light=new T.PointLight('#ffc584',6500,230,2);light.position.set(q.x,24,q.z);scene.add(light);}
 const sphereSpill=vegas?new T.PointLight('#ffab5f',13500,235,2):null;
 if(sphereSpill&&vegas){sphereSpill.position.copy(vegas.spherePosition);scene.add(sphereSpill);}
 const floodlightCandela=1050;
 const lights=night?Array.from({length:embedded?4:6},()=>{const l=new T.SpotLight('#f1f0e9',floodlightCandela,76,1.22,.76,2);scene.add(l,l.target);return l;}):[];
 const spot=lights[0];if(spot&&!embedded){spot.castShadow=true;spot.shadow.mapSize.set(384,384);spot.shadow.camera.near=.7;spot.shadow.camera.far=52;spot.shadow.normalBias=.021;spot.shadow.autoUpdate=false;spot.shadow.needsUpdate=true;}
 let lastSpot=-Infinity;
 const haze=night&&!embedded?new T.InstancedMesh(new T.ConeGeometry(2.65,4.8,20,1,true),new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,
  uniforms:{fogAmount:{value:.012}},vertexShader:'varying vec2 cone;void main(){cone=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
  fragmentShader:'uniform float fogAmount;varying vec2 cone;void main(){float a=cone.y*cone.y*(1.-smoothstep(.92,1.,cone.y));gl_FragColor=vec4(.82,.90,1.,a*fogAmount);}' }),lights.length):null;
 const lampPose=new T.Object3D(),fixtureStations=lights.map(()=>NaN),fixtureBoxes=lights.map(()=>NaN),fixtureGains=lights.map(()=>1);
 if(haze)scene.add(haze);
 const probe=night&&!embedded?new T.LightProbe():null;
 const hospitalityProbe=new T.SphericalHarmonics3(),sphereProbe=new T.SphericalHarmonics3(),probeDirection=new T.Vector3(),basis=new Array<number>(9);
 if(probe){scene.add(probe);probe.intensity=.32;}
 function zoneProbe(sh:T.SphericalHarmonics3,colour:T.Color,dx:number,dz:number){
  T.SphericalHarmonics3.getBasisAt(probeDirection.set(dx,.35,dz).normalize(),basis);
  for(let i=0;i<9;i++)sh.coefficients[i].copy(probeDirection.set(colour.r,colour.g,colour.b)).multiplyScalar(basis[i]);
 }
 zoneProbe(hospitalityProbe,new T.Color('#f1cb93'),.68,-.73);
 const weather=createRaceWeather(scene,track,circuit.heightAt,embedded,lights);
 const beauty=new RenderPass(scene,camera);
 const composer=!embedded?new EffectComposer(renderer,new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,samples:Math.min(4,renderer.capabilities.maxSamples)})):null;let bloom:UnrealBloomPass|null=null;if(composer){composer.addPass(beauty);bloom=new UnrealBloomPass(new T.Vector2(320,180),.11,.18,1.65);composer.addPass(bloom);const output=new OutputPass();output.material.fragmentShader=output.material.fragmentShader.replace('// color space','gl_FragColor.rgb*=1.-.048*smoothstep(.10,.52,dot(vUv-.5,vUv-.5));\n// color space');composer.addPass(output);}
 const paintSheet=liveryAtlas();
 const params=new URLSearchParams(location.search);
 const reviewKey=params.get('review');
 const reviewView=reviewKey&&Object.hasOwn(reviewViews,reviewKey)?reviewKey as keyof typeof reviewViews:null;
 const reviewPose=reviewView?reviewViews[reviewView].pose:undefined;
 const reviewProgress=reviewView?reviewViews[reviewView].progress:1;
 const stageProgress=reviewPose==='overhead'?.08:reviewPose==='lift'?.10:reviewPose==='breakdown'?.63:reviewProgress;
 // Three installs a renderer-specific dispose listener on each morphed geometry.
 // A cached template outlives the context, so both cars use a scene-owned copy.
 const morphGeometry=new Map<T.BufferGeometry,T.BufferGeometry>();
 function sceneMorph(source:T.BufferGeometry){
  let geometry=morphGeometry.get(source);
  if(!geometry){geometry=source.clone();geometry.userData.shared=true;morphGeometry.set(source,geometry);}
  return geometry;
 }
 const cars={a:createCar('a',track,paintSheet,sceneMorph,surfaceWater,reviewPose??undefined,reviewProgress),b:createCar('b',track,paintSheet,sceneMorph,surfaceWater)};scene.add(cars.a.root,cars.b.root);
 let safetyCar:ReturnType<typeof createSafetyCar>|undefined;
 let rearTarget:T.WebGLRenderTarget|undefined;
 function mirrorTarget(){
  if(!rearTarget){
   rearTarget=new T.WebGLRenderTarget(512,128);
   rearTarget.texture.wrapS=T.RepeatWrapping;rearTarget.texture.repeat.x=-1;
  }
  return rearTarget;
 }
 const rearCamera=new T.PerspectiveCamera(55,256/128,.1,500);let mirrorFrame=0,mirrorSide=0,mirrorSeed=0;
 let studio:ReturnType<typeof createShowroom>|undefined;let finish:Finish='colour',turntable=true;
 const field=createField(track,circuit.heightAt,paintSheet,surfaceWater);scene.add(field.root,field.signage);
 const loading=document.createElement('div');loading.className='model-loading';loading.setAttribute('elementtiming','race-loading');loading.textContent='LOADING MCP GP';if(!embedded)container.append(loading);
 let assetsLoaded=false,presentationReady=false,mirrorMs=0,mainMs=0,contextLost=false;
 let warmStep=0,warmSubmitted=false,warmFence:WebGLSync|null=null;
 let embeddedWarming=false,embeddedWarmed=false,driveAtlasUploaded=false,reflectionReady=!embedded;
 const reflectionDeadline=performance.now()+600;
 // Compile the final lit materials once. Adding the environment after the first
 // visible draw used to invalidate the PBR variants on the following frames.
 if(embedded)void loadReflections().finally(()=>{reflectionReady=true;});
 const gl=renderer.getContext() as WebGL2RenderingContext;
 // Unblock async shader warmup when a hidden iframe is disposed before its next rAF.
 let warmFrame=0,resumeWarm:(()=>void)|undefined,warmGeneration=0;
 function cancelWarmFrame(){
  warmGeneration++;
  if(warmFrame)cancelAnimationFrame(warmFrame);
  warmFrame=0;resumeWarm?.();resumeWarm=undefined;
 }
 function nextWarmFrame(){
  return new Promise<void>(resolve=>{
   resumeWarm=resolve;
   warmFrame=requestAnimationFrame(()=>{warmFrame=0;resumeWarm=undefined;resolve();});
  });
 }
 const onContextLost=(e:Event)=>{e.preventDefault();cancelWarmFrame();contextLost=true;presentationReady=false;renderer.domElement.style.visibility='hidden';};
 const onContextRestored=()=>{mirrorQueue.length=mirrorPrograms.length=0;mirrorProgram=mirrorIndex=mirrorDraw=0;mirrorSeen.clear();mirrorReady=false;mirrorSeed=0;crewWarm=false;driveAtlasUploaded=false;contextLost=false;embeddedWarming=false;embeddedWarmed=false;};
 renderer.domElement.addEventListener('webglcontextlost',onContextLost);
 renderer.domElement.addEventListener('webglcontextrestored',onContextRestored);
 const cameraDebug=params.has('cameraDebug');
 if(!embedded)void Promise.all([cars.a.loaded,cars.b.loaded,circuit.loaded,crew!.loaded,field.loaded,loadReflections()]).then(async()=>{
  if(disposed)return;
  if(reflectionError||!cars.a.ready||!cars.b.ready||!circuit.ready||!crew!.ready||!field.ready){
   loading.textContent='3D ASSET UNAVAILABLE';return;
  }
  // WebGL variants differ between the scene and the LDR mirror. Queue both
  // before querying any uniforms, then spread driver reflection over frames.
  const previousTarget=renderer.getRenderTarget();
  try{
   renderer.setRenderTarget(composer?.readBuffer??null);
   renderer.compile(scene,camera);
   renderer.setRenderTarget(mirrorTarget());
   // Scenery also enters the actual mirror on the first onboard frame.
   renderer.compile(scene,rearCamera);
  }finally{renderer.setRenderTarget(previousTarget);}
  const parallel=gl.getExtension('KHR_parallel_shader_compile');
  let slice=performance.now();
  for(const entry of renderer.info.programs?.slice()??[]){
   while(parallel&&!disposed&&!gl.getProgramParameter(entry.program as WebGLProgram,parallel.COMPLETION_STATUS_KHR)){
    await nextWarmFrame();
    slice=performance.now();
   }
   if(disposed)return;
   entry.getUniforms();
   entry.getAttributes();
   if(performance.now()-slice>5){await nextWarmFrame();slice=performance.now();}
  }
  if(!disposed)assetsLoaded=true;
 }).catch(err=>{if(!disposed){reflectionError=String(err);loading.textContent='3D ASSET UNAVAILABLE';}});
 const pan=new T.Vector3();let panAnchor=-1,panTime=0,orbitYaw=0,orbitPitch=0,zoom=1,pointer:number|null=null;
 const element=renderer.domElement;
 const orbitStart=(e:PointerEvent)=>{if(selectedMode!=='showroom'||reviewView||e.button!==0)return;pointer=e.pointerId;element.setPointerCapture(pointer);turntable=false;};
 const orbitMove=(e:PointerEvent)=>{if(e.pointerId!==pointer)return;orbitYaw-=e.movementX*.007;orbitPitch=T.MathUtils.clamp(orbitPitch+e.movementY*.005,-.8,1.2);};
 const orbitEnd=()=>{pointer=null;};
 const orbitZoom=(e:WheelEvent)=>{if(selectedMode!=='showroom'||reviewView)return;e.preventDefault();zoom=T.MathUtils.clamp(zoom*Math.exp(.001*e.deltaY),.42,2.8);};
 element.addEventListener('pointerdown',orbitStart);element.addEventListener('pointermove',orbitMove);element.addEventListener('lostpointercapture',orbitEnd);element.addEventListener('wheel',orbitZoom,{passive:false});
 let selectedMode:CameraMode='broadcast',activeMode:CameraMode='side',cameraLabel='SIDE / STABILISED';
 let lookBack=false,racingLineMode:RacingLineMode='off',racingLineSeat:'a'|'b'='a',hiddenCar:'a'|'b'|null=null;
 let racingLine:ReturnType<typeof createRacingLine>|undefined;
 const director=new BroadcastDirector(),driverHead=new DriverHead(),mountRotation=new T.Quaternion();
 const aerial=new TrackingCameraRig(AERIAL_CAMERA),side=new TrackingCameraRig(SIDE_CAMERA),chase=new TrackingCameraRig(CHASE_CAMERA),target=new T.Vector3(),desired=new T.Vector3();
 const carPosA=new T.Vector3(),carPosB=new T.Vector3(),focusPos=new T.Vector3(),rearPos=new T.Vector3(),upAxis=new T.Vector3(0,1,0),detailPos=new T.Vector3(),detailOffset=new T.Vector3(0,.45,0);
 const visitMap=new Map<Constructor,GarageVisit>();
 const carPosition=(c:Pick<RenderCar,'distance'|'offset'>,out=new T.Vector3())=>{const q=pointAt(c.distance,c.offset);return out.set(q.x,circuit.heightAt(c.distance),q.z);};
 let covering:Constructor|undefined;
 const garages=Object.keys(garageBay) as Constructor[];
 const crewFrustum=new T.Frustum(),crewProjection=new T.Matrix4();
 const crewBounds=new Map(garages.map(team=>{
  const box=pitBox(track,team),pos=carPosition({distance:box,offset:BOX_OFFSET});
  return [team,new T.Sphere(pos,10)] as const;
 }));
 function warmRivalMirror(root:T.Group){
  // The first close rival in a mirror uses an LDR target. A main HDR draw
  // or compile() alone doesn't exercise the Metal pipeline for that target.
  const previousTarget=renderer.getRenderTarget(),shadows=renderer.shadowMap.autoUpdate;
  const visible=root.visible;
  const scenery=scene.children.filter(o=>o.visible&&o!==root&&!(o instanceof T.Light));
  for(const o of scenery)o.visible=false;
  cars.a.setMirrorVisible(false);cars.b.setMirrorVisible(false);
  try{
   renderer.shadowMap.autoUpdate=false;
   renderer.setRenderTarget(mirrorTarget());
   root.visible=true;
   rearCamera.position.copy(root.localToWorld(new T.Vector3(1.7,1.05,5.2)));
   rearCamera.lookAt(root.localToWorld(new T.Vector3(0,.53,0)));
   renderer.render(scene,rearCamera);
  }finally{
   renderer.setRenderTarget(previousTarget);renderer.shadowMap.autoUpdate=shadows;
   for(const o of scenery)o.visible=true;
   root.visible=visible;
   cars.a.setMirrorVisible(true);cars.b.setMirrorVisible(true);
  }
 }
 // Queue distinct material/geometry variants over several presented frames.
 // The lighting scene contains the same lights, fog and environment, without
 // traversing both cars and the venue for every compile() invocation.
 const mirrorLights=new T.Scene(),mirrorQueue:T.Mesh[]=[],mirrorSeen=new Set<string>();
 let mirrorPrograms:NonNullable<typeof renderer.info.programs>=[],mirrorProgram=0,mirrorIndex=0,mirrorDraw=0,mirrorReady=false;
 let crewWarm=false;
 const parallelCompile=gl.getExtension('KHR_parallel_shader_compile');
 const warmCamera=new T.PerspectiveCamera(),warmScissor=new T.Vector4();
 warmCamera.name='Shader warmup';mirrorLights.matrixWorldAutoUpdate=false;
 function gatherMirrorMeshes(){
  mirrorLights.children=scene.children.filter(o=>o instanceof T.Light);
  mirrorLights.environment=scene.environment;mirrorLights.fog=scene.fog;
  scene.traverse(o=>{
   if(!(o instanceof T.Mesh)||Array.isArray(o.material)||o instanceof T.LOD||!o.layers.test(camera.layers))return;
   // Water reflectors launch a nested scene pass and must only draw in the live venue.
   if('isReflector' in o)return;
   const key=o.material.uuid+'/'+o.type+'/'+Boolean(o.geometry.morphAttributes.position)+'/'+Boolean(o.geometry.attributes.color)+'/'+Boolean(o instanceof T.InstancedMesh&&o.instanceColor);
   if(mirrorSeen.has(key))return;
   mirrorSeen.add(key);mirrorQueue.push(o);
  });
 }
 function warmMirror(){
  if(mirrorReady&&!mirrorQueue.length){
   if(crewWarm||!crew?.ready)return;
   crewWarm=true;mirrorIndex=mirrorProgram=mirrorDraw=0;
  }
  const start=performance.now();
  warmCamera.copy(camera,false);warmCamera.name='Shader warmup';
  if(!mirrorQueue.length){gatherMirrorMeshes();if(!mirrorQueue.length)return;}
  const previous=renderer.getRenderTarget(),shadows=renderer.shadowMap.autoUpdate,clear=renderer.autoClear;
  const scissorTest=renderer.getScissorTest();renderer.getScissor(warmScissor);
  try{
   renderer.shadowMap.autoUpdate=false;renderer.autoClear=false;
   while(mirrorIndex<mirrorQueue.length*2){
    const rear=mirrorIndex%2===1,o=mirrorQueue[Math.floor(mirrorIndex++/2)];
    if(rear&&!o.layers.test(rearCamera.layers))continue;
    renderer.setRenderTarget(rear?mirrorTarget():null);
    const at=renderer.info.programs?.length??0;
    renderer.compile(o,rear?rearCamera:camera,mirrorLights);
    const programs=renderer.info.programs;
    if(programs)for(let i=at;i<programs.length;i++)mirrorPrograms.push(programs[i]);
    if(performance.now()-start>=2)return;
   }
   while(mirrorProgram<mirrorPrograms.length){
    const entry=mirrorPrograms[mirrorProgram];
    if(parallelCompile&&!gl.getProgramParameter(entry.program as WebGLProgram,parallelCompile.COMPLETION_STATUS_KHR))return;
    entry.getUniforms();entry.getAttributes();mirrorProgram++;
    if(performance.now()-start>=2)return;
   }
   // Driver pipelines and VAOs can be created on first draw even after linking.
   // Use the real framebuffer formats, with a scissor outside the visible image.
   while(mirrorDraw<mirrorQueue.length*2){
    const rear=mirrorDraw%2===1,o=mirrorQueue[Math.floor(mirrorDraw++/2)];
    if(rear&&!o.layers.test(rearCamera.layers))continue;
    const visible=o.visible,culled=o.frustumCulled;
    renderer.setRenderTarget(rear?mirrorTarget():null);renderer.setScissor(0,0,0,0);renderer.setScissorTest(true);
    o.visible=true;o.frustumCulled=false;mirrorLights.children.push(o);
    try{renderer.render(mirrorLights,warmCamera);}
    finally{mirrorLights.children.pop();o.visible=visible;o.frustumCulled=culled;}
    if(performance.now()-start>=2)return;
   }
  }finally{
   renderer.setRenderTarget(previous);renderer.setScissor(warmScissor);renderer.setScissorTest(scissorTest);
   renderer.shadowMap.autoUpdate=shadows;renderer.autoClear=clear;
  }
  mirrorQueue.length=mirrorPrograms.length=0;mirrorReady=true;
 }
 function warmEmbedded(race:RenderRace,now:number){
  const generation=warmGeneration;
  embeddedWarming=true;
  const previousTarget=renderer.getRenderTarget();
  try{
   renderer.setRenderTarget(null);
   drawFrame(race,now,undefined,true);
   scene.updateMatrixWorld();
   const frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
   const view=new T.Group();
   scene.traverseVisible(o=>{
    if(o instanceof T.LOD&&o.autoUpdate)o.update(camera);
    if(o instanceof T.Mesh&&o.layers.test(camera.layers)&&(!o.frustumCulled||o.intersectsFrustum(frustum)))view.children.push(o);
   });
   renderer.compile(view,camera,scene);
   if(selectedMode.startsWith('cockpit')||selectedMode.startsWith('tcam')){
    // Upload the selected view's maps while its program links are in flight.
    // Waiting for uniform reflection first serializes those two startup costs.
    const maps=new Set<T.Texture>();
    for(const item of view.children){
     const material=(item as T.Mesh).material;
     for(const m of Array.isArray(material)?material:[material])for(const value of Object.values(m)){
      if(value instanceof T.Texture&&!value.isRenderTargetTexture&&value.image&&value.image.complete!==false)maps.add(value);
     }
    }
    for(const map of maps)renderer.initTexture(map);
   }
  }finally{renderer.setRenderTarget(previousTarget);}
  const parallel=gl.getExtension('KHR_parallel_shader_compile');
  void (async()=>{
   let slice=performance.now();
   for(const entry of renderer.info.programs?.slice()??[]){
    while(parallel&&generation===warmGeneration&&!disposed&&!contextLost&&!gl.isContextLost()&&!gl.getProgramParameter(entry.program as WebGLProgram,parallel.COMPLETION_STATUS_KHR)){
     await nextWarmFrame();
     slice=performance.now();
    }
    if(generation!==warmGeneration||disposed||contextLost||gl.isContextLost())return;
    // After a successful onboard link, skip the three synchronous compiler-log
    // queries Three otherwise issues per program. Failed links keep full diagnostics.
    const check=renderer.debug.checkShaderErrors;
    const onboard=selectedMode.startsWith('cockpit')||selectedMode.startsWith('tcam');
    if(onboard&&check&&!cameraDebug&&gl.getProgramParameter(entry.program as WebGLProgram,gl.LINK_STATUS))renderer.debug.checkShaderErrors=false;
    try{entry.getUniforms();entry.getAttributes();}finally{renderer.debug.checkShaderErrors=check;}
    if(performance.now()-slice>5){await nextWarmFrame();slice=performance.now();}
   }
   if(!disposed&&generation===warmGeneration)embeddedWarmed=true;
  })();
 }
 // Reduce secondary-view work under sustained frame pressure. Hysteresis
 // avoids reallocating targets on camera cuts or isolated shader compiles.
 let embeddedTier=0;
 let balanced=embedded,lastPresented=0,submitMs=0,frameMs=16.7,pressure=0,recovery=0,lastShadow=-Infinity;
 function updateQuality(now:number){
  const dt=now-lastPresented;lastPresented=now;
  if(!presentationReady||dt<=0||dt>(embedded?500:160))return;
  frameMs+=.08*((embedded?Math.min(dt,80):dt)-frameMs);
  if(embedded){
   pressure=frameMs>20?pressure+dt:Math.max(0,pressure-dt);
   recovery=frameMs<17.4?recovery+dt:0;
   const tier=pressure>900?Math.min(2,embeddedTier+1):recovery>6500?Math.max(0,embeddedTier-1):embeddedTier;
   if(tier!==embeddedTier){
    embeddedTier=tier;pressure=recovery=0;
    renderer.setPixelRatio(Math.min(devicePixelRatio,1)*(1-.1*tier));
    circuit.setReflectionCadence(50+tier*8);
   }
   return;
  }
  pressure=Math.max(0,pressure+(frameMs>17.0||submitMs>14?dt:-dt));
  recovery=frameMs<16.85&&submitMs<11?recovery+dt:0;
  if((!balanced&&pressure>450)||(balanced&&recovery>9000)){
   balanced=!balanced;pressure=0;recovery=0;
   const size=sun instanceof SunLight?(balanced?512:1024):(balanced?1024:2048);
   sun.shadow.mapSize.set(size,size);
   sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.needsUpdate=true;
   const ratio=balanced?Math.min(devicePixelRatio*.80,1):Math.min(devicePixelRatio,1.5);
   if(ratio!==renderer.getPixelRatio()){renderer.setPixelRatio(ratio);composer?.setPixelRatio(ratio);}
   sizeBloom(lastWidth,lastHeight);
  }
 }
 function render(race:RenderRace,now:number){
  updateQuality(now);
  if(embedded){
   if(contextLost||gl.isContextLost()){
    presentationReady=false;
    renderer.domElement.style.visibility='hidden';
    return;
   }
   if((!reflectionReady&&now<reflectionDeadline)||!hasSize||!circuit.ready||!cars.a.ready||!cars.b.ready){
    // The grid and both cars use this sheet. Transfer it while the selected
    // Drive venue is loading, before the first cockpit frame needs the sampler.
    if(hasSize&&!driveAtlasUploaded&&(selectedMode.startsWith('cockpit')||selectedMode.startsWith('tcam'))){
     driveAtlasUploaded=true;renderer.initTexture(paintSheet);
    }
    return;
   }
   if(!embeddedWarmed){
    if(!embeddedWarming)warmEmbedded(race,now);
    return;
   }
   const hadFrame=presentationReady;
   drawFrame(race,now);
   if(!hadFrame){
    if(contextLost||gl.isContextLost())return;
    presentationReady=true;
    renderer.domElement.style.visibility='';
   }else if(!crew){
    // The pit equipment can finish loading after the first race frame.
    crew=pitCrew(scene,track);
   }else if(selectedMode==='broadcast'||activeMode.startsWith('tcam')||activeMode.startsWith('cockpit'))warmMirror();
   return;
  }
  if(assetsLoaded&&!warmSubmitted){
   if(warmStep<2){
    warmRivalMirror(warmStep++===0?cars.a.root:cars.b.root);return;
   }
   mirrorFrame=0;
   // A real onboard draw links both the close LOD and the offscreen mirror
   // programs while the loading overlay is still visible.
   if(selectedMode==='broadcast'&&warmStep++===2){drawFrame(race,now,'tcam-a');return;}
   director.reset();
   drawFrame(race,now);
   warmSubmitted=true;
   warmFence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
   gl.flush();
  }else if(presentationReady){
   const start=performance.now();
   drawFrame(race,now);
   submitMs+=.10*(performance.now()-start-submitMs);
  }
  if(warmSubmitted&&!presentationReady){
   // Poll on subsequent frames. Race time remains server-owned throughout.
   if(warmFence&&gl.clientWaitSync(warmFence,0,0)===gl.TIMEOUT_EXPIRED)return;
   if(warmFence){gl.deleteSync(warmFence);warmFence=null;}
   presentationReady=true;renderer.domElement.style.visibility='';loading.hidden=true;
  }
 }
 const inBox=(v:GarageVisit|undefined)=>v&&(v.car.pit==='stopped'||(v.car.pit==='entry'&&v.gap>=-20&&v.gap<1)||(v.car.pit==='exit'&&v.gap>=0&&v.gap<14));
 const seats=['a','b'] as const;
 const recentImpact=(car:RenderCar,time:number)=>car.lastImpact&&time>=car.lastImpact.time&&time-car.lastImpact.time<.45;
 function drawFrame(race:RenderRace,now:number,warmMode?:CameraMode,prepare=false){
  const safety=race.phase==='racing'&&selectedMode!=='showroom'?race.control?.safetyCar:undefined;
  if(safety){
   if(!safetyCar){safetyCar=createSafetyCar();scene.add(safetyCar.car);}
   const point=pointAt(safety.distance,safety.offset),tangent=tangentAt(safety.distance);
   safetyCar.car.visible=true;
   safetyCar.car.position.set(point.x,circuit.heightAt(safety.distance),point.z);
   safetyCar.car.rotation.y=Math.atan2(tangent.x,tangent.z);
   safetyCar.car.rotation.x=Math.atan2(circuit.heightAt(safety.distance-2)-circuit.heightAt(safety.distance+2),4);
   safetyCar.flash(race.time,safety.distance);
  }else if(safetyCar)safetyCar.car.visible=false;
  const visits=garageVisits(track,race.cars,race.field,visitMap);
  let featured=covering?visits.get(covering):undefined;
  if(!inBox(featured)){
   featured=undefined;
   let stoppedFallback:GarageVisit|undefined;
   for(const v of visits.values()){
    if(v.entry.seat&&inBox(v)){featured=v;break;}
    if(!stoppedFallback&&v.car.pit==='stopped')stoppedFallback=v;
   }
   featured??=stoppedFallback;
   covering=featured?.entry.team;
  }
  const mode=warmMode??(selectedMode==='broadcast'?(featured?'pits':director.update(now,!!(recentImpact(race.cars.a,race.time)||recentImpact(race.cars.b,race.time)))):selectedMode);
  const cameraCut=mode!==activeMode;
  if(cameraCut){aerial.reset();side.reset();chase.reset();driverHead.reset();activeMode=mode;}
  renderer.info.reset();container.classList.toggle('visor-edge',params.has('visor')&&mode.startsWith('cockpit'));
  for(const id of seats){const c=race.cars[id],p=carPosition(c,id==='a'?carPosA:carPosB),t=tangentAt(c.distance);cars[id].root.position.copy(p);cars[id].root.position.y=p.y+.026;cars[id].root.rotation.set(Math.atan2(circuit.heightAt(c.distance-3)-circuit.heightAt(c.distance+3),6),Math.atan2(t.x,t.z)+(c.heading??0),0,'YXZ');const flag=race.control?.safetyCar||(race.control?.yellowUntil??0)>race.time?'yellow':(race.cars[id==='a'?'b':'a'].distance-c.distance>track.LENGTH?'blue':'green');
   cars[id].update(c,mode===`cockpit-${id}`,mode==='showroom',now,mode===`cockpit-${id}`||mode===`tcam-${id}`||mode==='detail'||mode==='showroom',flag);}
  const onboard=mode.startsWith('cockpit')||mode.startsWith('tcam');
  const playerCam=onboard||mode.startsWith('chase-')||mode.startsWith('nose-');
  const leader=race.cars.a.distance>=race.cars.b.distance?'a':'b';
  const focus=playerCam?(mode.endsWith('-b')?'b':'a'):mode==='detail'?(params.get('subject')==='b'?'b':'a'):mode==='pits'&&featured?.entry.seat?featured.entry.seat:leader;
  if(hiddenCar){cars[hiddenCar].root.visible=false;cars[hiddenCar==='a'?'b':'a'].root.visible=true;}
  const c=race.cars[focus],p=mode==='pits'&&featured?carPosition({distance:pitBox(track,featured.entry.team),offset:BOX_OFFSET},focusPos):(focus==='a'?carPosA:carPosB),elapsed=now/1000;
  // Resolve the shadow of fingers wrapped around the rim. Keep the larger
  // shadow footprint for external views of the field and trackside scenery.
  const extent=mode.startsWith('cockpit')?8:mode==='pits'?10:onboard||mode==='detail'?22:65;
  if(sun instanceof SunLight)sun.shadow.camera.far=mode==='helicopter'||mode==='flythrough'?390:onboard?120:215;
  if(sun instanceof T.DirectionalLight&&sun.shadow.camera.right!==extent){
   Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent});
   sun.shadow.camera.updateProjectionMatrix();
   sun.shadow.normalBias=extent<=10?.0009:extent===22?.003:.025;
   sun.shadow.radius=extent===8?2:1;
  }
  const chequered=race.phase==='finished'||(race.phase==='racing'&&race.laps!==undefined&&(Math.max(race.cars.a.distance,race.cars.b.distance)>=race.laps*track.LENGTH||!!race.field?.some(car=>car.finishTime!==null)));
  circuit.signals.update(race);
  circuit.people.update(elapsed,cars.a.root.position,cars.b.root.position,race.phase==='racing'&&race.cars.a.distance<track.LENGTH,race.phase==='racing'&&race.cars.b.distance<track.LENGTH,chequered,(race.control?.yellowUntil??0)>race.time||!!race.control?.safetyCar);
  circuit.sphereShow?.update(race,track,elapsed,chequered);
  if(sphereSpill&&circuit.sphereShow){const u=circuit.sphereShow.material.uniforms;sphereSpill.color.set('#ffbd62').lerp(darkBlue,u.helmetMix.value).lerp(flagWhite,u.flagMix.value);}
  sparks.update(race,p);impacts.update(race,camera);surfaceFx.update(race,renderer.domElement.height);
  if(night){
   // The exported fixtures are 45 m apart with a shorter span at the timing line.
   const station=track.wrap(c.distance),row=Math.floor(station/45)*45,next=Math.min(row+45,track.LENGTH);
   const travel=(station-row)/(next-row);
   let first=mode==='pits'?featured:undefined;
   if(!first)for(const v of visits.values())if(v.gap>=-32&&v.gap<=20){first=v;break;}
   const firstBox=first?pitBox(track,first.entry.team):null;
   let secondBox=firstBox,nearest=Infinity;
   for(const candidate of visits.values())if(candidate.gap>=-32&&candidate.gap<=20&&candidate!==first&&firstBox!==null){
    const box=pitBox(track,candidate.entry.team),gap=Math.abs(box-firstBox);
    if(gap<nearest){nearest=gap;secondBox=box;}
   }
   let moved=false;
   lights.forEach((light,i)=>{
    const d=i<2?row:i<4?track.wrap(next):track.wrap(next+45),side=i%2?1:-1;
    const box=i===2?firstBox:i===3?secondBox:null;
    // Fixed luminaires only move when the selected row or occupied bay changes.
    if(fixtureStations[i]!==d||fixtureBoxes[i]!== (box??-1)){
     fixtureStations[i]=d;fixtureBoxes[i]=box??-1;moved=true;
     const stripPool=T.MathUtils.smoothstep(d,3150,3420)*(1-T.MathUtils.smoothstep(d,4180,4410));
     fixtureGains[i]=1+stripPool*(.17*Math.cos(d*.026+side*1.6)-.24);
     const housing=box!==null?pointAt(box+(i===2?-4.5:4.5),-24.5):pointAt(d,side*7.5);
     const aim=box!==null?pointAt(box,BOX_OFFSET):pointAt(d,side*1.9),h=circuit.heightAt(box??d);
     light.position.set(housing.x,h+(box!==null?4.12:12.47),housing.z);
     light.target.position.set(aim.x,h+(box!==null?.65:0),aim.z);
     if(haze){lampPose.position.copy(light.position);lampPose.position.y-=2.45;lampPose.updateMatrix();haze.setMatrixAt(i,lampPose.matrix);}
    }
    light.intensity=box!==null?190:i>=4?floodlightCandela*.46:floodlightCandela*fixtureGains[i]*(1-T.MathUtils.smoothstep(i<2?travel:1-travel,.59,1));
   });
   if(haze){
    if(moved){haze.instanceMatrix.needsUpdate=true;haze.computeBoundingSphere();}
    haze.material.uniforms.fogAmount.value=.011+.044*surfaceWater.value;
   }
   if(spot&&spot.castShadow&&(cameraCut||now<lastSpot||now-lastSpot>(balanced?250:75))){spot.shadow.needsUpdate=true;lastSpot=now;}
   if(probe&&vegas&&sphereSpill){const mix=1-T.MathUtils.smoothstep(vegas.spherePosition.distanceTo(p),70,330);
    zoneProbe(sphereProbe,sphereSpill.color,-.61,.79);probe.sh.copy(hospitalityProbe).lerp(sphereProbe,mix);probe.intensity=.13+mix*.26;}
  }
  if(sun instanceof T.DirectionalLight){sun.position.set(p.x-80,p.y+(night?120:89),p.z-50);sun.target.position.copy(p);}
  if(camera.view?.enabled)camera.clearViewOffset();
  if(mode==='showroom'){
   if(!studio){
    studio=createShowroom(renderer,reviewPose?-.34*stageProgress:0,reviewView);
    studio.setStageFinish(finish);
   }
   studio.scene.add(cars.a.root);cars.a.root.position.set(0,0,0);cars.a.root.rotation.set(0,0,0);cars.a.update({...race.cars.a,steering:0,drs:false},true,true,now);
   const angle=params.get('angle')??'front';
   const key=reviewView?(reviewView==='hero'?finish:reviewView):angle==='front'?finish:angle==='wheel'?'front-corner':angle==='diffuser'?'diffuser-wire':angle==='steering'?'steering':null;
   if(key){
    const shot=referenceCameras[key];
    target.fromArray(shot.target);
    desired.fromArray(shot.direction).normalize().multiplyScalar(shot.distance);
    if(turntable&&!reviewView&&!params.has('angle'))desired.applyAxisAngle(upAxis,elapsed*.10);
    camera.position.copy(target).add(desired);camera.lookAt(target);camera.rotateZ(T.MathUtils.degToRad(shot.roll));
    camera.fov=2*T.MathUtils.radToDeg(Math.atan(shot.width/(2*shot.distance*camera.aspect)));
    const width=1000*camera.aspect;
    camera.setViewOffset(width,1000,shot.shift[0]*width,-shot.shift[1]*width,width,1000);
   }else{
    const pos=angle==='halo'?[-1,1.08,-1.1]:angle==='airbox'?[-.6,1.2,.65]:angle==='sidepod'?[-1.8,.85,1.9]:angle==='rear'?[-2.7,3.4,-6.6]:angle==='side'?[-8.6,1.2,0]:[-6,3.88,4.47];
    const aim=angle==='halo'?[-.25,.70,-.48]:angle==='airbox'?[0,.94,-.6]:angle==='sidepod'?[-.55,.54,.35]:[0,.42,0];
    camera.position.fromArray(pos);target.fromArray(aim);camera.lookAt(target);
    camera.fov=['rear','side'].includes(angle)?T.MathUtils.clamp(2*T.MathUtils.radToDeg(Math.atan(Math.tan(Math.PI/10)*4/(3*camera.aspect))),23,66):36;
   }
   if((orbitPitch||orbitYaw||zoom!==1)&&!reviewView){const orbit=new T.Spherical().setFromVector3(desired.copy(camera.position).sub(target));orbit.theta+=orbitYaw;orbit.phi=T.MathUtils.clamp(orbit.phi-orbitPitch,.09,Math.PI*.496);orbit.radius*=zoom;camera.position.copy(desired.setFromSpherical(orbit)).add(target);camera.lookAt(target);}
   cameraLabel=`MCP GP / STUDIO / ${finish.toUpperCase()}`;
  }else if(mode.startsWith('cockpit')||mode.startsWith('tcam')){
   const id=mode.endsWith('-a')?'a':'b',v=race.cars[id];
   const tc=mode.startsWith('tcam'),{height,back,pitch,fov,offset}=onboardLens(tc);
   const mount=cars[id].chassis;
   mount.updateWorldMatrix(true,false);
   if(lookBack){
    camera.position.copy(mount.localToWorld(desired.set(0,1.18,-.82)));
    mount.localToWorld(target.set(0,.88,-16));
    camera.up.set(0,1,0).applyQuaternion(mount.getWorldQuaternion(mountRotation));camera.lookAt(target);
    camera.up.set(0,1,0);
    camera.fov=68;cameraLabel=`REAR VIEW / ${id==='a'?'FERRARI':'MERCEDES'}`;
   }else{
    // Read the line the driver will see in half a second, in the car's frame.
    const here=pointAt(v.distance),ahead=pointAt(v.distance+Math.max(7,v.speed*.55));
    const tangent=tangentAt(v.distance),dx=ahead.x-here.x,dz=ahead.z-here.z;
    const roadAngle=Math.atan2(dx*tangent.z-dz*tangent.x,dx*tangent.x+dz*tangent.z)-(v.heading??0);
    if(!tc)driverHead.update(now,roadAngle,v.steering??0,v.speed,v.acceleration??0,v.lateralG??0);
    const eyeX=offset+(tc?0:driverHead.lateral),eyeZ=-back+(tc?0:driverHead.forward);
    const yaw=tc?0:driverHead.yaw;
    const bump=reducedMotion.matches?0:Math.min(.003,kerbHeight(track,v.distance,v.offset+.82)*.09)*Math.min(1,v.speed/35)*Math.sin(now*.136);
    camera.position.copy(mount.localToWorld(desired.set(eyeX,height+bump,eyeZ)));
    mount.localToWorld(target.set(eyeX+12*Math.sin(yaw),height-12*Math.tan(T.MathUtils.degToRad(pitch)),eyeZ+12*Math.cos(yaw)));
    camera.up.set(0,1,0).applyQuaternion(mount.getWorldQuaternion(mountRotation));camera.lookAt(target);
    camera.up.set(0,1,0);
    if(!tc)camera.rotateZ(driverHead.roll);
    camera.fov=fov+(reducedMotion.matches?0:3.2*T.MathUtils.smoothstep(v.speed,18,92));cameraLabel=`${tc?'T-CAM':'ONBOARD'} / ${id==='a'?'FERRARI':'MERCEDES'}`;
   }
  }else if(mode.startsWith('chase-')||mode.startsWith('nose-')){
   const id=mode.endsWith('-a')?'a':'b',v=race.cars[id],nose=mode.startsWith('nose-');
   const mount=cars[id].chassis;
   mount.updateWorldMatrix(true,false);
   if(lookBack){
    camera.position.copy(mount.localToWorld(desired.set(0,nose?1.18:1.85,nose?-.82:5.6)));
    mount.localToWorld(target.set(0,.85,-14));
   }else if(nose){
    camera.position.copy(mount.localToWorld(desired.set(0,.74,1.15)));
    mount.localToWorld(target.set(0,.62,18));
   }else{
    const speedFovBoost=T.MathUtils.clamp(v.speed/100,0,1);
    const pullBack=5.6+speedFovBoost*.75;
    const steerLead=-(v.steering??0)*1.35;
    camera.position.copy(mount.localToWorld(desired.set(steerLead*.35,1.98,-pullBack)));
    mount.localToWorld(target.set(steerLead*.8,.82,16));
   }
   camera.up.set(0,1,0);camera.lookAt(target);
   camera.fov=nose?68:56+T.MathUtils.clamp(v.speed/100,0,1)*13;
   cameraLabel=`${nose?'NOSE CAM':'CHASE CAM'} / ${id==='a'?'FERRARI':'MERCEDES'}`;
  }else if(mode==='sphere'&&vegas){const sp=vegas.spherePosition;const direction=params.get('angle')==='reverse'?-1:1;camera.position.set(sp.x+direction*190,88,sp.z+direction*200);camera.lookAt(sp.x,42,sp.z);camera.fov=52;cameraLabel='SPHERE / NIGHT SESSION';
  }else if(mode==='strip'&&vegas){const q=track.project(-115.1719,36.1093),target=track.project(-115.1730,36.1145);camera.position.set(q.x,117,q.z);camera.lookAt(target.x,30,target.z);camera.fov=59;cameraLabel='THE STRIP / NIGHT AERIAL';
  }else if(mode==='trackside'){
   const station=track.wrap(c.distance),anchor=track.wrap(Math.floor(station/85)*85+55);
   const lens=pointAt(anchor,track.trackHalfWidth(anchor)+1.15);
   camera.position.set(lens.x,circuit.heightAt(anchor)+1.38,lens.z);
   target.copy(p);target.y+=.55;
   if(cameraCut||panAnchor!==anchor||now<=panTime||reducedMotion.matches)pan.copy(target);else pan.lerp(target,-Math.expm1(-(now-panTime)/36));
   panTime=now;panAnchor=anchor;camera.lookAt(pan);
   if(!reducedMotion.matches)camera.rotateZ(.0009*Math.sin(now*.063)*(1-T.MathUtils.smoothstep(camera.position.distanceTo(target),5,21)));
   camera.fov=T.MathUtils.clamp(T.MathUtils.radToDeg(2*Math.atan(4.9/camera.position.distanceTo(target))),17,55);
   cameraLabel='TRACKSIDE / FIXED';
  }else if(mode==='pits'){
   if(featured){
    const car=featured.car,box=pitBox(track,featured.entry.team);
    const q=pointAt(box+5.9,BOX_OFFSET+4.4),a=pointAt(box,car.pit==='stopped'?(car.offset??BOX_OFFSET):BOX_OFFSET);
    camera.position.set(q.x,circuit.heightAt(box)+2.75,q.z);camera.lookAt(a.x,circuit.heightAt(box)+.65,a.z);
    camera.fov=52;cameraLabel='PIT BOX / '+featured.entry.team.toUpperCase();
    let neighbour:GarageVisit|undefined;
    if(car.pit==='stopped')for(const v of visits.values())if(v.entry.team!==featured.entry.team&&v.car.pit==='stopped'&&Math.abs(pitBox(track,v.entry.team)-box)<=28.01){neighbour=v;break;}
    if(car.pit==='stopped'&&neighbour){
     // Show both teams working and the traffic lane between the boxes and pit wall.
     const middle=(box+pitBox(track,neighbour.entry.team))*.5;
     const distance=Math.max(24,22/(Math.tan(camera.fov*Math.PI/360)*camera.aspect));
     const lens=pointAt(middle+3,BOX_OFFSET+distance),aim=pointAt(middle,BOX_OFFSET);
     camera.position.set(lens.x,circuit.heightAt(middle)+distance*.31,lens.z);
     camera.lookAt(aim.x,circuit.heightAt(middle)+1,aim.z);
    }
   }else{
    const q=pointAt(track.LENGTH-126,night?20.0:30.5),a=pointAt(track.LENGTH-178,-26);camera.position.set(q.x,circuit.heightAt(track.LENGTH-126)+8.8,q.z);camera.lookAt(a.x,circuit.heightAt(track.LENGTH-178)+4.1,a.z);camera.fov=46;cameraLabel='PIT LANE / GRANDSTANDS';
   }
  }else if(mode==='detail'){
   const root=cars[focus].root;const angle=params.get('angle')??'front';if(angle==='rear')detailPos.set(-4.4,1.75,-6.1);else if(angle==='side')detailPos.set(-7,1.1,0);else if(angle==='top')detailPos.set(.01,10,.01);else detailPos.set(-4.1,1.65,6.1);desired.copy(root.localToWorld(detailPos));camera.position.copy(desired);target.copy(root.position).add(detailOffset);camera.lookAt(target);camera.fov=35;cameraLabel='CAR DETAIL / MCP GP';
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
  // The cockpit lens resolves the wheel centimetres away. From the aircraft
  // that same near plane aliases centimetre-separated road, paint and verge
  // layers into the same depth value. Set the range for the actual shot.
  camera.near=mode==='helicopter'?8:mode==='strip'||mode==='sphere'?3:mode==='flythrough'?1:mode==='side'?.5:mode==='showroom'&&(reviewView==='steering'||params.get('angle')==='steering')?referenceCameras.steering.near:.06;
  camera.updateProjectionMatrix();camera.updateMatrixWorld();
  crewFrustum.setFromProjectionMatrix(crewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  if(crew)for(const team of garages){
   const visit=visits.get(team),bounds=crewBounds.get(team)!;
   const visible=visit&&camera.position.distanceToSquared(bounds.center)<300**2&&crewFrustum.intersectsSphere(bounds);
   crew.update(team,visible?visit.car:undefined,race.time);
  }
  if(embedded)for(const id of seats){
   const protectedView=id===focus&&(onboard||mode==='detail'||mode==='showroom'||mode==='pits');
   const range=protectedView?Infinity:Math.min(30,Math.max(12,lastHeight/(2*Math.tan(camera.fov*Math.PI/360))*2/58));
   cars[id].setLodRange(range);
  }
  const rainfall=weather.update(race,camera,mode,elapsed,reducedMotion.matches,renderer.domElement.height);
  surfaceWater.value=mode==='showroom'?0:race.control?.wetness??0;
  hemisphere.intensity=(night?.5:.65)*(1+rainfall*.19);scene.environmentIntensity=(night?.82:.65)*(1-rainfall*.19);
  sun.intensity=drySun*(1-rainfall*(night?.16:.78));
  scene.fog!.color.copy(dryFog).lerp(rainFog,rainfall);
  (scene.fog as T.FogExp2).density=dryDensity+rainfall*(night?.0032:.0046);
  if(!night&&scene.background instanceof T.Texture){
   scene.backgroundBlurriness=rainfall*.80;
   scene.backgroundIntensity=.8-rainfall*.28;
  }
  const limitDetail=balanced&&mode!=='showroom';
  circuit.update(race.time,p,camera.position,extent,limitDetail);
  renderer.shadowMap.autoUpdate=!balanced||cameraCut||mode==='showroom'||now<lastShadow||now-lastShadow>=(embedded?64+embeddedTier*12:limitDetail?(onboard?48:64):32);
  if(renderer.shadowMap.autoUpdate)lastShadow=now;
  mirrorMs=0;
  // Fill both rear views before the director cuts onboard. On the cut itself
  // the shadow map changes projection, so refresh the next mirror one frame later.
  const seedMirror=embedded&&mirrorReady&&mirrorSeed<2&&selectedMode==='broadcast'&&!onboard&&!cameraCut;
  if(seedMirror||(onboard&&(!embedded||mirrorReady&&!cameraCut)&&(warmMode||mirrorFrame++%(embedded?6:balanced?3:1)===0))){
   const mirrorStart=cameraDebug?performance.now():0;
   const id=seedMirror?focus:mode.endsWith('-a')?'a':'b',v=race.cars[id],q=carPosition(v,rearPos),t=tangentAt(v.distance);
   const side=mirrorSide===0?-1:1;
   rearCamera.position.set(q.x-t.z*side*.78,q.y+.73,q.z+t.x*side*.78);
   rearCamera.lookAt(q.x-t.x*25-t.z*side*4,q.y+.65,q.z-t.z*25+t.x*side*4);
   const rearTarget=mirrorTarget();
   rearTarget.viewport.set(mirrorSide*256,0,256,128);rearTarget.scissor.copy(rearTarget.viewport);rearTarget.scissorTest=true;
   if(seedMirror)mirrorSeed++;
   mirrorSide=1-mirrorSide;cars[id].root.visible=false;
   // Both cockpits can retain the shared rear texture after a broadcast cut.
   // Exclude both sets of reflecting faces while writing into that texture.
   cars.a.setMirrorVisible(false);cars.b.setMirrorVisible(false);
   rearCamera.updateMatrixWorld();
   field.update(race.field,rearCamera,p,0,true);circuit.viewDetail(rearCamera,.18);
   const oldTarget=renderer.getRenderTarget(),oldShadow=renderer.shadowMap.autoUpdate;
   renderer.shadowMap.autoUpdate=false;renderer.setRenderTarget(rearTarget);
   if(embedded)crew?.setMirrorHidden(true);
   try{renderer.render(scene,rearCamera);}finally{
    if(embedded)crew?.setMirrorHidden(false);
    renderer.setRenderTarget(oldTarget);renderer.shadowMap.autoUpdate=oldShadow;
    cars[id].root.visible=id!==hiddenCar;cars.a.setMirrorVisible(true);cars.b.setMirrorVisible(true);
   }
   cars[id].setMirror(rearTarget.texture);
   if(cameraDebug)mirrorMs=performance.now()-mirrorStart;
  }
  circuit.viewDetail(limitDetail?camera:null,.54,.8);
  if(mode==='showroom'){cars.a.setMirror(null);cars.b.setMirror(null);}
  else field.update(race.field,camera,p,extent,false,limitDetail,!embedded||renderer.shadowMap.autoUpdate,embedded?lastHeight:0);
  if(prepare){lastShadow=-Infinity;return;}
  const mainStart=cameraDebug?performance.now():0;
  if(racingLine){if(racingLineMode!=='off'&&mode!=='showroom')racingLine.update(race.cars[racingLineSeat] as any,racingLineMode,race.control?.wetness??0);else racingLine.mesh.visible=false;}
  if(mode!=='showroom'&&cars.a.root.parent!==scene)scene.add(cars.a.root);
  if(!embedded)circuit.puddles.update(renderer,scene,camera,p,now,surfaceWater.value,cameraCut);
  beauty.scene=mode==='showroom'?studio!.scene:scene;
  if(bloom){bloom.strength=mode==='showroom'?.042:night?.11:.045;bloom.enabled=night||!balanced;}
  if(composer)composer.render();else renderer.render(beauty.scene,camera);
  weather.renderLens(renderer);
  if(cameraDebug)mainMs=performance.now()-mainStart;
 }
 let hasSize=false,lastWidth=0,lastHeight=0;
 function sizeBloom(width:number,height:number){
  const scale=Math.min(renderer.getPixelRatio(),320/Math.max(1,width),180/Math.max(1,height));
  bloom?.setSize(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
 }
 function sizeScene(){
  const w=container.clientWidth,h=container.clientHeight;
  hasSize=w>0&&h>0;
  if(!hasSize||(w===lastWidth&&h===lastHeight))return;
  lastWidth=w;lastHeight=h;
  renderer.setSize(w,h,false);composer?.setSize(w,h);sizeBloom(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();
 }
 const resize=new ResizeObserver(sizeScene);resize.observe(container);sizeScene();
 return {render,get activeCamera(){return activeMode;},get ready(){return presentationReady;},get contextLost(){return contextLost||gl.isContextLost();},get startupError(){return cars.a.error??cars.b.error??circuit.error??(contextLost||gl.isContextLost()?'WebGL context lost':null);},setMode:(next:CameraMode)=>{selectedMode=next;director.reset();aerial.reset();side.reset();chase.reset();cars.a.setFinish(next==='showroom'?finish:'colour');},setFinish:(next:Finish)=>{finish=next;cars.a.setFinish(next);studio?.setStageFinish(next);},setTurntable:(on:boolean)=>{turntable=on;},setLookBack:(on:boolean)=>{lookBack=on;},setHideCar:(team:'a'|'b'|null)=>{hiddenCar=team;if(!team){cars.a.root.visible=true;cars.b.root.visible=true;}},setRacingLine:(m:RacingLineMode,seat:'a'|'b'='a')=>{racingLineMode=m;racingLineSeat=seat;if(m!=='off'&&!racingLine){racingLine=createRacingLine(track,circuit.heightAt);scene.add(racingLine.mesh);}if(racingLine&&m==='off')racingLine.mesh.visible=false;},get label(){return cameraLabel;},get info(){return {...renderer.info.render,...(cameraDebug?{mirrorMs,mainMs,lensBeads:weather.beads,rainDrops:weather.drops,sprayPackets:weather.spray,cameraMode:activeMode,selectedCamera:selectedMode,cameraLabel,cameraFov:camera.fov,cameraPosition:camera.position.toArray(),cameraQuaternion:camera.quaternion.toArray(),cameraTarget:target.toArray()}:{}),sparks:sparks?.active??0,safetyCarOnTrack:safetyCar?.car.visible??false,circuit:track.id,modelsReady:presentationReady,modelError:reflectionError??cars.a.error??cars.b.error??circuit.error??crew?.error??field.error,finish};},dispose:()=>{
  if(disposed)return;
  disposed=true;loadingAssets.abort();cancelWarmFrame();resize.disconnect();
  element.removeEventListener('pointerdown',orbitStart);element.removeEventListener('pointermove',orbitMove);
  element.removeEventListener('lostpointercapture',orbitEnd);element.removeEventListener('wheel',orbitZoom);
  element.removeEventListener('webglcontextlost',onContextLost);element.removeEventListener('webglcontextrestored',onContextRestored);
  if(warmFence)gl.deleteSync(warmFence);
  safetyCar?.dispose();crew?.dispose();field.dispose();circuit.dispose();cars.a.dispose();cars.b.dispose();
  for(const geometry of morphGeometry.values())geometry.dispose();
  morphGeometry.clear();
  paintSheet.dispose();rearTarget?.dispose();studio?.dispose();sparks.dispose();impacts.dispose();surfaceFx.dispose();racingLine?.dispose();weather.dispose();
  composer?.passes.forEach(p=>p.dispose());composer?.dispose();environment?.dispose();pmrem.dispose();
  scene.traverse(o=>{if(o instanceof SunLight||o instanceof T.DirectionalLight||o instanceof T.PointLight||o instanceof T.SpotLight)o.shadow.dispose();});
  new MeshResources().collect(scene).dispose();
  if(scene.background instanceof T.Texture)scene.background.dispose();
  scene.background=null;scene.environment=null;scene.clear();
  renderer.renderLists.dispose();renderer.dispose();
  if(embedded&&!gl.isContextLost())renderer.forceContextLoss();
  element.remove();loading.remove();
 }};
}
