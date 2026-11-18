import * as T from 'three';
import {tracksideMotion} from './trackside-motion';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import decoderJS from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url&inline';
import decoderWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url&inline';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {embeddedGLB,assetBytes} from './embedded-glb';
import monzaMcp from './assets/circuits/monza-mcp.glb.gz?url&inline';
import vegasMcp from './assets/circuits/las-vegas-mcp.glb.gz?url&inline';
import monzaURL from './assets/circuits/monza.glb.gz?url&inline';
import vegasURL from './assets/circuits/las-vegas.glb.gz?url&inline';
import {circuitHeight} from './elevation';
import canopyLightURL from './assets/circuits/monza-canopy-light.png?url&inline';
import asphaltNormal from './assets/asphalt-normal.webp?url';
import type {Track} from './track';
/** Reflect the actual resort and jets on the surface of the Blender lake. */
function lakeReflection(bounds:T.Box3){
 const size=bounds.getSize(new T.Vector3()),centre=bounds.getCenter(new T.Vector3());
 const water=new Reflector(new T.CircleGeometry(1,96),{textureWidth:512,textureHeight:384,clipBias:.002,multisample:0});
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
   'gl_FragColor=vec4(base.rgb*vec3(.58,.66,.72)+vec3(.002,.007,.009),.62);');
 // Refresh only when visible from a main camera. The depth-correct projected
 // reflection is reused by intervening frames and distant environment probes.
 const reflect=water.onBeforeRender;let last=-Infinity;
 water.onBeforeRender=function(renderer,scene,camera,...rest){
  if(camera.position.distanceTo(centre)>900||camera.parent instanceof T.CubeCamera)return;
  const now=performance.now();if(now-last<80)return;last=now;
  reflect.call(this,renderer,scene,camera,...rest);
 };
 return water;
}
/** All geometry is authored/exported by Blender. This loader only configures PBR and culling. */
export function loadCircuit(scene:T.Scene,track:Track,anisotropy:number){
 let ready=false,error:string|undefined,disposed=false;
 const heightAt=(d:number)=>circuitHeight(track.id,d);
 const people=tracksideMotion();
 const sp=track.project(-115.1621,36.1207),spherePosition=new T.Vector3(sp.x,32.9184,sp.z),spheres:T.ShaderMaterial[]=[];
 const normal=new T.TextureLoader().load(asphaltNormal);normal.colorSpace=T.NoColorSpace;normal.flipY=false;normal.wrapS=normal.wrapT=T.RepeatWrapping;normal.anisotropy=anisotropy;
 const canopyLight=track.night?null:new T.TextureLoader().load(canopyLightURL);
 if(canopyLight){canopyLight.flipY=false;canopyLight.colorSpace=T.NoColorSpace;}
 const lakeBounds=new T.Box3();let reflection:Reflector|undefined;
 const distant:T.Mesh[]=[],casters:T.Mesh[]=[];
 const draco=import.meta.env.MCP_APP==='true'?null:new DRACOLoader().setDecoderPath({js:decoderJS,wasm:decoderWasm}).setWorkerLimit(2);
 const source=import.meta.env.MCP_APP==='true'?embeddedGLB(track.night?vegasMcp:monzaMcp,true):assetBytes(track.night?vegasURL:monzaURL).then(b=>new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()).then(b=>new GLTFLoader().setDRACOLoader(draco!).parseAsync(b,''));
 const loaded=source.then(gltf=>{
  draco?.dispose();
  if(disposed){gltf.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const value of Object.values(m))if(value instanceof T.Texture)value.dispose();m.dispose();}}});return;}
  // Partition Blender EXT_mesh_gpu_instancing by spatial tile for culling and shadows.
  gltf.scene.updateMatrixWorld(true);
  const farCrowns=new Map<string,T.BufferGeometry>(),lodSources:T.Mesh[]=[];
  gltf.scene.traverse(o=>{
   if(!(o instanceof T.Mesh)||!(o.name.startsWith('LOD_Canopy')||o.name.startsWith('LOD_Grandstand')))return;
   const geometry=o.geometry.clone(),position=geometry.getAttribute('position');
   if(position.normalized){
    // Apply the MCP export's placement in metres without clipping it back to [-1,1].
    const floats=new T.Float32BufferAttribute(new Float32Array(position.count*3),3);
    for(let i=0;i<position.count;i++)floats.setXYZ(i,position.getX(i),position.getY(i),position.getZ(i));
    geometry.setAttribute('position',floats);
   }
   const key=o.name.startsWith('LOD_Grandstand')?o.name:(o.material as T.Material).name;
   farCrowns.set(key,geometry.applyMatrix4(o.matrixWorld));lodSources.push(o);
  });
  lodSources.forEach(o=>{o.removeFromParent();o.geometry.dispose();});
  const buckets=new Map<string,{mesh:T.Mesh;matrix:T.Matrix4}[]>(),sources:T.Mesh[]=[];
  gltf.scene.traverse(o=>{if(o instanceof T.Mesh&&(o instanceof T.InstancedMesh||o.name.startsWith('Instance_'))){sources.push(o);const count=o instanceof T.InstancedMesh?o.count:1;
   for(let i=0;i<count;i++){const matrix=new T.Matrix4();if(o instanceof T.InstancedMesh)o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);const p=new T.Vector3().setFromMatrixPosition(matrix),key=`${o.geometry.uuid}:${(o.material as T.Material).uuid}:${Math.floor(p.x/180)}:${Math.floor(p.z/180)}`;const group=buckets.get(key)??[];group.push({mesh:o,matrix});buckets.set(key,group);}
  }});
  for(const o of sources){let parent=o.parent;o.removeFromParent();while(parent&&parent!==gltf.scene&&parent.children.length===0){const next=parent.parent;parent.removeFromParent();parent=next;}}
  for(const objects of buckets.values()){
   const first=objects[0].mesh,materialName=(first.material as T.Material).name,spectator=materialName==='Spectator0';
   if(spectator&&!first.geometry.boundingBox)first.geometry.computeBoundingBox();
   const key=spectator?'LOD_Grandstand'+(first.geometry.boundingBox!.max.y>1.15?'Standing':'Seated'):materialName;
   const farGeometry=farCrowns.get(key),batch=new T.InstancedMesh(first.geometry,first.material,objects.length);batch.name=first.name;
   if(farGeometry){
    const centre=new T.Vector3();for(const o of objects)centre.add(new T.Vector3().setFromMatrixPosition(o.matrix));centre.divideScalar(objects.length);
    const offset=new T.Matrix4().makeTranslation(-centre.x,-centre.y,-centre.z),far=new T.InstancedMesh(farGeometry,first.material,objects.length),lod=new T.LOD();far.name=first.name+'_far';
    objects.forEach((o,i)=>{const matrix=o.matrix.clone().premultiply(offset);batch.setMatrixAt(i,matrix);far.setMatrixAt(i,matrix);});batch.computeBoundingSphere();far.computeBoundingSphere();lod.position.copy(centre);lod.addLevel(batch,0);lod.addLevel(far,spectator?105:115,.18);lod.addLevel(new T.Group(),950,.1);gltf.scene.add(lod);
   }else{objects.forEach((o,i)=>batch.setMatrixAt(i,o.matrix));batch.computeBoundingSphere();gltf.scene.add(batch);}
  }
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o=>{if(!(o instanceof T.Mesh))return;o.receiveShadow=true;o.castShadow=false;o.geometry.computeBoundingSphere();o.userData.cullCenter=(o instanceof T.InstancedMesh?o.boundingSphere!:o.geometry.boundingSphere!).center.clone().applyMatrix4(o.matrixWorld);
   const materials=Array.isArray(o.material)?o.material:[o.material];for(const material of materials){const m=material as T.MeshStandardMaterial;m.side=T.DoubleSide;people.bind(m);
    if(m.map){m.map.anisotropy=anisotropy;m.map.wrapS=m.map.wrapT=T.RepeatWrapping;}
    if(track.night&&m.name==='Steel'){m.envMapIntensity=.92;m.roughness=.48;m.metalness=.55;}
    if(m.name==='Concrete'){m.color.set('#c3c1b8');m.bumpMap=m.map;m.bumpScale=.003;m.roughness=.89;m.metalness=0;m.envMapIntensity=.55;}
    if(m.name==='Asphalt'||m.name==='RepairCourse'){
     m.color.set(m.name==='RepairCourse'?(track.night?'#62676b':'#5f6263'):(track.night?'#7f8081':'#777b7c'));m.normalMap=normal;m.normalScale.set(.14,.14);
     m.roughness=m.name==='RepairCourse'?.68:track.night?.66:.91;m.metalness=.015;m.envMapIntensity=track.night?.95:.7;
     // Physical aggregate at the original survey UV scale, plus broad,
     // non-repeating binder variation between the racing line and the verge.
     m.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 pavementUV;')
       .replace('#include <begin_vertex>','#include <begin_vertex>\npavementUV=uv;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
       varying vec2 pavementUV;
       float pavementHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
       float pavementNoise(vec2 p){
        vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(pavementHash(cell),pavementHash(cell+vec2(1,0)),f.x),
          mix(pavementHash(cell+vec2(0,1)),pavementHash(cell+1.),f.x),f.y);
       }`).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        float binder=pavementNoise(pavementUV*vec2(1.1,.13));
        float grit=pavementNoise(pavementUV*vec2(7.7,.62));
        vec2 metres=pavementUV*3.;
        float seamDistance=abs(metres.x-2.9+.058*sin(metres.y*.089)+.018*sin(metres.y*.81));
        float px=max(fwidth(metres.x),.004);
        float joint=1.-smoothstep(.018,.022+px,seamDistance);
        float aged=smoothstep(.18,.57,pavementNoise(vec2(metres.y*.027,3.)));
        diffuseColor.rgb*=(.86+.20*binder+.08*grit)*(1.-joint*aged*.38);
        roughnessFactor-=joint*aged*.10;
        roughnessFactor=clamp(roughnessFactor+.09*(binder-.5),.47,1.);
       `);
      if(track.night)shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
       float lane=pow((metres.y-45.*floor(metres.y/45.+.5))/15.,2.);
       float axial=exp(-lane);
       float lateral=exp(-pow((abs(metres.x)-7.5)/10.,2.));
       totalEmissiveRadiance+=diffuseColor.rgb*vec3(.50,.59,.73)*(.25+.8*axial)*lateral;
      `);
     };
    }
    if(m.name.startsWith('Canopy')){m.color.set(['#a7ad94','#98ab8a','#96a49a','#b1ac8b'][Number(m.name.slice(-1))%4]);m.bumpMap=m.map;m.bumpScale=.009;m.roughness=1;m.transparent=false;m.alphaTest=.33;m.alphaToCoverage=true;m.depthWrite=true;if(m.map)m.map.repeat.set(1,1);}
    if(m.name==='Windows'&&m.map){m.color.set('#acb3c2');m.emissiveIntensity=.88;}
    if(m.name==='Balustrade'){m.transparent=true;m.opacity=.23;m.depthWrite=false;}
    if(m.name==='Hospitality'){m.color.set('#c4cbd2');m.roughness=.40;m.envMapIntensity=.42;}
    if(m.name==='WarmWindows'&&m.map){m.map.repeat.set(1,1);m.color.set('#ffdfae');m.emissiveIntensity=.65;}
    if(m.name==='Travertine'){m.emissive.set('#c28b43');m.emissiveIntensity=.30;m.envMapIntensity=.8;}
    if(m.name==='CityGround'){m.color.set('#828897');m.emissive.set('#9ba4b1');m.emissiveIntensity=.38;m.envMapIntensity=.34;}
    if(m.name==='Fountain'){m.color.set('#c2c9ce');m.emissive.set('#e5dbc3');m.emissiveIntensity=1.55;m.roughness=.48;}
    if(m.name==='BootContact'){m.transparent=true;m.depthWrite=false;m.polygonOffset=true;m.polygonOffsetFactor=-2;}
    if(m.name==='Water'){lakeBounds.expandByObject(o);m.envMapIntensity=.55;m.roughness=.24;m.metalness=.37;m.normalMap=normal;m.normalScale.set(.05,.05);}
    if(m.name==='ParkHorizon'){m.color.set('#a5af9e');m.roughness=1;
     // Keep the distant tree line at eye level. From a helicopter the real
     // instanced crowns below already provide the overhead canopy.
     m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',
      'diffuseColor.a*=1.-smoothstep(.12,.29,dot(normalize(vViewPosition),viewMatrix[1].xyz));\n#include <alphatest_fragment>');};
     m.transparent=false;m.alphaTest=.40;m.alphaToCoverage=true;m.depthWrite=true;}
    if(m.name==='Grass')m.color.set('#708554');
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
        float seam=1.-smoothstep(.007,.007+aa,joint);
        float scuff=sin(apronMetres.y*1.71+.6*cos(apronMetres.x*3.1))*sin(apronMetres.x*4.2+apronMetres.y*.16);
        float grit=fract(sin(dot(floor(apronMetres*44.),vec2(12.9898,78.233)))*43758.5453);
        float resolved=1.-smoothstep(.012,.05,max(fwidth(apronMetres.x),aa));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.31,.32,.29),.08+.16*max(scuff,0.)+.12*grit*resolved);
        diffuseColor.rgb*=1.-.36*seam;
       `);
     };
    }
    if(['Concrete','White','Steel','Foliage','Trunk'].includes(m.name)||m.name.startsWith('Canopy'))casters.push(o);
    if(m.name==='Ice'&&track.night)m.emissiveIntensity=2.6;
    if(m.name==='Dark'&&track.night)m.color.set('#080b12');
    if(['Foliage','Fence','Crowd'].includes(m.name)){m.transparent=false;m.alphaTest=.4;m.depthWrite=true;}
    if(m.name==='Rubber'){m.transparent=true;m.depthWrite=false;m.polygonOffset=true;m.polygonOffsetFactor=-1;}
    if(['Fence','Crowd','Foliage','Trunk','Skin'].includes(m.name)||m.name.startsWith('Spectator')||m.name.startsWith('Seated'))distant.push(o);
    if(canopyLight&&['Asphalt','RepairCourse','Grass','White','Red','Green','RunoffPaint','Gravel','Rubber'].includes(m.name)){
     if(m.name==='Asphalt'||m.name==='RepairCourse'||!m.userData.canopyBaked){
      const original=m.onBeforeCompile;
      m.onBeforeCompile=function(shader,renderer){
       original.call(this,shader,renderer);shader.uniforms.canopyLight={value:canopyLight};
       shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 canopyUV;')
        .replace('#include <project_vertex>','#include <project_vertex>\ncanopyUV=((modelMatrix*vec4(transformed,1.)).xz+vec2(128.,1536.))/vec2(1536.,2560.);');
       shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D canopyLight;varying vec2 canopyUV;')
        .replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nfloat sunlight=texture2D(canopyLight,canopyUV).r; reflectedLight.directDiffuse*=sunlight;reflectedLight.directSpecular*=sunlight;');
      };
      m.customProgramCacheKey=()=>'park-canopy-'+m.name;
      m.userData.canopyBaked=true;
     }
    }
    if(m.name==='Sphere'){
     const shader=new T.ShaderMaterial({uniforms:{time:{value:0},art:{value:m.map}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:`uniform float time;uniform sampler2D art;varying vec2 vUv;void main(){float w=.5+.5*sin(vUv.x*35.+vUv.y*18.+time*.3);vec3 c=mix(vec3(.02,.48,.65),vec3(.85,.025,.18),w);float bands=pow(.5+.5*sin(vUv.y*90.+vUv.x*15.-time*.2),12.);vec2 cell=fract(vUv*vec2(1400.,700.))-.5;float led=mix(.87,.76+.24*(1.-smoothstep(.12,.5,length(cell))),1.-smoothstep(.15,1.,fwidth(vUv.x)*1400.));vec3 artwork=texture2D(art,vec2(fract(.88-vUv.x),vUv.y)).rgb;gl_FragColor=vec4((artwork*1.5+c*bands*.12)*led,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>
}`,side:T.DoubleSide});o.material=shader;spheres.push(shader);
    }
   }
  });scene.add(gltf.scene);
  if(!lakeBounds.isEmpty()){reflection=lakeReflection(lakeBounds);scene.add(reflection);}
  ready=true;
 }).catch(e=>{draco?.dispose();error=String(e);console.error('Blender circuit asset failed',e);});
 return {loaded,heightAt,spherePosition,people,get ready(){return ready;},get error(){return error;},update:(time:number,focus?:T.Vector3)=>{if(reflection)(reflection.material as T.ShaderMaterial).uniforms.waterTime.value=time;for(const s of spheres)s.uniforms.time.value=time;if(focus)for(const o of casters){const p=o.userData.cullCenter as T.Vector3;o.castShadow=Math.hypot(p.x-focus.x,p.z-focus.z)<105;}if(focus)for(const o of distant){const p=o.userData.cullCenter as T.Vector3;o.visible=Math.hypot(p.x-focus.x,p.z-focus.z)<950;}},dispose:()=>{disposed=true;normal.dispose();canopyLight?.dispose();if(reflection){reflection.removeFromParent();reflection.geometry.dispose();reflection.dispose();}}};
}
