import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from 'three';

// Both mixed-format GLB UV accessors and their normalized flags must survive a merge.
function attributeLayout(geometry:T.BufferGeometry){
 return Object.entries(geometry.attributes)
  .map(([name,a])=>[name,a.array.constructor.name,a.itemSize,a.normalized].join(':')).sort().join('/');
}

// Keep individual survey transforms and geometry bounds. Multi-draw submits the
// visible chunks of each opaque material together without joining distant bounds.
export function batchCircuit(root:T.Group){
 const buckets=new Map<string,T.Mesh[]>();
 root.traverse(o=>{
  if(!(o instanceof T.Mesh)||o instanceof T.SkinnedMesh||Array.isArray(o.material)||o.material.transparent||!o.visible||o.children.length)return;
  for(let p=o.parent;p&&p!==root;p=p.parent)if(p instanceof T.LOD)return;
  const m=o.material;
  if(!/^(Armco|Asphalt|RepairCourse|Concrete|Steel|White|Red|Green|Dark|Glass|Windows|WarmWindows|RoofSheet|DistantRidge|Grass|Gravel|Sign|Gold|Ice|Barrier|Stage|Roof|ParkHorizon|CityGround|Kerb|RunoffPaint|LeafLitter|RoughMeadow|BarrierPrint|Astroturf|UpperCurtain|UpperStone|UpperRibbon|TarSeam|Fence|CopperRoof|Travertine|RecessGlass|StoreGlass|ImpactIvory|ImpactRed)$/.test(m.name))return;
  if(o instanceof T.InstancedMesh&&(o.instanceColor||o.morphTexture))return;
  const layout=attributeLayout(o.geometry);
  const key=m.uuid+layout+Boolean(o.geometry.index)+o.renderOrder;
  const meshes=buckets.get(key)??[];meshes.push(o);buckets.set(key,meshes);
 });
 const batchMaterials=new Set<T.Material>(),matrix=new T.Matrix4(),inverse=root.matrixWorld.clone().invert();
 const batches:T.BatchedMesh[]=[];
 const frustum=new T.Frustum(),projection=new T.Matrix4(),lastView=new T.Matrix4(),lastProjection=new T.Matrix4();
 const positiveX=new Uint8Array(6),positiveY=new Uint8Array(6),positiveZ=new Uint8Array(6);
 let lastCamera:T.Camera|null=null;
 function updateFrustum(camera:T.Camera){
  if(camera===lastCamera&&lastView.equals(camera.matrixWorldInverse)&&lastProjection.equals(camera.projectionMatrix))return;
  lastCamera=camera;lastView.copy(camera.matrixWorldInverse);lastProjection.copy(camera.projectionMatrix);
  frustum.setFromProjectionMatrix(projection.multiplyMatrices(lastProjection,lastView),camera.coordinateSystem,camera.reversedDepth);
  for(let j=0;j<6;j++){
   const n=frustum.planes[j].normal;positiveX[j]=Number(n.x>=0);positiveY[j]=Number(n.y>=0);positiveZ[j]=Number(n.z>=0);
  }
 }
 for(const sources of buckets.values()){
  // Each multi-draw batch owns matrix and draw-ID textures. Small static
  // groups are cheaper to leave as individually frustum-culled survey tiles.
  if(sources.length<3)continue;
  if(sources.length<8&&!sources.some(mesh=>mesh.geometry.userData.clusterBounds))continue;
  const shapes=new Set(sources.map(o=>o.geometry));
  let vertices=0,indices=0,instances=0;
  for(const g of shapes){vertices+=g.attributes.position.count;indices+=g.index?.count??0;}
  for(const o of sources)instances+=(o instanceof T.InstancedMesh?o.count:1)*(o.geometry.userData.clusterBounds?.length/6||1);
  const m=sources[0].material as T.Material;
  // The venue shaders explicitly look up world-space survey coordinates.
  if(!batchMaterials.has(m)){
   const previous=m.onBeforeCompile,key=m.customProgramCacheKey();
   m.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);
    shader.vertexShader='#ifdef USE_BATCHING\n#define venueModel (modelMatrix * batchingMatrix)\n#else\n#define venueModel modelMatrix\n#endif\n'+shader.vertexShader.replace(/\bmodelMatrix\b/g,'venueModel');
   };
   m.customProgramCacheKey=()=>key+'-venue-batches';batchMaterials.add(m);
  }
  const batch=new T.BatchedMesh(instances,vertices,indices,m),shapeIDs=new Map<T.BufferGeometry,number>();
  batch.layers.mask=sources[0].layers.mask;batch.name='Circuit '+m.name;batch.sortObjects=false;batch.renderOrder=sources[0].renderOrder;
  const ranges:{mesh:T.Mesh;first:number;end:number;bounds:T.Box3|null;mask:number}[]=[];
  const clusters:{bounds:Float32Array;blocks:Float32Array;step:number}[]=[],boxes:T.Box3[]=[];
  const masks=new Int8Array(instances);
  // A child box only needs the planes that actually intersect its parent.
  function planeMask(box:T.Box3,mask:number){
   const lo=box.min,hi=box.max;
   for(let j=0;j<6;j++){
    const bit=1<<j;if(!(mask&bit))continue;
    const {normal:n,constant:d}=frustum.planes[j];
    if(n.x*(positiveX[j]?hi.x:lo.x)+n.y*(positiveY[j]?hi.y:lo.y)+n.z*(positiveZ[j]?hi.z:lo.z)+d<0)return -1;
    if(n.x*(positiveX[j]?lo.x:hi.x)+n.y*(positiveY[j]?lo.y:hi.y)+n.z*(positiveZ[j]?lo.z:hi.z)+d>=0)mask^=bit;
   }
   return mask;
  }
  // Keep cluster bounds contiguous. A venue has thousands of small ranges,
  // and the main, mirror and shadow frusta read them several times per frame.
  const scratch=new T.Box3(),blockBox=new T.Box3(),emptyBounds=new Float32Array(0);
  function packedMask(bounds:Float32Array,offset:number,mask:number){
   for(let j=0;j<6;j++){
    const bit=1<<j;if(!(mask&bit))continue;
    const {normal:n,constant:d}=frustum.planes[j];
    const x=positiveX[j]*3,y=positiveY[j]*3,z=positiveZ[j]*3;
    if(n.x*bounds[offset+x]+n.y*bounds[offset+1+y]+n.z*bounds[offset+2+z]+d<0)return -1;
    if(n.x*bounds[offset+3-x]+n.y*bounds[offset+4-y]+n.z*bounds[offset+5-z]+d>=0)mask^=bit;
   }
   return mask;
  }
  let slot=0;
  for(const o of sources){
   let id=shapeIDs.get(o.geometry);if(id===undefined){id=batch.addGeometry(o.geometry);shapeIDs.set(o.geometry,id);}
   const first=slot,count=o instanceof T.InstancedMesh?o.count:1;
   for(let i=0;i<count;i++){
    if(o instanceof T.InstancedMesh){o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);}
    else matrix.copy(o.matrixWorld);
    if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();
    boxes.push(o.geometry.boundingBox!.clone().applyMatrix4(matrix));
    const coords=o.geometry.userData.clusterBounds as number[]|undefined;
    const bounds=coords?new Float32Array(coords.length):emptyBounds;
    const blocks=coords?new Float32Array(Math.ceil(bounds.length/96)*6):emptyBounds;
    if(coords)for(let j=0;j<coords.length;j+=6){
     scratch.min.fromArray(coords,j).multiplyScalar(1/32767);
     scratch.max.fromArray(coords,j+3).multiplyScalar(1/32767);
     scratch.applyMatrix4(matrix).expandByScalar(.025);
     scratch.min.toArray(bounds,j);scratch.max.toArray(bounds,j+3);
     if(j%96===0)blockBox.makeEmpty();
     blockBox.union(scratch);
     if(j%96===90||j+6===coords.length){
      const offset=Math.floor(j/96)*6;blockBox.min.toArray(blocks,offset);blockBox.max.toArray(blocks,offset+3);
     }
    }
    clusters.push({bounds,blocks,step:o.geometry.userData.clusterStep??0});
    batch.setMatrixAt(batch.addInstance(id),matrix.premultiply(inverse));slot++;
   }
   const bounds=count>1?boxes[first].clone():null;
   if(bounds)for(let i=first+1;i<slot;i++)bounds.union(boxes[i]);
   ranges.push({mesh:o,first,end:slot,bounds,mask:63});o.removeFromParent();
  }
  // Source nodes still carry the venue's distance/receiver decisions. Set the
  // batch's instance visibility independently for the shadow and beauty passes.
  batch.perObjectFrustumCulled=false;batch.castShadow=m.name==='Armco';batch.receiveShadow=sources.some(o=>o.receiveShadow);
  const main=batch.onBeforeRender,shadow=batch.onBeforeShadow;
  function visibility(camera:T.Camera,depth:boolean){
   updateFrustum(camera);
   for(const range of ranges){
    const {mesh,first,end,bounds}=range;
    const visible=mesh.visible&&(!depth||mesh.castShadow);
    const parentMask=visible?(bounds?planeMask(bounds,63):63):-1;
    if(parentMask<=0&&range.mask===parentMask)continue;
    range.mask=parentMask;
    for(let i=first;i<end;i++){
     const mask=parentMask>0?planeMask(boxes[i],parentMask):parentMask;
     if((masks[i]>=0)!==(mask>=0))batch.setVisibleAt(i,mask>=0);
     masks[i]=mask;
    }
   }
  }
  batch.onBeforeRender=function(...args){visibility(args[2],false);main.apply(this,args);};
  batch.onBeforeShadow=function(...args){visibility(args[3],true);shadow.apply(this,args);};
  // Batch multi-draw accepts separate index ranges for one instance. Adjacent
  // visible clusters stay contiguous and continue to share one model matrix.
  if(clusters.some(c=>c.bounds.length)){
   type Draw={start:number;count:number;index:number;z:number};
   const visible:Draw[]=[],pool:Draw[]=[];
   batch.sortObjects=true;
   batch.setCustomSort(list=>{
    visible.length=0;
    for(const item of list as Draw[]){
     const {bounds,blocks,step}=clusters[item.index],mask=masks[item.index];
     if(!bounds.length||mask===0){visible.push(item);continue;}
     let run:Draw|undefined;
     let blockMask=mask;
     for(let i=0,countClusters=bounds.length/6;i<countClusters;i++){
      if(i%16===0)blockMask=packedMask(blocks,i/16*6,mask);
      if(blockMask<0){run=undefined;i+=15;continue;}
      const length=blockMask===0?Math.min(16,countClusters-i):1;
      if(blockMask&&packedMask(bounds,i*6,blockMask)<0){run=undefined;continue;}
      const count=Math.min(step*length,item.count-i*step);
      if(run)run.count+=count;
      else{
       const slot=visible.length;run=pool[slot]??=( {start:0,count:0,index:0,z:0} );
       run.start=item.start+i*step;run.count=count;run.index=item.index;visible.push(run);
      }
      i+=length-1;
     }
    }
    list.length=visible.length;for(let i=0;i<visible.length;i++)list[i]=visible[i];
   });
  }
  batch.computeBoundingSphere();root.add(batch);batches.push(batch);
 }
 const empty=new T.BufferGeometry();
 for(const items of buckets.values())for(const mesh of items)if(!mesh.parent)mesh.geometry=empty;
 return batches;
}

