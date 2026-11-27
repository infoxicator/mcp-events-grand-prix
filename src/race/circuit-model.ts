import {batchCircuit,batchDistantInstances} from './embedded-batches';
import {MeshResources} from './mesh-resources';
import {wetRoad} from './wet-road';
import {circuitSignals} from './circuit-signals';
import vegasSurvey from './assets/circuits/las-vegas-manifest.json';
import rakedURL from './assets/circuits/raked-normal.jpg?url';
import waterURL from './assets/circuits/water-normal.jpg?url';
import * as T from 'three';
import {createSphereShow} from './sphere-show';
import {tracksideMotion} from './trackside-motion';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import decoderJS from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url&inline';
import decoderWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url&inline';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {embeddedGLB,gzipBytes} from './embedded-glb';
import monzaMcp from './assets/circuits/monza-mcp.glb.gz?url';
import vegasMcp from './assets/circuits/las-vegas-mcp.glb.gz?url';
import monzaURL from './assets/circuits/monza.glb.gz?url';
import vegasURL from './assets/circuits/las-vegas.glb.gz?url';
import {circuitHeight} from './elevation';
import canopyLightURL from './assets/circuits/monza-canopy-light.png?url';
import asphaltNormal from './assets/asphalt-normal.webp?url';
import type {Track} from './track';
// Transfer a selected Drive venue to its first scene. An abandoned invitation
// releases the parsed buffers and decoded bitmaps even if parsing is in flight.
type PreparedCircuit={night:boolean;controller:AbortController;loaded:ReturnType<typeof embeddedGLB>;timer:number};
let prepared:PreparedCircuit|undefined;
export function cancelPreparedCircuit(){
 const entry=prepared;if(!entry)return;
 prepared=undefined;clearTimeout(entry.timer);entry.controller.abort();
 void entry.loaded.then(asset=>new MeshResources().collect(asset.scene).dispose(),()=>{});
}
export function prepareDriveCircuit(night:boolean){
 if(prepared?.night===night)return;
 cancelPreparedCircuit();
 const controller=new AbortController(),loaded=embeddedGLB(night?vegasMcp:monzaMcp,true,controller.signal);
 const entry={night,controller,loaded,timer:window.setTimeout(cancelPreparedCircuit,10000)};
 prepared=entry;void loaded.catch(()=>{if(prepared===entry)cancelPreparedCircuit();});
}
function takeCircuit(night:boolean,signal:AbortSignal){
 const entry=prepared;
 if(!entry||entry.night!==night){cancelPreparedCircuit();return embeddedGLB(night?vegasMcp:monzaMcp,true,signal);}
 prepared=undefined;clearTimeout(entry.timer);
 const abort=()=>entry.controller.abort();
 signal.addEventListener('abort',abort,{once:true});
 return entry.loaded.finally(()=>signal.removeEventListener('abort',abort));
}
/** Reflect the actual resort and jets on the surface of the Blender lake. */
function lakeReflection(bounds:T.Box3,cadence:()=>number){
 const size=bounds.getSize(new T.Vector3()),centre=bounds.getCenter(new T.Vector3());
 const water=new Reflector(new T.CircleGeometry(1,96),{textureWidth:import.meta.env.MCP_APP==='true'?320:512,textureHeight:import.meta.env.MCP_APP==='true'?240:384,clipBias:.002,multisample:0});
 water.position.set(centre.x,centre.y+.018,centre.z);water.rotation.x=-Math.PI/2;water.scale.set(size.x/2,size.z/2,1);
 const m=water.material as T.ShaderMaterial;m.transparent=true;m.depthWrite=false;
 m.uniforms.waterTime={value:0};
 m.vertexShader='varying vec2 pond;\n'+m.vertexShader.replace('vUv = textureMatrix','pond=position.xy; vUv = textureMatrix');
 m.fragmentShader='uniform float waterTime; varying vec2 pond;\n'+m.fragmentShader
  .replace('vec4 base = texture2DProj( tDiffuse, vUv );',`vec4 projected=vUv;
   vec2 ripple=vec2(sin(pond.y*215.+waterTime*1.8)+.45*sin(pond.x*63.+pond.y*107.),
                    sin(pond.x*142.-pond.y*91.-waterTime*.9));
   projected.xy+=ripple*vec2(.0016,.0028)*projected.w;
   vec4 base=texture2DProj(tDiffuse,projected);`)
  .replace('gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );',
    `float r=length(pond*vec2(95.,135./1.4));
    float jets=exp(-.19*abs(r-35.))+exp(-.21*abs(r-65.));
    float glint=smoothstep(.5,1.28,ripple.x+.35*ripple.y);
    gl_FragColor=vec4(base.rgb*vec3(.58,.66,.72)+vec3(.002,.007,.009)+jets*(.04+.45*glint)*vec3(.92,.67,.34),.69);`);
 // Refresh only when visible from a main camera. The depth-correct projected
 // reflection is reused by intervening frames and distant environment probes.
 const reflect=water.onBeforeRender;let last=-Infinity;
 water.onBeforeRender=function(renderer,scene,camera,...rest){
  if(camera.name!=='Race camera'||camera.position.distanceTo(centre)>900||camera.parent instanceof T.CubeCamera)return;
  const now=performance.now();if(now-last<cadence())return;last=now;
  reflect.call(this,renderer,scene,camera,...rest);
 };
 return water;
}
/** All geometry is authored/exported by Blender. This loader only configures PBR and culling. */
export function loadCircuit(scene:T.Scene,track:Track,anisotropy:number,surfaceWater={value:0},multiDraw=false){
 let ready=false,error:string|undefined,disposed=false;
 const loadingAssets=new AbortController();
 const heightAt=(d:number)=>circuitHeight(track.id,d);
 const people=tracksideMotion();
 const sp=track.project(-115.1621,36.1207),spherePosition=new T.Vector3(sp.x,32.9184,sp.z);
 let sphereShow:ReturnType<typeof createSphereShow>|undefined;
 const normal=new T.TextureLoader().load(asphaltNormal);normal.colorSpace=T.NoColorSpace;normal.flipY=false;normal.wrapS=normal.wrapT=T.RepeatWrapping;normal.anisotropy=anisotropy;
 const canopyLight=track.night?null:new T.TextureLoader().load(canopyLightURL);
 if(canopyLight){canopyLight.flipY=false;canopyLight.colorSpace=T.NoColorSpace;}
 const shadowPatch={value:new T.Vector3()},puddles=wetRoad(),signals=circuitSignals(scene,track,heightAt),animation={value:0};
 const gravelNormal=new T.TextureLoader().load(rakedURL),waterNormal=new T.TextureLoader().load(waterURL);
 for(const t of [gravelNormal,waterNormal]){t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=anisotropy;}
 const data=new Uint8Array(1024*4);
 for(let i=0;i<1024;i++){
  const d=track.LENGTH*i/1024;data[4*i]=Math.round((track.racingLineOffset(d)+16)*255/32);
  data[4*i+1]=255*Math.max(0,...track.CORNERS.map(c=>1-track.wrap(c.d-d)/Math.max(35,165-c.speed)));data[4*i+3]=255;
 }
 const lineMap=new T.DataTexture(data,1024,1);lineMap.wrapS=T.RepeatWrapping;lineMap.minFilter=lineMap.magFilter=T.LinearFilter;lineMap.needsUpdate=true;
 let reflectionMs=import.meta.env.MCP_APP==='true'?50:33.33;
 let circuitRoot:T.Group|undefined;
 let batches:T.BatchedMesh[]=[];
 let distantInstances:ReturnType<typeof batchDistantInstances>|undefined;
 const lakeBounds=new T.Box3();let reflection:Reflector|undefined;
 const distant:T.Mesh[]=[],casters:T.Mesh[]=[],receivers:T.Mesh[]=[];
 const circuitLods:T.LOD[]=[],detailCamera=new T.PerspectiveCamera();
 let manualDetail=false;
 const draco=import.meta.env.MCP_APP==='true'?null:new DRACOLoader().setDecoderPath({js:decoderJS,wasm:decoderWasm}).setWorkerLimit(2);
 const source=import.meta.env.MCP_APP==='true'?takeCircuit(!!track.night,loadingAssets.signal):gzipBytes(track.night?vegasURL:monzaURL,loadingAssets.signal).then(b=>new GLTFLoader().setDRACOLoader(draco!).parseAsync(b,''));
 const loaded=source.then(gltf=>{
  draco?.dispose();
  const original=new MeshResources().collect(gltf.scene);
  if(disposed){original.dispose();return;}
  circuitRoot=gltf.scene;
  // Partition Blender EXT_mesh_gpu_instancing by spatial tile for culling and shadows.
  gltf.scene.updateMatrixWorld(true);
  const drySurfaces=new Set<T.MeshStandardMaterial>();
  const farCrowns=new Map<string,T.BufferGeometry>(),lodSources:T.Mesh[]=[];
  gltf.scene.traverse(o=>{
   if(!(o instanceof T.Mesh)||!(o.name.startsWith('LOD_Canopy')||o.name.startsWith('LOD_DistantCanopy')||o.name.startsWith('LOD_Grandstand')||o.name.startsWith('LOD_Staff')))return;
   const geometry=o.geometry.clone(),position=geometry.getAttribute('position');
   if(position.normalized){
    // Apply the MCP export's placement in metres without clipping it back to [-1,1].
    const floats=new T.Float32BufferAttribute(new Float32Array(position.count*3),3);
    for(let i=0;i<position.count;i++)floats.setXYZ(i,position.getX(i),position.getY(i),position.getZ(i));
    geometry.setAttribute('position',floats);
   }
   const key=!o.name.startsWith('LOD_Canopy')?o.name:(o.material as T.Material).name;
   farCrowns.set(key,geometry.applyMatrix4(o.matrixWorld));lodSources.push(o);
  });
  lodSources.forEach(o=>{o.removeFromParent();});
  const buckets=new Map<string,{mesh:T.Mesh;matrix:T.Matrix4}[]>(),sources:T.Mesh[]=[];
  gltf.scene.traverse(o=>{if(o instanceof T.Mesh&&(o instanceof T.InstancedMesh||o.name.startsWith('Instance_'))){sources.push(o);const count=o instanceof T.InstancedMesh?o.count:1;
   for(let i=0;i<count;i++){const matrix=new T.Matrix4();if(o instanceof T.InstancedMesh)o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);const p=new T.Vector3().setFromMatrixPosition(matrix),key=`${o.geometry.uuid}:${(o.material as T.Material).uuid}:${Math.floor(p.x/180)}:${Math.floor(p.z/180)}`;const group=buckets.get(key)??[];group.push({mesh:o,matrix});buckets.set(key,group);}
  }});
  for(const o of sources){let parent=o.parent;o.removeFromParent();while(parent&&parent!==gltf.scene&&parent.children.length===0){const next=parent.parent;parent.removeFromParent();parent=next;}}
  for(const objects of buckets.values()){
   const first=objects[0].mesh,materialName=(first.material as T.Material).name,spectator=materialName==='Spectator0';
   if(spectator&&!first.geometry.boundingBox)first.geometry.computeBoundingBox();
   const staff=materialName.endsWith('Uniform');
   const key=staff?'LOD_Staff'+materialName:spectator?'LOD_Grandstand'+(first.geometry.boundingBox!.max.y>1.15?'Standing':'Seated'):materialName;
   const farGeometry=farCrowns.get(key),batch=new T.InstancedMesh(first.geometry,first.material,objects.length);batch.name=first.name;
   if(farGeometry){
    const centre=new T.Vector3();for(const o of objects)centre.add(new T.Vector3().setFromMatrixPosition(o.matrix));centre.divideScalar(objects.length);
    const offset=new T.Matrix4().makeTranslation(-centre.x,-centre.y,-centre.z);
    const far=new T.InstancedMesh(farGeometry,first.material,objects.length),lod=new T.LOD();
    const horizonGeometry=farCrowns.get('LOD_Distant'+materialName);
    const horizon=horizonGeometry?new T.InstancedMesh(horizonGeometry,first.material,objects.length):null;
    far.name=first.name+'_far';
    objects.forEach((o,i)=>{
     const matrix=o.matrix.premultiply(offset);
     batch.setMatrixAt(i,matrix);far.setMatrixAt(i,matrix);horizon?.setMatrixAt(i,matrix);
    });
    batch.computeBoundingSphere();far.computeBoundingSphere();lod.position.copy(centre);
    lod.addLevel(batch,0);lod.addLevel(far,staff?40:spectator?34:100,.15);
    if(horizon){horizon.name=first.name+'_horizon';horizon.computeBoundingSphere();lod.addLevel(horizon,290,.12);}
    lod.addLevel(new T.Group(),staff?360:spectator?550:950,.1);gltf.scene.add(lod);circuitLods.push(lod);
   }else{objects.forEach((o,i)=>batch.setMatrixAt(i,o.matrix));batch.computeBoundingSphere();gltf.scene.add(batch);}
  }
  gltf.scene.updateMatrixWorld(true);
  // The authored circuit has fixed world transforms. Crowd, flags and LEDs
  // animate in shaders, and LOD changes only toggle visibility.
  gltf.scene.traverse(o=>{o.matrixAutoUpdate=false;o.matrixWorldAutoUpdate=false;});
  const configured=new Set<T.Material>();
  gltf.scene.traverse(o=>{if(!(o instanceof T.Mesh))return;o.receiveShadow=false;o.castShadow=false;o.geometry.computeBoundingSphere();o.userData.cullCenter=(o instanceof T.InstancedMesh?o.boundingSphere!:o.geometry.boundingSphere!).center.clone().applyMatrix4(o.matrixWorld);
   const materials=Array.isArray(o.material)?o.material:[o.material];for(const material of materials){const m=material as T.MeshStandardMaterial;
    if(!/^(DistantRidge|CityGround|ParkHorizon|Upper|WarmWindows|Windows|Sphere|StreetLamp)/.test(m.name))o.receiveShadow=true;
    if(m.name.startsWith('Canopy')||m.name==='Trunk'||m.name==='Foliage')o.userData.foliageCaster=true;
    if(['Concrete','White','Steel','Armco'].includes(m.name)||o.userData.foliageCaster)casters.push(o);
    if(['Fence','Crowd','Foliage','Trunk','Skin'].includes(m.name)||m.name.startsWith('Spectator')||m.name.startsWith('Seated'))distant.push(o);
    if(m.name==='Sphere'){
     const bounds=new T.Box3().setFromObject(o),centre=bounds.getCenter(new T.Vector3());
     centre.y=bounds.max.y-(bounds.max.x-bounds.min.x)*.5;
     sphereShow??=createSphereShow(centre);o.material=sphereShow.material;
    }
    if(m.name==='Water')lakeBounds.expandByObject(o);
    if(configured.has(m))continue;
    configured.add(m);
    m.side=/^(Canopy|Fence|Sign$|Brake[0-9]|ParkHorizon|Marquee|GarageFascia|WorkshopBack|DistantRidge|Impact|Balustrade|Armco$)/.test(m.name)?T.DoubleSide:T.FrontSide;
    people.bind(m);signals.bind(m);
    if(m.name==='PaddockBanner')m.side=T.DoubleSide;
    if(m.name==='Trunk'){
     m.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 bark;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nbark=position;');
      shader.fragmentShader='varying vec3 bark;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
       float arc=atan(bark.y,bark.x),ridge=sin(arc*21.+.74*sin(bark.z*7.+arc*2.));
       diffuseColor.rgb*=1.+.32*ridge*(1.-smoothstep(.07,.18,fwidth(arc))); `);
     };
    }
    if(m.name==='PalmFrond')m.side=T.DoubleSide;
    if(m.name==='Gravel'){m.normalMap=gravelNormal;m.normalScale.set(.54,.54);m.roughness=.98;m.metalness=0;}
    if(m.name==='Water'){m.normalMap=waterNormal;m.normalScale.set(.23,.23);}
    if(/^(Armco|Impact|Concrete)$/.test(m.name)){m.normalMap=normal;m.normalScale.set(.12,.12);if(m.map)m.roughnessMap=m.map;}
    if(/^(Canopy|PalmFrond|ItalianFlag|FlagCloth|Fountain|Roller)/.test(m.name)){
     const prior=m.onBeforeCompile,program=m.customProgramCacheKey(),name=m.name;
     m.onBeforeCompile=function(shader,renderer){
      prior.call(this,shader,renderer);shader.uniforms.venueTime=animation;
      const hub=(vegasSurvey as {rollerCenter?:number[]}).rollerCenter??[0,84,0];
      const deform=name.startsWith('Roller')?`vec2 p=w.xy-vec2(${hub[0].toFixed(3)},${hub[1].toFixed(3)});
       vec2 spoke=${name==='RollerCabin'?'70.*vec2(cos(floor(atan(p.y,p.x)*25./6.283185+.5)*6.283185/25.),sin(floor(atan(p.y,p.x)*25./6.283185+.5)*6.283185/25.))':'p'};
       float a=venueTime*.006;w.xy+=mat2(cos(a),sin(a),-sin(a),cos(a))*spoke-spoke;`:
       name==='Fountain'?'w.y+=(.22+.14*sin(w.x*.21+venueTime))*(sin(w.z*.35+venueTime*2.)+1.);':
       'w.x+=.055*sin(1.8*venueTime+.12*w.z+.28*w.y);w.z+=.034*sin(venueTime+.22*w.x+.30*w.y);';
      shader.vertexShader='uniform float venueTime;\n'+shader.vertexShader.replace('#include <project_vertex>',`
       vec4 local=vec4(transformed,1.);
       #ifdef USE_INSTANCING
        local=instanceMatrix*local;
       #endif
       vec4 w=modelMatrix*local;vec3 wp=w.xyz;${deform}
       #include <project_vertex>
       mvPosition.xyz+=mat3(viewMatrix)*(w.xyz-wp);gl_Position=projectionMatrix*mvPosition;`);
     };m.customProgramCacheKey=()=>program+'-venue-'+name;
    }
    if(m.map){m.map.anisotropy=anisotropy;m.map.wrapS=m.map.wrapT=T.RepeatWrapping;}
    if(track.night&&m.name==='Steel'){m.envMapIntensity=.92;m.roughness=.48;m.metalness=.55;}
    if(track.night&&['White','Concrete','RunoffPaint','Red','Green'].includes(m.name))drySurfaces.add(m);
    if(m.name==='GarageFascia'){
     // Constructor numbers and names sit on the live bay board above this backing.
     m.map=null;m.emissiveMap=null;m.color.set('#24272a');m.emissive.set('#090a0b');
    }
    if(m.name==='Concrete'){m.color.set('#c3c1b8');m.bumpMap=m.map;m.bumpScale=.003;m.roughness=.89;m.metalness=0;m.envMapIntensity=.55;}
    if(m.name==='Asphalt'||m.name==='RepairCourse'){
     m.color.set(m.name==='RepairCourse'?(track.night?'#62676b':'#5f6263'):(track.night?'#7f8081':'#777b7c'));m.normalMap=normal;m.normalScale.set(.14,.14);
     m.roughness=m.name==='RepairCourse'?.68:track.night?.66:.91;m.metalness=.015;m.envMapIntensity=track.night?.95:.7;
     // Physical aggregate at the original survey UV scale, plus broad,
     // non-repeating binder variation between the racing line and the verge.
     m.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{puddleMatrix:puddles.matrix,puddleMap:puddles.image,puddleVisible:puddles.visible,puddleTime:puddles.clock});
      shader.uniforms.surfaceWater=surfaceWater;shader.uniforms.courseLine={value:lineMap};
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform mat4 puddleMatrix;varying vec4 puddleClip;varying vec2 pavementUV;')
       .replace('#include <begin_vertex>','#include <begin_vertex>\npavementUV=uv;puddleClip=puddleMatrix*modelMatrix*vec4(transformed,1.);');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
       varying vec4 puddleClip;uniform float puddleVisible,puddleTime,surfaceWater;uniform sampler2D puddleMap,courseLine;
       varying vec2 pavementUV;
       float pavementHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
       float pavementNoise(vec2 p){
        vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(pavementHash(cell),pavementHash(cell+vec2(1,0)),f.x),
          mix(pavementHash(cell+vec2(0,1)),pavementHash(cell+1.),f.x),f.y);
       }
       float resolvedNoise(vec2 p){
        vec2 footprint=fwidth(p);
        return mix(pavementNoise(p),.5,smoothstep(.35,1.,max(footprint.x,footprint.y)));
       }
       // Pixel coverage of a narrow joint, including oblique views.
       float pavementJoint(float d,float halfWidth,float footprint){
        float w=max(footprint,.001);
        return clamp((min(d+.5*w,halfWidth)-max(d-.5*w,-halfWidth))/w,0.,1.);
       }`).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        float binder=resolvedNoise(pavementUV*vec2(1.1,.13));
        float grit=resolvedNoise(pavementUV*vec2(7.7,.62));
        vec2 metres=pavementUV*3.;
        float seamDistance=abs(metres.x-2.9+.058*sin(metres.y*.089)+.018*sin(metres.y*.81));
        float px=max(fwidth(metres.x),.004);
        float joint=pavementJoint(seamDistance,.020,px);
        float aged=smoothstep(.18,.57,pavementNoise(vec2(metres.y*.027,3.)));
        diffuseColor.rgb*=(.86+.20*binder+.08*grit)*(1.-joint*aged*.38);
        roughnessFactor-=joint*aged*.10;
        roughnessFactor=clamp(roughnessFactor+.09*(binder-.5),.47,1.);
        // Water settles unevenly across the existing course and binder texture.
        float basin=resolvedNoise(metres*vec2(.43,.12))*.72+.28*binder;
        vec2 raceLine=texture2D(courseLine,vec2(fract(-metres.y/${track.LENGTH.toFixed(3)}),.5)).rg;
        float dist=abs(metres.x-(raceLine.r*32.-16.));
        float rubber=exp(-6.*(dist-.77)*(dist-.77))*(.30+.65*raceLine.g);
        diffuseColor.rgb*=1.-.23*rubber;roughnessFactor-=.085*rubber;
        float film=(1.-.58*rubber)*surfaceWater*(.46+.54*smoothstep(.60-surfaceWater*.38,.81-surfaceWater*.38,basin));
        roughnessFactor=mix(roughnessFactor,.12+.15*(1.-basin),film);
       `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
       if(puddleVisible>.5 && film>.035 && puddleClip.w>0.){
        vec2 cell=floor(metres*2.8),drop=fract(metres*2.8)-.5;
        float cycle=fract(puddleTime*1.3+pavementHash(cell));
        float radius=length(drop),ring=exp(-90.*abs(radius-cycle*.60))*(1.-cycle);
        vec2 ripple=drop/max(.02,radius)*ring*.002+vec2(binder-.5,grit-.5)*.003;
        vec2 projected=puddleClip.xy/puddleClip.w+ripple;
        vec2 bounds=min(projected,1.-projected);
        float coverage=smoothstep(0.,.035,min(bounds.x,bounds.y))*smoothstep(.45,.78,basin+.22*surfaceWater);
        float fresnel=.18+.68*pow(1.-abs(dot(normal,normalize(vViewPosition))),3.);
        outgoingLight=mix(outgoingLight,texture2D(puddleMap,projected).rgb,film*coverage*fresnel);
       }
       #include <opaque_fragment>`);
      if(!track.night)shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
       // Blender's glTF export flips the survey V coordinate.
       float station=3.-metres.y;
       float braking=smoothstep(600.,755.,station)*(1.-smoothstep(945.,1020.,station));
       // A recently surfaced braking zone. Preserve fine aggregate but omit the
       // long fissure photographed in the source tile.
       float aggregate=clamp(texture2D(map,vMapUv*1.83+vec2(.35,.71)).g,.076,.139);
       vec3 wearingCourse=diffuse*vec3(1.,.986,.94)*(.047+aggregate*.52)*(.88+.2*binder);
       float stripe=abs(abs(metres.x+2.4+1.2*smoothstep(830.,930.,station))-.85);
       float brakingLoad=smoothstep(760.,892.,station);
       float shoulderWear=exp(-stripe*stripe/1.75)*(.07+.10*brakingLoad);
       float brakingRubber=shoulderWear+exp(-stripe*stripe/.36)*(.17+.13*grit);
       float edge=smoothstep(4.7,7.3,abs(metres.x));
       float flecks=smoothstep(.73,.92,resolvedNoise(pavementUV*58.))*edge;
       float jointDistance=min(abs(station-801.+metres.x*.06),abs(station-903.-metres.x*.045));
       float transverse=pavementJoint(jointDistance,.036,fwidth(station));
       diffuseColor.rgb=mix(diffuseColor.rgb,wearingCourse*(1.-brakingRubber-.17*transverse+.13*flecks),braking);
      `);
      if(track.night)shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
       float station=3.-metres.y;
       float pool=(station-45.*floor(station/45.+.5))/15.;
       float lane=pool*pool;
       float axial=exp(-lane);
       float lateral=exp(-pow((abs(metres.x)-7.5)/10.,2.));
       totalEmissiveRadiance+=diffuseColor.rgb*vec3(.52,.55,.59)*(.12+.88*axial)*lateral;
      `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_fragment>',`
       diffuseColor.rgb*=1.-film*.51;
       #include <lights_physical_fragment>
      `);
     };
    }
    if(m.name.startsWith('Canopy')){m.color.set(['#a7ad94','#98ab8a','#96a49a','#b1ac8b'][Number(m.name.slice(-1))%4]);m.bumpMap=m.map;m.bumpScale=.009;m.roughness=1;m.transparent=false;m.alphaTest=.33;m.alphaToCoverage=true;m.depthWrite=true;if(m.map)m.map.repeat.set(1,1);}
    if(m.name==='Windows'&&m.map){m.color.set('#acb3c2');m.emissiveIntensity=.88;}
    if(m.name==='Balustrade'){m.transparent=true;m.opacity=.23;m.depthWrite=false;}
    if(track.night&&['Windows','WarmWindows','StoreGlass'].includes(m.name)&&m.map){
     m.customProgramCacheKey=()=>'strip-facade-'+m.name;
     const strip=track.pointAt(3841,0),elevation=heightAt(3841),store=m.name==='StoreGlass';
     m.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 facadeWorld;\n'+shader.vertexShader.replace('#include <begin_vertex>',
       '#include <begin_vertex>\nfacadeWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader='varying vec3 facadeWorld;\n'+shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
       vec3 eye=normalize(cameraPosition-facadeWorld);
       vec2 facing=vec2(dot(eye.xz,vec2(.834,.552)),eye.y);
       vec2 pane=fract(vMapUv*vec2(11.,8.))-.5;
       vec2 recess=abs(pane+facing*.075);
       float jamb=1.-smoothstep(.40,.47,max(recess.x,recess.y));
       totalEmissiveRadiance*=.78+.22*jamb;
       vec2 bay=floor(vec2(vMapUv.x*3.1,facadeWorld.y/10.5));
       float block=fract(sin(dot(bay,vec2(17.21,63.07)))*3178.94);
       float groupLight=mix(.12,.86,smoothstep(.22,.79,block));
       ${store?'':`totalEmissiveRadiance*=groupLight*mix(vec3(.76,.87,1.),vec3(1.,.85,.68),block);
       diffuseColor.rgb*=.43+.37*groupLight;`}
       // Alternate occupied rooms, recessed entrances and unlit sections in
       // the street-level Strip frontage.
       vec2 local=facadeWorld.xz-vec2(${strip.x.toFixed(3)},${strip.z.toFixed(3)});
       // Broad service cores and mechanical storeys interrupt the window
       // texture at building scale. World-space derivatives soften distant rows.
       float frontage=dot(local,vec2(.834,.552));
       float tower=floor(frontage/62.);
       float phase=fract(sin(tower*12.78)*4375.);
       float vertical=abs(fract(frontage/(26.+13.*phase)+phase)-.5);
       float floorBand=abs(fract((facadeWorld.y+phase*43.)/(22.+17.*phase))-.5);
       float shaft=smoothstep(.05,.15+min(.16,fwidth(frontage)*.035),vertical);
       float floors=smoothstep(.025,.095+min(.12,fwidth(facadeWorld.y)*.028),floorBand);
       float corridor=1.-smoothstep(210.,720.,length(local));
       totalEmissiveRadiance*=mix(vec3(1.),mix(vec3(.48,.68,.80),vec3(.96,.87,.78),phase)*(.17+.83*shaft*floors),corridor);
       float low=(1.-smoothstep(105.,295.,length(local)))*(1.-smoothstep(13.,45.,facadeWorld.y-${elevation.toFixed(3)}));
       vec2 rooms=floor(vec2((local.x*.83+local.y*.56)/5.3,(facadeWorld.y-${elevation.toFixed(3)})/4.3));
       float suite=fract(sin(dot(rooms,vec2(12.71,39.46)))*4358.67);
       float lit=mix(.09,.79,smoothstep(.40,.79,suite));
       totalEmissiveRadiance*=mix(1.,lit,low);
       diffuseColor.rgb*=mix(1.,.35+.61*lit,low);
      `);
     };
    }
    if(m.name.startsWith('Brake')&&!track.night){m.color.set('#ffffff');m.roughness=.92;m.metalness=0;}
    if(m.name==='Hospitality'){m.transparent=true;m.opacity=.67;m.depthWrite=false;m.roughness=.12;m.metalness=.48;m.envMapIntensity=1.16;}
    if(m.name==='WarmWindows'&&m.map){m.map.repeat.set(1,1);m.color.set('#ffdfae');m.emissiveIntensity=.65;}
    if(m.name==='Travertine'){m.emissive.set('#c28b43');m.emissiveIntensity=.11;m.envMapIntensity=.5;}
    if(m.name==='CityGround'){m.color.set('#828897');m.emissive.set('#9ba4b1');m.emissiveIntensity=.38;m.envMapIntensity=.34;}
    if(m.name==='Fountain'){m.color.set('#c2c9ce');m.emissive.set('#e5dbc3');m.emissiveIntensity=.66;m.roughness=.64;}
    if(m.name==='BootContact'){m.transparent=true;m.depthWrite=false;m.polygonOffset=true;m.polygonOffsetFactor=-2;}
    if(m.name==='Water'){m.envMapIntensity=.55;m.roughness=.24;m.metalness=.37;}
    if(m.name==='ParkHorizon'){m.color.set('#a5af9e');m.roughness=1;
     // Keep the distant tree line at eye level. From a helicopter the real
     // instanced crowns below already provide the overhead canopy.
     m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',
      'diffuseColor.a*=1.-smoothstep(.12,.29,dot(normalize(vViewPosition),viewMatrix[1].xyz));\n#include <alphatest_fragment>');};
     m.transparent=false;m.alphaTest=.40;m.alphaToCoverage=true;m.depthWrite=true;}
    if(m.name==='Concrete'&&!track.night){
     m.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
       if(vMapUv.x< -6.95 && vMapUv.x> -8.05 && vMapUv.y>7.95 && vMapUv.y<9.05){
        vec2 panel=vec2(vMapUv.x+8.,9.-vMapUv.y);
        vec2 metres=panel*vec2(4.,1.3);
        float joint=min(metres.x,4.-metres.x);
        float tie=length(vec2(abs(metres.x-2.)-1.42,abs(metres.y-.65)-.39));
        float grain=texture2D(map,metres*vec2(1.35,1.8)).r;
        float scuff=(1.-smoothstep(.14,.52,metres.y+.04*sin(4.2*metres.x)))*smoothstep(.19,.42,grain);
        float value=.46+.23*(grain-.35)-.13*scuff;
        float aa=clamp(fwidth(metres.x),.002,.045);
        value*=.48+.52*smoothstep(.006,.013+aa,joint);
        value-=.19*(1.-smoothstep(.011,.020+aa,tie));
        value+=.05*(1.-smoothstep(.002,.009+aa,abs(tie-.025)));
        diffuseColor.rgb=vec3(value)*vec3(1.01,.995,.96);
       }`);
     };
    }
    if(m.name==='CobaltGlass'||m.name==='RubyGlass'){
     m.roughness=.81;m.metalness=.04;m.emissiveIntensity=.26;
     m.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec2 gore;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ngore=uv;');
      shader.fragmentShader='varying vec2 gore;\n'+shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
       float height=1.-gore.y;
       float seam=.5+.5*cos(gore.x*24.*6.2831853);
       float fabric=.72+.28*seam;
       diffuseColor.rgb*=fabric;
       totalEmissiveRadiance=totalEmissiveRadiance*fabric
         +vec3(1.5,.59,.12)*exp(-5.4*abs(height-.11))*(.69+.31*seam);`);
     };
    }
    if(!track.night&&['Grass','Gravel','GravelMargin'].includes(m.name)){
     m.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec2 terrainMetres;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nterrainMetres=(modelMatrix*vec4(transformed,1.)).xz;');
      shader.fragmentShader='varying vec2 terrainMetres;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
       vec2 ground=terrainMetres;
       float broad=sin(ground.x*.034+ground.y*.013)*sin(ground.y*.047-ground.x*.019);
       ${m.name==='Grass'?`float pass=dot(ground,vec2(.89,.456))*.56+.29*sin(ground.y*.017);
       float mow=smoothstep(-.28,.28,sin(pass))-.5;
       diffuseColor.rgb*=1.+.095*mow+.048*broad;`:`float sweep=dot(ground,vec2(.79,-.61))+.016*pow(19.*sin(ground.y*.026),2.);
       float tracks=abs(fract(sweep/19.+.05*broad)-.5)*19.;
       float rut=(1.-smoothstep(.11,.42,abs(tracks-.81)))*smoothstep(-.35,.7,broad);
       diffuseColor.rgb*=1.+.095*broad-.13*rut;`}
      `);
     };
     m.customProgramCacheKey=()=>'landscape-'+m.name;
    }
    if(m.name==='Grass')m.color.set('#708554');
    // The woodland floor uses the gravel scan for grain. Its neutral source
    // albedo needs the leaf-litter tint when it meets the grass in wide shots.
    if(m.name==='LeafLitter')m.color.set('#514a35');
    if(m.name==='RoughMeadow')m.color.set('#81774d');
    if(m.name==='Gravel'){m.bumpMap=m.map;m.bumpScale=.008;}
    if(m.name==='RunoffPaint'&&!m.userData.canopyBaked){
     m.roughness=.88;
     // The slab joints run across the apron. Scuffed binder shows through
     // the paint between joints, with subpixel grit filtered at distance.
     m.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 apronMetres;')
       .replace('#include <begin_vertex>','#include <begin_vertex>\napronMetres=uv*3.;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 apronMetres;')
       .replace('#include <color_fragment>',`#include <color_fragment>
        float joint=abs(fract(apronMetres.y/4.)-.5)*4.;
        float aa=max(fwidth(apronMetres.y),.002);
        float seam=clamp((min(joint+.5*aa,.007)-max(joint-.5*aa,-.007))/aa,0.,1.);
        float scuff=sin(apronMetres.y*1.71+.6*cos(apronMetres.x*3.1))*sin(apronMetres.x*4.2+apronMetres.y*.16);
        float grit=fract(sin(dot(floor(apronMetres*44.),vec2(12.9898,78.233)))*43758.5453);
        float resolved=1.-smoothstep(.012,.05,max(fwidth(apronMetres.x),aa));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.31,.32,.29),.08+.16*max(scuff,0.)+.12*grit*resolved);
        diffuseColor.rgb*=1.-.36*seam;
       `);
     };
    }
    if(m.name==='Ice'&&track.night)m.emissiveIntensity=1.15;
    if(m.name==='Gold'&&track.night){m.emissiveIntensity=.37;m.roughness=.49;}
    if(m.name==='Dark'&&track.night)m.color.set('#080b12');
    if(['Foliage','Fence','Crowd'].includes(m.name)){m.transparent=false;m.alphaTest=m.name==='Fence'?.34:.4;m.alphaToCoverage=true;m.depthWrite=true;}
    if(m.name==='Fence'){
     m.roughness=.92;m.metalness=.06;
     m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`
      vec3 plane=cross(dFdx(vViewPosition),dFdy(vViewPosition));
      float angle=abs(dot(plane,normalize(vViewPosition)))/max(length(plane),.000001);
      diffuseColor.a*=mix(.59,1.,smoothstep(.025,.38,angle));
      #include <alphatest_fragment>`);};
    }
    if(m.name==='GravelMargin'){m.transparent=true;m.depthWrite=false;m.roughness=.93;}
    if(m.name==='Rubber'){m.transparent=true;m.depthWrite=false;m.polygonOffset=true;m.polygonOffsetFactor=-1;}
    if(canopyLight&&['Asphalt','RepairCourse','Grass','LeafLitter','RoughMeadow','White','Red','Green','RunoffPaint','Gravel','Rubber'].includes(m.name)){
     if(m.name==='Asphalt'||m.name==='RepairCourse'||!m.userData.canopyBaked){
      const original=m.onBeforeCompile;
      m.onBeforeCompile=function(shader,renderer){
       original.call(this,shader,renderer);shader.uniforms.canopyLight={value:canopyLight};shader.uniforms.shadowPatch=shadowPatch;
       shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 canopyUV;')
        .replace('#include <project_vertex>','#include <project_vertex>\ncanopyUV=((modelMatrix*vec4(transformed,1.)).xz+vec2(128.,1536.))/vec2(1536.,2560.);');
       shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform vec3 shadowPatch;uniform sampler2D canopyLight;varying vec2 canopyUV;')
        .replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nfloat radius=distance(canopyUV*vec2(1536.,2560.)-vec2(128.,1536.),shadowPatch.xy);float sunlight=mix(1.,texture2D(canopyLight,canopyUV).r,smoothstep(.60,1.,radius/max(1.,shadowPatch.z))); reflectedLight.directDiffuse*=sunlight;reflectedLight.directSpecular*=sunlight;');
      };
      m.customProgramCacheKey=()=>'park-canopy-'+m.name;
      m.userData.canopyBaked=true;
     }
    }

   }
   if(import.meta.env.MCP_APP==='true'&&materials.some(m=>/^(Canopy|Trunk|Foliage|Spectator|Seated|Skin|.*Uniform|Fountain)/.test(m.name)))o.layers.set(1);
   if(o.receiveShadow)receivers.push(o);
   o.userData.cullRadius=(o instanceof T.InstancedMesh?o.boundingSphere:o.geometry.boundingSphere)!.radius*o.matrixWorld.getMaxScaleOnAxis();
  });
  for(const material of drySurfaces){
   const concrete=material.name==='Concrete';
   if(material.name==='White')material.color.set('#bcbeb9');
   material.roughness=Math.max(.91,material.roughness);material.metalness=0;
   material.envMapIntensity=.30;
   const previous=material.onBeforeCompile;
   material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);
    // Compress only intense reflected light on matte paint and concrete.
    // The venue's authored luminaires and signs use their own HDR materials.
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
     float luma=dot(outgoingLight,vec3(.2126,.7152,.0722));
     float excess=max(0.,luma-.24);
     float shoulder=${concrete?'.38':'.60'};
     outgoingLight*=(min(luma,.24)+excess/(1.+excess/shoulder))/max(luma,.00001);
     #include <opaque_fragment>
    `);
   };
   material.customProgramCacheKey=()=>`dry-${material.name}`;
  }
  if(import.meta.env.MCP_APP==='true'){
   if(multiDraw)batches=batchCircuit(gltf.scene);
   distantInstances=batchDistantInstances(gltf.scene);
  }
  const active=new MeshResources().collect(gltf.scene);
  for(const geometry of farCrowns.values())original.geometries.add(geometry);
  original.dispose(active);
  scene.add(gltf.scene);
  if(!lakeBounds.isEmpty()){reflection=lakeReflection(lakeBounds,()=>reflectionMs);scene.add(reflection);}
  ready=true;
 }).catch(e=>{draco?.dispose();if(disposed)return;error=String(e);console.error('Blender circuit asset failed',e);});
 return {setReflectionCadence(ms:number){reflectionMs=ms;},loaded,heightAt,spherePosition,people,signals,puddles,get sphereShow(){return sphereShow;},get ready(){return ready;},get error(){return error;},viewDetail(camera:T.Camera|null,detail=1,drawDistance=1){
  if(!camera&&!manualDetail)return;
  manualDetail=!!camera;
  if(camera){detailCamera.matrixWorld.copy(camera.matrixWorld);detailCamera.zoom=detail;}
  for(const lod of circuitLods){
   lod.autoUpdate=!camera;
   if(camera){
    // Lower silhouette detail while preserving the venue's draw distance.
    const end=lod.levels[lod.levels.length-1],range=end.distance;
    end.distance=range*drawDistance/detail;lod.update(detailCamera);end.distance=range;
   }
  }
  distantInstances?.(camera);
 },update(time:number,focus:T.Vector3,camera:T.Vector3,shadowExtent:number,balanced:boolean){
  animation.value=time;shadowPatch.value.set(focus.x,focus.z,balanced?0:shadowExtent);
  if(reflection)(reflection.material as T.ShaderMaterial).uniforms.waterTime.value=time;
  function near(mesh:T.Mesh,range:number){
   const centre=mesh.userData.cullCenter as T.Vector3;
   const radius=mesh.userData.cullRadius as number;
   return Math.min(centre.distanceToSquared(camera),centre.distanceToSquared(focus))<(range+radius)**2;
  }
  for(const mesh of casters)mesh.castShadow=(!balanced||!canopyLight||!mesh.userData.foliageCaster)&&near(mesh,balanced?48:105);
  for(const mesh of receivers)mesh.receiveShadow=near(mesh,balanced?shadowExtent+8:shadowExtent*1.5+15);
  for(const mesh of distant)mesh.visible=near(mesh,balanced?640:950);
 },dispose:()=>{if(disposed)return;disposed=true;loadingAssets.abort();
  if(circuitRoot){
   circuitRoot.removeFromParent();const assets=new MeshResources().collect(circuitRoot);
   for(const batch of batches){assets.geometries.delete(batch.geometry);batch.dispose();}
   assets.dispose();circuitRoot=undefined;
  }
  puddles.dispose();signals.dispose();lineMap.dispose();gravelNormal.dispose();waterNormal.dispose();normal.dispose();canopyLight?.dispose();if(reflection){reflection.removeFromParent();reflection.geometry.dispose();reflection.dispose();}}};
}
