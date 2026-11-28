import * as T from 'three';
import type {RenderRace} from './scene';
import type {Track} from './track';

/** Reconstruct each burst from the contact timestamp so replay and live views agree. */
export function impactEffects(scene:T.Scene,track:Track,heightAt:(distance:number)=>number){
 const chipMaterial=new T.MeshStandardMaterial({color:'#ffffff',metalness:.28,roughness:.56});
 const hotMaterial=new T.MeshBasicMaterial({color:new T.Color(4,1.42,.28),toneMapped:false});
 const chip=new T.InstancedMesh(new T.TetrahedronGeometry(.055),chipMaterial,22*22);
 const hot=new T.InstancedMesh(new T.PlaneGeometry(.021,.26),hotMaterial,132);
 for(const pool of [chip,hot]){pool.frustumCulled=false;pool.count=0;scene.add(pool);}
 const pose=new T.Object3D(),tint=new T.Color();
 const contacts=new Map<number,{time:number;station:number;offset:number;speed:number}>();
 return {update(race:RenderRace,camera:T.Camera){
  chip.count=hot.count=0;
  for(let i=0;i<2+(race.field?.length??0);i++){
   const car=i===0?race.cars.a:i===1?race.cars.b:race.field![i-2];
   if(!car.lastImpact)continue;
   const age=race.time-car.lastImpact.time;if(age<0||age>5)continue;
   let hit=contacts.get(i);
   if(hit?.time!==car.lastImpact.time){hit={time:car.lastImpact.time,station:car.distance-age*car.speed,offset:car.offset,speed:car.speed};contacts.set(i,hit);}
   for(let j=0;j<22;j++){
    const travel=1-Math.exp(-age*2.5),air=Math.max(0,1-age/(.54+.021*j));
    const station=hit.station+travel*(hit.speed*.08+Math.cos(j*6.7)*2);
    const p=track.pointAt(station,hit.offset+Math.sin(j*8.3)*(.3+travel*(1+j*.14)));
    pose.position.set(p.x,heightAt(station)+.024+air*(.23+age*(2+j*.12)),p.z);
    pose.rotation.set(air*(j+age*(4+j)),j+travel*6,air*j*.8);pose.scale.set(.5+(j%4)*.4,.14,1+j%5*.5);pose.updateMatrix();
    chip.setMatrixAt(chip.count,pose.matrix);
    chip.setColorAt(chip.count++,tint.set(j%3?'#27282a':i===0?'#ba1b29':i===1?'#8eabad':'#536575'));
    if(j<6&&age<.42){pose.quaternion.copy(camera.quaternion);pose.rotateZ(j+age*2);pose.scale.setScalar(1-age/.44);pose.updateMatrix();hot.setMatrixAt(hot.count++,pose.matrix);}
   }
  }
  if(chip.count)chip.instanceColor!.needsUpdate=true;
  for(const pool of [chip,hot]){pool.visible=pool.count>0;if(pool.visible)pool.instanceMatrix.needsUpdate=true;}
 },dispose(){for(const pool of [chip,hot]){pool.removeFromParent();pool.geometry.dispose();pool.material.dispose();pool.dispose();}}};
}
