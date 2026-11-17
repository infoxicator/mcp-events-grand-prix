import * as T from 'three';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import decoderJS from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url&inline';
import decoderWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url&inline';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {embeddedGLB} from './embedded-glb';
import monzaMcp from './assets/circuits/monza-mcp.glb.gz?url&inline';
import vegasMcp from './assets/circuits/las-vegas-mcp.glb.gz?url&inline';
import monzaURL from './assets/circuits/monza.glb?url&inline';
import vegasURL from './assets/circuits/las-vegas.glb?url&inline';
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
 const source=import.meta.env.MCP_APP==='true'?embeddedGLB(track.night?vegasMcp:monzaMcp,true):new GLTFLoader().setDRACOLoader(draco!).loadAsync(track.night?vegasURL:monzaURL);
 const loaded=source.then(gltf=>{
  draco?.dispose();
  if(disposed){gltf.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const value of Object.values(m))if(value instanceof T.Texture)value.dispose();m.dispose();}}});return;}
  gltf.scene.traverse(o=>{if(!(o instanceof T.Mesh))return;o.receiveShadow=true;o.castShadow=false;o.geometry.computeBoundingSphere();
   const materials=Array.isArray(o.material)?o.material:[o.material];for(const material of materials){const m=material as T.MeshStandardMaterial;m.side=T.DoubleSide;
    if(m.map){m.map.anisotropy=anisotropy;m.map.wrapS=m.map.wrapT=T.RepeatWrapping;}
    if(m.name==='Asphalt'){m.color.set(track.night?'#737982':'#777b7e');m.normalMap=normal;m.normalScale.set(.09,.09);m.roughness=track.night?.48:.91;
     if(track.night)m.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 roadUv;').replace('#include <begin_vertex>','#include <begin_vertex>\nroadUv=uv;');s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 roadUv;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\nfloat pool=.5+.5*cos(roadUv.y*3.*6.283185/45.);totalEmissiveRadiance+=diffuseColor.rgb*(.16+.38*pool);');};
    }
    if(m.name==='Grass')m.color.set('#708554');
    if(m.name==='Gravel'){m.bumpMap=m.map;m.bumpScale=.008;}
    if(['Concrete','White','Steel','Foliage','Trunk'].includes(m.name))casters.push(o);
    if(m.name==='Dark'&&track.night)m.color.set('#080b12');
    if(['Foliage','Fence','Crowd'].includes(m.name)){m.transparent=false;m.alphaTest=.4;m.depthWrite=true;}
    if(m.name==='Rubber'){m.transparent=true;m.depthWrite=false;m.polygonOffset=true;m.polygonOffsetFactor=-1;}
    if(['Fence','Crowd','Foliage','Trunk'].includes(m.name))distant.push(o);
    if(m.name==='Sphere'){
     const shader=new T.ShaderMaterial({uniforms:{time:{value:0},art:{value:art}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:`uniform float time;uniform sampler2D art;varying vec2 vUv;void main(){float w=.5+.5*sin(vUv.x*35.+vUv.y*18.+time*.3);vec3 c=mix(vec3(.02,.48,.65),vec3(.85,.025,.18),w);float bands=pow(.5+.5*sin(vUv.y*90.+vUv.x*15.-time*.2),12.);vec2 cell=fract(vUv*vec2(1400.,700.))-.5;float led=.72+.28*smoothstep(.5,.12,length(cell));vec3 artwork=texture2D(art,vec2(fract(.88-vUv.x),vUv.y)).rgb;gl_FragColor=vec4((artwork*1.5+c*bands*.12)*led,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>
}`,side:T.DoubleSide});o.material=shader;spheres.push(shader);
    }
   }
  });scene.add(gltf.scene);ready=true;
 }).catch(e=>{draco?.dispose();error=String(e);console.error('Blender circuit asset failed',e);});
 return {loaded,heightAt,spherePosition,get ready(){return ready;},get error(){return error;},update:(time:number,focus?:T.Vector3)=>{for(const s of spheres)s.uniforms.time.value=time;if(focus)for(const o of casters){const p=o.geometry.boundingSphere!.center;o.castShadow=Math.hypot(p.x-focus.x,p.z-focus.z)<170;}if(focus)for(const o of distant){const p=o.geometry.boundingSphere!.center;o.visible=Math.hypot(p.x-focus.x,p.z-focus.z)<950;}},dispose:()=>{disposed=true;normal.dispose();art.dispose();}};
}
