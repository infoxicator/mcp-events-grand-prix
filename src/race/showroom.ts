import * as T from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import contactURL from './assets/jgp26-contact.png?url&inline';
/** Neutral studio rig, independent of circuit daylight/night lighting. */
export function createShowroom(renderer:T.WebGLRenderer){
 const scene=new T.Scene();scene.background=new T.Color('#101318');scene.fog=new T.Fog('#101318',18,65);
 const pmrem=new T.PMREMGenerator(renderer),room=new T.Scene();room.background=new T.Color('#101317');
 // Softboxes are represented in the reflection environment as well as direct lighting.
 for(const [x,y,z,w,h,power] of [[-2.3,5.6,1,2.6,7,4.2],[-3.4,2.3,.9,.64,6.8,6.2],[4,3,-2,1.25,6,2.7],[-1,2,-5,3,.65,4],[2.8,3.2,3,.38,6,4.1]]){
  const panel=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({color:new T.Color(power,power,power),side:T.DoubleSide}));panel.position.set(x,y,z);panel.lookAt(0,.3,0);room.add(panel);
 }
 const env=pmrem.fromScene(room,.025);room.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(o.material as T.Material).dispose();}});pmrem.dispose();scene.environment=env.texture;scene.environmentIntensity=.82;
 RectAreaLightUniformsLib.init();const overhead=new T.RectAreaLight('#fff8ee',2.8,2.1,6.7);overhead.position.set(-1,5,0);overhead.lookAt(0,0,0);scene.add(overhead);
 const key=new T.DirectionalLight('#fff4ea',1.18);key.position.set(-3,7,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.1,far:20});key.shadow.normalBias=.002;key.shadow.bias=-.0001;key.shadow.radius=4;scene.add(key,new T.HemisphereLight('#e1edff','#292c33',.69));
 const sideFill=new T.RectAreaLight('#f6f3ed',2.5,5.8,2.9);sideFill.position.set(-4,2.1,1);sideFill.lookAt(0,.4,0);scene.add(sideFill);
 const fill=new T.RectAreaLight('#d8e1ef',1.6,2.3,5.5);fill.position.set(5,3,-4);fill.lookAt(0,.4,0);scene.add(fill);
 const floor=new T.Mesh(new T.PlaneGeometry(150,150),new T.MeshStandardMaterial({color:'#10151d',roughness:.79,metalness:.03,envMapIntensity:.025}));floor.rotation.x=-Math.PI/2;floor.position.y=-.012;floor.receiveShadow=true;scene.add(floor);
 const mirror=new Reflector(new T.PlaneGeometry(150,150),{textureWidth:768,textureHeight:768,color:0x151b23,clipBias:.001});mirror.rotation.x=-Math.PI/2;mirror.position.y=-.01;
 const mirrorMaterial=mirror.material as T.ShaderMaterial;
 // A subdued, slightly blurred studio reflection; no extra pass during racing.
 mirrorMaterial.fragmentShader=mirrorMaterial.fragmentShader.replace('vec4 base = texture2DProj( tDiffuse, vUv );',`vec4 base = vec4(0.0); for(int x=-1;x<=1;x++){for(int y=-1;y<=1;y++){vec4 uv=vUv;uv.xy+=vec2(float(x),float(y))*.004*uv.w;base+=texture2DProj(tDiffuse,uv)/9.0;}}`);
 mirrorMaterial.transparent=true;mirrorMaterial.fragmentShader=mirrorMaterial.fragmentShader.replace('gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );','gl_FragColor = vec4( base.rgb * vec3(.80,.84,.89), 0.14 );');scene.add(mirror);
 // Soft contact occlusion strengthens contact without a full-resolution SSAO pass.
 const tex=new T.TextureLoader().load(contactURL);tex.flipY=false;
 const shadow=new T.Mesh(new T.PlaneGeometry(4,7),new T.ShaderMaterial({uniforms:{ao:{value:tex}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform sampler2D ao;varying vec2 vUv;void main(){float a=1.-texture2D(ao,vUv).r;gl_FragColor=vec4(0.,0.,0.,a*.92);}',transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.001;scene.add(shadow);
 return {scene,dispose(){env.dispose();key.shadow.dispose();mirror.dispose();floor.geometry.dispose();(floor.material as T.Material).dispose();shadow.geometry.dispose();shadow.material.dispose();tex.dispose();}};
}
