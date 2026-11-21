import * as T from 'three';
import {embeddedGLB} from './embedded-glb';
import {serviceSuit,suitFabric} from './service-suit';
import suitURL from './assets/service-suit.glb.gz?url';
import library from './assets/pit-equipment.glb.gz?url';
import type {Track} from './track';
import {circuitHeight} from './elevation';
import {cornerService,frontJackPose,jackLift,pitBox,releaseGreen,ramp,type PitTelemetry} from './pit-service';
import {BOX_OFFSET,garageBay,type Constructor} from './pit-service';
import {constructors,grid} from './grid';
import {wheelStations} from './suspension';

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const up=V(0,1),identity=new T.Quaternion(),unit=V(1,1,1);
const colour=(compound?:string)=>compound==='hard'?'#e3dfd1':compound==='medium'?'#f2bd37':'#e4423e';

/** One instance batch per Blender part. All service poses are calculated in box-local metres. */
export function pitCrew(scene:T.Scene,track:Track){
 const groups=new Map<Constructor,T.Group>(),kits=new Map<T.Group,Map<string,T.InstancedMesh>>();
 let disposed=false,ready=false,error:string|undefined;
 const crews=new Map<T.Group,ReturnType<typeof serviceSuit>[]>();
 let build:((team:Constructor)=>void)|undefined,releaseSource:(()=>void)|undefined;
 const loaded=Promise.all([embeddedGLB(library,true),embeddedGLB(suitURL,true)]).then(([gltf,clothing])=>{
  const source=clothing.scene.getObjectByName('ServiceSuit') as T.SkinnedMesh;
  if(disposed){
   source.geometry.dispose();(source.material as T.Material).dispose();
   const materials=new Set<T.Material>();
   gltf.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const mat of ([] as T.Material[]).concat(o.material))materials.add(mat);}});
   for(const mat of materials){for(const v of Object.values(mat))if(v instanceof T.Texture)v.dispose();mat.dispose();}
   return;
  }
  for(const name of Object.keys(garageBay) as Constructor[]){
   const box=pitBox(track,name),q=track.pointAt(box,-24.10),forward=track.tangentAt(box);
   const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=64;
   const ctx=canvas.getContext('2d')!;ctx.fillStyle='#181a1c';ctx.fillRect(0,0,1024,64);
   ctx.fillStyle=constructors[name][0];ctx.fillRect(0,0,1024,9);ctx.fillRect(0,55,1024,9);
   ctx.textAlign='center';ctx.fillStyle='#ffffff';ctx.font='bold 41px Arial';ctx.fillText(name.toUpperCase(),512,48);
   const drivers=grid.filter(entry=>entry.team===name);ctx.font='bold 29px Arial';
   drivers.forEach((driver,i)=>ctx.fillText(driver.number+'  '+driver.code,i===0?100:924,46));
   const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
   const sign=new T.Mesh(new T.PlaneGeometry(27,.75),new T.MeshBasicMaterial({map}));
   sign.name=name+' garage';sign.position.set(q.x,circuitHeight(track.id,box)+4.31,q.z);
   sign.rotation.y=Math.atan2(forward.x,forward.z)-Math.PI/2;scene.add(sign);
  }
  build=team=>{
   const group=new T.Group(),kit=new Map<string,T.InstancedMesh>();
   gltf.scene.traverse(o=>{if(!(o instanceof T.Mesh))return;
    if(['Torso','Arm','Leg'].includes(o.name))return;
    const material=o.material.clone() as T.MeshStandardMaterial;
    if(o.name==='Helmet'){
     material.onBeforeCompile=shader=>{
      shader.uniforms.crewStripe={value:new T.Color(constructors[team][1])};
      shader.vertexShader='varying vec3 shell;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nshell=position;');
      shader.fragmentShader='uniform vec3 crewStripe;varying vec3 shell;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
       if(shell.y>.202){
        float stripe=1.-smoothstep(.010,.015,abs(abs(shell.x)-.042));
        diffuseColor.rgb=mix(diffuseColor.rgb,crewStripe,stripe);
       }`);
     };material.customProgramCacheKey=()=>'constructor-helmet-stripe';
    }
    material.roughness=o.name==='Helmet'?.29:o.name==='SocketGun'?.43:.91;
    const batch=new T.InstancedMesh(o.geometry,o.name==='ReleaseLens'?new T.MeshBasicMaterial({toneMapped:false}):material,o.name==='AirHose'?64:36);batch.name=team+' pit '+o.name;
    batch.count=0;batch.boundingSphere=new T.Sphere(V(2,1,0),10);
    batch.instanceMatrix.setUsage(T.DynamicDrawUsage);batch.castShadow=true;batch.receiveShadow=true;
    if(o.name==='ReleaseLens')material.dispose();
    if(o.name==='SoleContact'){
     batch.castShadow=false;batch.receiveShadow=false;material.transparent=true;
     material.depthWrite=false;material.polygonOffset=true;material.polygonOffsetFactor=-2;
    }
    kit.set(o.name,batch);group.add(batch);
   });
   for(const name of ['Helmet','Boot','Glove','SocketGun','JackFoot','JackHandle','SpareWheel','CompoundBand','SoleContact'])
    if(!kit.has(name))throw Error('Missing Blender service part '+name);
   const fabric=suitFabric(source.material as T.MeshStandardMaterial,team);
   const people=Array.from({length:16},()=>serviceSuit(source,fabric));crews.set(group,people);
   for(const actor of people)group.add(actor.mesh);
   group.visible=false;scene.add(group);groups.set(team,group);kits.set(group,kit);
  }
  build('Ferrari');build('Mercedes');
  releaseSource=()=>{
   gltf.scene.traverse(o=>{if(o instanceof T.Mesh){o.material.dispose();o.geometry.dispose();}});
   source.geometry.dispose();(source.material as T.Material).dispose();source.skeleton.dispose();
  };ready=true;
 }).catch(e=>{error=String(e);console.error('Blender pit equipment failed',e)});
 const m=new T.Matrix4(),tint=new T.Color(),oldTyre:Partial<Record<Constructor,string>>={};
 const lastStop:Partial<Record<Constructor,{offset:number;yaw:number}>>={};
 function update(team:Constructor,car:PitTelemetry|undefined,time:number){
  if(!car){const g=groups.get(team);if(g)g.visible=false;delete lastStop[team];return;}
  if(!groups.has(team))build?.(team);
  const group=groups.get(team);if(!group)return;
  const stopped=car.pit==='stopped',entry=car.pit==='entry',exit=car.pit==='exit';
  if(!stopped&&!exit)delete lastStop[team];
  if(!stopped&&!entry&&!exit){group.visible=false;return;}
  if(stopped)lastStop[team]={offset:Math.abs((car.offset??BOX_OFFSET)-BOX_OFFSET)<1?(car.offset??BOX_OFFSET):BOX_OFFSET,yaw:car.heading??0};
  const parked=lastStop[team],box=pitBox(track,team);
  const gap=track.wrap(car.distance-box+track.LENGTH/2)-track.LENGTH/2;
  group.visible=(entry&&gap>=-135&&gap<=2)||stopped||(exit&&gap>=-2&&gap<36);
  if(!group.visible)return;
  if(!exit)oldTyre[team]=car.compound??oldTyre[team];
  const seconds=stopped?(car.pitTime??0):entry?-1:3;
  const progress=entry?ramp(gap,-135,-54):exit?1-ramp(gap,4,36):1;
  const mark=track.pointAt(box,parked?.offset??BOX_OFFSET),forward=track.tangentAt(box);
  group.position.set(mark.x,circuitHeight(track.id,box)+.031,mark.z);
  group.rotation.y=Math.atan2(forward.x,forward.z)+(parked?.yaw??0);
  const kit=kits.get(group)!;for(const b of kit.values())b.count=0;
  let personIndex=0;const people=crews.get(group)!;
  function put(name:string,p:T.Vector3,q=identity,scale=unit,color='#ffffff'){
   const b=kit!.get(name)!,i=b.count++;b.setMatrixAt(i,m.compose(p,q,scale));b.setColorAt(i,tint.set(color));
  }
  // Resolve a two-bone chain, then orient the entire fabric skin in that
  // bend plane. Bone lengths stay fixed even when the hand target is distant.
  function chain(actor:ReturnType<typeof serviceSuit>,side:number,base:T.Vector3,end:T.Vector3,pole:T.Vector3,name:'Arm'|'Leg',a:number,b:number){
   const ray=end.clone().sub(base),distance=Math.max(.001,ray.length());ray.divideScalar(distance);
   const d=T.MathUtils.clamp(distance,Math.abs(a-b)+.001,a+b-.001);
   const h=(a*a-b*b+d*d)/(2*d),normal=pole.addScaledVector(ray,-pole.dot(ray)).normalize();
   const joint=base.clone().addScaledVector(ray,h).addScaledVector(normal,Math.sqrt(Math.max(0,a*a-h*h)));
   const tip=base.clone().addScaledVector(ray,d),upper=joint.clone().sub(base).normalize(),lower=tip.clone().sub(joint).normalize();
   const angle=Math.acos(T.MathUtils.clamp(upper.dot(lower),-1,1));
   actor.limb(name,side,base,joint,upper,lower,angle);return tip;
  }
  function person(hips:T.Vector3,yaw:number,lean:number,hands:T.Vector3[],role:'gun'|'carrier'|'jack'|'steady',phase:number,step:number,stride:number,stance:T.Vector3){
   const dir=new T.Quaternion().setFromAxisAngle(up,yaw);
   const breath=Math.sin(time*2.8+phase);
   const twist=.10*Math.sin(phase)+.12*stride;
   const torso=new T.Quaternion().setFromEuler(new T.Euler(lean+.011*breath,yaw+twist,.035*stride,'YXZ'));
   const mount=(x:number,y:number,z:number)=>V(x,y,z).applyQuaternion(torso).add(hips);
   // Follow a two-handed grip with the shoulders and pelvis. Knees take
   // the load while the boots stay at their independent support positions.
   for(let pass=0;pass<2;pass++)for(const [i,side] of [-1,1].entries()){
    const delta=hands[i].clone().sub(mount(side*.166,.425,0)),length=delta.length();
    if(length>.557)hips.addScaledVector(delta,(length-.557)/length);
   }
   const actor=people[personIndex++];actor.core(hips,torso);
   const eye=mount(0,.515,.012),aim=hands[0].clone().lerp(hands[1],.5).sub(eye);
   const headYaw=Math.atan2(aim.x,aim.z),headPitch=Math.atan2(-aim.y,Math.hypot(aim.x,aim.z));
   const head=new T.Quaternion().setFromEuler(new T.Euler(T.MathUtils.clamp(headPitch*.65,.10,.79),headYaw+.023*breath,.035*Math.sin(phase),'YXZ'));
   put('Helmet',eye,head);
   for(const [i,side] of [-1,1].entries()){
    const kneeling=role==='gun',trail=side<0;
    const forward=kneeling?(trail?-.41:.37):.20*side;
    const foot=V(side*(kneeling?.19:.17),0,forward).applyQuaternion(dir).add(stance);
    const cycle=foot.x/.52+i*.5,frac=cycle-Math.floor(cycle),swing=ramp(frac,.37,.97);
    const walking=ramp(progress,0,.12)*(1-ramp(progress,.88,1));
    foot.x+=walking*(swing-frac)*.52;
    // On the transfer step one foot accepts the load before the other moves.
    const lead=Math.sin(phase*4.7)>0?0:1;
    const stagger=.035*Math.sin(phase*2.9);
    const stepping=i===lead?ramp(step,.045+stagger,.52+stagger):ramp(step,.53+stagger,.96+stagger);
    foot.x+=stride*stepping;
    foot.y=.060+walking*.09*Math.sin(Math.PI*swing)+.075*Math.sin(Math.PI*stepping);
    // A long withdrawal step must still land under the pelvis. Shorten its
    // horizontal reach while keeping the sole on the apron.
    const hip=mount(side*.097,0,0),dx=foot.x-hip.x,dz=foot.z-hip.z;
    const reach=Math.sqrt(Math.max(0,.858**2-(foot.y-hip.y)**2));
    const planar=Math.hypot(dx,dz);
    if(planar>reach){foot.x=hip.x+dx*reach/planar;foot.z=hip.z+dz*reach/planar;}
    const knee=kneeling&&trail?V(side*.22,-1,.25):V(side*.21,.04,1);
    chain(actor,side,hip,foot,knee.applyQuaternion(dir),'Leg',.43,.43);
    put('Boot',foot.clone().add(V(0,-.060,0)),dir);
    const contact=Math.max(.2,1-(foot.y-.060)*7);
    put('SoleContact',V(foot.x,.008,foot.z),dir,V(contact,1,contact));
    const wrist=chain(actor,side,mount(side*.166,.425,0),hands[i],V(side*.80,-.85,-.23).applyQuaternion(dir),'Arm',.31,.27);
    const grip=dir.clone().multiply(new T.Quaternion().setFromAxisAngle(V(1,0,0),role==='gun'?.20:.56));
    put('Glove',wrist,grip);
   }
  }
  function tyre(p:T.Vector3,q:T.Quaternion,i:number,ink:string){
   const scale=V(i<2?.92:1.10,1,1);put('SpareWheel',p,q,scale);put('CompoundBand',p,q,scale,ink);
  }
  // Two cross-bay booms feed the wheel guns from above. Leave the lane
  // and the carriers' route clear; only the short working end travels.
  const hoseRay=V(),hoseQ=new T.Quaternion();
  function hose(anchor:T.Vector3,end:T.Vector3,side:number){
   const curve=new T.CubicBezierCurve3(anchor,anchor.clone().add(V(side*.21,-.55,.02)),
    end.clone().add(V(side*.39,-.28,-.09)),end);
   let last=anchor;
   for(let j=1;j<=10;j++){
    const next=curve.getPoint(j/10);hoseRay.subVectors(next,last);
    const length=hoseRay.length();hoseQ.setFromUnitVectors(up,hoseRay.normalize());
    put('AirHose',last,hoseQ,V(1,length+.006,1));last=next;
   }
  }
  for(const z of [1.55,-2.05])put('HoseBoom',V(3.62,0,z-.36));
  const lamp=V(.34,2.62,1.55-.36);put('ReleaseHousing',lamp);
  put('ReleaseLens',lamp,identity,unit,releaseGreen(seconds)?'#67ff80':'#fc3127');
  for(const [i,w] of wheelStations.entries()){
   const side=Math.sign(w.x),z=w.z,stage=cornerService(seconds,i),y=.365+jackLift(car);
   const clear=exit?1:ramp(seconds,2.0,2.42),idle=1-progress;
   const offset=(x:number)=>T.MathUtils.lerp(6.1+side*.55,x,progress);
   const yaw=-side*Math.PI/2,gunDir=new T.Quaternion().setFromAxisAngle(up,yaw);
   const back=1-stage.gun,ready=ramp(gap,-38,-3);
   const gun=V(offset(side*(Math.abs(w.x)+.472+.23*back+.29*clear)),y+.012+.095*clear,z-.10*back);
   const gunQ=gunDir.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(.18*back,0,.045*stage.gun*Math.sin(seconds*79+i))));
   put('SocketGun',gun,gunQ);
   hose(V(side>0?2.27:-.83,2.83,z-.36),V(0,-.145,.018).applyQuaternion(gunQ).add(gun),side);
   const gunHome=V(offset(side*1.87),0,z-.10);
   const gunHands=[V(-.039,-.078,.018),V(.040,-.013,.109)].map(h=>h.applyQuaternion(gunQ).add(gun));
   // A short free-hand signal follows the final torque pulse at each corner.
   const signal=ramp(seconds,1.99+i*.039,2.19+i*.043);
   gunHands[1].lerp(V(gunHome.x+side*.24,1.10,z+.12),signal);
   person(V(gunHome.x+side*(.18*back+.24*clear),.54+.19*idle+.13*clear-.050*ready,z-.12),
    yaw,.77+.12*stage.gun-.22*clear,gunHands,'gun',i+1,clear,side*.19,gunHome);

   // Pull straight off the stub axle before turning away; the replacement
   // swings into alignment first and is then pushed squarely onto the hub.
   const pull=ramp(stage.remove,0,.54),carry=ramp(stage.remove,.26,1);
   const align=ramp(stage.fit,0,.68),seat=ramp(stage.fit,.57,1);
   const old=V(offset(w.x+side*(.46*pull+.48*carry)),y+.27*carry+.04*Math.sin(carry*Math.PI),z-.87*carry);
   const fresh=V(offset(w.x+side*(.48*(1-seat)+.47*(1-align))),y+.31*(1-align),z+.92*(1-align));
   const oldQ=new T.Quaternion().setFromEuler(new T.Euler(.16*carry,side*.31*carry,.09*side*carry));
   const newQ=new T.Quaternion().setFromEuler(new T.Euler(-.14*(1-align),-side*.29*(1-align),-.09*side*(1-align)));
   if(stage.off||stage.remove>=1)tyre(old,oldQ,i,colour(oldTyre[team]));
   if(stage.fit<1)tyre(fresh,newQ,i,colour(car.instruction?.tyre));
   for(const k of [-1,1]){
    const removing=k<0,held=removing?old:fresh,q=removing?oldQ:newQ;
    const shift=removing?carry:1-align,transfer=removing?carry:align;
    const release=removing?0:ramp(seconds,1.73+i*.015,2.16);
    const home=V(offset(side*(1.33+.32*(removing?0:1))),0,z+k*(.68+.58*shift));
    const brace=removing?ramp(seconds,.17+i*.021,.47+i*.021)*(1-carry):align*(1-seat);
    const hips=V(offset(side*(1.33+.40*shift+.31*release-.075*brace)),.61+.25*shift+.18*release+.10*idle-.065*brace,z+k*(.70+.72*shift+.20*release));
    hips.z+=k*.058*Math.sin(transfer*Math.PI);
    const look=Math.atan2(held.x-hips.x,held.z-hips.z);
    const right=V(Math.cos(look),0,-Math.sin(look));
    const contacts=[-1,1].map(sign=>V(side*.10,.13+sign*.045,sign*.255).applyQuaternion(q).add(held));
    if(contacts[1].clone().sub(contacts[0]).dot(right)<0)contacts.reverse();
    for(const [n,h] of contacts.entries()){
     const rest=hips.clone().addScaledVector(right,n===0?-.19:.19).add(V(-side*.21,.15,-k*.19));
     h.lerp(rest,release);
    }
    person(hips,look,.84-.22*shift-.46*release,contacts,'carrier',i*1.9+k,transfer,side*(removing?.38:-.32),home);
   }
  }
  // Stabilisers steady the chassis beside the cockpit during the lift.
  for(const side of [-1,1]){
   const hold=ramp(seconds,-.06,.22)*(1-ramp(seconds,2.08,2.38));
   const home=V(side*(1.16+(1-progress)*1.9),0,-.46);
   const hips=home.clone().add(V(-side*.10*hold,.80-.085*hold,0));
   const hands=[-.18,.14].map(dz=>V(side*(1.01-.55*hold+(1-progress)*1.9),.87+.025*hold,-.48+dz));
   person(hips,-side*Math.PI/2,.34+.72*hold,hands,'steady',side+7,0,0,home);
  }
  for(const side of [-1,1]){
   const sweep=frontJackPose(seconds);
   const rearClear=ramp(seconds,2.26,2.55);
   const pull=side>0?sweep.withdraw:(entry?1:1-ramp(seconds,-.1,.20));
   const approach=(1-progress)*5.9;
   const x=approach+(side>0?sweep.x:pull*1.07),yaw=side>0?Math.PI:0;
   const nose=side>0?2.83+sweep.z:2.71+pull*.20+.42*rearClear,origin=V(x,0,side*nose),face=new T.Quaternion().setFromAxisAngle(up,yaw);
   const angle=stopped?.24*ramp(seconds,.02,.27)*(1-ramp(seconds,2.12,2.37)):0;
   const handleFace=face.clone().multiply(new T.Quaternion().setFromAxisAngle(up,side>0?sweep.handleYaw:0));
   const jack=handleFace.clone().multiply(new T.Quaternion().setFromAxisAngle(V(1,0,0),-angle));
   put('JackFoot',origin,face);put('JackHandle',origin,jack);
   const hands=[-1,1].map(k=>V(k*.17,.90,-.82).applyQuaternion(jack).add(origin));
   const pivot=side>0?sweep.pivot:0;
   const stance=V(side>0?approach+.76*pull:x-pull*.34,0,origin.z+side*(1.21-.47*pivot));
   const bodyX=side>0?approach+1.06*pivot+.65*pull:x;
   person(V(bodyX,.75+.09*pull,stance.z+side*.08),yaw+(side>0?sweep.handleYaw:0),.45+.16*ramp(seconds,.04,.27)-.15*pull,hands,'jack',side,side>0?pivot:pull,side>0?.85:.34,stance);
  }
  for(const batch of kit.values()){batch.instanceMatrix.needsUpdate=true;if(batch.instanceColor)batch.instanceColor.needsUpdate=true;}
 }
 return {update,loaded,get ready(){return ready},get error(){return error},dispose(){disposed=true;releaseSource?.();for(const group of groups.values())for(const child of group.children){if(child instanceof T.SkinnedMesh)child.skeleton.dispose();else if(child instanceof T.InstancedMesh)child.dispose();}}};
}
