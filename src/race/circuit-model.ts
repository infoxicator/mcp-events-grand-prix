import * as T from 'three';
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
import sphereArt from './assets/circuits/sphere-art.png?url&inline';
import asphaltNormal from './assets/asphalt-normal.jpg?url';
import type {Track} from './track';
/** All geometry is authored/exported by Blender. This loader only configures PBR and culling. */
export function loadCircuit(scene:T.Scene,track:Track,anisotropy:number){
 let ready=false,error:string|undefined,disposed=false;
 const heightAt=(d:number)=>circuitHeight(track.id,d);
 const sp=track.project(-115.1621,36.1207),spherePosition=new T.Vector3(sp.x,32.9184,sp.z),spheres:T.ShaderMaterial[]=[];
 const normal=new T.TextureLoader().load(asphaltNormal);normal.colorSpace=T.NoColorSpace;normal.flipY=false;normal.wrapS=normal.wrapT=T.RepeatWrapping;normal.anisotropy=anisotropy;
 const art=new T.TextureLoader().load(sphereArt);art.colorSpace=T.SRGBColorSpace;art.flipY=false;
 const distant:T.Mesh[]=[],casters:T.Mesh[]=[];
 const draco=import.meta.env.MCP_APP==='true'?null:new DRACOLoader().setDecoderPath({js:decoderJS,wasm:decoderWasm}).setWorkerLimit(2);
 const source=import.meta.env.MCP_APP==='true'?embeddedGLB(track.night?vegasMcp:monzaMcp,true):assetBytes(track.night?vegasURL:monzaURL).then(b=>new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()).then(b=>new GLTFLoader().setDRACOLoader(draco!).parseAsync(b,''));
 const loaded=source.then(gltf=>{
  draco?.dispose();
  if(disposed){gltf.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const value of Object.values(m))if(value instanceof T.Texture)value.dispose();m.dispose();}}});return;}
  // Partition Blender EXT_mesh_gpu_instancing by spatial tile for culling and shadows.
  gltf.scene.updateMatrixWorld(true);const farCrowns=new Map<string,T.BufferGeometry>(),lodSources:T.Mesh[]=[];gltf.scene.traverse(o=>{if(o instanceof T.Mesh&&o.name.startsWith('LOD_Canopy')){farCrowns.set((o.material as T.Material).name,o.geometry.clone().applyMatrix4(o.matrixWorld));lodSources.push(o);}});lodSources.forEach(o=>{o.removeFromParent();o.geometry.dispose();});const buckets=new Map<string,{mesh:T.Mesh;matrix:T.Matrix4}[]>(),sources:T.Mesh[]=[];
  gltf.scene.traverse(o=>{if(o instanceof T.Mesh&&(o instanceof T.InstancedMesh||o.name.startsWith('Instance_'))){sources.push(o);const count=o instanceof T.InstancedMesh?o.count:1;
   for(let i=0;i<count;i++){const matrix=new T.Matrix4();if(o instanceof T.InstancedMesh)o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);const p=new T.Vector3().setFromMatrixPosition(matrix),key=`${o.geometry.uuid}:${(o.material as T.Material).uuid}:${Math.floor(p.x/180)}:${Math.floor(p.z/180)}`;const group=buckets.get(key)??[];group.push({mesh:o,matrix});buckets.set(key,group);}
  }});
  for(const o of sources){let parent=o.parent;o.removeFromParent();while(parent&&parent!==gltf.scene&&parent.children.length===0){const next=parent.parent;parent.removeFromParent();parent=next;}}
  for(const objects of buckets.values()){
   const first=objects[0].mesh,farGeometry=farCrowns.get((first.material as T.Material).name),batch=new T.InstancedMesh(first.geometry,first.material,objects.length);batch.name=first.name;
   if(farGeometry){
    const centre=new T.Vector3();for(const o of objects)centre.add(new T.Vector3().setFromMatrixPosition(o.matrix));centre.divideScalar(objects.length);
    const offset=new T.Matrix4().makeTranslation(-centre.x,-centre.y,-centre.z),far=new T.InstancedMesh(farGeometry,first.material,objects.length),lod=new T.LOD();far.name=first.name+'_far';
    objects.forEach((o,i)=>{const matrix=o.matrix.clone().premultiply(offset);batch.setMatrixAt(i,matrix);far.setMatrixAt(i,matrix);});batch.computeBoundingSphere();far.computeBoundingSphere();lod.position.copy(centre);lod.addLevel(batch,0);lod.addLevel(far,130,.18);lod.addLevel(new T.Group(),950,.1);gltf.scene.add(lod);
   }else{objects.forEach((o,i)=>batch.setMatrixAt(i,o.matrix));batch.computeBoundingSphere();gltf.scene.add(batch);}
  }
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o=>{if(!(o instanceof T.Mesh))return;o.receiveShadow=true;o.castShadow=false;o.geometry.computeBoundingSphere();o.userData.cullCenter=(o instanceof T.InstancedMesh?o.boundingSphere!:o.geometry.boundingSphere!).center.clone().applyMatrix4(o.matrixWorld);
   const materials=Array.isArray(o.material)?o.material:[o.material];for(const material of materials){const m=material as T.MeshStandardMaterial;m.side=T.DoubleSide;
    if(m.map){m.map.anisotropy=anisotropy;m.map.wrapS=m.map.wrapT=T.RepeatWrapping;}
    if(track.night&&['Asphalt','Concrete','Steel'].includes(m.name)){m.envMapIntensity=m.name==='Asphalt'?1.4:.7;m.roughness=m.name==='Asphalt'?.32:.38;m.metalness=m.name==='Asphalt'?.08:.25;}
    if(m.name==='Asphalt'){m.color.set(track.night?'#737982':'#777b7e');m.normalMap=normal;m.normalScale.set(.09,.09);m.roughness=track.night?.32:.91;m.roughnessMap=null;
     if(track.night)m.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 roadUv;').replace('#include <begin_vertex>','#include <begin_vertex>\nroadUv=uv;');s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 roadUv;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\nfloat pool=.5+.5*cos(roadUv.y*3.*6.283185/45.);totalEmissiveRadiance+=diffuseColor.rgb*(.16+.38*pool);');};
    }
    if(m.name.startsWith('Canopy')){m.color.set(['#6a7947','#708447','#526e43','#808448'][Number(m.name.slice(-1))%4]);m.bumpMap=m.map;m.bumpScale=.32;m.roughness=1;}
    if(m.name==='Windows'&&m.map){m.map.repeat.set(2.25,1.25);m.color.set('#85888d');m.emissiveIntensity=.55;}
    if(m.name==='Grass')m.color.set('#708554');
    if(m.name==='Gravel'){m.bumpMap=m.map;m.bumpScale=.008;}
    if(['Concrete','White','Steel','Foliage','Trunk'].includes(m.name)||m.name.startsWith('Canopy'))casters.push(o);
    if(m.name==='Dark'&&track.night)m.color.set('#080b12');
    if(['Foliage','Fence','Crowd'].includes(m.name)){m.transparent=false;m.alphaTest=.4;m.depthWrite=true;}
    if(m.name==='Rubber'){m.transparent=true;m.depthWrite=false;m.polygonOffset=true;m.polygonOffsetFactor=-1;}
    if(['Fence','Crowd','Foliage','Trunk','Skin'].includes(m.name)||m.name.startsWith('Spectator'))distant.push(o);
    if(m.name==='Sphere'){
     const shader=new T.ShaderMaterial({uniforms:{time:{value:0},art:{value:art}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:`uniform float time;uniform sampler2D art;varying vec2 vUv;void main(){float w=.5+.5*sin(vUv.x*35.+vUv.y*18.+time*.3);vec3 c=mix(vec3(.02,.48,.65),vec3(.85,.025,.18),w);float bands=pow(.5+.5*sin(vUv.y*90.+vUv.x*15.-time*.2),12.);vec2 cell=fract(vUv*vec2(1400.,700.))-.5;float led=.72+.28*smoothstep(.5,.12,length(cell));vec3 artwork=texture2D(art,vec2(fract(.88-vUv.x),vUv.y)).rgb;gl_FragColor=vec4((artwork*1.5+c*bands*.12)*led,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>
}`,side:T.DoubleSide});o.material=shader;spheres.push(shader);
    }
   }
  });scene.add(gltf.scene);ready=true;
 }).catch(e=>{draco?.dispose();error=String(e);console.error('Blender circuit asset failed',e);});
 return {loaded,heightAt,spherePosition,get ready(){return ready;},get error(){return error;},update:(time:number,focus?:T.Vector3)=>{for(const s of spheres)s.uniforms.time.value=time;if(focus)for(const o of casters){const p=o.userData.cullCenter as T.Vector3;o.castShadow=Math.hypot(p.x-focus.x,p.z-focus.z)<105;}if(focus)for(const o of distant){const p=o.userData.cullCenter as T.Vector3;o.visible=Math.hypot(p.x-focus.x,p.z-focus.z)<950;}},dispose:()=>{disposed=true;normal.dispose();art.dispose();}};
}
