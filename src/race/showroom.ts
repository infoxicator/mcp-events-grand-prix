import * as T from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type {Finish} from './car-model';
import contactURL from './assets/jgp26-contact.png?url';
/** Neutral studio rig, independent of circuit daylight/night lighting. */
export function createShowroom(renderer:T.WebGLRenderer,stageOffset=0,view:string|null=null){
 const scene=new T.Scene();scene.background=new T.Color('#101318');scene.fog=new T.Fog('#101318',18,65);
 const pmrem=new T.PMREMGenerator(renderer),room=new T.Scene();room.background=new T.Color('#101317');
 // Softboxes are represented in the reflection environment as well as direct lighting.
 for(const [x,y,z,w,h,power] of [[-2.3,5.6,1,2.6,7,4.2],[-2.9,2.0,.6,.42,6.1,8.4],[3.4,2.6,-1.9,.78,5.9,5.1],[-1,2,-5,3,.65,4],[2.8,3.2,3,.38,6,4.1]]){
  const panel=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({color:new T.Color(power,power,power),side:T.DoubleSide}));panel.position.set(x,y,z);panel.up.set(0,0,1);panel.lookAt(0,.3,0);room.add(panel);
 }
 const env=pmrem.fromScene(room,.025);room.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(o.material as T.Material).dispose();}});pmrem.dispose();scene.environment=env.texture;scene.environmentIntensity=.79;
 RectAreaLightUniformsLib.init();const overhead=new T.RectAreaLight('#fff8ee',2.8,2.1,6.7);overhead.position.set(-1,5,0);overhead.lookAt(0,0,0);scene.add(overhead);
 const key=new T.DirectionalLight('#fff4ea',.85);key.position.set(-3,7,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.1,far:20});key.shadow.normalBias=.002;key.shadow.bias=-.0001;key.shadow.radius=4;const sky=new T.HemisphereLight('#e1edff','#292c33',.50);scene.add(key,sky);
 const sideFill=new T.RectAreaLight('#f6f3ed',1.95,5.8,1.45);sideFill.position.set(-4,2.1,1);sideFill.lookAt(0,.4,0);scene.add(sideFill);
 const fill=new T.RectAreaLight('#d8e1ef',1.6,2.3,5.5);fill.position.set(5,3,-4);fill.lookAt(0,.4,0);scene.add(fill);
 const floor=new T.Mesh(new T.PlaneGeometry(150,150),new T.MeshStandardMaterial({color:'#0c121b',roughness:.79,metalness:.03,envMapIntensity:.025}));floor.rotation.x=-Math.PI/2;floor.position.y=-.012;floor.receiveShadow=true;scene.add(floor);
 const sweep:T.Vector2[]=[];
 for(let i=0;i<=14;i++){const a=i*Math.PI/28;sweep.push(new T.Vector2(19+6*Math.sin(a),stageOffset-.014+6*(1-Math.cos(a))));}
 sweep.push(new T.Vector2(25,22));
 const cyclorama=new T.Mesh(new T.LatheGeometry(sweep,64),new T.MeshStandardMaterial({color:'#131a24',roughness:.92,side:T.BackSide,envMapIntensity:.08}));scene.add(cyclorama);
 const mirror=new Reflector(new T.PlaneGeometry(150,150),{textureWidth:768,textureHeight:768,color:0x151b23,clipBias:.001});mirror.rotation.x=-Math.PI/2;mirror.position.y=-.01;
 const mirrorMaterial=mirror.material as T.ShaderMaterial;
 // A subdued, slightly blurred studio reflection; no extra pass during racing.
 mirrorMaterial.fragmentShader=mirrorMaterial.fragmentShader.replace('vec4 base = texture2DProj( tDiffuse, vUv );',`vec4 base = vec4(0.0); for(int x=-1;x<=1;x++){for(int y=-1;y<=1;y++){vec4 uv=vUv;uv.xy+=vec2(float(x),float(y))*.004*uv.w;base+=texture2DProj(tDiffuse,uv)/9.0;}}`);
 mirrorMaterial.uniforms.reflectionOpacity={value:.14};
 mirrorMaterial.transparent=true;mirrorMaterial.fragmentShader='uniform float reflectionOpacity;\n'+mirrorMaterial.fragmentShader.replace('gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );','gl_FragColor = vec4( base.rgb * vec3(.80,.84,.89), reflectionOpacity );');scene.add(mirror);
 // Soft contact occlusion strengthens contact without a full-resolution SSAO pass.
 const contact={value:null as T.Texture|null};let disposed=false;
 const shadow=new T.Mesh(new T.PlaneGeometry(4,7),new T.ShaderMaterial({uniforms:{ao:contact},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform sampler2D ao;varying vec2 vUv;void main(){float a=1.-texture2D(ao,vUv).r;gl_FragColor=vec4(0.,0.,0.,a*.92);}',transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.001;shadow.visible=false;scene.add(shadow);
 const contactReady=new Promise<boolean>(resolve=>{
  new T.TextureLoader().load(contactURL,tex=>{
   if(disposed){tex.dispose();resolve(false);return;}
   tex.flipY=false;contact.value=tex;shadow.visible=true;resolve(true);
  },undefined,()=>resolve(false));
 });
 floor.position.y+=stageOffset;mirror.position.y+=stageOffset;shadow.visible=stageOffset===0;
 if(view==='front-corner'){
  const fill=new T.RectAreaLight('#fffaf3',3.25,1.30,.62);
  fill.position.set(-1.91,.78,2.52);fill.lookAt(-.785,.241,2.41);scene.add(fill);
  const slot=new T.RectAreaLight('#fffaf2',0.219,.37,.065);
  slot.position.set(.31,.52,2.17);slot.lookAt(-.21,.206,2.36);scene.add(slot);
  const bead=new T.RectAreaLight('#fffaf4',15.703,.051,.086);
  bead.position.set(-1.493,0.6104,1.6094);bead.lookAt(-.980,.198,1.413);scene.add(bead);
 }
 if(view==='rear-wing'||view==='steering'){
  const rear=view==='rear-wing';
  const strip=new T.RectAreaLight('#f4f0ea',rear?3.769:.82,rear?1.8:.68,rear?.38:.23);
  if(rear){
   strip.position.set(-1.55,1.85,-3.95);strip.lookAt(0,.42,-2.82);
   const diffuserPanel=new T.RectAreaLight('#f6f5f2',0.752,.88,.32);
   diffuserPanel.position.set(0.434,0.837,-1.987);
   diffuserPanel.lookAt(-.38,.43,-2.15);
   scene.add(diffuserPanel);
   // The broad return from the service bay crosses the deck behind the vanes.
   const deck=new T.RectAreaLight('#fffbf5',3.401,.60,.30);
   deck.position.set(0.876,1.385,-1.505);deck.lookAt(0,.25,-2.90);scene.add(deck);
   function addReflectionCard(color:string,intensity:number,width:number,height:number,
                              position:T.Vector3Tuple,focus:T.Vector3Tuple,axis:T.Vector3Tuple){
    const card=new T.RectAreaLight(color,intensity,width,height);
    card.position.fromArray(position);
    const normal=card.position.clone().sub(new T.Vector3(...focus)).normalize();
    const tangent=new T.Vector3(...axis);
    tangent.addScaledVector(normal,-tangent.dot(normal)).normalize();
    card.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(tangent,normal.clone().cross(tangent),normal));
    scene.add(card);
   }
   addReflectionCard('#fff8f2',9.5,.44,.12,[.224,1.799,-1.910],[.202,1.098,-1.856],[-.19,.06,.34]);
   addReflectionCard('#fff8ef',1.366,1,.043,[-.60,0.516,-3.695],[-.245,0.300,-3.132],[.05,.01,1]);
  }
  else{
   strip.position.set(.22,1.07,-.4);strip.lookAt(0,.46,.09);
   for(const [x,y,z,tx,ty,tz,width,height,power] of [[-.1809,.5489,.0657,-.158,.535,.099,.011,.015,.56],[-.073,.400,-.052,.156,.524,.116,.11,.043,.46],[-.0735,.3207,-.0722,-.0812,.3182,-.0157,.044,.006,3.2110],[.2947,.7213,.1422,.0882,.599,.144,.128,.022,.17],[-.1273,.7695,-.0335,-.1066,.5999,.135,.155,.013,.19],[.0575,.3471,-.0380,.050,.3095,-.045,.011,.018,3.5842]]){
    const gripStrip=new T.RectAreaLight('#f4f0ea',power,width,height);
    gripStrip.position.set(x,y,z);gripStrip.lookAt(tx,ty,tz);scene.add(gripStrip);
   }
  }
  scene.add(strip);
 }
 const claySoftboxes=[overhead,sideFill,fill].map(light=>({light,power:light.intensity}));
 function setStageFinish(finish:Finish){
  const assembled=finish==='wireframe'&&stageOffset===0;
  const servicePhoto=view==='rear-wing'&&finish==='colour';
  const releasedClay=view==='clay-breakdown'&&finish==='clay';
  floor.material.color.set(assembled?'#04111d':servicePhoto?'#030b12':releasedClay?'#031421':'#0c121b');
  if(view==='front-corner'){
   // Cross-light the slot and the near dish while retaining detail in the printed ink.
   const photo=finish==='colour';
   key.intensity=photo?0.542:.85;
   sky.intensity=photo?0.448:.50;
   sideFill.intensity=photo?1.388:1.95;
   overhead.intensity=photo?1.271:2.8;
  }
  if(view==='clay-breakdown'){
   if(releasedClay)key.position.set(-3.2568,4.89,2.1320);
   else key.position.set(-3,7,4);
   key.intensity=releasedClay?1.8888:.85;
   sky.intensity=.50*(releasedClay?0.7804:1);
   scene.environmentIntensity=.79*(releasedClay?.88:1);
   for(const {light,power} of claySoftboxes)light.intensity=power*(releasedClay?.63:1);
   key.shadow.needsUpdate=true;
  }
  if(assembled)floor.material.color.multiplyScalar(1.22);
  mirrorMaterial.uniforms.reflectionOpacity.value=assembled?.19:servicePhoto?.084:releasedClay?0.0578:.14;
  floor.material.roughness=assembled?.90:.79;
  floor.material.metalness=assembled?.12:.03;
 }
 return {scene,contactReady,setStageFinish,dispose(){disposed=true;cyclorama.geometry.dispose();cyclorama.material.dispose();env.dispose();key.shadow.dispose();mirror.dispose();floor.geometry.dispose();(floor.material as T.Material).dispose();shadow.geometry.dispose();shadow.material.dispose();contact.value?.dispose();}};
}
