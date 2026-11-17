import * as T from 'three';
const elbow=new T.Vector3(),wrist=new T.Vector3(),axis=new T.Vector3(0,1,0),direction=new T.Vector3();
/** Pose the Blender unit-axis sleeves between seated elbows and moving glove cuffs. */
export function poseForearms(model:T.Object3D,steering:T.Object3D,visible=true){
 for(const side of [-1,1]){
  const arm=model.getObjectByName(side<0?'ForearmL':'ForearmR');if(!arm)continue;
  arm.visible=visible;elbow.set(side*.25,.31,-.23);
  wrist.set(side*(.216-.205*(1-.85)),-.071,-.117).applyQuaternion(steering.quaternion).add(steering.position);
  direction.copy(wrist).sub(elbow);arm.position.copy(elbow);arm.scale.set(1,direction.length(),1);arm.quaternion.setFromUnitVectors(axis,direction.normalize());
 }
}
/** Small contact-preserving grip changes, deterministic from car telemetry. Radians. */
export function fingerCurl(side:-1|1,digit:number,steering:number,distance:number,speed:number){
 const load=Math.max(-1,Math.min(1,steering/.25))*side;
 const pressure=[.021,.032,.028,.018,.012][digit]??0;
 const breathe=speed>1?Math.sin(distance*.018+digit*1.73+side)*.0035:0;
 return {curl:side*(pressure*load+breathe),spread:side*load*(digit-2)*.0025};
}
