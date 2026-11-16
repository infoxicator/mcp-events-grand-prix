import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import contactURL from './assets/jgp26-contact.png?url&inline';
/** Neutral studio rig, independent of circuit daylight/night lighting. */
export function createShowroom(renderer:T.WebGLRenderer){
 const scene=new T.Scene();scene.background=new T.Color('#141c25');scene.fog=new T.Fog('#141c25',18,65);
 const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.07);room.dispose();pmrem.dispose();scene.environment=env.texture;scene.environmentIntensity=.8;
 RectAreaLightUniformsLib.init();const overhead=new T.RectAreaLight('#fff5ec',2,5,8);overhead.position.set(-1,5,0);overhead.lookAt(0,0,0);scene.add(overhead);
 const key=new T.DirectionalLight('#f3f5ff',.9);key.position.set(-3,7,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.1,far:20});key.shadow.normalBias=.002;key.shadow.bias=-.0001;key.shadow.radius=4;scene.add(key,new T.HemisphereLight('#e1edff','#171b22',.4));
 const fill=new T.RectAreaLight('#b9cce3',2,4,4);fill.position.set(5,3,-4);fill.lookAt(0,.4,0);scene.add(fill);
 const floor=new T.Mesh(new T.PlaneGeometry(150,150),new T.MeshStandardMaterial({color:'#080c12',roughness:.92,metalness:0,envMapIntensity:.04}));floor.rotation.x=-Math.PI/2;floor.position.y=-.012;floor.receiveShadow=true;scene.add(floor);
 const mirror=new Reflector(new T.PlaneGeometry(150,150),{textureWidth:512,textureHeight:512,color:0x0d121a,clipBias:.001});mirror.rotation.x=-Math.PI/2;mirror.position.y=-.01;
 const mirrorMaterial=mirror.material as T.ShaderMaterial;
 // A subdued, slightly blurred studio reflection; no extra pass during racing.
 mirrorMaterial.fragmentShader=mirrorMaterial.fragmentShader.replace('vec4 base = texture2DProj( tDiffuse, vUv );',`vec4 base = vec4(0.0); for(int x=-1;x<=1;x++){for(int y=-1;y<=1;y++){vec4 uv=vUv;uv.xy+=vec2(float(x),float(y))*.0025*uv.w;base+=texture2DProj(tDiffuse,uv)/9.0;}}`);
 mirrorMaterial.transparent=true;mirrorMaterial.opacity=.18;mirrorMaterial.fragmentShader=mirrorMaterial.fragmentShader.replace('gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );','gl_FragColor = vec4( blendOverlay( base.rgb, color ), 0.18 );');scene.add(mirror);
 // Soft contact occlusion strengthens contact without a full-resolution SSAO pass.
 const tex=new T.TextureLoader().load(contactURL);tex.flipY=false;
 const shadow=new T.Mesh(new T.PlaneGeometry(4,7),new T.ShaderMaterial({uniforms:{ao:{value:tex}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform sampler2D ao;varying vec2 vUv;void main(){float a=1.-texture2D(ao,vUv).r;gl_FragColor=vec4(0.,0.,0.,a*.8);}',transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.001;scene.add(shadow);
 return {scene,dispose(){env.dispose();key.shadow.dispose();mirror.dispose();floor.geometry.dispose();(floor.material as T.Material).dispose();shadow.geometry.dispose();shadow.material.dispose();tex.dispose();}};
}