// Rigid shell parts share a chassis transform. Preserve independent parts and
// bind the shadow proxy only while the body has its original, undamaged shape.
export function rigidCarParts(model:T.Group,changing:Set<T.Mesh>){
 const candidates:T.Mesh[]=[],opaque=new Map<string,T.Mesh[]>();
 const inverse=model.matrixWorld.clone().invert();
 model.traverse(o=>{
  if(!(o instanceof T.Mesh)||o instanceof T.SkinnedMesh||o.children.length||Array.isArray(o.material)||!o.visible||o.material.transparent||o.material.alphaTest||Object.keys(o.geometry.morphAttributes).length)return;
  let rigid=false;
  for(let p:T.Object3D|null=o;p&&p!==model;p=p.parent){
   if(!p.visible||/Wheel|Knuckle|Hand|Finger|Steering|Helmet|Suit|DRS|Actuator|MovingFlap|Mirror|Paddle|Suspension|Forearm|UpperArm|Front[LR]|Rear[LR]/.test(p.name))return;
   if(/^(Chassis|Floor|ConformalDecals|Number[AB])$/.test(p.name))rigid=true;
  }
  if(!rigid)return;
  if(o.castShadow)candidates.push(o);
  if(changing.has(o))return;
  // Same local frame keeps custom normal, UV and livery-point shaders exact.
  const k=[o.material.uuid,o.matrixWorld.elements.join(','),o.castShadow,o.receiveShadow,o.layers.mask,o.renderOrder,Boolean(o.geometry.index),attributeLayout(o.geometry)].join('/');
  const list=opaque.get(k)??[];list.push(o);opaque.set(k,list);
 });
 const merged:{sources:T.Mesh[];mesh:T.Mesh}[]=[];
 for(const sources of opaque.values()){
  if(sources.length<2)continue;
  const geometry=mergeGeometries(sources.map(m=>m.geometry));
  if(!geometry)continue;
  const ref=sources[0],mesh=new T.Mesh(geometry,ref.material);
  mesh.name='Rigid '+(ref.material as T.Material).name;mesh.matrix.copy(ref.matrixWorld).premultiply(inverse);mesh.matrixAutoUpdate=false;
  mesh.castShadow=ref.castShadow;mesh.receiveShadow=ref.receiveShadow;mesh.layers.mask=ref.layers.mask;mesh.renderOrder=ref.renderOrder;model.add(mesh);
  for(const m of sources)m.visible=false;
  merged.push({sources,mesh});
 }
 const shadowGeometry:T.BufferGeometry[]=[],point=new T.Vector3();
 for(const mesh of candidates){
  const g=mesh.geometry,position=g.attributes.position,xyz=new Float32Array(position.count*3);
  const transform=new T.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld);
  for(let i=0;i<position.count;i++)point.fromBufferAttribute(position,i).applyMatrix4(transform).toArray(xyz,3*i);
  const part=new T.BufferGeometry();part.setAttribute('position',new T.BufferAttribute(xyz,3));
  if(g.index)part.setIndex(g.index);
  shadowGeometry.push(part);
 }
 const combined=shadowGeometry.length?mergeGeometries(shadowGeometry):null;
 for(const g of shadowGeometry)g.dispose();
 const shadow=combined?new T.Mesh(combined,new T.MeshBasicMaterial({side:T.DoubleSide})):null;
 if(shadow){shadow.name='Rigid car shadow';shadow.castShadow=true;shadow.layers.set(2);model.add(shadow);}
 let previous='';
 return (studio:boolean,damaged:boolean)=>{
  const key=studio?'studio':damaged?'damaged':'race';if(previous===key)return;previous=key;
  for(const {sources,mesh} of merged){mesh.visible=!studio;for(const s of sources)s.visible=studio;}
  const proxy=!!shadow&&!studio&&!damaged;
  if(shadow)shadow.visible=proxy;
  for(const mesh of candidates)mesh.castShadow=!proxy;
  for(const {sources,mesh} of merged)mesh.castShadow=!proxy&&sources[0].castShadow;
 };
}

