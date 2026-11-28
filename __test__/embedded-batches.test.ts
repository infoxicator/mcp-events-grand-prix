import {expect,it} from 'vitest';
import * as T from 'three';
import {batchCircuit,batchDistantInstances,rigidCarParts} from '../src/race/embedded-batches';

it('submits only intersecting authored index ranges and keeps independent caster visibility',()=>{
 const root=new T.Group(),material=new T.MeshStandardMaterial();material.name='Steel';
 const geo=new T.BufferGeometry();
 geo.setAttribute('position',new T.Float32BufferAttribute([-.6,0,0,-.4,0,0,-.5,.2,0,.4,0,0,.6,0,0,.5,.2,0],3));
 geo.setIndex([0,1,2,3,4,5]);
 geo.userData.clusterStep=3;
 geo.userData.clusterBounds=[-.6,0,0,-.4,.2,0,.4,0,0,.6,.2,0].map(v=>Math.round(v*32767));
 for(const x of [0,-100,100]){
  const mesh=new T.Mesh(geo,material);mesh.position.x=x;root.add(mesh);
 }
 root.updateMatrixWorld(true);
 const [batch]=batchCircuit(root),cam=new T.OrthographicCamera(-.2,.2,.5,-.5,.1,10);
 cam.position.set(-.5,0,2);cam.updateMatrixWorld();
 const renderer={} as T.WebGLRenderer,scene=new T.Scene(),group={} as T.Group;
 batch.onBeforeRender(renderer,scene,cam,batch.geometry,material,group);
 expect([0,1,2].map(id=>batch.getVisibleAt(id))).toEqual([true,false,false]);
 const ranges=[{index:0,start:12,count:6,z:0}];
 batch.customSort!.call(batch,ranges,cam);
 expect(ranges.map(({start,count})=>[start,count])).toEqual([[12,3]]);
 cam.position.x=.5;cam.updateMatrixWorld();
 batch.onBeforeRender(renderer,scene,cam,batch.geometry,material,group);
 const right=[{index:0,start:12,count:6,z:0}];batch.customSort!.call(batch,right,cam);
 expect(right.map(({start,count})=>[start,count])).toEqual([[15,3]]);
 batch.onBeforeShadow(renderer,scene,cam,cam,batch.geometry,material,group);
 expect(batch.getVisibleAt(0)).toBe(false);
 batch.dispose();geo.dispose();material.dispose();
});

it('batches visible far instances in world space and restores tiles receiving shadows',()=>{
 const root=new T.Group(),geometry=new T.BoxGeometry(1,3,1),material=new T.MeshStandardMaterial();material.name='Trunk';
 const sources:T.InstancedMesh[]=[];
 for(const x of [10,200,400]){
  const tile=new T.InstancedMesh(geometry,material,2);tile.position.x=x;tile.layers.set(1);
  tile.setMatrixAt(0,new T.Matrix4());tile.setMatrixAt(1,new T.Matrix4().makeTranslation(100,0,0));
  sources.push(tile);root.add(tile);
 }
 root.updateMatrixWorld(true);
 const update=batchDistantInstances(root),batch=root.getObjectByName('Distant Trunk') as T.InstancedMesh;
 const cam=new T.OrthographicCamera(-4,4,4,-4,.1,30);cam.position.set(10,0,10);cam.layers.enable(1);cam.updateMatrixWorld();
 update(cam);
 expect(batch.count).toBe(1);
 const pose=new T.Matrix4();batch.getMatrixAt(0,pose);expect(pose.elements[12]).toBe(10);
 const firstUpload=batch.instanceMatrix.version;update(cam);expect(batch.instanceMatrix.version).toBe(firstUpload);
 sources[0].receiveShadow=true;update(cam);expect(batch.visible).toBe(false);expect(sources[0].layers.mask).toBe(2);
 update(null);expect(sources.every(tile=>tile.layers.mask===2)).toBe(true);
 for(const tile of [...sources,batch])tile.dispose();geometry.dispose();material.dispose();
});

it('merges rigid body sections only when their UV storage agrees',()=>{
 const root=new T.Group(),chassis=new T.Group(),material=new T.MeshStandardMaterial();
 chassis.name='Chassis';root.add(chassis);
 const parts=[0,1,2,3].map(i=>{
  const geometry=new T.BoxGeometry(),uv=geometry.getAttribute('uv');
  if(i<2)geometry.setAttribute('uv',new T.Uint16BufferAttribute(uv.array.map(x=>x*65535),2,true));
  const mesh=new T.Mesh(geometry,material);chassis.add(mesh);return mesh;
 });
 root.updateMatrixWorld(true);
 const switchPose=rigidCarParts(root,new Set());switchPose(false,false);
 expect(parts.every(part=>!part.visible)).toBe(true);
 const batches=root.children.filter((node):node is T.Mesh=>node instanceof T.Mesh);
 expect(batches).toHaveLength(2);
 expect(new Set(batches.map(o=>o.geometry.getAttribute('uv').array.constructor))).toEqual(new Set([Float32Array,Uint16Array]));
 switchPose(true,false);expect(parts.every(part=>part.visible)).toBe(true);
 batches.forEach(o=>o.geometry.dispose());parts.forEach(o=>o.geometry.dispose());material.dispose();
});
