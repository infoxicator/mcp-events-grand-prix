import {describe,it,expect,beforeAll} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {onboardLens} from '../src/race/onboard-camera';
import {poseForearms} from '../src/race/grip';

let model:T.Group;
beforeAll(async()=>{
 const bytes=readFileSync(new URL('../src/race/assets/jgp26-high.glb',import.meta.url));
 model=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
 // Match the renderer's two-sided materials so liner backfaces cannot make
 // an occluded glove appear clear in this regression.
 model.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.side=T.DoubleSide;});
 poseForearms(model,model.getObjectByName('Steering')!);model.updateMatrixWorld(true);
});
function camera(tv:boolean){
 const p=onboardLens(tv),c=new T.PerspectiveCamera(p.fov,738/375,.06,100);
 c.position.set(p.offset,p.height,-p.back);c.lookAt(0,p.height-Math.tan(p.pitch*Math.PI/180)*12,12-p.back);c.updateMatrixWorld(true);return c;
}
describe('onboard sightlines through the exported Blender car',()=>{
 it('shows the helmet crown in the lower foreground without the airbox occluding it',()=>{
  const c=camera(true),head=model.getObjectByName('Helmet')!,crown=head.localToWorld(new T.Vector3(0,.93,-.315)),projected=crown.clone().project(c);
  expect(Math.abs(projected.x)).toBeLessThan(.35);expect(projected.y).toBeLessThan(-.05);expect(projected.y).toBeGreaterThan(-.95);
  // Sample the rear crown as well: one clear top ray missed the old airbox
  // covering most of the driver's helmet in the lower part of the picture.
  for(const point of [[0,.93,-.315],[-.08,.86,-.43],[.08,.86,-.43],[0,.79,-.48]]){
   const sample=head.localToWorld(new T.Vector3(...point));
   const hit=new T.Raycaster(c.position,sample.sub(c.position).normalize()).intersectObject(model,true)[0];
   expect(hit).toBeTruthy();let node:T.Object3D|null=hit.object;
   while(node&&node.name!=='Helmet')node=node.parent;
   expect(node?.name).toBe('Helmet');
  }
 });
 it('keeps both front tyres and the lower camera dashboard within the image',()=>{
  for(const tv of [true,false])for(const x of [-.8175,.8175]){
   const p=new T.Vector3(x,.65,1.55).project(camera(tv));
   expect(Math.abs(p.x)).toBeLessThan(.95);expect(Math.abs(p.y)).toBeLessThan(.95);
  }
  const c=camera(false),dash=model.getObjectByName('Steering')!.localToWorld(new T.Vector3(0,.025,-.025)),p=dash.clone().project(c);
  expect(Math.abs(p.x)).toBeLessThan(.3);expect(p.y).toBeGreaterThan(-.85);expect(p.y).toBeLessThan(-.1);
  // Driver's-eye rendering hides the head, but should not need to hide the car.
  const head=model.getObjectByName('Helmet')!;head.visible=false;
  const hits=new T.Raycaster(c.position,dash.clone().sub(c.position).normalize()).intersectObject(model,true).filter(h=>{
   let n:T.Object3D|null=h.object;while(n){if(!n.visible)return false;n=n.parent;}return true;
  });
  let node:T.Object3D|null=hits[0]?.object??null;while(node&&node.name!=='Steering')node=node.parent;
  expect(node?.name).toBe('Steering');head.visible=true;
 });
 it('keeps both gloves visible outside the cockpit liner at centre and steering lock',()=>{
  const c=camera(false),head=model.getObjectByName('Helmet')!,steer=model.getObjectByName('Steering')!;head.visible=false;
  for(const lock of [0,-.20,.20,-.42,.42]){
   steer.rotation.z=-lock*3.6;poseForearms(model,steer);model.updateMatrixWorld(true);
   for(const side of [-1,1]){
    const name=side<0?'HandL':'HandR',point=steer.localToWorld(new T.Vector3(side*.210,-.018,-.057));
    const hits=new T.Raycaster(c.position,point.sub(c.position).normalize()).intersectObject(model,true).filter(h=>{
     let n:T.Object3D|null=h.object;while(n){if(!n.visible)return false;n=n.parent;}return true;
    });
    // At the physical ±.42 rad limit the arms cross: the driver's own sleeve
    // may naturally obscure a glove, but the cockpit liner must never do so.
    const allowed=Math.abs(lock)>.4?[name,side<0?'ForearmL':'ForearmR']:[name];
    let node:T.Object3D|null=hits[0]?.object??null;while(node&&!allowed.includes(node.name))node=node.parent;
    expect(node,`${name} occluded at ${lock} by ${hits[0]?.object.name}`).not.toBeNull();
   }
  }
  steer.rotation.z=0;poseForearms(model,steer);head.visible=true;model.updateMatrixWorld(true);
 });
});