// Far trees and spectators share their authored geometry across survey tiles.
// Keep the original tile whenever its shadows matter. Otherwise submit the
// visible instance ranges together, using the original world transforms.
export function batchDistantInstances(root:T.Group){
 type Chunk={bounds:T.Box3;matrices:Float32Array};
 type Tile={source:T.InstancedMesh;layers:number;chunks:Chunk[];bounds:T.Box3};
 const groups=new Map<string,T.InstancedMesh[]>();
 root.traverse(o=>{
  if(!(o instanceof T.InstancedMesh)||o.count<2||o.instanceColor||o.morphTexture||Array.isArray(o.material))return;
  if(o.material.name!=='Trunk'&&!/_(far|horizon)$/.test(o.name))return;
  if(!/^(Trunk|Canopy|Spectator|.*Uniform)/.test(o.material.name))return;
  const key=o.geometry.uuid+o.material.uuid+o.layers.mask;
  const group=groups.get(key)??[];group.push(o);groups.set(key,group);
 });
 const frustum=new T.Frustum(),projection=new T.Matrix4(),matrix=new T.Matrix4(),point=new T.Vector3(),worldToRoot=root.matrixWorld.clone().invert();
 const sets:{batch:T.InstancedMesh;tiles:Tile[];last:Chunk[];next:Chunk[]}[]=[];
 for(const sources of groups.values()){
  if(sources.length<3)continue;
  const ref=sources[0],batch=new T.InstancedMesh(ref.geometry,ref.material,sources.reduce((n,o)=>n+o.count,0));
  batch.name='Distant '+(ref.material as T.Material).name;batch.layers.mask=ref.layers.mask;batch.frustumCulled=false;
  batch.instanceMatrix.setUsage(T.DynamicDrawUsage);batch.count=0;batch.visible=false;root.add(batch);
  const tiles:Tile[]=[];
  for(const source of sources){
   if(!source.geometry.boundingSphere)source.geometry.computeBoundingSphere();
   const sphere=source.geometry.boundingSphere!,cells=new Map<string,{indices:number[];bounds:T.Box3;radius:number}>();
   for(let i=0;i<source.count;i++){
    source.getMatrixAt(i,matrix);matrix.premultiply(source.matrixWorld);point.copy(sphere.center).applyMatrix4(matrix);
    const key=Math.floor(point.x/60)+'/'+Math.floor(point.z/60);
    let cell=cells.get(key);if(!cell){cell={indices:[],bounds:new T.Box3(),radius:0};cells.set(key,cell);}
    cell.indices.push(i);cell.bounds.expandByPoint(point);cell.radius=Math.max(cell.radius,sphere.radius*matrix.getMaxScaleOnAxis());
   }
   const bounds=new T.Box3(),chunks:Chunk[]=[];
   for(const cell of cells.values()){
    const values=new Float32Array(cell.indices.length*16);
    for(let j=0;j<cell.indices.length;j++){
     source.getMatrixAt(cell.indices[j],matrix);matrix.premultiply(source.matrixWorld).premultiply(worldToRoot).toArray(values,j*16);
    }
    cell.bounds.expandByScalar(cell.radius+.1);bounds.union(cell.bounds);chunks.push({bounds:cell.bounds,matrices:values});
   }
   tiles.push({source,layers:source.layers.mask,bounds,chunks});
  }
  sets.push({batch,tiles,last:[],next:[]});
 }
 return (camera:T.Camera|null)=>{
  if(camera)frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),camera.coordinateSystem,camera.reversedDepth);
  for(const set of sets){
   const {batch,tiles,last,next}=set;
   if(camera&&!camera.layers.test(batch.layers))continue;
   next.length=0;
   for(const {source,layers,bounds,chunks} of tiles){
    const useBatch=camera&&!source.castShadow&&!source.receiveShadow;
    source.layers.mask=useBatch?8:layers;
    if(!useBatch||!source.visible||!frustum.intersectsBox(bounds))continue;
    for(const chunk of chunks)if(frustum.intersectsBox(chunk.bounds))next.push(chunk);
   }
   batch.visible=next.length>0;
   let changed=next.length!==last.length;
   for(let i=0;i<next.length&&!changed;i++)changed=next[i]!==last[i];
   if(!changed)continue;
   let offset=0;
   for(const chunk of next){batch.instanceMatrix.array.set(chunk.matrices,offset);offset+=chunk.matrices.length;}
   batch.count=offset/16;
   if(offset){batch.instanceMatrix.clearUpdateRanges();batch.instanceMatrix.addUpdateRange(0,offset);batch.instanceMatrix.needsUpdate=true;}
   set.last=next;set.next=last;
  }
 };
}
