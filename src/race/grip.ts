import * as T from 'three';

const up=new T.Vector3(0,1,0);
const wrist=new T.Vector3(),shoulder=new T.Vector3(),elbow=new T.Vector3(),centre=new T.Vector3();
const along=new T.Vector3(),bend=new T.Vector3(),direction=new T.Vector3();
const restAxis=new T.Vector3(),right=new T.Vector3(),normal=new T.Vector3();
const chassisRotation=new T.Quaternion(),handRotation=new T.Quaternion(),basis=new T.Matrix4();
const UPPER_LENGTH=.291,FORE_LENGTH=.290;

type ArmRig={side:number;upper:T.Object3D;fore:T.Object3D;hand:T.Object3D;joint:T.Object3D};
const armCache=new WeakMap<T.Object3D,ArmRig[]>();

/** Put the forearm end at the carpal joint. The fingers stay on the rim.
 * The gauntlet rolls with the sleeve and the elbow moves around the reach circle. */
export function poseForearms(model:T.Object3D,steering:T.Object3D,visible=true){
 let arms=armCache.get(model);
 if(!arms){
  arms=[];
  for(const [suffix,side] of [['L',-1],['R',1]] as const){
   const fore=model.getObjectByName('Forearm'+suffix),upper=model.getObjectByName('UpperArm'+suffix);
   const hand=steering.getObjectByName('Hand'+suffix),joint=hand?.getObjectByName('Wrist'+suffix);
   if(fore&&upper&&hand&&joint)arms.push({side,upper,fore,hand,joint});
  }
  armCache.set(model,arms);
 }
 for(const {side,upper,fore,hand,joint} of arms){
  fore.visible=upper.visible=visible;
  if(!visible)continue;
  const chassis=fore.parent!;
  chassis.worldToLocal(joint.getWorldPosition(wrist));
  chassis.getWorldQuaternion(chassisRotation).invert();
  hand.getWorldQuaternion(handRotation).premultiply(chassisRotation);
  restAxis.set(-side*.007,.029,.045).normalize();
  shoulder.copy(upper.position);
  along.subVectors(wrist,shoulder);const reach=along.length();along.divideScalar(reach);
  const advance=(UPPER_LENGTH**2+reach**2-FORE_LENGTH**2)/(2*reach);
  centre.copy(shoulder).addScaledVector(along,advance);
  const radius=Math.sqrt(Math.max(0,UPPER_LENGTH**2-advance**2));
  // The rising elbow lifts beside the ribs. The lowering elbow folds inward
  // across the lap. A continuous pole trajectory avoids the flip produced
  // by choosing either of two points on a constrained reach circle.
  const turn=T.MathUtils.clamp(side*steering.rotation.z/(.42*3.6),-1,1);
  const rise=Math.max(0,turn),fold=Math.max(0,-turn);
  bend.set(side*(.222-.221*fold**1.35-.014*Math.sin(Math.PI*rise)),
   .358+.272*rise**1.15-.04*Math.sin(Math.PI*fold),-.125-.073*fold-.056*rise).sub(centre);
  bend.addScaledVector(along,-bend.dot(along)).normalize();
  elbow.copy(centre).addScaledVector(bend,radius);
  upper.quaternion.setFromUnitVectors(up,direction.subVectors(elbow,shoulder).normalize());
  fore.position.copy(elbow);direction.subVectors(wrist,elbow).normalize();
  // The suit seam pronates with the hand. Construct an orthonormal frame
  // instead of allowing a shortest-arc rotation to choose the sleeve roll.
  right.set(1,0,0).applyQuaternion(handRotation);
  normal.crossVectors(right,direction).normalize();right.crossVectors(direction,normal).normalize();
  fore.quaternion.setFromRotationMatrix(basis.makeBasis(right,direction,normal));
  direction.applyQuaternion(handRotation.invert());
  joint.quaternion.setFromUnitVectors(restAxis,direction);
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
 hand.updateWorldMatrix(true,true);hand.updateMatrixWorld(true);
 const inverseHand=hand.matrixWorld.clone().invert(),point=new T.Vector3(),shift=new T.Vector3();
 const meshes:T.Mesh[]=[];
 const candidates:T.Mesh[]=[];
 hand.traverse(o=>{if(o instanceof T.Mesh&&(o.parent===hand||o instanceof T.SkinnedMesh))candidates.push(o);});
 for(const child of candidates){
  if(!(child instanceof T.Mesh))continue;
  const geometry=child.geometry,base=geometry.getAttribute('position');
  if(!base)continue;
  if(geometry.morphAttributes.position?.length){
   if(!child.morphTargetInfluences)child.updateMorphTargets();
   if(geometry.userData?.gloveCompression)meshes.push(child);
   continue;
  }
  const toHand=inverseHand.clone().multiply(child.matrixWorld);
  if(child instanceof T.SkinnedMesh){
   // glTF positions are in the skin bind space. At setup all joints are in their
   // rest pose and share this transform into the rendered hand frame.
   toHand.multiply(child.bindMatrixInverse).multiply(child.skeleton.bones[0].matrixWorld)
    .multiply(child.skeleton.boneInverses[0]).multiply(child.bindMatrix);
  }
  const toMesh=toHand.clone().invert();
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
  geometry.userData={...geometry.userData,gloveCompression:true};
  child.updateMorphTargets();meshes.push(child);
 }
 return meshes;
}
