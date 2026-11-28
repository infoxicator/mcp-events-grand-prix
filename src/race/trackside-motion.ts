import * as T from 'three';

/** Skin the Blender instances in the vertex shader. All parts of a seated
 * person have the same instance origin, so skin, clothes and cap share a pose. */
export function tracksideMotion(night:boolean){
 const clock={value:0},carA={value:new T.Vector2()},carB={value:new T.Vector2()};
 const green={value:new T.Vector2()},finish={value:0},flag={value:new T.Color()},waveFlag={value:0},safetyBoard={value:0};
 function bind(material:T.MeshStandardMaterial){
  const name=material.name,seated=name==='PitWallEngineer'||name.startsWith('Spectator')||name.startsWith('Seated');
  const marshal=name==='MarshalUniform'||name==='FinishUniform';
  if(['SafetyBoard','GrandstandFlag'].includes(name)){
   material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{actorTime:clock,safetyBoard});
    shader.vertexShader='uniform float actorTime,safetyBoard;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
     #ifdef USE_INSTANCING
      vec3 origin=(modelMatrix*instanceMatrix[3]).xyz;
      ${name==='GrandstandFlag'?'transformed.z+=uv.x*.12*sin(actorTime*4.9+origin.x+uv.x*6.);':'transformed*=safetyBoard;'}
     #endif`);
   };
   material.customProgramCacheKey=()=>'track-prop-'+name;return;
  }
  if(!seated&&!name.endsWith('Uniform'))return;
  if(material.userData.articulated)return;
  material.userData.articulated=true;
  material.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,{actorTime:clock,actorCarA:carA,actorCarB:carB,greenLaps:green,finishSignal:finish,marshalFlag:flag,waveFlag});
   const deform=seated?`
    float torso=smoothstep(.19,.55,p.y);
    float pass=min(distance(origin.xz,actorCarA),distance(origin.xz,actorCarB));
    float cheer=max(finishSignal,(1.-smoothstep(15.,90.,pass))*(.5+.5*sin(pass*.09-actorTime*4.)));
    ${name==='PitWallEngineer'?'':'p.y+=nearby*torso*(.19*cheer+.20*finishSignal);p.z-=.085*torso*cheer;'}
    yawPart(p,n,vec3(0.,.52,.018),nod*.31*torso+headTurn*uv.y);
    lean(p,n,vec3(0.,.20,0.),nod*torso);
   `:`
    float group=floor(uv.x*3.+.5);
    if(group>1.5){
     float signal=${name==='FinishUniform'?'finishSignal':`max(greenLaps.x*(1.-smoothstep(65.,180.,distance(origin.xz,actorCarA))),greenLaps.y*(1.-smoothstep(65.,180.,distance(origin.xz,actorCarB))))`};
     float swing=${marshal?'mix(-1.14+.025*sin(slow),-.26+.67*sin(wave),signal)':'(.060*sin(slow*.87)+.047*sin(.46*slow+seed*9.))*nearby'};
     if(group>2.5){
      float fly=uv.y,phase=wave*1.62-6.3*fly;
      p.y+=fly*(.045+.14*signal)*sin(phase);
      p.z+=fly*(.045+.13*signal)*cos(phase+.4);
      n=normalize(n+vec3(0.,.28*sin(phase),.22*cos(phase))*fly);
     }
     lean(p,n,vec3(.183,1.39,0.),swing);
    }
    if(group>.5&&group<1.5)yawPart(p,n,vec3(0.,1.46,.01),headTurn);
    float torso=smoothstep(.77,1.40,p.y);
    lean(p,n,vec3(0.,.87,0.),nod*.72*torso);
    p.z+=torso*.011*sin(slow);
   `;
   shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
    uniform float actorTime,finishSignal;uniform vec2 actorCarA,actorCarB,greenLaps;
    mat2 turn2(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
    void lean(inout vec3 p,inout vec3 n,vec3 pivot,float a){mat2 m=turn2(a);p.xy=pivot.xy+m*(p.xy-pivot.xy);n.xy=m*n.xy;}
    void yawPart(inout vec3 p,inout vec3 n,vec3 pivot,float a){mat2 m=turn2(a);p.xz=pivot.xz+m*(p.xz-pivot.xz);n.xz=m*n.xz;}
    void tracksidePose(inout vec3 p,inout vec3 n){
     #ifdef USE_INSTANCING
      vec3 origin=(modelMatrix*instanceMatrix[3]).xyz;
      float nearby=1.-smoothstep(110.,175.,distance(origin,cameraPosition));
      ${seated?'if(nearby<=0.)return;':''}
      float seed=fract(sin(dot(origin.xz,vec2(.327,1.732)))*1735.2);
      float slow=actorTime*(1.03+.43*seed)+seed*48.;
      float wave=actorTime*(5.3+seed*.64)+seed*16.;
      float nod=(.041*sin(slow)+.025*sin(.47*slow+seed*14.))*nearby;
      float headTurn=(.21*sin(slow*.67+seed*23.)+.086*sin(slow*1.23))*nearby;
      ${deform}
     #endif
    }`).replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
     vec3 actorPosition=position;tracksidePose(actorPosition,objectNormal);`)
    .replace('#include <begin_vertex>','vec3 transformed=actorPosition;');
   if(marshal&&name!=='FinishUniform'){
    shader.vertexShader='uniform vec3 marshalFlag;uniform float waveFlag;\n'+shader.vertexShader.replace('#include <color_vertex>',`#include <color_vertex>
    #ifdef USE_COLOR
    if(uv.x>.86){vColor.rgb=marshalFlag;}
    #endif`).replace('float swing=mix','signal=max(signal,waveFlag);float swing=mix');
   }
   if(night&&(name==='MarshalUniform'||name==='PitCrewUniform')){
    shader.vertexShader='varying float reflectiveTape;\n'+shader.vertexShader.replace('#include <color_vertex>',`#include <color_vertex>
     reflectiveTape=0.;
     #ifdef USE_COLOR
      if(color.g>color.r && color.g>.52 && position.y<1.29)reflectiveTape=1.;
     #endif`);
    shader.fragmentShader='varying float reflectiveTape;\n'+shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
     #if NUM_SPOT_LIGHTS > 0
      if(reflectiveTape>.01){
       vec3 eye=normalize(vViewPosition);
       float retro=0.;
       for(int i=0;i<NUM_SPOT_LIGHTS;i++){
        vec3 lightDir=normalize(spotLights[i].position+vViewPosition);
        retro=max(retro,pow(max(0.,dot(eye,lightDir)),16.));
       }
       reflectedLight.directDiffuse*=1.+reflectiveTape*retro*2.8;
      }
     #endif`);
   }
   if(name==='GarageUniform'||name==='PitWallEngineer')shader.vertexShader=shader.vertexShader.replace('#include <color_vertex>',`#include <color_vertex>
    #if defined(USE_INSTANCING_COLOR) && defined(USE_COLOR)
     if(${name==='PitWallEngineer'?'uv.x>.1':'uv.y<.5'})vColor.rgb=color.rgb;
    #endif`);
   if(seated&&name!=='PitWallEngineer')shader.vertexShader=shader.vertexShader.replace('#include <color_vertex>',`#include <color_vertex>
    #if defined(USE_INSTANCING) && defined(USE_COLOR)
     vec2 seat=(modelMatrix*instanceMatrix[3]).xz;
     float hue=fract(sin(dot(seat,vec2(.861,1.97)))*4375.8);
     float tone=fract(sin(dot(seat,vec2(.42,2.41)))*3251.);
     float region=floor(uv.x*5.+.5);
     if(region<.5){
      vec3 kit=hue<.22?vec3(.60,.032,.025):hue<.39?vec3(.038,.13,.25):hue<.55?vec3(.76,.68,.56):hue<.68?vec3(.10,.22,.18):hue<.81?vec3(.085,.08,.11):hue<.92?vec3(.50,.21,.08):vec3(.30,.38,.48);
      vColor.rgb*=kit*(.74+.44*tone);
     }else if(region<1.5){
      #ifdef USE_MAP
       float portrait=floor(tone*4.);
       vMapUv+=vec2(.5*mod(portrait,2.),(256./544.)*floor(portrait*.5));
      #endif
      vColor.rgb*=mix(vec3(.84,.79,.75),vec3(1.16,1.11,1.05),tone);
     }
     else if(region<2.5)vColor.rgb*=mix(vec3(.22,.18,.16),vec3(2.7,2.3,1.85),hue);
     else if(region>3.5)vColor.rgb*=mix(vec3(.18,.22,.3),vec3(.66,.84,1.),hue);
     if(region>2.5&&region<3.5&&tone>.95){float flash=smoothstep(.996,.999,sin(actorTime*1.71+tone*85.));vColor.rgb+=vec3(2.8)*flash;}
    #endif`);
  };
  material.customProgramCacheKey=()=>'trackside-'+(marshal?name:seated?'spectator':'crew');
 }
 return {bind,update(time:number,a:T.Vector3,b:T.Vector3,openingA:boolean,openingB:boolean,finished:boolean,signal:string){
  clock.value=time;carA.value.set(a.x,a.z);carB.value.set(b.x,b.z);
  green.value.set(+openingA,+openingB);finish.value=+finished;waveFlag.value=Number(signal!=='GREEN');safetyBoard.value=Number(signal==='SC'||signal==='VSC');
  flag.value.setHex(signal==='GREEN'?0x18bd55:signal==='BLUE'?0x347bff:signal==='RED'?0xfe3324:signal==='WHITE'?0xffffff:0xffd02b);
 }};
}
