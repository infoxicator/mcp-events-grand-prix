/** Deterministic A/B replay of the previous and current aerial camera math. */
import {PerspectiveCamera,Vector3} from 'three';
import {getTrack} from '../src/race/track';
import {AerialCameraRig} from '../src/race/aerial-camera';
import {writeFileSync} from 'node:fs';
const results=[];
for(const id of ['monza','las-vegas'] as const){
 const track=getTrack(id),rig=new AerialCameraRig(),old=new PerspectiveCamera(),next=new PerspectiveCamera();
 const frames=[];let oldTravel=0,newTravel=0,oldMax=0,newMax=0;
 let previousOld=old.quaternion.clone(),previousNew=next.quaternion.clone();
 for(let i=0;i<=390;i++){
  const time=i/60,d=(id==='monza'?60:4250)+time*70;
  const a={distance:d+Math.sin(time*5)*2,offset:-1.5+Math.sin(time*6)*.7},b={distance:d-Math.sin(time*5)*2,offset:1.5+Math.sin(time*6)*.7};
  const c=a.distance>=b.distance?a:b,other=c===a?b:a,p=track.pointAt(c.distance,c.offset),q=track.pointAt(other.distance,other.offset),t=track.tangentAt(c.distance);
  const target=new Vector3(p.x,.5,p.z).lerp(new Vector3(q.x,.5,q.z),.35);
  old.position.set(target.x-t.x*75-t.z*100,target.y+190,target.z-t.z*75+t.x*100);old.lookAt(target);
  rig.update(track,a,b,()=>0,time*1000);next.position.copy(rig.position);next.lookAt(rig.target);
  if(i>42){const oldStep=old.quaternion.angleTo(previousOld),newStep=next.quaternion.angleTo(previousNew);oldTravel+=oldStep;newTravel+=newStep;oldMax=Math.max(oldMax,oldStep*60);newMax=Math.max(newMax,newStep*60);}
  previousOld.copy(old.quaternion);previousNew.copy(next.quaternion);
  frames.push({time,oldPosition:old.position.toArray(),newPosition:next.position.toArray()});
 }
 results.push({circuit:id,oldAngularTravel:oldTravel,newAngularTravel:newTravel,oldPeakAngularRate:oldMax,newPeakAngularRate:newMax,frames});
}
writeFileSync('artifacts/onboard-v9/aerial-before-after.json',JSON.stringify(results,null,2)+'\n');
console.log(results.map(({frames,...summary})=>summary));
