import * as T from 'three';
import {constructors} from './grid';
import type {Constructor} from './pit-service';

const one=new T.Vector3(1,1,1);
type Limb='Arm'|'Leg';
// A-pose stations match the welded Blender source in build_service_suit.py.
export function suitFabric(source:T.MeshStandardMaterial,team:Constructor){
 const ferrari=team==='Ferrari',mercedes=team==='Mercedes',label=document.createElement('canvas');label.width=384;label.height=192;
 const sponsors:Record<Constructor,string>={Ferrari:'Shell',Mercedes:'PETRONAS',McLaren:'OKX','Red Bull Racing':'ORACLE','Racing Bulls':'VISA',Alpine:'BWT',Haas:'TOYOTA',Audi:'Revolut',Williams:'BARCLAYS','Aston Martin':'aramco',Cadillac:'TWG'};
 const ctx=label.getContext('2d')!;ctx.textAlign='center';
 ctx.fillStyle='#162025';ctx.fillRect(6,14,372,158);
 ctx.fillStyle=constructors[team][0];ctx.fillRect(8,15,368,10);
 ctx.fillStyle='#fffaf1';ctx.font='italic bold 64px Arial';ctx.fillText(sponsors[team],192,93,348);
 ctx.font='bold 31px Arial';ctx.fillText(team.toUpperCase(),192,144,345);
 const patch=new T.CanvasTexture(label);patch.colorSpace=T.SRGBColorSpace;patch.anisotropy=4;
 const fabric=source.clone();fabric.addEventListener('dispose',()=>patch.dispose());fabric.color.set(ferrari?'#bc392f':mercedes?'#313a3d':constructors[team][0]);fabric.roughness=.95;
 fabric.onBeforeCompile=shader=>{
  shader.vertexShader='varying vec3 restCloth;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nrestCloth=position;');
  shader.uniforms.seamColor={value:new T.Color(constructors[team][1])};shader.uniforms.teamPatch={value:patch};
  shader.fragmentShader='uniform vec3 seamColor;uniform sampler2D teamPatch;varying vec3 restCloth;\n'+shader.fragmentShader.replace('#include <map_fragment>',`
   #include <map_fragment>
   bool sleeve=abs(restCloth.x)>.217;
   bool chest=restCloth.z>0.;
   float torsoArc=atan(restCloth.x,abs(restCloth.z));
   vec2 labelUV=vec2(.5+(chest?1.:-1.)*torsoArc/1.53,(restCloth.y-.279)/(chest?.098:.119));
   if(sleeve){
    // Around the outward normal, screen-right is -Z on the right arm and +Z on the left.
    float armOut=dot(vec2(abs(restCloth.x)-.166,restCloth.y-.425),vec2(.73,.68));
    float armDepth=restCloth.z-(.425-restCloth.y)*.11;
    float arc=atan(-sign(restCloth.x)*armDepth,armOut);
    labelUV=vec2(.5+arc/1.76,(restCloth.y-.266)/.084);
   }
   if(all(greaterThan(labelUV,vec2(0.))) && all(lessThan(labelUV,vec2(1.)))){
    vec4 ink=texture2D(teamPatch,labelUV);diffuseColor.rgb=mix(diffuseColor.rgb,ink.rgb,ink.a);
   }
   vec2 quilting=vec2(restCloth.y+restCloth.x*.56,restCloth.y-restCloth.x*.56)*21.;
   vec2 edge=abs(fract(quilting)-.5);float quilt=1.-smoothstep(.012,.042+fwidth(quilting.y),min(edge.x,edge.y));
   diffuseColor.rgb*=1.-.19*quilt;
   float seam=restCloth.y-.421+.32*abs(restCloth.x);
   if(abs(restCloth.x)<.238 && abs(seam)<.006)diffuseColor.rgb=mix(diffuseColor.rgb,seamColor,.81);
   vec2 thread=vec2(dot(restCloth,vec3(443.,151.,77.)),dot(restCloth,vec3(-111.,457.,87.)));
   float weave=sin(thread.x*6.283)*sin(thread.y*6.283);
   diffuseColor.rgb*=1.+.035*weave*(1.-smoothstep(.2,.7,max(fwidth(thread.x),fwidth(thread.y))));
  `);
 };fabric.customProgramCacheKey=()=>'constructor-service-patch';return fabric;
}
export function serviceSuit(source:T.SkinnedMesh,material:T.Material){
 const bones=source.skeleton.bones.map(b=>{const copy=new T.Bone();copy.name=b.name;copy.matrixAutoUpdate=false;return copy;});
 const parts=new Map(bones.map(b=>[b.name,b]));
 const mesh=new T.SkinnedMesh(source.geometry,material);mesh.morphTargetDictionary={...source.morphTargetDictionary};mesh.add(...bones);
 mesh.bind(new T.Skeleton(bones,bones.map(()=>new T.Matrix4())),new T.Matrix4());
 mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;
 const rest=new Map<string,{anchor:T.Vector3;axis:T.Vector3}>();
 for(const side of [-1,1])for(const limb of ['Arm','Leg'] as const){
  const arm=limb==='Arm',tag=side<0?'L':'R';
  const anchor=new T.Vector3(side*(arm?.166:.097),arm?.425:0,0);
  const axis=arm?new T.Vector3(side*.68,-.725,.08):new T.Vector3(side*.16,-.987,.02);
  axis.normalize();rest.set(limb+tag,{anchor,axis});rest.set((arm?'Fore':'Shin')+tag,{anchor:anchor.clone().addScaledVector(axis,arm?.31:.43),axis});
 }
 const point=new T.Vector3(),neutral=new T.Vector3(),swing=new T.Quaternion(),body=new T.Quaternion();
 function poseBone(name:string,base:T.Vector3,direction:T.Vector3){
  const {anchor,axis}=rest.get(name)!;
  neutral.copy(axis).applyQuaternion(body);swing.setFromUnitVectors(neutral,direction).multiply(body);
  point.copy(anchor).applyQuaternion(swing).negate().add(base);
  parts.get(name)!.matrix.compose(point,swing,one);
 }
 return {mesh,core(hips:T.Vector3,q:T.Quaternion){body.copy(q);parts.get('Core')!.matrix.compose(hips,q,one);},
  limb(name:Limb,side:number,base:T.Vector3,joint:T.Vector3,upper:T.Vector3,lower:T.Vector3,bend:number){
   const tag=side<0?'L':'R';poseBone(name+tag,base,upper);poseBone((name==='Arm'?'Fore':'Shin')+tag,joint,lower);
   const morph=mesh.morphTargetDictionary!['Flex'+name+tag];mesh.morphTargetInfluences![morph]=T.MathUtils.smoothstep(bend,.45,2.15);
  }};
}
