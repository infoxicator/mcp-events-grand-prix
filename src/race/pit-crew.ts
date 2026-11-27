import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {MeshResources} from './mesh-resources';
import {pitHoses} from './pit-hoses';
import {pitDisplay} from './pit-display';
import * as T from 'three';
import {embeddedGLB} from './embedded-glb';
import {serviceSuit,suitFabric} from './service-suit';
import suitURL from './assets/service-suit.glb.gz?url';
import library from './assets/pit-equipment.glb.gz?url';
import type {Track} from './track';
import {circuitHeight} from './elevation';
import {cornerService,frontJackPose,jackLift,pitBox,canRelease,serviceClock,ramp,type PitTelemetry} from './pit-service';
import {BOX_OFFSET,garageBay,type Constructor} from './pit-service';
import {compoundColors,constructors,grid} from './grid';
import {wheelStations} from './suspension';

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const up=V(0,1),identity=new T.Quaternion(),unit=V(1,1,1);
const colour=(compound='medium')=>compoundColors[compound]??compoundColors.medium;

/** One instance batch per Blender part. All service poses are calculated in box-local metres. */
export function pitCrew(scene:T.Scene,track:Track){
 const loadingAssets=new AbortController();
 const root=new T.Group();scene.add(root);
 const resources=new MeshResources();
 const groups=new Map<Constructor,T.Group>(),kits=new Map<T.Group,Map<string,T.InstancedMesh>>();
 let disposed=false,ready=false,error:string|undefined;
 const bays=new Map(Object.keys(garageBay).map(key=>{
  const team=key as Constructor,box=pitBox(track,team);
  return [team,{box,point:track.pointAt(box),forward:track.tangentAt(box),height:circuitHeight(track.id,box),
   outlets:wheelStations.map(w=>{
    const p=track.pointAt(box+w.z,BOX_OFFSET-Math.sign(w.x)*.9);
    return V(p.x,circuitHeight(track.id,box+w.z)+2.97,p.z);
   })}];
 }));
 const hoses=new Map<T.Group,ReturnType<typeof pitHoses>>();
 const displays=new Map<Constructor,ReturnType<typeof pitDisplay>>();
 const crews=new Map<T.Group,ReturnType<typeof serviceSuit>[]>();
 let build:((team:Constructor)=>void)|undefined;
 const loaded=Promise.allSettled([embeddedGLB(library,true,loadingAssets.signal),embeddedGLB(suitURL,true,loadingAssets.signal)]).then(results=>{
  for(const result of results)if(result.status==='fulfilled')resources.collect(result.value.scene);
  const [kitResult,suitResult]=results;
  if(disposed||kitResult.status==='rejected'||suitResult.status==='rejected'){
   resources.dispose();
   if(!disposed)throw (kitResult.status==='rejected'?kitResult.reason:suitResult.status==='rejected'?suitResult.reason:undefined);
   return;
  }
  const gltf=kitResult.value,source=suitResult.value.scene.getObjectByName('ServiceSuit') as T.SkinnedMesh;
  const signs=[...['FIA RACE CONTROL','MEDICAL CENTRE','PIRELLI'].map((name,bay)=>({name,box:track.PIT_STOP-200+28*bay,stripe:'#849099'})),
   ...(Object.keys(garageBay) as Constructor[]).map(name=>({name,box:pitBox(track,name),stripe:constructors[name][0]}))];
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=64*signs.length;
  const ctx=canvas.getContext('2d')!,panels:T.BufferGeometry[]=[];
  for(const [row,{name,box,stripe}] of signs.entries()){
   ctx.setTransform(1,0,0,1,0,64*row);ctx.fillStyle='#181a1c';ctx.fillRect(0,0,1024,64);
   ctx.fillStyle=stripe;ctx.fillRect(0,0,1024,9);ctx.fillRect(0,55,1024,9);
   ctx.textAlign='center';ctx.fillStyle='#ffffff';ctx.font='bold 41px Arial';ctx.fillText(name.toUpperCase(),512,48);
   const drivers=grid.filter(entry=>entry.team===name);ctx.font='bold 29px Arial';
   drivers.forEach((driver,i)=>ctx.fillText(driver.number+'  '+driver.code,i===0?100:924,46));

   // Adjacent boards share an edge on the surveyed grade and curvature of the pit lane.
   const panel=new T.PlaneGeometry(28,.75,4,1),positions=panel.getAttribute('position');
   const uv=panel.getAttribute('uv');
   for(let i=0;i<uv.count;i++)uv.setY(i,(signs.length-row-1+uv.getY(i))/signs.length);
   for(let i=0;i<positions.count;i++){
    const station=box+positions.getX(i),point=track.pointAt(station,-24.10);
    positions.setXYZ(i,point.x,circuitHeight(track.id,station)+4.31+positions.getY(i),point.z);
   }
   panel.computeVertexNormals();
   panels.push(panel);
  }
  const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
  const sign=new T.Mesh(mergeGeometries(panels),new T.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:track.night?.54:.16,roughness:.48}));
  sign.name='Garage fascia signs';root.add(sign);
  for(const panel of panels)panel.dispose();
  for(const name of Object.keys(garageBay) as Constructor[]){
   const d=pitBox(track,name),t=track.tangentAt(d);
   displays.set(name,pitDisplay(scene,track.pointAt(d,-20.9),circuitHeight(track.id,d)+2.9,Math.atan2(t.x,t.z)-Math.PI/2));
  }
  build=team=>{
   const group=new T.Group(),kit=new Map<string,T.InstancedMesh>();
   gltf.scene.traverse(o=>{if(!(o instanceof T.Mesh))return;
    if(['Torso','Arm','Leg','AirHose'].includes(o.name))return;
    const material:T.MeshStandardMaterial=['Helmet','PitVisor'].includes(o.name)?
     new T.MeshPhysicalMaterial({clearcoat:1,clearcoatRoughness:.12}):o.material.clone();
    if(o.name==='Helmet'){
     material.vertexColors=false;material.color.set(constructors[team][0]);material.metalness=.22;
     material.onBeforeCompile=shader=>{
      shader.uniforms.crewStripe={value:new T.Color(constructors[team][1])};
      shader.vertexShader='varying vec3 shell;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nshell=position;');
      shader.fragmentShader='uniform vec3 crewStripe;varying vec3 shell;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
       if(shell.y>.185){
        float stripe=1.-smoothstep(.012,.016,abs(abs(shell.x)-.047));
        diffuseColor.rgb=mix(diffuseColor.rgb,crewStripe,stripe);
       }`);
     };material.customProgramCacheKey=()=>'constructor-helmet-stripe';
    }
    material.roughness=o.name==='Helmet'?.24:.85;
    if(/Jack|SocketGun|HoseBoom/.test(o.name)){material.metalness=.72;material.roughness=.35;}
    if(o.name==='SpareWheel'){material.roughness=.60;material.metalness=.13;}
    if(o.name==='PitVisor'){material.vertexColors=false;material.color.set('#304956');material.metalness=.61;material.roughness=.08;}
    const batch=new T.InstancedMesh(o.geometry,o.name==='ReleaseLens'?new T.MeshBasicMaterial({toneMapped:false}):material,48);batch.name=team+' pit '+o.name;
    batch.count=0;batch.boundingSphere=new T.Sphere(V(2,1,0),10);
    batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
    batch.castShadow=['Helmet','Boot','JackFoot','JackHandle','SpareWheel','SpareNose'].includes(o.name);
    batch.receiveShadow=true;
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
   const people=Array.from({length:20},()=>serviceSuit(source,fabric));crews.set(group,people);
   for(const actor of people)group.add(actor.mesh);
   const lines=pitHoses();group.add(lines.mesh);hoses.set(group,lines);
   group.visible=false;root.add(group);groups.set(team,group);kits.set(group,kit);
  }
  build('Ferrari');build('Mercedes');
  ready=true;
 }).catch(e=>{error=String(e);console.error('Blender pit equipment failed',e)});
 const m=new T.Matrix4(),tint=new T.Color(),oldTyre:Partial<Record<Constructor,string>>={};
 const lastStop:Partial<Record<Constructor,{offset:number;yaw:number}>>={};
 const vectors=Array.from({length:176},()=>new T.Vector3());
 const rotations=Array.from({length:32},()=>new T.Quaternion());
 const corner=cornerService(0,0),jackPose=frontJackPose(0);
 let vectorIndex=0,rotationIndex=0;
 function scratch(x=0,y=0,z=0){const v=vectors[vectorIndex]??=new T.Vector3();vectorIndex++;return v.set(x,y,z);}
 function rotation(){const q=rotations[rotationIndex]??=new T.Quaternion();rotationIndex++;return q;}
 const euler=new T.Euler(),sides=[-1,1],reserveStations=[3.75,-3.65];
 // Bone matrices copy their inputs. Release each actor's temporary span before posing the next.
 const gripPoints=[new T.Vector3(),new T.Vector3()];
 function handsAt(left:T.Vector3,right:T.Vector3){gripPoints[0]=left;gripPoints[1]=right;return gripPoints;}
 const poseFrame={entry:false,exit:false,gap:0,progress:0,time:0};
 function mount(hips:T.Vector3,torso:T.Quaternion,x:number,y:number,z:number){return scratch(x,y,z).applyQuaternion(torso).add(hips);}
 function offset(side:number,progress:number,x:number){return T.MathUtils.lerp(6.1+side*.55,x,progress);}
 function put(kit:Map<string,T.InstancedMesh>,name:string,p:T.Vector3,q=identity,scale=unit,color='#ffffff'){
  const b=kit.get(name)!,i=b.count++;b.setMatrixAt(i,m.compose(p,q,scale));b.setColorAt(i,tint.set(color));
 }
 // Resolve a two-bone chain, then orient the entire fabric skin in that
 // bend plane. Bone lengths stay fixed even when the hand target is distant.
 function chain(actor:ReturnType<typeof serviceSuit>,side:number,base:T.Vector3,end:T.Vector3,pole:T.Vector3,name:'Arm'|'Leg',a:number,b:number){
  const ray=scratch().copy(end).sub(base),distance=Math.max(.001,ray.length());ray.divideScalar(distance);
  const d=T.MathUtils.clamp(distance,Math.abs(a-b)+.001,a+b-.001);
  const h=(a*a-b*b+d*d)/(2*d),normal=pole.addScaledVector(ray,-pole.dot(ray)).normalize();
  const joint=scratch().copy(base).addScaledVector(ray,h).addScaledVector(normal,Math.sqrt(Math.max(0,a*a-h*h)));
  const tip=scratch().copy(base).addScaledVector(ray,d),upper=scratch().copy(joint).sub(base).normalize(),lower=scratch().copy(tip).sub(joint).normalize();
  const angle=Math.acos(T.MathUtils.clamp(upper.dot(lower),-1,1));
  actor.limb(name,side,base,joint,upper,lower,angle);return tip;
 }
 function person(actor:ReturnType<typeof serviceSuit>,kit:Map<string,T.InstancedMesh>,hips:T.Vector3,yaw:number,lean:number,hands:T.Vector3[],role:'gun'|'carrier'|'jack'|'steady',phase:number,step:number,stride:number,stance:T.Vector3){
  const vectorStart=vectorIndex,rotationStart=rotationIndex;
  const {entry,exit,gap,progress,time}=poseFrame;
  const walking=entry?1-ramp(progress,.35,.94):exit?1-ramp(progress,.78,1):0;
  yaw+=Math.atan2(Math.sin((entry?-Math.PI/2:Math.PI/2)-yaw),Math.cos((entry?-Math.PI/2:Math.PI/2)-yaw))*walking;
  const dir=rotation().setFromAxisAngle(up,yaw);
  const breath=Math.sin(time*2.8+phase);
  const twist=.10*Math.sin(phase)+.12*stride;
  const torso=rotation().setFromEuler(euler.set(lean+.011*breath,yaw+twist,.035*stride,'YXZ'));
  // Follow a two-handed grip with the shoulders and pelvis. Knees take
  // the load while the boots stay at their independent support positions.
  for(let pass=0;pass<2;pass++)for(let i=0;i<2;i++){
   const side=sides[i];
   const delta=scratch().copy(hands[i]).sub(mount(hips,torso,side*.166,.425,0)),length=delta.length();
   if(length>.557)hips.addScaledVector(delta,(length-.557)/length);
  }
  actor.core(hips,torso);
  const eye=mount(hips,torso,0,.515,.012),aim=scratch().copy(hands[0]).lerp(hands[1],.5).sub(eye);
  if(entry)aim.lerp(scratch(-hips.x,-.7,gap-hips.z).normalize(),1-ramp(gap,-8,-1));
  const headYaw=Math.atan2(aim.x,aim.z),headPitch=Math.atan2(-aim.y,Math.hypot(aim.x,aim.z));
  const head=rotation().setFromEuler(euler.set(T.MathUtils.clamp(headPitch*.65,.10,.79),headYaw+.023*breath,.035*Math.sin(phase),'YXZ'));
  put(kit,'Helmet',eye,head);put(kit,'PitVisor',eye,head);put(kit,'HelmetHardware',eye,head);
  for(let i=0;i<2;i++){
   const side=sides[i];
   const kneeling=role==='gun',trail=side<0;
   const forward=kneeling?(trail?-.41:.37):.20*side;
   const foot=scratch(side*(kneeling?.19:.17),0,forward).applyQuaternion(dir).add(stance);
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
   const hip=mount(hips,torso,side*.097,0,0),dx=foot.x-hip.x,dz=foot.z-hip.z;
   const reach=Math.sqrt(Math.max(0,.858**2-(foot.y-hip.y)**2));
   const planar=Math.hypot(dx,dz);
   if(planar>reach){foot.x=hip.x+dx*reach/planar;foot.z=hip.z+dz*reach/planar;}
   const knee=kneeling&&trail?scratch(side*.22,-1,.25):scratch(side*.21,.04,1);
   chain(actor,side,hip,foot,knee.applyQuaternion(dir),'Leg',.43,.43);
   const toe=kneeling&&trail?.64*progress:0;
   put(kit,'Boot',scratch().copy(foot).add(scratch(0,-.060+.12*Math.sin(toe),0)),rotation().copy(dir).multiply(rotation().setFromAxisAngle(scratch(1,0,0),toe)));
   const contact=Math.max(.2,1-(foot.y-.060)*7);
   put(kit,'SoleContact',scratch(foot.x,.008,foot.z),dir,scratch(contact,1,contact));
   const wrist=chain(actor,side,mount(hips,torso,side*.166,.425,0),hands[i],scratch(side*.80,-.85,-.23).applyQuaternion(dir),'Arm',.31,.27);
   const grip=rotation().copy(dir).multiply(rotation().setFromAxisAngle(scratch(1,0,0),role==='gun'?.20:.56));
   put(kit,side<0?'GloveLeft':'Glove',wrist,grip);
  }
  vectorIndex=vectorStart;rotationIndex=rotationStart;
 }
 function tyre(kit:Map<string,T.InstancedMesh>,p:T.Vector3,q:T.Quaternion,i:number,ink:string){
  const scale=scratch(i<2?.92:1.10,1,1);put(kit,'SpareWheel',p,q,scale);put(kit,'CompoundBand',p,q,scale,ink);
 }
 function update(team:Constructor,car:PitTelemetry|undefined,time:number){
  vectorIndex=0;rotationIndex=0;
  displays.get(team)?.update(car);
  if(!car){delete oldTyre[team];const g=groups.get(team);if(g)g.visible=false;delete lastStop[team];return;}
  if(!groups.has(team))build?.(team);
  const group=groups.get(team);if(!group)return;
  const stopped=car.pit==='stopped',entry=car.pit==='entry',exit=car.pit==='exit';
  if(!stopped&&!exit)delete lastStop[team];
  if(!stopped&&!entry&&!exit){group.visible=false;return;}
  if(stopped){
   const pose=lastStop[team]??={offset:BOX_OFFSET,yaw:0};
   pose.offset=Math.abs((car.offset??BOX_OFFSET)-BOX_OFFSET)<1?(car.offset??BOX_OFFSET):BOX_OFFSET;
   pose.yaw=car.heading??0;
  }
  const parked=lastStop[team],bay=bays.get(team)!,box=bay.box;
  const gap=track.wrap(car.distance-box+track.LENGTH/2)-track.LENGTH/2;
  group.visible=(entry&&gap>=-135&&gap<=2)||stopped||(exit&&gap>=-2&&gap<36);
  if(!group.visible)return;
  if(entry||(!oldTyre[team]&&stopped))oldTyre[team]=car.compound??oldTyre[team];
  const seconds=stopped?serviceClock(car):entry?-1:3;
  const progress=entry?ramp(gap,-135,-54):exit?1-ramp(gap,4,36):1;
  const {point,forward}=bay,lateral=parked?.offset??BOX_OFFSET;
  group.position.set(point.x-forward.z*lateral,bay.height+.031,point.z+forward.x*lateral);
  group.rotation.y=Math.atan2(forward.x,forward.z)+(parked?.yaw??0);
  const kit=kits.get(group)!;for(const b of kit.values())b.count=0;
  poseFrame.entry=entry;poseFrame.exit=exit;poseFrame.gap=gap;poseFrame.progress=progress;poseFrame.time=time;
  let personIndex=0;const people=crews.get(group)!;
  group.updateWorldMatrix(true,false);
  const lines=hoses.get(group)!;
  const lamp=scratch(.34,2.62,1.55-.36);put(kit,'ReleaseHousing',lamp);
  put(kit,'ReleaseLens',lamp,identity,unit,canRelease(car)?'#67ff80':'#fc3127');
  for(let i=0;i<wheelStations.length;i++){
   const w=wheelStations[i];
   const vectorStart=vectorIndex,rotationStart=rotationIndex;
   const side=Math.sign(w.x),z=w.z,stage=cornerService(seconds,i,corner),y=.365+jackLift(car);
   const clear=exit?1:ramp(seconds,2.0,2.42),idle=1-progress;
   const yaw=-side*Math.PI/2,gunDir=rotation().setFromAxisAngle(up,yaw);
   const back=1-stage.gun,ready=ramp(gap,-38,-3);
   const gun=scratch(offset(side,progress,side*(Math.abs(w.x)+.472+.23*back+.29*clear)),y+.012+.095*clear,z-.10*back);
   const gunQ=rotation().copy(gunDir).multiply(rotation().setFromEuler(euler.set(.18*back,0,.045*stage.gun*Math.sin(seconds*79+i),'XYZ')));
   put(kit,'SocketGun',gun,gunQ);
   const outlet=group.worldToLocal(scratch().copy(bay.outlets[i]));
   lines.connect(i,outlet,scratch(0,-.145,.018).applyQuaternion(gunQ).add(gun),side);
   const gunHome=scratch(offset(side,progress,side*1.87),0,z-.10);
   const gunHands=handsAt(scratch(-.039,-.078,.018).applyQuaternion(gunQ).add(gun),scratch(.040,-.013,.109).applyQuaternion(gunQ).add(gun));
   // A short free-hand signal follows the final torque pulse at each corner.
   const signal=ramp(seconds,1.99+i*.039,2.19+i*.043);
   gunHands[1].lerp(scratch(gunHome.x+side*.24,1.10,z+.12),signal);
   person(people[personIndex++],kit,scratch(gunHome.x+side*(.18*back+.24*clear),.54+.19*idle+.13*clear-.050*ready,z-.12),
    yaw,.77+.12*stage.gun-.22*clear,gunHands,'gun',i+1,clear,side*.19,gunHome);

   // Pull straight off the stub axle before turning away; the replacement
   // swings into alignment first and is then pushed squarely onto the hub.
   const pull=ramp(stage.remove,0,.54),carry=ramp(stage.remove,.26,1);
   const align=ramp(stage.fit,0,.68),seat=ramp(stage.fit,.57,1);
   const old=scratch(offset(side,progress,w.x+side*(.46*pull+.48*carry)),y+.27*carry+.04*Math.sin(carry*Math.PI),z-.87*carry);
   const fresh=scratch(offset(side,progress,w.x+side*(.48*(1-seat)+.47*(1-align))),y+.31*(1-align),z+.92*(1-align));
   const oldQ=rotation().setFromEuler(euler.set(.16*carry,side*.31*carry,.09*side*carry,'XYZ'));
   const newQ=rotation().setFromEuler(euler.set(-.14*(1-align),-side*.29*(1-align),-.09*side*(1-align),'XYZ'));
   if(stage.off||stage.remove>=1)tyre(kit,old,oldQ,i,colour(oldTyre[team]));
   if(stage.fit<1)tyre(kit,fresh,newQ,i,colour(car.instruction?.tyre??car.compound));
   for(const k of sides){
    const removing=k<0,held=removing?old:fresh,q=removing?oldQ:newQ;
    const shift=removing?carry:1-align,transfer=removing?carry:align;
    const release=removing?0:ramp(seconds,1.73+i*.015,2.16);
    const home=scratch(offset(side,progress,side*(1.33+.32*(removing?0:1))),0,z+k*(.68+.58*shift));
    const brace=removing?ramp(seconds,.17+i*.021,.47+i*.021)*(1-carry):align*(1-seat);
    const hips=scratch(offset(side,progress,side*(1.33+.40*shift+.31*release-.075*brace)),.61+.25*shift+.18*release+.10*idle-.065*brace,z+k*(.70+.72*shift+.20*release));
    hips.z+=k*.058*Math.sin(transfer*Math.PI);
    const look=Math.atan2(held.x-hips.x,held.z-hips.z);
    const right=scratch(Math.cos(look),0,-Math.sin(look));
    const contacts=handsAt(scratch(side*.10,.085,-.255).applyQuaternion(q).add(held),scratch(side*.10,.175,.255).applyQuaternion(q).add(held));
    if(scratch().copy(contacts[1]).sub(contacts[0]).dot(right)<0)contacts.reverse();
    for(let n=0;n<2;n++){
     const h=contacts[n];
     const rest=scratch().copy(hips).addScaledVector(right,n===0?-.19:.19).add(scratch(-side*.21,.15,-k*.19));
     h.lerp(rest,release);
    }
    person(people[personIndex++],kit,hips,look,.84-.22*shift-.46*release,contacts,'carrier',i*1.9+k,transfer,side*(removing?.38:-.32),home);
   }
   vectorIndex=vectorStart;rotationIndex=rotationStart;
  }
  // Stabilisers steady the chassis beside the cockpit during the lift.
  for(const side of sides){
   const hold=ramp(seconds,-.06,.22)*(1-ramp(seconds,2.08,2.38));
   const t=car.pitTime??0;
   const repair=stopped&&(car.totalStop??2.6)>2.6?ramp(t,.4,1.6)*(1-ramp(t,(car.totalStop??2.6)-.9,(car.totalStop??2.6)-.55)):0;
   const home=scratch(side*(1.16+(1-progress)*1.9),0,-.46+2.64*repair);
   const hips=scratch().copy(home).add(scratch(-side*.10*hold,.80-.085*hold,0));
   const x=side*(1.01-.55*hold+(1-progress)*1.9),y=.87+.025*hold-.48*repair+.035*repair*Math.sin(t*7+side);
   const hands=handsAt(scratch(x,y,home.z-.20),scratch(x,y,home.z+.12));
   person(people[personIndex++],kit,hips,-side*Math.PI/2,.34+.72*hold,hands,'steady',side+7,0,0,home);
  }
  for(const side of sides){
   const sweep=frontJackPose(seconds,jackPose);
   const rearClear=ramp(seconds,2.26,2.55);
   const pull=side>0?sweep.withdraw:(entry?1:1-ramp(seconds,-.1,.20));
   const approach=(1-progress)*5.9;
   const x=approach+(side>0?sweep.x:pull*1.07),yaw=side>0?Math.PI:0;
   const nose=side>0?2.83+sweep.z:2.71+pull*.20+.42*rearClear,origin=scratch(x,0,side*nose),face=rotation().setFromAxisAngle(up,yaw);
   const angle=stopped?.24*ramp(seconds,.02,.27)*(1-ramp(seconds,2.12,2.37)):0;
   const handleFace=rotation().copy(face).multiply(rotation().setFromAxisAngle(up,side>0?sweep.handleYaw:0));
   const jack=rotation().copy(handleFace).multiply(rotation().setFromAxisAngle(scratch(1,0,0),-angle));
   const axle=scratch(0,.09,-.13).applyQuaternion(face).add(origin);
   put(kit,'JackFoot',origin,face,side>0?unit:scratch(.82,.72,1.18));put(kit,'JackCradle',scratch().copy(origin).add(scratch(0,jackLift(car),0)),face);put(kit,'JackHandle',axle,jack);
   const hands=handsAt(scratch(-.17,.81,-.69).applyQuaternion(jack).add(axle),scratch(.17,.81,-.69).applyQuaternion(jack).add(axle));
   const pivot=side>0?sweep.pivot:0;
   const stance=scratch(side>0?approach+.76*pull:x-pull*.34,0,origin.z+side*(1.21-.47*pivot));
   const bodyX=side>0?approach+1.06*pivot+.65*pull:x;
   person(people[personIndex++],kit,scratch(bodyX,.75+.09*pull,stance.z+side*.08),yaw+(side>0?sweep.handleYaw:0),.45+.16*ramp(seconds,.04,.27)-.15*pull,hands,'jack',side,side>0?pivot:pull,side>0?.85:.34,stance);
  }
  // Two adjusters follow the front-wing repair, with a spotter and reserve jack behind the box.
  const repair=stopped&&((car.totalStop??2.6)>2.7),reach=repair?ramp(car.pitTime??0,.45,1.5):0;
  const repairDuration=Math.max(.1,(car.totalStop??2.6)-2.6);
  const exchange=repair?T.MathUtils.clamp(((car.pitTime??0)-.65)/repairDuration,0,1):0;
  const carrying=repair&&exchange>.05&&exchange<.96;
  const noseX=carrying?3.4*(1-ramp(exchange,.05,.73)):0,noseZ=3.40-.47*ramp(exchange,.65,.96);
  if(carrying)put(kit,'ServiceNose',scratch(noseX,.23*(1-ramp(exchange,.65,.96)),noseZ),identity,unit,constructors[team][0]);
  for(const side of sides){
   const home=scratch(side*(1.61+(1-progress)*2),0,2.51);
   if(carrying){home.x=noseX+side*1.24;home.z=noseZ-.12;}
   const hip=scratch().copy(home).add(scratch(0,.68-.13*reach,0));
   person(people[personIndex++],kit,hip,-side*Math.PI/2,.54+.28*reach,handsAt(scratch(home.x-side*(.38+.22*reach),.53-.19*reach,home.z-.14),scratch(home.x-side*(.38+.22*reach),.53-.19*reach,home.z+.14)),'steady',side+21,0,0,home);
  }
  for(let j=0;j<reserveStations.length;j++){
   const z=reserveStations[j];
   const home=scratch(2.8+.55*j,0,z),hip=scratch().copy(home).add(scratch(0,.84,0));
   person(people[personIndex++],kit,hip,-Math.PI/2,.17,handsAt(scratch(home.x-.25,.95,z-.17),scratch(home.x-.25,.95+(j===0&&canRelease(car)?.42:0),z+.17)),'steady',j+25,0,0,home);
  }
  for(const batch of kit.values()){if(!batch.count)continue;batch.instanceMatrix.needsUpdate=true;if(batch.instanceColor)batch.instanceColor.needsUpdate=true;}
 }
 return {update,loaded,setMirrorHidden(hidden:boolean){root.visible=!hidden;},get ready(){return ready},get error(){return error},dispose(){
  if(disposed)return;
  disposed=true;loadingAssets.abort();build=undefined;
  for(const display of displays.values())display.dispose();
  root.removeFromParent();resources.collect(root).dispose();root.clear();
  groups.clear();kits.clear();crews.clear();hoses.clear();displays.clear();
 }};
}
