import * as T from 'three';
import {cornerService,serviceClock} from './pit-service';
import type {RenderRace} from './scene';
import type {Track} from './track';
import {pavementHeight} from './pavement';
import {wheelStations} from './suspension';

type Puff={d:number;x:number;time:number;vx:number;vz:number;size:number;dust:number;seed:number};
export function surfaceEffects(scene:T.Scene,track:Track,heightAt:(d:number)=>number){
 const capacity=180,puffs:Puff[]=[],positions=new Float32Array(capacity*3),parameters=new Float32Array(capacity*4);
 const geo=new T.BufferGeometry(),pos=new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage),attrib=new T.BufferAttribute(parameters,4).setUsage(T.DynamicDrawUsage);
 geo.setAttribute('position',pos);geo.setAttribute('puff',attrib);
 const material=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{pixelHeight:{value:850}},vertexShader:`
 attribute vec4 puff;uniform float pixelHeight;varying vec3 vPuff;
 void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
 gl_PointSize=clamp(pixelHeight*puff.x*projectionMatrix[1][1]/max(1.,-mv.z),1.,160.);vPuff=puff.yzw;}`,
 fragmentShader:`varying vec3 vPuff;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){
  vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(cell),hash(cell+vec2(1,0)),f.x),mix(hash(cell+vec2(0,1)),hash(cell+1.),f.x),f.y);
 }
 void main(){
  vec2 p=gl_PointCoord*2.-1.,q=p*2.7+vPuff.z;
  float billow=.68*noise(q)+.32*noise(q*2.28);
  float density=1.-smoothstep(.16,.98,length(p)+(.51-billow)*.70);
  if(density<.008)discard;
  vec3 tint=mix(vec3(.59,.61,.63),vec3(.37,.285,.19),vPuff.y)*(.72+.44*billow);
  gl_FragColor=vec4(tint,density*(.30+.70*billow)*vPuff.x);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
 const mesh=new T.Points(geo,material);mesh.frustumCulled=false;scene.add(mesh);
 const marks=new T.InstancedMesh(new T.PlaneGeometry(.27,1),new T.MeshBasicMaterial({color:'#111212',transparent:true,opacity:.31,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}),384);
 marks.count=0;marks.frustumCulled=false;marks.instanceMatrix.setUsage(T.DynamicDrawUsage);scene.add(marks);
 const pose=new T.Object3D(),trail=new Float64Array(22).fill(NaN);let markIndex=0;
 const previous:string[]=[],last=new Float64Array(22).fill(-100);let before=-1,index=0;
 function emit(d:number,x:number,time:number,vx:number,vz:number,size:number,dust:number){
  puffs[index]={d,x,time,vx,vz,size,dust,seed:(index*17.73)%91};index=(index+1)%capacity;
 }
 return {update(r:RenderRace,height:number){
  if(before>r.time||r.time-before>2){puffs.length=0;index=0;last.fill(-100);previous.length=0;trail.fill(NaN);marks.count=0;markIndex=0;}
  before=r.time;material.uniforms.pixelHeight.value=height;
  [r.cars.a,r.cars.b,...(r.field??[])].forEach((car,i)=>{
   const pit=car.pit??'none',exit=pit==='exit'&&previous[i]==='stopped';previous[i]=pit;
   const velocity=car.speed,lateral='lateralVelocity' in car?car.lateralVelocity??0:0;
   const slip=pit==='none'&&(('lockup' in car&&(car.lockup??0)>.12)||Math.abs(lateral)>3.3||('throttle' in car&&(car.throttle??0)>.85&&velocity>3&&velocity<14));
   const dirt=pit==='none'&&Math.abs(car.offset)>track.trackHalfWidth(car.distance)+.6;
   if((slip||dirt)&&velocity>2){
    const axle='lockup' in car&&(car.lockup??0)>.12?1.55:-2.05;
    if(r.time-last[i]>.068){
     for(const side of [-1,1])for(let lobe=0;lobe<3;lobe++){
      const wobble=Math.sin(r.time*17+lobe*2+i);
      emit(car.distance+axle-lobe*.19,car.offset+side*(.81+.043*wobble),r.time,
       side*(.23+lobe*.19)+wobble*.14,velocity*.63-lobe*.49,.22+.06*lobe+.035*Math.abs(lateral),dirt?1:0);
     }
     last[i]=r.time;
    }
    const travel=car.distance-trail[i];
    if(!dirt&&travel>.52&&travel<10){
     const d=car.distance+axle-travel/2,t=track.tangentAt(d);
     for(const side of [-1,1]){const x=car.offset+.80*side,at=track.pointAt(d,x);
      pose.position.set(at.x,heightAt(d)+pavementHeight(track,d,x)+.018,at.z);
      pose.rotation.set(-Math.PI/2,Math.atan2(t.x,t.z),0,'YXZ');pose.scale.set(1,Math.min(7,travel+.08),1);pose.updateMatrix();
      marks.setMatrixAt(markIndex,pose.matrix);markIndex=(markIndex+1)%384;marks.count=Math.min(384,marks.count+1);
     }marks.instanceMatrix.needsUpdate=true;trail[i]=car.distance;
    }else if(!Number.isFinite(travel)||travel<0||travel>=10)trail[i]=car.distance;
   }else trail[i]=NaN;
   if(exit)for(let n=0;n<8;n++)emit(car.distance-2,car.offset+(n%2?-.83:.83),r.time,Math.sin(n)*.6,-1.6-n*.1,.27,0);
   if(r.time-last[i]<.09||pit!=='stopped')return;
   const seconds='pitTime' in car?(car.pitTime??0):2.6-('service' in car?car.service??0:0);
   const clock=serviceClock({distance:car.distance,pitTime:seconds,totalStop:'totalStop' in car?car.totalStop:2.6});
   for(const [j,w] of wheelStations.entries()){
    const stage=cornerService(clock,j);
    if(stage.gun>.62&&((clock>.2&&clock<.67)||(clock>1.62&&clock<2.04))){
     emit(car.distance+w.z,car.offset-w.x,r.time,-Math.sign(w.x)*.78,.2,.18,.23);last[i]=r.time;
    }
   }
  });
  let n=0;
  for(const puff of puffs){const age=r.time-puff.time;if(age<0||age>1.25)continue;
   const d=puff.d+puff.vz*(-Math.expm1(-age*2.4)/2.4),p=track.pointAt(d,puff.x+puff.vx*age);
   pos.setXYZ(n,p.x,heightAt(d)+.16+age*(.58+.004*puff.seed),p.z);
   attrib.setXYZW(n++,puff.size+age*.98,.46*(.25+.75*Math.min(1,age/.044))*(1-age/1.25)**1.4,puff.dust,puff.seed+age*.29);
  }
  geo.setDrawRange(0,n);mesh.visible=n>0;if(n){pos.needsUpdate=true;attrib.needsUpdate=true;}
 },dispose(){marks.removeFromParent();marks.material.dispose();marks.geometry.dispose();marks.dispose();mesh.removeFromParent();geo.dispose();material.dispose();}};
}
