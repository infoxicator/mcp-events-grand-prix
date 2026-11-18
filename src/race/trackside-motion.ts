import * as T from 'three';

/** Skin the Blender instances in the vertex shader. All parts of a seated
 * person have the same instance origin, so skin, clothes and cap share a pose. */
export function tracksideMotion(){
 const clock={value:0},carA={value:new T.Vector2()},carB={value:new T.Vector2()};
 const green={value:new T.Vector2()},finish={value:0};
 function bind(material:T.MeshStandardMaterial){
  const name=material.name,seated=name.startsWith('Spectator')||name.startsWith('Seated');
  const marshal=name==='MarshalUniform'||name==='FinishUniform';
  if(!seated&&!marshal&&name!=='PitCrewUniform')return;
  if(material.userData.articulated)return;
  material.userData.articulated=true;
  material.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,{actorTime:clock,actorCarA:carA,actorCarB:carB,greenLaps:green,finishSignal:finish});
   const deform=seated?`
    float torso=smoothstep(.19,.55,p.y);
    yawPart(p,n,vec3(0.,.52,.018),nod*.31*torso+headTurn*smoothstep(.58,.66,p.y));
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
  };
  material.customProgramCacheKey=()=>'trackside-'+name;
 }
 return {bind,update(time:number,a:T.Vector3,b:T.Vector3,openingA:boolean,openingB:boolean,finished:boolean){
  clock.value=time;carA.value.set(a.x,a.z);carB.value.set(b.x,b.z);
  green.value.set(+openingA,+openingB);finish.value=+finished;
 }};
}
