import * as T from 'three';

// GLTF meshes can share materials, geometries, textures and decoded image sources.
// Snapshot before replacing any binding so detached assets have an owner too.
export class MeshResources {
 readonly geometries=new Set<T.BufferGeometry>();
 readonly materials=new Set<T.Material>();
 readonly textures=new Set<T.Texture>();
 readonly instances=new Set<T.InstancedMesh>();
 readonly skeletons=new Set<T.Skeleton>();

 material(material:T.Material){
  if(this.materials.has(material))return;
  this.materials.add(material);
  for(const value of Object.values(material))if(value instanceof T.Texture)this.textures.add(value);
  if(material instanceof T.ShaderMaterial)for(const uniform of Object.values(material.uniforms)){
   if(uniform.value instanceof T.Texture)this.textures.add(uniform.value);
  }
 }
 collect(root:T.Object3D){
  root.traverse(o=>{
   if(o instanceof T.InstancedMesh)this.instances.add(o);
   if(o instanceof T.SkinnedMesh)this.skeletons.add(o.skeleton);
   if(o instanceof T.Mesh||o instanceof T.Line||o instanceof T.Points)this.geometries.add(o.geometry);
   if(o instanceof T.Mesh||o instanceof T.Line||o instanceof T.Points||o instanceof T.Sprite){
    for(const m of Array.isArray(o.material)?o.material:[o.material])this.material(m);
    if(o.customDepthMaterial)this.material(o.customDepthMaterial);
   }
  });
  return this;
 }
 dispose(retained?:MeshResources){
  const liveImages=new Set(retained?[...retained.textures].map(t=>t.image):[]);
  for(const t of this.textures)if(t.userData.shared)liveImages.add(t.image);
  const images=new Set<ImageBitmap>();
  for(const t of this.textures){
   if(t.userData.shared||t.isRenderTargetTexture||retained?.textures.has(t))continue;
   if(typeof ImageBitmap!=='undefined'&&t.image instanceof ImageBitmap&&!liveImages.has(t.image))images.add(t.image);
   t.dispose();
  }
  for(const image of images)image.close();
  for(const m of this.materials)if(!m.userData.shared&&!retained?.materials.has(m))m.dispose();
  for(const g of this.geometries)if(!g.userData.shared&&!retained?.geometries.has(g))g.dispose();
  for(const s of this.skeletons)if(!retained?.skeletons.has(s))s.dispose();
  for(const i of this.instances)if(!retained?.instances.has(i))i.dispose();
  this.textures.clear();this.materials.clear();this.geometries.clear();this.skeletons.clear();this.instances.clear();
 }
}
