import * as T from 'three';
import {constructors} from './grid';
import type {Constructor} from './pit-service';

const one=new T.Vector3(1,1,1);
type Limb='Arm'|'Leg';
// A-pose stations match the welded Blender source in build_service_suit.py.
export function suitFabric(source:T.MeshStandardMaterial,team:Constructor){
 const ferrari=team==='Ferrari',mercedes=team==='Mercedes',label=document.createElement('canvas');label.width=384;label.height=192;
 const ctx=label.getContext('2d')!;ctx.textAlign='center';ctx.fillStyle='#f2f0e6';
 ctx.font='italic bold 54px Arial';ctx.fillText(mercedes?'PETRONAS':team,192,76);
 ctx.font='bold 23px Arial';ctx.fillStyle=ferrari?'#e5c952':constructors[team][1];
 ctx.fillText(ferrari?'SCUDERIA FERRARI':mercedes?'AMG MOTORSPORT':'PIT CREW',192,122);
 const patch=new T.CanvasTexture(label);patch.colorSpace=T.SRGBColorSpace;patch.anisotropy=4;
 const fabric=source.clone();fabric.addEventListener('dispose',()=>patch.dispose());fabric.color.set(ferrari?'#bc392f':mercedes?'#313a3d':constructors[team][0]);fabric.roughness=.95;
 fabric.onBeforeCompile=shader=>{
  shader.vertexShader='varying vec3 restCloth;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nrestCloth=position;');
  shader.uniforms.seamColor={value:new T.Color(constructors[team][1])};shader.uniforms.teamPatch={value:patch};
  shader.fragmentShader='uniform vec3 seamColor;uniform sampler2D teamPatch;varying vec3 restCloth;\n'+shader.fragmentShader.replace('#include <map_fragment>',`
   vec2 labelUV=vec2(.5-restCloth.x/.28,(restCloth.y-.28)/.129);
   if(restCloth.z<-.056 && all(greaterThan(labelUV,vec2(0.))) && all(lessThan(labelUV,vec2(1.)))){
    vec4 ink=texture2D(teamPatch,labelUV);diffuseColor.rgb=mix(diffuseColor.rgb,ink.rgb,ink.a);
   }
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
