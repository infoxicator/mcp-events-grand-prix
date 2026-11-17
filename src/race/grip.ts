import * as T from 'three';

const axis=new T.Vector3(0,1,0);
const wrist=new T.Vector3(),shoulder=new T.Vector3(),elbow=new T.Vector3();
const along=new T.Vector3(),bend=new T.Vector3(),direction=new T.Vector3();
const UPPER_LENGTH=.291,FORE_LENGTH=.266;

type ArmRig={side:number;upper:T.Object3D;fore:T.Object3D;cuff:T.Object3D};
const armCache=new WeakMap<T.Object3D,ArmRig[]>();

/** Solve both links in the chassis frame. Read the cuff from the actual hand
 * hierarchy so wheel rotation, grip offsets and LOD bind transforms agree. */
export function poseForearms(model:T.Object3D,steering:T.Object3D,visible=true){
 let arms=armCache.get(model);
 if(!arms){
  arms=[];
  for(const [suffix,side] of [['L',-1],['R',1]] as const){
   const fore=model.getObjectByName('Forearm'+suffix),upper=model.getObjectByName('UpperArm'+suffix),cuff=steering.getObjectByName('Cuff'+suffix);
   if(fore&&upper&&cuff)arms.push({side,upper,fore,cuff});
  }
  armCache.set(model,arms);
 }
 for(const {side,upper,fore,cuff} of arms){
  fore.visible=upper.visible=visible;
  if(!visible)continue;
  const chassis=fore.parent!;
  chassis.worldToLocal(cuff.getWorldPosition(wrist));
  shoulder.copy(upper.position);
  along.subVectors(wrist,shoulder);
  const reach=along.length();along.divideScalar(reach);
  bend.set(side*.218,.180,-.20).sub(shoulder);
  bend.addScaledVector(along,-bend.dot(along)).normalize();
  const advance=(UPPER_LENGTH**2+reach**2-FORE_LENGTH**2)/(2*reach);
  elbow.copy(shoulder).addScaledVector(along,advance).addScaledVector(bend,Math.sqrt(Math.max(0,UPPER_LENGTH**2-advance**2)));
  upper.quaternion.setFromUnitVectors(axis,direction.subVectors(elbow,shoulder).normalize());
  fore.position.copy(elbow);
  fore.quaternion.setFromUnitVectors(axis,direction.subVectors(wrist,elbow).normalize());
 }
}
/** Small contact-preserving grip changes, deterministic from car telemetry. Radians. */
export function fingerCurl(side:-1|1,digit:number,steering:number,distance:number,speed:number){
 const load=Math.max(-1,Math.min(1,steering/.25))*side;
 const pressure=[.021,.032,.028,.018,.012][digit]??0;
 const breathe=speed>1?Math.sin(distance*.018+digit*1.73+side)*.0035:0;
 return {curl:side*(pressure*load+breathe),spread:side*load*(digit-2)*.0025};
}

/** A millimetre of compression on the back of the glove. All applique and
 * seam meshes use the same hand-space field so the layers stay registered. */
export function bindGloveCompression(hand:T.Object3D,side:-1|1){
 hand.updateWorldMatrix(true,true);
 const inverseHand=hand.matrixWorld.clone().invert(),point=new T.Vector3(),shift=new T.Vector3();
 const meshes:T.Mesh[]=[];
 const candidates:T.Mesh[]=[];
 hand.traverse(o=>{if(o instanceof T.Mesh&&(o.parent===hand||o instanceof T.SkinnedMesh))candidates.push(o);});
 for(const child of candidates){
  if(!(child instanceof T.Mesh))continue;
  const geometry=child.geometry,base=geometry.getAttribute('position');
  if(!base||geometry.morphAttributes.position?.length)continue;
  const toHand=inverseHand.clone().multiply(child.matrixWorld),toMesh=toHand.clone().invert();
  const deltas=new Float32Array(base.count*3);
  for(let i=0;i<base.count;i++){
   point.fromBufferAttribute(base,i).applyMatrix4(toHand);
   const dorsal=T.MathUtils.smoothstep(side*point.x,.202,.229);
   const envelope=Math.exp(-((point.z+.059)**2/.00039)-((point.y+.027)**2/.00115));
   const ripple=Math.sin((point.z+side*.21*point.x)*440+point.y*54);
   shift.copy(point);shift.x+=side*.00135*envelope*dorsal*ripple;
   shift.applyMatrix4(toMesh);point.fromBufferAttribute(base,i);shift.sub(point).toArray(deltas,i*3);
  }
  geometry.morphTargetsRelative=true;
  geometry.morphAttributes.position=[new T.BufferAttribute(deltas,3)];
  child.updateMorphTargets();meshes.push(child);
 }
 return meshes;
}
