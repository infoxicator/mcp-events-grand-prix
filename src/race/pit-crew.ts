import * as T from 'three';
import {embeddedGLB} from './embedded-glb';
import library from './assets/pit-equipment.glb.gz?url&inline';
import type {Track} from './track';
import {circuitHeight} from './elevation';
import {cornerService,jackLift,pitBox,ramp,type PitTelemetry} from './pit-service';
import {wheelStations} from './suspension';

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const up=V(0,1),identity=new T.Quaternion(),unit=V(1,1,1);
const colour=(compound?:string)=>compound==='hard'?'#e3dfd1':compound==='medium'?'#f2bd37':'#e4423e';

/** One instance batch per Blender part. All service poses are calculated in box-local metres. */
export function pitCrew(scene:T.Scene,track:Track){
 const groups=new Map<'a'|'b',T.Group>(),kits=new Map<T.Group,Map<string,T.InstancedMesh>>();
 let disposed=false,ready=false,error:string|undefined;
 const loaded=embeddedGLB(library,true).then(gltf=>{
  if(disposed){
   const materials=new Set<T.Material>();
   gltf.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const mat of ([] as T.Material[]).concat(o.material))materials.add(mat);}});
   for(const mat of materials){for(const v of Object.values(mat))if(v instanceof T.Texture)v.dispose();mat.dispose();}
   return;
  }
  for(const team of ['a','b'] as const){
   const group=new T.Group(),kit=new Map<string,T.InstancedMesh>();
   gltf.scene.traverse(o=>{if(!(o instanceof T.Mesh))return;
    const batch=new T.InstancedMesh(o.geometry,o.material,32);batch.count=0;batch.boundingSphere=new T.Sphere(V(2,1,0),10);
    batch.instanceMatrix.setUsage(T.DynamicDrawUsage);batch.castShadow=true;batch.receiveShadow=true;
    kit.set(o.name,batch);group.add(batch);
   });
   for(const name of ['Torso','Helmet','Sleeve','Forearm','Thigh','Shin','Boot','Glove','SocketGun','JackFoot','JackHandle','SpareWheel','CompoundBand'])
    if(!kit.has(name))throw Error('Missing Blender service part '+name);
   group.visible=false;scene.add(group);groups.set(team,group);kits.set(group,kit);
  }
  ready=true;
 }).catch(e=>{error=String(e);console.error('Blender pit equipment failed',e)});
 const m=new T.Matrix4(),tint=new T.Color(),oldTyre={a:'soft',b:'medium'};
 const lastStop:Partial<Record<'a'|'b',{station:number;offset:number;yaw:number}>>={};
 function update(team:'a'|'b',car:PitTelemetry){
  const group=groups.get(team);if(!group)return;
  const stopped=car.pit==='stopped',entry=car.pit==='entry',exit=car.pit==='exit';
  if(!stopped&&!exit)delete lastStop[team];
  if(!stopped&&!entry&&!exit){group.visible=false;return;}
  if(stopped)lastStop[team]={station:track.wrap(car.distance),offset:car.offset??track.pitOffset(car.distance),yaw:car.heading??0};
  const parked=lastStop[team],box=parked?.station??pitBox(track,team);
  const gap=track.wrap(car.distance-box+track.LENGTH/2)-track.LENGTH/2;
  group.visible=(entry&&gap>=-135&&gap<=2)||stopped||(exit&&gap>=-2&&gap<36);
  if(!group.visible)return;
  if(!exit)oldTyre[team]=car.compound??oldTyre[team];
  const seconds=stopped?(car.pitTime??0):entry?-1:3;
  const progress=entry?ramp(gap,-135,-54):exit?1-ramp(gap,4,36):1;
  const mark=track.pointAt(box,parked?.offset??track.pitOffset(box)),forward=track.tangentAt(box);
  group.position.set(mark.x,circuitHeight(track.id,box)+.031,mark.z);
  group.rotation.y=Math.atan2(forward.x,forward.z)+(parked?.yaw??0);
  const kit=kits.get(group)!;for(const b of kit.values())b.count=0;
  const suit=team==='a'?'#b8463b':'#4c929f';
  function put(name:string,p:T.Vector3,q=identity,scale=unit,color='#ffffff'){
   const b=kit!.get(name)!,i=b.count++;b.setMatrixAt(i,m.compose(p,q,scale));b.setColorAt(i,tint.set(color));
  }
  function along(name:string,a:T.Vector3,b:T.Vector3,length:number){
   const delta=b.clone().sub(a),len=delta.length();if(len<.001)return;
   put(name,a,new T.Quaternion().setFromUnitVectors(up,delta.divideScalar(len)),V(1,len/length,1),suit);
  }
  // Analytic two-link solve keeps elbows, knees, wrists and ankles connected throughout the transfer.
  function chain(base:T.Vector3,end:T.Vector3,pole:T.Vector3,first:string,second:string,a:number,b:number){
   const ray=end.clone().sub(base),dist=Math.max(.001,ray.length());ray.divideScalar(dist);
   const d=T.MathUtils.clamp(dist,Math.abs(a-b)+.001,a+b-.001);
   const alongRay=(a*a-b*b+d*d)/(2*d),normal=pole.addScaledVector(ray,-pole.dot(ray)).normalize();
   const joint=base.clone().addScaledVector(ray,alongRay).addScaledVector(normal,Math.sqrt(Math.max(0,a*a-alongRay*alongRay)));
   const tip=base.clone().addScaledVector(ray,d);
   along(first,base,joint,a);along(second,joint,tip,b);return tip;
  }
  function person(hip:T.Vector3,yaw:number,lean:number,hands:T.Vector3[]){
   const dir=new T.Quaternion().setFromAxisAngle(up,yaw),torso=new T.Quaternion().setFromEuler(new T.Euler(lean,yaw,0,'YXZ'));
   const mount=(x:number,y:number,z:number)=>V(x,y,z).applyQuaternion(torso).add(hip);
   put('Torso',hip,torso,unit,suit);put('Helmet',mount(0,.52,.012),torso);
   for(const [i,side] of [-1,1].entries()){
    // Alternate planted feet while crossing the apron. Each support foot
    // stays at a fixed world X until its partner takes the load.
    const foot=V(side*.16,0,side*.14).applyQuaternion(dir).add(hip);
    const walking=progress>0&&progress<1;
    const spacing=.53,phase=foot.x/spacing+(i===0?0:.5);
    const cycle=phase-Math.floor(phase),swing=ramp(cycle,.36,.97);
    const amplitude=walking?ramp(progress,0,.13)*(1-ramp(progress,.90,1)):0;
    foot.x+=amplitude*(swing-cycle)*spacing;
    foot.y=.05+amplitude*.095*Math.sin(Math.PI*swing);
    chain(mount(side*.093,.015,0),foot,V(side*.16,0,1).applyQuaternion(dir),'Thigh','Shin',.43,.43);
    put('Boot',foot.clone().add(V(0,-.05,0)),dir);
    const hand=chain(mount(side*.167,.435,0),hands[i],V(side*.80,-.90,-.17).applyQuaternion(dir),'Sleeve','Forearm',.31,.27);
    put('Glove',hand,dir);
   }
  }
  function tyre(p:T.Vector3,i:number,ink:string){
   const scale=V(i<2?.92:1.10,1,1);put('SpareWheel',p,identity,scale);put('CompoundBand',p,identity,scale,ink);
  }
  for(const [i,w] of wheelStations.entries()){
   const side=Math.sign(w.x),z=w.z,stage=cornerService(seconds,i),y=.365+jackLift(car);
   const clear=exit?1:ramp(seconds,2.02,2.40);
   const idle=(1-progress);
   // All crew leave from the garage side. Both flanks are set before the car enters the box.
   const offset=(x:number)=>T.MathUtils.lerp(6.1+side*.55,x,progress);
   const gunRetreat=(1-stage.gun)*.21+clear*.24;
   const gun=V(offset(side*(1.30+gunRetreat)),y+.012,z);
   const yaw=-side*Math.PI/2;
   const gunQ=new T.Quaternion().setFromAxisAngle(up,yaw);
   put('SocketGun',gun,gunQ);
   person(V(offset(side*(1.77+gunRetreat)),.63+idle*.16,z),yaw,.54,
    [gun.clone().add(V(-side*.13,.005,.025)),gun.clone().add(V(0,-.075,-.014))]);
   const old=V(offset(w.x+side*(.83*stage.remove)),y+.14*stage.remove,z-.88*stage.remove);
   const fresh=V(offset(w.x+side*1.03*(1-stage.fit)),y+.17*(1-stage.fit),z+.94*(1-stage.fit));
   if(stage.off||stage.remove>=1)tyre(old,i,colour(oldTyre[team]));
   if(stage.fit<1)tyre(fresh,i,colour(car.instruction?.tyre));
   for(const direction of [-1,1]){
    const removed=direction<0,held=removed?old:fresh;
    const shift=removed?stage.remove:1-stage.fit;
    const service=stopped?(removed?1-ramp(seconds,1.02,1.43):ramp(seconds,.79,1.16)*(1-ramp(seconds,1.73,2.08))):0;
    const hip=V(offset(side*(1.22+.57*shift+.26*(1-service)+clear*.26)),.72+idle*.12,z+direction*(.76+.63*shift));
    const look=Math.atan2(held.x-hip.x,held.z-hip.z);
    const across=V(Math.cos(look),0,-Math.sin(look));
    const hands=[-1,1].map(k=>held.clone().addScaledVector(across,k*.17).add(V(0,.16,direction*.16)));
    person(hip,look,.55,hands);
   }
  }
  for(const side of [-1,1]){
   const pull=side>0?(exit?1:ramp(seconds,2.13,2.52)):(entry?1:1-ramp(seconds,-.1,.20));
   const x=(1-progress)*5.9+pull*1.07, yaw=side>0?Math.PI:0;
   const nose=side>0?2.83:2.71,origin=V(x,0,side*(nose+pull*.20)),face=new T.Quaternion().setFromAxisAngle(up,yaw);
   const angle=stopped?.24*ramp(seconds,.02,.27)*(1-ramp(seconds,2.12,2.37)):0;
   const jack=face.clone().multiply(new T.Quaternion().setFromAxisAngle(V(1,0,0),-angle));
   put('JackFoot',origin,face);put('JackHandle',origin,jack);
   const hands=[-1,1].map(k=>V(k*.17,.90,-.82).applyQuaternion(jack).add(origin));
   person(V(x,.85,origin.z+side*1.11),yaw,.28,hands);
  }
  for(const batch of kit.values()){batch.instanceMatrix.needsUpdate=true;if(batch.instanceColor)batch.instanceColor.needsUpdate=true;}
 }
 return {update,loaded,get ready(){return ready},get error(){return error},dispose(){disposed=true;for(const group of groups.values())for(const child of group.children)(child as T.InstancedMesh).dispose();}};
}
