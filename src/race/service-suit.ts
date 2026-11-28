import * as T from 'three';
import {constructors} from './grid';
import type {Constructor} from './pit-service';

type Limb='Arm'|'Leg';
// A-pose stations match the welded Blender source in build_service_suit.py.
export function suitFabric(source:T.MeshStandardMaterial,team:Constructor){
 const ferrari=team==='Ferrari',mercedes=team==='Mercedes',label=document.createElement('canvas');label.width=512;label.height=512;
 const sponsors:Record<Constructor,string>={Ferrari:'Shell',Mercedes:'PETRONAS',McLaren:'OKX','Red Bull Racing':'ORACLE','Racing Bulls':'VISA',Alpine:'BWT',Haas:'TOYOTA',Audi:'Revolut',Williams:'BARCLAYS','Aston Martin':'aramco',Cadillac:'TWG'};
 const ctx=label.getContext('2d')!;ctx.textAlign='center';
 ctx.fillStyle='#162025';ctx.fillRect(4,3,504,218);
 ctx.fillStyle=constructors[team][1];ctx.fillRect(4,4,504,13);
 ctx.fillStyle='#fffaf1';ctx.font='italic bold 91px Arial';ctx.fillText(sponsors[team],256,123,484);
 ctx.font='bold 48px Arial';ctx.fillText(team.toUpperCase(),256,191,478);
 ctx.fillStyle='#131d21';ctx.fillRect(0,256,512,64);ctx.fillStyle='#c8c8bf';ctx.fillRect(210,270,92,36);
 ctx.fillStyle=constructors[team][1];ctx.fillRect(0,336,512,19);ctx.fillRect(0,365,512,8);
 ctx.fillStyle='#ededda';ctx.fillRect(0,400,220,110);ctx.fillStyle='#1b2b38';
 ctx.font='italic bold 53px Arial';ctx.fillText('FIA',110,465);ctx.font='bold 19px Arial';ctx.fillText('8856-2018',110,491);
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
    vec4 ink=texture2D(teamPatch,vec2(labelUV.x,1.-(1.-labelUV.y)*.44));diffuseColor.rgb=mix(diffuseColor.rgb,ink.rgb,ink.a);
   }
   vec2 trimUV=vec2(-1.);
   if(restCloth.y>.106&&restCloth.y<.14&&abs(restCloth.x)<.185)trimUV=vec2(.5+torsoArc*.32,.375+(restCloth.y-.106)*3.66);
   if((sleeve&&restCloth.y>.217&&restCloth.y<.24)||(!sleeve&&restCloth.y<-.09&&abs(restCloth.x)>.17))
    trimUV=vec2(.5,.264+.08*fract(sleeve?(restCloth.y-.217)/.023:abs(restCloth.x)*31.));
   if(restCloth.z>.057&&abs(restCloth.x)<.046&&restCloth.y>.478&&restCloth.y<.518)
    trimUV=vec2((restCloth.x+.046)*4.6,(restCloth.y-.478)*5.3);
   if(trimUV.x>=0.){vec4 trim=texture2D(teamPatch,trimUV);diffuseColor.rgb=mix(diffuseColor.rgb,trim.rgb,trim.a);}
   vec2 quilting=vec2(restCloth.y+restCloth.x*.56,restCloth.y-restCloth.x*.56)*21.;
   vec2 edge=abs(fract(quilting)-.5);float quilt=1.-smoothstep(.012,.042+fwidth(quilting.y),min(edge.x,edge.y));
   diffuseColor.rgb*=1.-.19*quilt;
   float seam=restCloth.y-.421+.32*abs(restCloth.x);
   if(abs(restCloth.x)<.238 && abs(seam)<.006)diffuseColor.rgb=mix(diffuseColor.rgb,seamColor,.81);
   vec2 thread=vec2(dot(restCloth,vec3(443.,151.,77.)),dot(restCloth,vec3(-111.,457.,87.)));
   float weave=sin(thread.x*6.283)*sin(thread.y*6.283);
   diffuseColor.rgb*=1.+.035*weave*(1.-smoothstep(.2,.7,max(fwidth(thread.x),fwidth(thread.y))));
  `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   float nap=.00030*weave*(1.-smoothstep(.18,.6,max(fwidth(thread.x),fwidth(thread.y))))-.00070*quilt;
   vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
   vec3 tx=cross(dy,normal),ty=cross(normal,dx);
   float det=dot(tx,dx);
   normal=normalize(max(abs(det),1e-9)*normal-sign(det)*(dFdx(nap)*tx+dFdy(nap)*ty));
  `);
 };fabric.customProgramCacheKey=()=>'constructor-service-patch';return {fabric,patch};
}
export function serviceSuit(source:T.SkinnedMesh,material:T.Material,size:number){
 const scale=new T.Vector3(size,size,size);
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
  point.copy(anchor).multiplyScalar(size).applyQuaternion(swing).negate().add(base);
  parts.get(name)!.matrix.compose(point,swing,scale);
 }
 return {mesh,size,scale,core(hips:T.Vector3,pelvis:T.Quaternion,chest:T.Vector3,q:T.Quaternion,neck:T.Vector3,head:T.Quaternion){
   body.copy(q);parts.get('Core')!.matrix.compose(hips,pelvis,scale);
   parts.get('Chest')!.matrix.compose(chest,q,scale);
   point.set(0,-.49*size,0).applyQuaternion(head).add(neck);parts.get('Neck')!.matrix.compose(point,head,scale);
  },
  limb(name:Limb,side:number,base:T.Vector3,joint:T.Vector3,upper:T.Vector3,lower:T.Vector3,bend:number){
   const tag=side<0?'L':'R';poseBone(name+tag,base,upper);poseBone((name==='Arm'?'Fore':'Shin')+tag,joint,lower);
   const morph=mesh.morphTargetDictionary!['Flex'+name+tag];mesh.morphTargetInfluences![morph]=T.MathUtils.smoothstep(bend,.45,2.15);
  }};
}
