import {loadCar} from './load-car';
import {describe,it,expect,beforeAll} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {onboardLens} from '../src/race/onboard-camera';
import {bindGloveCompression,fingerCurl,poseForearms} from '../src/race/grip';

let model:T.Group;
beforeAll(async()=>{
 const bytes=readFileSync(new URL('../src/race/assets/jgp26-high.glb',import.meta.url));
 model=(await loadCar(bytes)).scene;
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
  for(const tv of [true,false])for(const x of ['FrontL','FrontR'].map(name=>model.getObjectByName(name)!.position.x)){
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

for(const level of ['high','low'])it(level+' holds the glove width and both sleeve lengths through a full steering sweep',async()=>{
 const bytes=readFileSync(new URL(`../src/race/assets/jgp26-${level}.glb`,import.meta.url));
 const {scene}=await loadCar(bytes);
 const steering=scene.getObjectByName('Steering')!;
 for(const [suffix,side] of [['L',-1],['R',1]] as const){
  const upper=scene.getObjectByName('UpperArm'+suffix)!,fore=scene.getObjectByName('Forearm'+suffix)!;
  const cuff=scene.getObjectByName('Cuff'+suffix)!,joint=scene.getObjectByName('Wrist'+suffix)!,hand=scene.getObjectByName('Hand'+suffix)!;
  const meshes=bindGloveCompression(hand,side);expect(meshes.length).toBeGreaterThan(0);
  let largest=0;
  for(const mesh of meshes){
   const offsets=mesh.geometry.morphAttributes.position![0];
   for(let i=0;i<offsets.count;i++)largest=Math.max(largest,new T.Vector3().fromBufferAttribute(offsets,i).length());
  }
  expect(largest).toBeGreaterThan(.0003);expect(largest).toBeLessThan(.00136);
  const palm=(x:number,y:number,z:number)=>hand.localToWorld(new T.Vector3(side*x,y,z));
  let previousElbow:T.Vector3|undefined;
  for(let step=-42;step<=42;step++){
   steering.rotation.z=-step*.01*3.6;poseForearms(scene,steering);scene.updateMatrixWorld(true);
   const origin=(bone:T.Object3D)=>bone.getWorldPosition(new T.Vector3());
   expect(origin(upper).distanceTo(origin(fore))).toBeCloseTo(.291,5);
   expect(origin(joint).distanceTo(origin(fore))).toBeCloseTo(.290,5);
   expect(fore.localToWorld(new T.Vector3(0,.290,0)).distanceTo(origin(joint))).toBeLessThan(.00002);
   const sleeve=origin(joint).sub(origin(fore)).normalize();
   const opening=origin(joint).sub(origin(cuff)).normalize();
   expect(T.MathUtils.radToDeg(sleeve.angleTo(opening))).toBeLessThan(.1);
   expect(Math.abs(fore.position.x)).toBeLessThan(.240);
   const palmAxis=new T.Vector3(-side*.007,.029,.045).normalize().applyQuaternion(hand.getWorldQuaternion(new T.Quaternion()));
   expect(T.MathUtils.radToDeg(sleeve.angleTo(palmAxis))).toBeLessThan(37);
   if(previousElbow)expect(fore.position.distanceTo(previousElbow)).toBeLessThan(.018);
   previousElbow=fore.position.clone();
   expect(palm(.184,-.04,-.06).distanceTo(palm(.245,-.04,-.06))).toBeCloseTo(.061,6);
   expect(palm(.21,.02,-.025).distanceTo(palm(.21,.02,-.105))).toBeCloseTo(.080,6);
   for(const node of [upper,fore,hand])expect(node.getWorldScale(new T.Vector3()).distanceTo(new T.Vector3(1,1,1))).toBeLessThan(.00001);
  }
 }
});

for(const level of ['high','low'])it(level+' keeps the five separately weighted digits in contact with the ergonomic grip',async()=>{
 const bytes=readFileSync(new URL(`../src/race/assets/jgp26-${level}.glb`,import.meta.url));
 const {scene}=await loadCar(bytes);
 const wheel=scene.getObjectByName('Steering')!,rubber=wheel.getObjectByName('Steering_Rubber') as T.Mesh;
 for(const [suffix,side] of [['L',-1],['R',1]] as const){
  wheel.rotation.z=0;scene.updateMatrixWorld(true);
  const hand=wheel.getObjectByName('Hand'+suffix)!,skins:T.SkinnedMesh[]=[];
  hand.traverse(o=>{if(o instanceof T.SkinnedMesh)skins.push(o);});
  expect(skins.length).toBeGreaterThan(0);
  const local=hand.matrixWorld.clone().invert();
  const rim:T.Vector3[]=[],position=rubber.geometry.getAttribute('position');
  for(let i=0;i<position.count;i++){
   const point=rubber.localToWorld(new T.Vector3().fromBufferAttribute(position,i)).applyMatrix4(local);
   if(side*point.x>.11)rim.push(point);
  }
  for(let digit=0;digit<5;digit++){
   let best=Infinity,match:{skin:T.SkinnedMesh;vertex:number;rim:T.Vector3}|undefined;
   const bone=hand.getObjectByName('Finger'+suffix+digit)!;
   for(const skin of skins){
    const joint=skin.skeleton.bones.indexOf(bone as T.Bone);
    const weights=skin.geometry.getAttribute('skinWeight'),indices=skin.geometry.getAttribute('skinIndex');
    for(let i=0;i<weights.count;i++){
     if(![0,1,2,3].some(k=>weights.getComponent(i,k)>.8&&indices.getComponent(i,k)===joint))continue;
     const vertex=skin.localToWorld(skin.getVertexPosition(i,new T.Vector3())).applyMatrix4(local);
     for(const point of rim){
      const d=point.distanceToSquared(vertex);if(d<best){best=d;match={skin,vertex:i,rim:point};}
     }
    }
   }
   expect(match).toBeDefined();const pair=match!;
   let skinTravel=0;
   for(const lock of [-.42,-.21,0,.21,.42]){
    const pressure=fingerCurl(side,digit,lock,4220,43);
    wheel.rotation.z=-lock*3.6;bone.rotation.set(0,pressure.curl,pressure.spread);scene.updateMatrixWorld(true);
    const posed=hand.worldToLocal(pair.skin.localToWorld(pair.skin.getVertexPosition(pair.vertex,new T.Vector3())));
    expect(posed.distanceTo(pair.rim),suffix+digit+' contact gap').toBeLessThan(.006);
    bone.rotation.set(0,0,0);scene.updateMatrixWorld(true);
    const rest=hand.worldToLocal(pair.skin.localToWorld(pair.skin.getVertexPosition(pair.vertex,new T.Vector3())));
    skinTravel=Math.max(skinTravel,posed.distanceTo(rest));
   }
   expect(skinTravel).toBeGreaterThan(.00012);
   wheel.rotation.z=0;scene.updateMatrixWorld(true);
  }
 }
});
