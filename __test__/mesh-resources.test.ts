import {expect,it,vi} from 'vitest';
import {Group,Mesh,MeshStandardMaterial,PlaneGeometry,Texture} from 'three';
import {MeshResources} from '../src/race/mesh-resources';

it('releases a replaced atlas binding while its live clone continues to own the decoded image',()=>{
 class Bitmap{close=vi.fn();}
 vi.stubGlobal('ImageBitmap',Bitmap);
 try{
  const image=new Bitmap(),original=new Texture(image as unknown as ImageBitmap),clone=original.clone();
  const oldMaterial=new MeshStandardMaterial({map:original}),root=new Group();
  const geometry=new PlaneGeometry(),mesh=new Mesh(geometry,oldMaterial);
  root.add(mesh);
  const before=new MeshResources().collect(root);
  const newMaterial=new MeshStandardMaterial({map:clone,emissiveMap:clone});
  mesh.material=newMaterial;root.add(new Mesh(geometry,newMaterial));
  const active=new MeshResources().collect(root);
  const removed=vi.spyOn(original,'dispose'),material=vi.spyOn(oldMaterial,'dispose');
  const retained=vi.spyOn(clone,'dispose'),geo=vi.spyOn(geometry,'dispose');
  before.dispose(active);
  expect(removed).toHaveBeenCalledOnce();expect(material).toHaveBeenCalledOnce();
  expect(geo).toHaveBeenCalledTimes(0);expect(image.close).toHaveBeenCalledTimes(0);
  active.dispose();active.dispose();
  expect(retained).toHaveBeenCalledOnce();expect(image.close).toHaveBeenCalledOnce();
  expect(geo).toHaveBeenCalledOnce();
 }finally{vi.unstubAllGlobals();}
});

it('keeps the decoded source of a cached template alive when releasing a scene clone',()=>{
 class Bitmap{close=vi.fn();}
 vi.stubGlobal('ImageBitmap',Bitmap);
 try{
  const image=new Bitmap(),template=new Texture(image as unknown as ImageBitmap);
  template.userData.shared=true;
  const clone=template.clone();
  clone.userData.shared=false;
  const sharedDispose=vi.spyOn(template,'dispose'),cloneDispose=vi.spyOn(clone,'dispose');
  const scene=new MeshResources();
  scene.textures.add(template);scene.textures.add(clone);
  scene.dispose();
  expect(sharedDispose).not.toHaveBeenCalled();
  expect(cloneDispose).toHaveBeenCalledOnce();
  expect(image.close).not.toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();}
});
