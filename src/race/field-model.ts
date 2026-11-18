import * as T from 'three';
import {embeddedGLB} from './embedded-glb';
import {grid, gridSlot, opponents, paints, type FieldCar} from './grid';
import type {Track} from './track';
import fieldURL from './assets/field.glb.gz?url&inline';

function numberAtlas(){
 const canvas=document.createElement('canvas');canvas.width=128*opponents.length;canvas.height=128;
 const ctx=canvas.getContext('2d')!;ctx.font='italic bold 82px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
 opponents.forEach((entry,i)=>{
  ctx.lineWidth=8;ctx.strokeStyle='#25262a';ctx.fillStyle='#faf9f3';
  ctx.strokeText(String(entry.number),128*i+64,67);ctx.fillText(String(entry.number),128*i+64,67);
 });
 const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;return map;
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
export function createField(track:Track,heightAt:(distance:number)=>number){
 const root=new T.Group(),batches:T.InstancedMesh[]=[],pose=new T.Object3D(),numbers=numberAtlas();
 const gridBoxes=extraGridBoxes(track,heightAt);root.add(gridBoxes);
 const frustum=new T.Frustum(),projection=new T.Matrix4(),bounds=new T.Sphere(new T.Vector3(),3.6);
 const entries=new Int16Array(opponents.length).fill(-1),palettes:T.Color[][]=[];
 const numbersBySlot=new T.InstancedBufferAttribute(new Float32Array(opponents.length),1);
 let disposed=false,ready=false,error:string|null=null;
 const loaded=embeddedGLB(fieldURL,true).then(({scene})=>{
  scene.traverse(obj=>{
   if(!(obj instanceof T.Mesh))return;
   const old=obj.material as T.Material;
   if(disposed){obj.geometry.dispose();old.dispose();return;}
   const trim=obj.name==='Trim',paint=obj.name==='Paint';
   const material=new T.MeshStandardMaterial({vertexColors:trim,metalness:trim?.17:.28,roughness:trim?.65:.35});
   if(paint){
    obj.geometry.setAttribute('raceNumberSlot',numbersBySlot);
    material.onBeforeCompile=shader=>{
     shader.uniforms.gridNumbers={value:numbers};
     shader.vertexShader='attribute float raceNumberSlot; varying vec3 panel; varying float slot;\n'+shader.vertexShader;
     shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npanel=position;slot=raceNumberSlot;');
     shader.fragmentShader='uniform sampler2D gridNumbers; varying vec3 panel; varying float slot;\n'+shader.fragmentShader;
     shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 mark=vec2(panel.x/.35+.5,(panel.z-1.42)/.46+.5);
      if(panel.y>.26 && all(greaterThan(mark,vec2(0.))) && all(lessThan(mark,vec2(1.)))){
       vec4 ink=texture2D(gridNumbers,vec2((slot+mark.x)/${opponents.length.toFixed(1)},mark.y));
       diffuseColor.rgb=mix(diffuseColor.rgb,ink.rgb,ink.a);
      }`);
    };
   }
   const batch=new T.InstancedMesh(obj.geometry,material,opponents.length),color=new T.Color();
   old.dispose();batch.name='Field '+obj.name;batch.frustumCulled=false;
   batch.castShadow=true;batch.receiveShadow=true;batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
   const palette=opponents.map(entry=>{
    const [primary,accent]=paints(entry);
    const tint=obj.name==='HelmetTint'?new T.Color().setHSL(entry.number*.137%1,.78,.49):color.set(trim?'#ffffff':paint?primary:accent);
    return tint.clone();
   });
   palettes.push(palette);root.add(batch);batches.push(batch);
  });ready=!disposed;
 }).catch(e=>{error=String(e);});
 return {root,loaded,get ready(){return ready;},get error(){return error;},update(field:readonly FieldCar[]|undefined,camera:T.PerspectiveCamera,focus:T.Vector3,mirror:boolean){
  root.visible=!!field?.length;if(!ready||!field)return;
  camera.updateMatrixWorld();frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  let count=0,changed=false;
  for(let i=0;i<field.length;i++){
   const c=field[i];if(c.finishTime!==null)continue;
   const p=track.pointAt(c.distance,c.offset);bounds.center.set(p.x,heightAt(c.distance)+.55,p.z);
   // Keep nearby shadow casters and cars in the rear-view mirror. Beyond
   // that corridor submit only the cars visible to the active camera.
   if(bounds.center.distanceToSquared(focus)>(mirror?500:60)**2&&!frustum.intersectsSphere(bounds))continue;
   const t=track.tangentAt(c.distance);pose.position.copy(bounds.center);pose.position.y-=.524;
   pose.rotation.set(Math.atan2(heightAt(c.distance-3)-heightAt(c.distance+3),6),Math.atan2(t.x,t.z),0,'YXZ');pose.updateMatrix();
   for(let j=0;j<batches.length;j++){
    batches[j].setMatrixAt(count,pose.matrix);
    if(entries[count]!==i)batches[j].setColorAt(count,palettes[j][i]);
   }
   if(entries[count]!==i){entries[count]=i;numbersBySlot.setX(count,i);changed=true;}
   count++;
  }
  if(changed)numbersBySlot.needsUpdate=true;
  for(const batch of batches){batch.count=count;batch.instanceMatrix.needsUpdate=true;if(changed)batch.instanceColor!.needsUpdate=true;}
 },dispose(){disposed=true;numbers.dispose();for(const mesh of batches)mesh.dispose();}};
}
