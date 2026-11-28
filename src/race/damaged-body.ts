import {MathUtils,Matrix3,Vector3,Uint8BufferAttribute,type Material,type Mesh} from 'three';
import type {PanelDamage} from './types';

const scrapeMaterials=new WeakSet<Material>();

function bindScrape(mesh:Mesh){
 const scrape=new Uint8BufferAttribute(mesh.geometry.getAttribute('position').count,1,true);
 mesh.geometry.setAttribute('scrape',scrape);
 for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
  if(scrapeMaterials.has(mat))continue;
  scrapeMaterials.add(mat);const prior=mat.onBeforeCompile,key=mat.customProgramCacheKey();
  mat.onBeforeCompile=(shader,renderer)=>{
   prior.call(mat,shader,renderer);
   shader.vertexShader='attribute float scrape;varying float exposedCarbon;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nexposedCarbon=scrape;');
   shader.fragmentShader='varying float exposedCarbon;\n'+shader.fragmentShader.replace('#include <lights_physical_fragment>','diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.018,.020,.023),exposedCarbon);\n#include <lights_physical_fragment>');
  };mat.customProgramCacheKey=()=>key+'-contact-scrape';mat.needsUpdate=true;
 }
 return scrape;
}

// Use a common chassis frame for laminate, painted marks and endplates.
// Blender decal meshes can have independent origins, rotations and scales.
export function bindBodyDamage(mesh:Mesh){
 const geometry=mesh.geometry,position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal');
 const toBody=mesh.matrixWorld,toMesh=toBody.clone().invert();
 const bodyNormal=new Matrix3().getNormalMatrix(toBody),meshNormal=new Matrix3().getNormalMatrix(toMesh);
 const point=new Vector3(),direction=new Vector3();
 const indices:number[]=[],corners:number[]=[],weights:number[]=[],body:number[]=[],rest:number[]=[];
 for(let i=0;i<position.count;i++){
  point.fromBufferAttribute(position,i).applyMatrix4(toBody);
  const {x,y,z}=point,aft=z<0;
  const end=MathUtils.smoothstep(aft?-z:z,aft?1.92:1.76,aft?2.42:2.47);
  if(end===0)continue;
  indices.push(i);corners.push((aft?2:0)+(x>0?1:0));
  weights.push(end,MathUtils.smoothstep(Math.abs(x),.12,.94),MathUtils.smoothstep(Math.abs(x),0,.20));
  direction.fromBufferAttribute(normal,i).applyNormalMatrix(bodyNormal);
  body.push(x,y,z,direction.x,direction.y,direction.z);
  rest.push(position.getX(i),position.getY(i),position.getZ(i),normal.getX(i),normal.getY(i),normal.getZ(i));
 }
 if(!indices.length)return;
 const scrape=import.meta.env.MCP_APP==='true'?undefined:bindScrape(mesh);
 let detached:{offset:number;corner:number;second:number;third:number}[]|undefined;
 let detachedMask=0;
 return (damage:PanelDamage)=>{
  const mask=Number(damage[0]>.92)|Number(damage[1]>.92)<<1|Number(damage[2]>.92)<<2|Number(damage[3]>.92)<<3;
  if(mask&&!detached){
   const panelCorner=new Int8Array(position.count).fill(-1);
   for(let j=0;j<indices.length;j++){
    const k=j*6;
    if(Math.abs(body[k])>(corners[j]<2?.76:.71))panelCorner[indices[j]]=corners[j];
   }
   detached=[];const ix=geometry.index;
   if(ix)for(let k=0;k<ix.count;k+=3){
    const corner=panelCorner[ix.getX(k)],b=ix.getX(k+1),c=ix.getX(k+2);
    if(corner>=0&&panelCorner[b]===corner&&panelCorner[c]===corner)detached.push({offset:k,corner,second:b,third:c});
   }
  }
  const ix=geometry.index;
  if(ix&&detached?.length&&mask!==detachedMask){
   detachedMask=mask;
   for(const tri of detached){
    const broken=damage[tri.corner]>.92,a=ix.getX(tri.offset);
    ix.setX(tri.offset+1,broken?a:tri.second);ix.setX(tri.offset+2,broken?a:tri.third);
   }
   ix.needsUpdate=true;
  }
  if(scrape)scrape.needsUpdate=true;
  for(let j=0;j<indices.length;j++){
   const k=j*6,index=indices[j],corner=corners[j],aft=corner>=2,opposite=damage[corner^1];
   scrape?.setX(index,damage[corner]*weights[j*3]*weights[j*3+1]*(.64+.30*Math.cos(body[k+2]*86+body[k+1]*63)));
   if(!damage[corner]&&!opposite){
    position.setXYZ(index,rest[k],rest[k+1],rest[k+2]);normal.setXYZ(index,rest[k+3],rest[k+4],rest[k+5]);continue;
   }
   const x=body[k],y=body[k+1],z=body[k+2],side=x<0?-1:1,outboard=weights[j*3+1];
   // Blend at the nose centreline. Increase the fold towards the unsupported wing tips.
   const strength=weights[j*3]*MathUtils.lerp((damage[corner]+opposite)*.5,damage[corner],weights[j*3+2]);
   const angle=strength*outboard*(aft?-.46:.64)*side,cs=Math.cos(angle),sn=Math.sin(angle);
   const arm=x-side*.22,pivot=aft?.87:.20;
   point.set(x+(cs-1)*arm-sn*(y-pivot)-side*.09*outboard*strength,
    y+sn*arm+(cs-1)*(y-pivot),z+(aft?1:-1)*strength*(.14+.24*outboard)).applyMatrix4(toMesh);
   position.setXYZ(index,point.x,point.y,point.z);
   const nx=body[k+3],ny=body[k+4];
   direction.set(cs*nx-sn*ny,sn*nx+cs*ny,body[k+5]).applyNormalMatrix(meshNormal);
   normal.setXYZ(index,direction.x,direction.y,direction.z);
  }
  position.needsUpdate=true;normal.needsUpdate=true;
 };
}
