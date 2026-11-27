import * as T from 'three';
import type {RenderRace} from './scene';
import type {Track} from './track';

/** Reconstruct each burst from the contact timestamp so replay and live views agree. */
export function impactEffects(scene:T.Scene,track:Track,heightAt:(distance:number)=>number){
 const chipMaterial=new T.MeshStandardMaterial({color:'#282d31',metalness:.28,roughness:.56});
 const hotMaterial=new T.MeshBasicMaterial({color:new T.Color(4,1.42,.28),toneMapped:false});
 const chip=new T.InstancedMesh(new T.TetrahedronGeometry(.055),chipMaterial,132);
 const hot=new T.InstancedMesh(new T.PlaneGeometry(.021,.26),hotMaterial,132);
 for(const pool of [chip,hot]){pool.frustumCulled=false;pool.count=0;scene.add(pool);}
 const pose=new T.Object3D();
 return {update(race:RenderRace,camera:T.Camera){
  chip.count=hot.count=0;
  for(let i=0;i<2+(race.field?.length??0);i++){
   const car=i===0?race.cars.a:i===1?race.cars.b:race.field![i-2];
   if(!car.lastImpact)continue;
   const age=race.time-car.lastImpact.time;if(age<0||age>1.1)continue;
   for(let j=0;j<6;j++){
    const station=car.distance-age*car.speed*(.42+j*.05);
    const p=track.pointAt(station,car.offset+Math.sin(j*8.3)*age*(3+j*.7));
    pose.position.set(p.x,heightAt(station)+.045+Math.abs(.32+(1.8+j*.29)*age-5*age*age)*Math.exp(-2*age),p.z);
    pose.rotation.set(j+age*(4+j),age*(7+j),j*.8);pose.scale.set(1,.35,1.6);pose.updateMatrix();
    chip.setMatrixAt(chip.count++,pose.matrix);
    if(age<.42){pose.quaternion.copy(camera.quaternion);pose.rotateZ(j+age*2);pose.scale.setScalar(1-age/.44);pose.updateMatrix();hot.setMatrixAt(hot.count++,pose.matrix);}
   }
  }
  for(const pool of [chip,hot]){pool.visible=pool.count>0;if(pool.visible)pool.instanceMatrix.needsUpdate=true;}
 },dispose(){for(const pool of [chip,hot]){pool.removeFromParent();pool.geometry.dispose();pool.material.dispose();pool.dispose();}}};
}
