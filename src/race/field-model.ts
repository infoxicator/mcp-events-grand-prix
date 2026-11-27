import {MeshResources} from './mesh-resources';
import {finishRotor} from './brake-rotor';
import {cornerService,jackLift} from './pit-service';
import tyrePrintURL from './assets/slick-print.png?url';
import {applyLivery} from './liveries';
import * as T from 'three';
import {constructorKit,trimMesh} from './constructor-trim';
import {embeddedGLB} from './embedded-glb';
import {compoundColors,grid, gridSlot, opponents, paints, type FieldCar} from './grid';
import type {Track} from './track';
import nearURL from './assets/field-near.glb.gz?url';
import fieldURL from './assets/field.glb.gz?url';

// Keep the wing, endplates and supports together as the same car crosses LODs.
// The transform is in chassis space, so wheel contacts and stance stay fixed.
function prepareAero(geometry:T.BufferGeometry,fixedProfile?:number){
 if(fixedProfile===0)return;
 const positions=geometry.getAttribute('position'),smooth=T.MathUtils.smoothstep;
 const deltas=fixedProfile===undefined?new Int16Array(positions.count*3):null;
 for(let i=0;i<positions.count;i++){
  const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),width=Math.abs(x);
  const onWheel=width>.54&&(y-.36)**2+(z+2.05)**2<.375**2;
  const tail=onWheel?0:smooth(-z,2.09,2.22)*smooth(y,.43,.77);
  const tip=smooth(width,.58,.77);
  const flap=smooth(width,.42,.95)*smooth(z,2.02,2.22)*smooth(y,.115,.26);
  const pod=smooth(width,.38,.69)*smooth(y,.26,.53)*(1-smooth(z,.63,.94))*smooth(z,-1.69,-.64);
  const nose=smooth(z,.54,1.18)*(1-smooth(z,2.48,2.72))*(1-smooth(width,.19,.32))*smooth(y,.20,.37);
  // A dished span, level span and crowned span share the same mounting
  // points. Carry the profile into the end fence and its aft corner.
  const span=smooth(width,.17,.76);
  const cover=smooth(y,.79,1.02)*smooth(z,-2.16,-1.64)*(1-smooth(z,-.61,-.43))*(1-smooth(width,.2,.38));
  const dx=x*.48*cover-Math.sign(x)*pod*.054-x*nose*.21+Math.sign(x)*tail*span*.043;
  const dy=.084*cover+tail*(.035+.15*span*span)+flap*.077+pod*.047+nose*.037;
  const dz=.080*cover+tail*(.055-.23*tip*smooth(y,.60,.98))-flap*.126;
  if(deltas){
   deltas[i*3]=Math.round(dx*32767);deltas[i*3+1]=Math.round(dy*32767);deltas[i*3+2]=Math.round(dz*32767);
  }else positions.setXYZ(i,x+dx*fixedProfile!,y+dy*fixedProfile!,z+dz*fixedProfile!);
 }
 if(deltas)geometry.setAttribute('aeroDelta',new T.Int16BufferAttribute(deltas,3,true));
}
function shapeAero(material:T.Material){
 const existing=material.onBeforeCompile,key=material.customProgramCacheKey();
 material.onBeforeCompile=(shader,renderer)=>{
  existing.call(material,shader,renderer);
  shader.vertexShader='attribute float rearProfile; attribute vec3 aeroDelta;\n'+shader.vertexShader
   .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed+=rearProfile*aeroDelta;');
 };
 material.customProgramCacheKey=()=>key+'-aero-profile';
}

// The two Blender circuits contain the original twenty painted boxes.
function extraGridBoxes(track:Track,heightAt:(distance:number)=>number){
 const vertices:number[]=[];
 function stripe(d0:number,d1:number,left:number,right:number){
  for(const [d,offset] of [[d0,left],[d1,left],[d1,right],[d0,left],[d1,right],[d0,right]]){
   const p=track.pointAt(d,offset);vertices.push(p.x,heightAt(d)+.05,p.z);
  }
 }
 for(const entry of grid.slice(20)){
  const slot=gridSlot(entry),line=slot.distance+3;
  stripe(line,line+.12,slot.offset-1.1,slot.offset+1.1);
  stripe(line-4,line,slot.offset-1.1,slot.offset-1);
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();
 return new T.Mesh(geometry,new T.MeshStandardMaterial({color:'#dddeda',roughness:.9,side:T.DoubleSide}));
}
function spinRims(material:T.Material){
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute vec2 wheelMotion;\n'+shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
   vec2 axle=vec2(.36,position.z>0.?1.55:-2.05);
   vec2 radial=position.yz-axle;
   bool rim=abs(position.x)>.90 && length(radial)<.236;
   float a=wheelMotion.x;
   mat2 turn=mat2(cos(a),sin(a),-sin(a),cos(a));
   if(rim)objectNormal.yz=turn*objectNormal.yz;`).replace('#include <begin_vertex>',`#include <begin_vertex>
    if(rim)transformed.yz=axle+turn*radial;`);
 };
}
// The close field asset batches each material across all four wheels. Mask
// a corner in both passes while its mechanics carry the wheel off the axle.
function serviceWheels(material:T.Material){
 const original=material.onBeforeCompile,key=material.customProgramCacheKey();
 material.onBeforeCompile=(shader,renderer)=>{
  original.call(material,shader,renderer);
  shader.vertexShader='attribute float removedWheels; varying vec3 servicePoint; flat varying int removed;\n'+shader.vertexShader
   .replace('#include <begin_vertex>','#include <begin_vertex>\nservicePoint=position;removed=int(removedWheels);');
  shader.fragmentShader='varying vec3 servicePoint; flat varying int removed;\n'+shader.fragmentShader
   .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
    if(removed!=0){
     int corner=(servicePoint.z>0.?0:2)+(servicePoint.x>0.?1:0);
     float radial=length(servicePoint.yz-vec2(.36,servicePoint.z>0.?1.55:-2.05));
     if((removed & (1<<corner))!=0 && abs(servicePoint.x)>.64 && radial<.38)discard;
    }`);
 };
 material.customProgramCacheKey=()=>key+'-service-wheels';
}
export function createField(track:Track,heightAt:(distance:number)=>number,paintSheet:T.Texture,surfaceWater={value:0}){
 const loadingAssets=new AbortController();
 const root=new T.Group(),pose=new T.Object3D(),inkMap=new T.TextureLoader().load(tyrePrintURL);
 inkMap.colorSpace=T.SRGBColorSpace;inkMap.anisotropy=import.meta.env.MCP_APP==='true'?4:8;
 const gridBoxes=extraGridBoxes(track,heightAt);const signage=new T.Group();signage.add(gridBoxes);
 const frustum=new T.Frustum(),projection=new T.Matrix4(),bounds=new T.Sphere(new T.Vector3(),3.6);
 const level=()=>({batches:[] as T.InstancedMesh[],palettes:[] as T.Color[][],
  entries:new Int16Array(opponents.length).fill(-1),
  wheels:new T.InstancedBufferAttribute(new Float32Array(opponents.length*2),2),
  controls:new T.InstancedBufferAttribute(new Float32Array(opponents.length*2),2),
  forms:new T.InstancedBufferAttribute(new Float32Array(opponents.length),1),
  rows:new T.InstancedBufferAttribute(new Float32Array(opponents.length),1),
  count:0,dirty:false,shadowCount:0});
 const removedWheels=new T.InstancedBufferAttribute(new Float32Array(opponents.length),1);
 const rotorHeat=new T.InstancedBufferAttribute(new Float32Array(opponents.length),1);
 const lastDistance=new Float64Array(opponents.length).fill(NaN),lastSpeed=new Float32Array(opponents.length),heat=new Float32Array(opponents.length);
 const far=level(),close=level(),wasClose=new Uint8Array(opponents.length);
 let disposed=false,ready=false,error:string|null=null;
 const compoundColor=new T.Color();
 const centres=opponents.map(()=>new T.Vector3());
 const order=new Int16Array(opponents.length);
 const visibleInCamera=new Uint8Array(opponents.length);
 const rows=opponents.map(entry=>grid.indexOf(entry));
 const profiles=opponents.map(e=>'Field'+e.team.replaceAll(' ',''));
 const farModules=profiles.map(name=>name.replace('Field','Far'));
 // Signed airbox and wing families, shared by the base mesh, trim and shadow at either LOD.
 const shapes:Record<(typeof grid)[number]['team'],number>={Mercedes:.82,'Aston Martin':.68,Williams:.90,Alpine:1,Ferrari:0,Haas:-.68,Audi:-1,Cadillac:-.9,McLaren:.18,'Red Bull Racing':-.18,'Racing Bulls':0};
 const strengths=opponents.map(e=>shapes[e.team]),modules=new Map<string,T.InstancedMesh>();
 const loaded=Promise.allSettled([embeddedGLB(fieldURL,true,loadingAssets.signal),embeddedGLB(nearURL,true,loadingAssets.signal),constructorKit()] as const).then(([low,high,library])=>{
  const sources=new MeshResources();
  if(low.status==='fulfilled')sources.collect(low.value.scene);
  if(high.status==='fulfilled')sources.collect(high.value.scene);
  if(disposed||low.status==='rejected'||high.status==='rejected'||library.status==='rejected'){
   sources.dispose();
   if(!disposed)throw (low.status==='rejected'?low.reason:high.status==='rejected'?high.reason:library.status==='rejected'?library.reason:undefined);
   return;
  }
  const scene=low.value.scene,nearScene=high.value.scene,kit=library.value;
  {
   const art=document.createElement('canvas');art.width=256;art.height=144;
   const ctx=art.getContext('2d')!;ctx.fillStyle='#dfded1';ctx.fillRect(0,0,256,144);
   ctx.fillStyle='#192126';ctx.textAlign='center';ctx.font='bold 30px Arial';ctx.fillText('LEGACY',128,42);
   ctx.font='bold 86px Arial';ctx.fillText('DRS',128,123);
   const map=new T.CanvasTexture(art);map.flipY=false;map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
   const geometry=(kit.getObjectByName('RulesBoard') as T.Mesh).geometry.clone();
   const boards=new T.InstancedMesh(geometry,new T.MeshStandardMaterial({map,vertexColors:true,roughness:.94,side:T.FrontSide}),track.DRS_ZONES.length);
   for(const [i,zone] of track.DRS_ZONES.entries()){
    const d=zone.start,p=track.pointAt(d,track.trackHalfWidth(d)+(track.night?1.55:2.4)),t=track.tangentAt(d);
    pose.position.set(p.x,heightAt(d)+.04,p.z);pose.rotation.set(0,Math.atan2(t.x,t.z),0);pose.updateMatrix();boards.setMatrixAt(i,pose.matrix);
   }
   boards.name='Legacy DRS activation';signage.add(boards);
  }
  for(const type of [...new Set([...profiles,...farModules]),'Contact','BrightWheelFaces']){
   const mesh=trimMesh(kit,type,'#ffffff'),batch=new T.InstancedMesh(mesh.geometry,mesh.material,opponents.length);
   if(type==='BrightWheelFaces'){
    batch.geometry.setAttribute('removedWheels',new T.InstancedBufferAttribute(new Float32Array(opponents.length),1));
    batch.geometry.setAttribute('wheelMotion',new T.InstancedBufferAttribute(new Float32Array(opponents.length*2),2));
    spinRims(mesh.material);serviceWheels(mesh.material);
   }
   if(type!=='Contact'&&type!=='BrightWheelFaces'){
    batch.geometry.setAttribute('liveryRow',new T.InstancedBufferAttribute(new Float32Array(opponents.length),1));
    applyLivery(mesh.material as T.MeshStandardMaterial,paintSheet,true,0,false,true);
    const angles=new T.InstancedBufferAttribute(new Float32Array(opponents.length),1);
    batch.geometry.setAttribute('fieldFlapAngle',angles);
    const livery=mesh.material.onBeforeCompile,key=mesh.material.customProgramCacheKey();
    mesh.material.onBeforeCompile=(shader,renderer)=>{
     livery.call(mesh.material,shader,renderer);
     shader.vertexShader='attribute float fieldFlapAngle;\n'+shader.vertexShader.replace('#include <project_vertex>',`
      if(flapUV.x>=0.){
       vec2 hinge=vec2(.87,-2.42);float a=fieldFlapAngle;
       transformed.yz=hinge+mat2(cos(a),sin(a),-sin(a),cos(a))*(transformed.yz-hinge);
      }
      #include <project_vertex>`);
    };
    mesh.material.customProgramCacheKey=()=>key+'-moving-flap';
    prepareAero(mesh.geometry,strengths[profiles.indexOf(type.replace(/^Far/,'Field'))]);
   }
   batch.frustumCulled=false;batch.count=0;batch.receiveShadow=type!=='Contact';modules.set(type,batch);root.add(batch);
  }
  for(const [source,tier] of [[scene,far],[nearScene,close]] as const)source.traverse(obj=>{
   const near=tier===close;
   if(!(obj instanceof T.Mesh))return;
   const trim=obj.name==='Trim',paint=obj.name==='Paint';
   const shadow=obj.name==='UndertrayShadow';
   const enamel=obj.name==='HelmetTint'||obj.name==='Visor';
   const material=enamel?new T.MeshPhysicalMaterial({clearcoat:1,clearcoatRoughness:.12}):near&&paint?new T.MeshPhysicalMaterial({clearcoat:.38,clearcoatRoughness:.24,specularIntensity:.60}):
    new T.MeshStandardMaterial({vertexColors:trim||obj.name==='WheelMetal'||shadow,metalness:trim?.10:.17,roughness:trim?.79:.46});
   if(obj.name==='HelmetTint'){
    material.roughness=.27;material.metalness=.29;
    material.onBeforeCompile=shader=>{
     shader.vertexShader='varying vec3 helmetPoint;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nhelmetPoint=position;');
     shader.fragmentShader='varying vec3 helmetPoint;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float stripe=helmetPoint.y+.13*helmetPoint.z+.026*cos(helmetPoint.x*18.);
      float crown=abs(helmetPoint.x)-(.045+.018*sin((helmetPoint.z+.16)*13.));
      float width=max(.001,fwidth(stripe));
      float ribbon=1.-smoothstep(.009,.009+width,abs(stripe-.865));
      float spine=(1.-smoothstep(.009,.009+fwidth(crown),abs(crown)))*smoothstep(.86,.92,helmetPoint.y);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.014,.022,.037),max(ribbon,spine));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.91,.88,.78),1.-smoothstep(.003,.003+width,abs(stripe-.882)));`);
    };
   }
   if(obj.name==='Visor'){material.color.set('#2f414c');material.roughness=.075;material.metalness=.77;}
   if(shadow){material.transparent=true;material.depthWrite=false;material.polygonOffset=true;material.polygonOffsetFactor=-2;}
   if(near){
    // The Blender skin and thin foil returns have visible front and back faces.
    material.side=T.DoubleSide;
    if(paint){material.metalness=.48;material.roughness=.37;}
    if(obj.name==='Carbon'){material.color.set('#363d43');material.roughness=.50;material.metalness=.12;}
    if(obj.name==='BrakeRotor'){
     material.color.set('#544e48');material.metalness=.35;material.roughness=.62;
     obj.geometry.setAttribute('rotorHeat',rotorHeat);
     finishRotor(material);
    }
    if(obj.name==='WheelMetal'){
     material.roughness=.33;material.metalness=.64;
     obj.geometry.setAttribute('wheelMotion',tier.wheels);
     spinRims(material);
    }
    if(obj.name==='Tyre'){
     obj.geometry.setAttribute('wheelMotion',tier.wheels);
     material.color.set('#26272a');material.roughness=.91;material.metalness=0;
     material.onBeforeCompile=shader=>{
      shader.uniforms.sidewallInk={value:inkMap};shader.uniforms.surfaceWater=surfaceWater;
      shader.vertexShader='attribute vec2 wheelMotion; varying vec2 spin; varying vec3 tyrePoint;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntyrePoint=position;spin=wheelMotion;');
      shader.fragmentShader='uniform float surfaceWater; uniform sampler2D sidewallInk; varying vec2 spin; varying vec3 tyrePoint;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
       vec3 compound=vColor.rgb;diffuseColor.rgb=diffuse;
       float radius=length(vec2(tyrePoint.y-.36,tyrePoint.z-(tyrePoint.z>0.?1.55:-2.05)));
       float ring=1.-smoothstep(.0015,.003+fwidth(radius),min(abs(radius-.287),abs(radius-.316)));
       diffuseColor.rgb*=.88+.22*smoothstep(.25,.36,radius)+.23*ring;
       float band=1.-smoothstep(.003,.003+max(.0004,fwidth(radius)),abs(radius-.316));
       if(radius>.235 && abs(tyrePoint.x)>.91){
        vec2 radial=vec2((tyrePoint.z-(tyrePoint.z>0.?1.55:-2.05))*-sign(tyrePoint.x),tyrePoint.y-.36)/.729;
        float a=spin.x*-sign(tyrePoint.x),cs=cos(a),sn=sin(a);
        vec2 uv=mat2(cs,sn,-sn,cs)*radial;
        float arc=min(.43,spin.y/100.);
        float ink=0.,stripe=0.;
        for(int tap=-2;tap<=2;tap++){
         float t=float(tap)*arc*.25;
         vec2 point=mat2(cos(t),sin(t),-sin(t),cos(t))*uv;
         float coverage=texture2D(sidewallInk,.5+point).r;
         stripe+=.2*smoothstep(.51,.54,point.x*point.x/max(dot(point,point),.00001));
         ink+=clamp((coverage-.0176)/.879,0.,1.)*.2;
        }
        diffuseColor.rgb=mix(mix(diffuseColor.rgb,compound,band*stripe),vec3(.90),ink);
       }
      `).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
       float film=surfaceWater*(.26+.69*smoothstep(.343,.358,radius));
       roughnessFactor=mix(roughnessFactor,.24,film);
       diffuseColor.rgb*=1.-.30*film;
      `);
     };
    }
   }
   // The distance mesh batches carbon, wheels and suspension into Trim. Only
   // its endplate faces receive print, using the same atlas UVs as the close car.
   const printedEndplates=near?obj.name==='Carbon':trim;
   if(paint||obj.name==='Accent'||printedEndplates){
    obj.geometry.setAttribute('liveryRow',tier.rows);
    applyLivery(material,paintSheet,true,0,printedEndplates);
   }
   const batch=new T.InstancedMesh(obj.geometry,material,opponents.length),color=new T.Color();
   if(near&&(obj.name==='WheelMetal'||obj.name==='Tyre')){
    obj.geometry.setAttribute('removedWheels',removedWheels);serviceWheels(material);
    const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});
    serviceWheels(depth);batch.customDepthMaterial=depth;
   }
   // Allocate the final attribute layout before precompiling. Its presence
   // changes the Three.js program key even when the batch currently has no cars.
   batch.setColorAt(0,color.set('#ffffff'));
   if(['Trim','Carbon','Paint','Accent'].includes(obj.name)){
    prepareAero(obj.geometry);
    obj.geometry.setAttribute('rearProfile',tier.forms);
    shapeAero(material);
    const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});
    shapeAero(depth);batch.customDepthMaterial=depth;
   }
   if(near&&['Tyre','WheelMetal'].includes(obj.name)){
    obj.geometry.setAttribute('fieldControl',tier.controls);
    for(const surface of [material,batch.customDepthMaterial].filter((m):m is T.Material=>!!m)){
     const prior=surface.onBeforeCompile,key=surface.customProgramCacheKey();
     surface.onBeforeCompile=(shader,renderer)=>{
      prior.call(surface,shader,renderer);
      const motion=`if(position.z>.8){
       vec2 hub=vec2(sign(position.x)*.81,1.55);float a=fieldControl.x;
       transformed.xz=hub+mat2(cos(a),-sin(a),sin(a),cos(a))*(transformed.xz-hub);}`;
      shader.vertexShader='attribute vec2 fieldControl;\n'+shader.vertexShader.replace('#include <project_vertex>',motion+'\n#include <project_vertex>');
     };surface.customProgramCacheKey=()=>key+'-steer';
    }
   }
   batch.name='Field '+obj.name;batch.frustumCulled=false;
   batch.castShadow=!shadow;batch.receiveShadow=!shadow;batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
   batch.onBeforeShadow=()=>{batch.count=tier.shadowCount;};
   batch.onAfterShadow=()=>{batch.count=tier.count;};
   const palette=opponents.map(entry=>{
    const [primary,accent]=paints(entry);
    const tint=obj.name==='HelmetTint'?new T.Color().setHSL(entry.number*.137%1,.53,.52,T.SRGBColorSpace):color.set(entry.team==='Mercedes'&&paint?'#637278':entry.team==='Mercedes'&&obj.name==='Accent'?'#263439':obj.name==='Accent'?accent:paint?primary:'#ffffff');
    return tint.clone();
   });
   tier.palettes.push(palette);root.add(batch);tier.batches.push(batch);
  });sources.dispose(new MeshResources().collect(root));ready=true;
 }).catch(e=>{error=String(e);});
 return {root,signage,loaded,get ready(){return ready;},get error(){return error;},update(field:readonly FieldCar[]|undefined,camera:T.PerspectiveCamera,focus:T.Vector3,shadowExtent:number,mirror=false,balanced=false,drawShadows=true,viewHeight=0){
  root.visible=!!field?.length;if(!ready||!field)return;
  camera.updateMatrixWorld();frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  for(const batch of modules.values())batch.count=0;
  for(const tier of [far,close]){tier.count=0;tier.dirty=false;tier.shadowCount=0;}
  // Pack shadow casters first so the depth pass only draws that prefix.
  // Store spatial tests once for both material LODs and constructor modules.
  let casters=0,others=order.length;
  for(let i=0;i<field.length;i++){
   const c=field[i];if(c.finishTime!==null)continue;
   const p=track.pointAt(c.distance,c.offset),centre=centres[i];
   centre.set(p.x,heightAt(c.distance)+.55,p.z);bounds.center.copy(centre);
   const focusSq=centre.distanceToSquared(focus);
   visibleInCamera[i]=Number(frustum.intersectsSphere(bounds));
   if(drawShadows&&!mirror&&focusSq<((balanced?1:1.42)*shadowExtent+6)**2)order[casters++]=i;
   else if(visibleInCamera[i])order[--others]=i;
  }
  for(let k=0;k<order.length;k++){
   if(k>=casters&&k<others)continue;
   const i=order[k],c=field[i],inShadow=k<casters,inCamera=visibleInCamera[i];
   bounds.center.copy(centres[i]);
   const t=track.tangentAt(c.distance);pose.position.copy(bounds.center);pose.position.y-=.524;
   pose.rotation.set(Math.atan2(heightAt(c.distance-3)-heightAt(c.distance+3),6),Math.atan2(t.x,t.z)+(c.pitHeading??0)+(c.impactYaw??0),0,'YXZ');pose.updateMatrix();
   const distanceSq=bounds.center.distanceToSquared(camera.position);
   const stopped=c.pit==='stopped',seconds=track.PIT_STOP_SECONDS-(c.service??0);
   const movingRange=balanced?(wasClose[i]?24:19):(wasClose[i]?38:32);
   const pixelRange=viewHeight?viewHeight/(2*Math.tan(camera.fov*Math.PI/360))*2/48:Infinity;
   const range=mirror?(stopped?12:6):stopped?65:Math.min(movingRange,pixelRange);
   const travel=c.distance-lastDistance[i];
   if(!mirror&&travel>0&&travel<35){
    const decel=(lastSpeed[i]**2-c.speed**2)/(2*Math.max(.02,travel)),dt=travel/Math.max(2,c.speed);
    const goal=T.MathUtils.clamp(decel/23,0,1);heat[i]+=(goal-heat[i])*(-Math.expm1(-dt*(goal>heat[i]?5:.26)));
   }else if(!Number.isFinite(travel)||Math.abs(travel)>=35)heat[i]=0;
   if(!mirror){lastDistance[i]=c.distance;lastSpeed[i]=c.speed;}
   const near=(inCamera||stopped)&&distanceSq<range**2;
   if(!mirror)wasClose[i]=Number(near);
   const tier=near?close:far,slot=tier.count++;if(inShadow)tier.shadowCount++;
   let off=0;
   if(near){
    rotorHeat.setX(slot,stopped?Math.max(heat[i],.46*Math.exp(-seconds/4)):heat[i]);
    tier.controls.setXY(slot,stopped?0:T.MathUtils.clamp(-3.6*track.signedCurvatureAt(c.distance)+.45*(c.pitHeading??0),-.45,.45),!stopped&&c.speed>46&&track.isDrsZone(c.distance)?-.43:0);
    tier.wheels.setXY(slot,(c.distance/.36)%(2*Math.PI),c.speed);
    if(stopped)for(let w=0;w<4;w++)if(cornerService(seconds,w).off)off|=1<<w;
    removedWheels.setX(slot,off);
   }
   const module=modules.get(near?profiles[i]:farModules[i])!,contact=modules.get('Contact')!;
   contact.setMatrixAt(contact.count++,pose.matrix);
   if(stopped){pose.position.y+=jackLift({distance:c.distance,pit:c.pit,pitTime:seconds});pose.updateMatrix();}
   const row=module.geometry.getAttribute('liveryRow');
   if(row.getX(module.count)!==rows[i]){row.setX(module.count,rows[i]);row.needsUpdate=true;}
   module.geometry.getAttribute('fieldFlapAngle').setX(module.count,!stopped&&c.speed>46&&track.isDrsZone(c.distance)?-.43:0);
   module.setMatrixAt(module.count++,pose.matrix);
   if(opponents[i].team==='Cadillac'||opponents[i].team==='Racing Bulls'){
    const faces=modules.get('BrightWheelFaces')!;faces.geometry.getAttribute('removedWheels').setX(faces.count,off);
    faces.geometry.getAttribute('wheelMotion').setXY(faces.count,(c.distance/.36)%(2*Math.PI),c.speed);
    faces.setMatrixAt(faces.count++,pose.matrix);
   }
   for(const [j,batch] of tier.batches.entries()){
    batch.setMatrixAt(slot,pose.matrix);
    if(batch.name==='Field Tyre'){compoundColor.set(compoundColors[(stopped&&seconds<=1.66?c.previousCompound??c.compound:c.compound)??'medium']);const color=batch.instanceColor!;
     if(color.getX(slot)!==Math.fround(compoundColor.r)||color.getY(slot)!==Math.fround(compoundColor.g)||color.getZ(slot)!==Math.fround(compoundColor.b)){batch.setColorAt(slot,compoundColor);color.needsUpdate=true;}}
    else if(tier.entries[slot]!==i)batch.setColorAt(slot,tier.palettes[j][i]);
   }
   if(tier.entries[slot]!==i){tier.entries[slot]=i;tier.rows.setX(slot,rows[i]);
    tier.forms.setX(slot,strengths[i]);tier.dirty=true;}
  }
  if(close.count){removedWheels.needsUpdate=true;close.wheels.needsUpdate=true;close.controls.needsUpdate=true;rotorHeat.needsUpdate=true;}
  for(const m of modules.values()){m.visible=m.count>0;if(!m.count)continue;for(const name of ['wheelMotion','removedWheels','fieldFlapAngle']){const a=m.geometry.getAttribute(name);if(a)a.needsUpdate=true;}m.instanceMatrix.needsUpdate=true;}
  for(const tier of [far,close]){
   if(tier.dirty){tier.rows.needsUpdate=true;tier.forms.needsUpdate=true;}
   for(const batch of tier.batches){batch.castShadow=tier.shadowCount>0&&batch.name!=='Field UndertrayShadow';batch.count=tier.count;batch.visible=tier.count>0;if(!tier.count)continue;batch.instanceMatrix.needsUpdate=true;if(tier.dirty)batch.instanceColor!.needsUpdate=true;}
  }
 },dispose(){
  if(disposed)return;
  disposed=true;loadingAssets.abort();inkMap.dispose();root.removeFromParent();signage.removeFromParent();
  new MeshResources().collect(root).collect(signage).dispose();
  root.clear();signage.clear();modules.clear();far.batches.length=close.batches.length=0;
 }};
}
