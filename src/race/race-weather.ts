import * as T from 'three';
import type {RainLevel} from './race-control';
import type {RenderRace} from './scene';
import {safetyWheelStations} from './safety-car-model';
import {wheelStations} from './suspension';
import type {Track} from './track';

const precipitation:Record<RainLevel,number>={dry:0,light:.16,moderate:.48,heavy:1};
const clamp=T.MathUtils.clamp;
const quad=new Float32Array([-1,-1,0, 1,-1,0, -1,1,0, 1,1,0]);

function billboards(){
 const g=new T.InstancedBufferGeometry();
 g.setAttribute('position',new T.BufferAttribute(quad,3));
 g.setIndex([0,1,2,2,1,3]);g.instanceCount=0;
 return g;
}

function randomSequence(){
 let state=0x6d2b79f5;
 return ()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
}

// Rain occupies a wrapping volume in world coordinates. Only its shutter trail
// depends on camera travel. A camera cut cannot drag the volume across the track.
function rainfall(scene:T.Scene,budget:number,night:boolean){
 const g=billboards(),random=randomSequence(),drops=new Float32Array(budget*4);
 for(let i=0;i<drops.length;i++)drops[i]=random();
 g.setAttribute('drop',new T.InstancedBufferAttribute(drops,4));
 const uniforms={clock:{value:0},strength:{value:0},travel:{value:new T.Vector3()},tint:{value:new T.Color(night?'#c1cada':'#dce1e3')}};
 const m=new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,
  vertexShader:`
   attribute vec4 drop;
   uniform float clock, strength;
   uniform vec3 travel;
   varying float opacity;
   varying vec2 shape;
   void main(){
    vec3 box=vec3(38.,23.,38.);
    vec3 velocity=vec3(1.15+drop.w,-7.-3.5*drop.w,-.65);
    vec3 offset=mod((drop.xyz-.5)*box+velocity*clock-cameraPosition+.5*box,box)-.5*box;
    vec4 head=viewMatrix*vec4(cameraPosition+offset,1.);
    vec3 streak=mat3(viewMatrix)*(velocity-travel)*mix(.007,.014,drop.w);
    vec3 middle=head.xyz-streak*.5;
    // Account for perspective so drops viewed along the car's direction radiate outward.
    vec2 axis=streak.xy*max(.05,-middle.z)+middle.xy*streak.z;
    vec2 normal=normalize(vec2(-axis.y,axis.x)+vec2(1.e-6));
    vec3 vertex=middle+position.y*streak*.5;
    vertex.xy+=position.x*normal*(.0018+.00070*max(0.,-middle.z));
    gl_Position=projectionMatrix*vec4(vertex,1.);
    shape=position.xy;
    opacity=(.18+.16*drop.w)*(.68+.32*strength)*smoothstep(.65,1.7,-head.z)
       *(1.-smoothstep(14.,19.,length(offset.xz)));
   }`,
  fragmentShader:`
   uniform vec3 tint;
   varying vec2 shape;
   varying float opacity;
   void main(){
    float coverage=(1.-shape.x*shape.x)*(1.-shape.y*shape.y);
    gl_FragColor=vec4(tint,opacity*coverage);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 const mesh=new T.Mesh(g,m);mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=5;scene.add(mesh);
 return {mesh,uniforms,geometry:g,dispose(){mesh.removeFromParent();g.dispose();m.dispose();}};
}

// Small beads live on the exposed lens in screen coordinates. Give the mirror
// and trackside cameras their own clear optics by isolating this draw on layer 2.
function onboardBeads(scene:T.Scene,night:boolean){
 const geometry=billboards(),limit=60,seeds=new Float32Array(4*limit),random=randomSequence();
 for(let i=0;i<seeds.length;i++)seeds[i]=random();
 geometry.setAttribute('seed',new T.InstancedBufferAttribute(seeds,4));
 const uniforms={clock:{value:0},speed:{value:0},aspect:{value:1},light:{value:night?.73:1}};
 const material=new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,depthTest:false,
  vertexShader:`
   attribute vec4 seed;
   uniform float clock,speed,aspect;
   varying vec2 lensUV;
   varying float opacity;
   void main(){
    float cycles=clock*(.32+seed.w*.46)+seed.z;
    float phase=fract(cycles),cycle=floor(cycles);
    vec2 anchor=fract(seed.xy+cycle*vec2(.4142,.7321))*2.-1.;
    float slip=pow(phase,3.)*(.06+.32*speed);
    anchor+=vec2((anchor.x+.18)*speed,mix(-.9,.85,speed))*slip;
    float size=(.0028+.0062*seed.z*seed.z)*smoothstep(0.,.08,phase);
    vec2 offset=position.xy*size*vec2(1./aspect,1.+speed*.45+slip);
    gl_Position=vec4(anchor+offset,0.,1.);
    lensUV=position.xy;
    opacity=smoothstep(0.,.08,phase)*(1.-smoothstep(.67,1.,phase));
   }`,
  fragmentShader:`
   varying vec2 lensUV;
   varying float opacity;
   uniform float light;
   void main(){
    vec2 p=lensUV;p.x*=1.+.15*p.y;
    float r=length(p),aa=max(fwidth(r),.035);
    float coverage=1.-smoothstep(.90-aa,.93+aa,r);
    float rim=smoothstep(.46,.84,r);
    float glint=exp(-13.*dot(p-vec2(-.24,.47),p-vec2(-.24,.47)));
    float skyFacing=max(0.,dot(p,vec2(-.38,.81)));
    vec3 colour=mix(vec3(.040,.047,.05),vec3(.78,.85,.89)*light,clamp(skyFacing+glint,0.,1.));
    gl_FragColor=vec4(colour,opacity*coverage*(.045+.32*rim+.40*glint));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 const mesh=new T.Mesh(geometry,material);mesh.layers.set(2);mesh.frustumCulled=false;mesh.renderOrder=20;mesh.visible=false;scene.add(mesh);
 let load=0;
 return {update(active:boolean,cut:boolean,supply:number,speed:number,dt:number,time:number,aspect:number){
  if(!active||cut)load=0;
  if(active){
   const target=Math.min(1,supply);
   load+=(target-load)*-Math.expm1(-dt*(target>load?2.8:.9+speed*.014));
  }
  geometry.instanceCount=Math.round(load*limit);mesh.visible=geometry.instanceCount>0;
  uniforms.clock.value=time;uniforms.speed.value=clamp(speed/70,0,1);uniforms.aspect.value=aspect;
 },get count(){return geometry.instanceCount;},dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();}};
}


// The coherent sheet lasts only the first metre or two behind the contact
// patch. Beyond that the droplets are carried independently in the wake.
function treadSheets(scene:T.Scene,night:boolean){
 const limit=4*24;
 const geometry=new T.InstancedBufferGeometry(),vertices:number[]=[],indices:number[]=[];
 for(let row=0;row<=10;row++){
  vertices.push(-1,row/10,0,1,row/10,0);
  if(row<10){const a=row*2;indices.push(a,a+1,a+2,a+2,a+1,a+3);}
 }
 geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);
 const origins=new T.InstancedBufferAttribute(new Float32Array(limit*4),4).setUsage(T.DynamicDrawUsage);
 const motion=new T.InstancedBufferAttribute(new Float32Array(limit*4),4).setUsage(T.DynamicDrawUsage);
 geometry.setAttribute('wheel',origins);geometry.setAttribute('motion',motion);
 const uniforms={clock:{value:0},wetness:{value:0},tint:{value:new T.Color(night?'#a0adc2':'#c5cbd0')}};
 const material=new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,
  vertexShader:`
   attribute vec4 wheel,motion;
   uniform float wetness,clock;
   varying vec2 sheetUV;
   varying float flow;
   void main(){
    float u=position.y,v=position.x,side=motion.z,speed=motion.w;
    float strand=wheel.w,pressure=clamp(speed/65.,0.,1.3);
    float flutter=sin(u*15.-clock*14.+strand)*.015*u;
    // Follow the rising rear quadrant, then spread aft and outboard.
    float back=.34*sin(min(u*4.4,1.45))+u*u*(.78+.86*pressure);
    float height=.075+.62*(1.-exp(-u*3.4))+u*(.12+.48*pressure)+flutter;
    float lateral=side*(.035+u*u*(.12+.23*pressure))+v*(.105+u*.24);
    vec3 point=wheel.xyz+vec3(motion.y*lateral-motion.x*back,height+.045*v*side*u,-motion.x*lateral-motion.y*back);
    gl_Position=projectionMatrix*viewMatrix*vec4(point,1.);
    sheetUV=vec2(v,u);flow=pressure*wetness;
   }`,
  fragmentShader:`
   varying vec2 sheetUV;
   varying float flow;
   uniform float clock;
   uniform vec3 tint;
   void main(){
    float v=sheetUV.x,u=sheetUV.y;
    float drift=(.14*sin(10.*u-clock*7.)+.07*sin(16.*u+clock*3.))*u;
    float fibres=.5+.5*sin((v+drift)*36.+cos(v*13.+u*7.-clock*6.));
    float lines=mix(.56,fibres,1.-smoothstep(.25,1.4,fwidth(v)*36.));
    float alpha=flow*(1.-v*v)*smoothstep(0.,.18,u)*(1.-smoothstep(.38,1.,u))*(.14+.21*lines)*(.8+.2*sin(v*8.+u*11.-clock*4.));
    gl_FragColor=vec4(tint,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=3;scene.add(mesh);
 let count=0;
 return {begin(time:number,water:number){count=0;geometry.instanceCount=0;mesh.visible=false;uniforms.clock.value=time;uniforms.wetness.value=water;},
  wheel(x:number,y:number,z:number,sn:number,cs:number,side:number,speed:number,seed:number){
   if(count>=limit)return;
   origins.setXYZW(count,x,y,z,seed);motion.setXYZW(count,sn,cs,side,speed);count++;
  },finish(){geometry.instanceCount=count;mesh.visible=count>0;if(count){origins.needsUpdate=true;motion.needsUpdate=true;}},
  dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();}};
}


interface Packet {
 x:number;y:number;z:number;forwardX:number;forwardZ:number;kick:number;out:number;lift:number;
 born:number;life:number;width:number;spread:number;alpha:number;seed:number;
}
interface Source {x:number;y:number;z:number;yaw:number;remainder:number[]}

function tyreSpray(scene:T.Scene,track:Track,heightAt:(station:number)=>number,night:boolean,budget:number){
 const sheets=treadSheets(scene,night);
 const geometry=billboards();
 const centers=new T.InstancedBufferAttribute(new Float32Array(budget*4),4).setUsage(T.DynamicDrawUsage);
 const profiles=new T.InstancedBufferAttribute(new Float32Array(budget*4),4).setUsage(T.DynamicDrawUsage);
 geometry.setAttribute('centreRadius',centers);geometry.setAttribute('profile',profiles);
 const material=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{mist:{value:new T.Color(night?'#a4b3c6':'#d0d4d5')}},
  vertexShader:`
   attribute vec4 centreRadius,profile;
   varying vec2 patchUV;
   varying vec3 density;
   void main(){
    vec4 eye=viewMatrix*vec4(centreRadius.xyz,1.);
    float fade=smoothstep(.25,1.3,-eye.z);
    eye.xy+=position.xy*centreRadius.w*vec2(1.,profile.x);
    gl_Position=projectionMatrix*eye;
    patchUV=position.xy;
    density=vec3(profile.y*fade,profile.zw);
   }`,
  fragmentShader:`
   uniform vec3 mist;
   varying vec2 patchUV;
   varying vec3 density;
   float hash(vec2 p){return fract(sin(dot(p,vec2(71.17,39.73)))*4375.54);}
   float noise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
   }
   void main(){
    vec2 p=patchUV*2.1+density.y;
    float billow=noise(p+vec2(density.z,-density.z*.4))*.65+noise(p*2.7)*.35;
    float falloff=max(0.,1.-dot(patchUV,patchUV));
    float alpha=density.x*falloff*smoothstep(.12,.84,billow+falloff*.25);
    gl_FragColor=vec4(mist*(.82+.26*billow),alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 const mesh=new T.Mesh(geometry,material);mesh.renderOrder=4;mesh.frustumCulled=false;mesh.visible=false;scene.add(mesh);
 const live:Packet[]=[],free:Packet[]=[],sources=new Map<number,Source>(),random=randomSequence();
 let lastTime:number|undefined;
 let immersion=0;
 function clear(){immersion=0;sheets.begin(0,0);while(live.length)free.push(live.pop()!);sources.clear();geometry.instanceCount=0;mesh.visible=false;}
 function update(race:RenderRace,camera:T.Vector3,water:number){
  const time=race.time,dt=time-(lastTime??time);
  lastTime=time;
  if(dt<0||dt>2||race.phase!=='racing'||water<=0){clear();if(race.phase!=='racing'||water<=0)return;}
  // Keep airborne water behind its emitter even if a car brakes or changes lanes.
  for(let i=live.length-1;i>=0;i--){
   if(time-live[i].born<live[i].life)continue;
   const expired=live[i],last=live.pop()!;if(i<live.length)live[i]=last;free.push(expired);
  }
  sheets.begin(time,water);
  function emit(id:number,car:{distance:number;speed:number;offset:number;finishTime?:number|null;pit?:string;steering?:number},heading:number,stations:readonly {x:number;z:number}[]=wheelStations){
   const p=track.pointAt(car.distance,car.offset),y=heightAt(car.distance);
   if(car.finishTime!=null||car.pit==='stopped'||car.speed<2||Math.hypot(camera.x-p.x,camera.z-p.z)>235){sources.delete(id);return;}
   const tangent=track.tangentAt(car.distance),yaw=Math.atan2(tangent.x,tangent.z)+heading;
   if(stations===wheelStations&&Math.hypot(camera.x-p.x,camera.z-p.z)<55){
    const sn=Math.sin(yaw),cs=Math.cos(yaw);
    for(const [index,w] of wheelStations.entries()){
     const steering=yaw+(index<2?car.steering??0:0);
     sheets.wheel(p.x+cs*w.x+sn*w.z,heightAt(car.distance+w.z),p.z-sn*w.x+cs*w.z,
      Math.sin(steering),Math.cos(steering),Math.sign(w.x),car.speed,id*7+index);
    }
   }
   let prev=sources.get(id);
   if(!prev){prev={x:p.x,y,z:p.z,yaw,remainder:wheelStations.map(()=>random())};sources.set(id,prev);return;}
   const drive=clamp((car.speed-2)/68,0,1.35);
   const turn=Math.atan2(Math.sin(yaw-prev.yaw),Math.cos(yaw-prev.yaw));
   const teleport=Math.hypot(p.x-prev.x,p.z-prev.z)>Math.max(8,dt*125);
   for(let i=0;i<4&&!teleport;i++){
    const w=stations[i],rear=w.z<0;
    const rate=(rear?55:44)*Math.sqrt(water)*drive;
    const amount=rate*dt+prev.remainder[i],count=Math.floor(amount);
    for(let j=0;j<count&&live.length<budget;j++){
     const age=(amount-1-j)/rate;
     const life=(rear?.78:.37)*(1+.75*water)*(.72+.6*random());
     if(age>=life)continue;
     const f=1-age/dt,h=prev.yaw+turn*f,sn=Math.sin(h),cs=Math.cos(h);
     const side=Math.sign(w.x),x=w.x+side*(random()-.42)*.21,z=w.z-.10-random()*.10;
     const packet=free.pop()??{} as Packet;
     packet.x=prev.x+(p.x-prev.x)*f+cs*x+sn*z;
     packet.z=prev.z+(p.z-prev.z)*f-sn*x+cs*z;
     packet.y=prev.y+(y-prev.y)*f+.055+random()*.055;
     packet.forwardX=sn;packet.forwardZ=cs;
     packet.kick=car.speed*(.36+.30*random());
     packet.out=side*(rear?.55:1.15)*(1+drive)*(random()+.65);
     packet.lift=(rear?2.25:1.15)*(.65+drive)*(.52+random())*(.65+.65*water);
     packet.born=time-age;packet.life=life;packet.width=.075+.08*random();
     packet.spread=(rear?1.72:.60)*(.62+random())*(.65+water)*(.6+.5*drive);
     packet.alpha=(rear?.34:.44)*(.38+.62*water)*(.65+random()*.5);
     packet.seed=random()*94;
     live.push(packet);
    }
    prev.remainder[i]=amount-count;
   }
   prev.x=p.x;prev.z=p.z;prev.y=y;prev.yaw=yaw;
  }
  emit(-1,race.cars.a,race.cars.a.heading??0);emit(-2,race.cars.b,race.cars.b.heading??0);
  race.field?.forEach((car,i)=>emit(i,car,car.pitHeading??0));
  const safety=race.control?.safetyCar;
  if(safety)emit(-3,safety,0,safetyWheelStations);else sources.delete(-3);
  sheets.finish();immersion=0;
  for(let i=0;i<live.length;i++){
   const q=live[i],age=time-q.born,phase=age/q.life;
   const entrained=-Math.expm1(-3.4*age)/3.4;
   const travel=q.kick*entrained,side=q.out*age;
   const radius=q.width+q.spread*age;
   const x=q.x+q.forwardX*travel+q.forwardZ*side+.70*age*age;
   const y=q.y+q.lift*entrained*2.1+.13*age,z=q.z+q.forwardZ*travel-q.forwardX*side;
   centers.setXYZW(i,x,y,z,radius);
   const distanceSq=(x-camera.x)**2+(y-camera.y)**2+(z-camera.z)**2;
   if(distanceSq<radius*radius)immersion+=q.alpha*(1-phase)*(1-distanceSq/(radius*radius));
   profiles.setXYZW(i,.68+.28*phase,q.alpha*Math.min(1,age/.018)*(1-phase)**1.2,q.seed,phase*.6);
  }
  geometry.instanceCount=live.length;mesh.visible=live.length>0;
  if(mesh.visible){
   for(const a of [centers,profiles]){a.clearUpdateRanges();a.addUpdateRange(0,live.length*4);a.needsUpdate=true;}
  }
 }
 return {update,clear,get immersion(){return immersion;},get count(){return geometry.instanceCount;},dispose(){sheets.dispose();mesh.removeFromParent();geometry.dispose();material.dispose();}};
}

export function createRaceWeather(scene:T.Scene,track:Track,heightAt:(d:number)=>number,embedded:boolean){
 const rainBudget=embedded?4200:8000;
 const beads=onboardBeads(scene,track.night);
 const drops=rainfall(scene,rainBudget,track.night);
 const spray=tyreSpray(scene,track,heightAt,track.night,embedded?3600:6200);
 const previous=new T.Vector3(),velocity=new T.Vector3();
 let lastWall=-1,previousShot='',rainTime=0;
 return {update(race:RenderRace,camera:T.PerspectiveCamera,mode:string,seconds:number,reducedMotion:boolean){
  const rain=precipitation[race.control?.rain??'dry'],water=race.control?.wetness??0;
  const dt=seconds-lastWall;
  const onboard=mode.startsWith('cockpit')||mode.startsWith('tcam'),cut=mode!==previousShot;
  const car=race.cars[mode.endsWith('-b')?'b':'a'];
  if(onboard){
   const dir=track.tangentAt(car.distance);
   velocity.set(dir.x*car.speed,0,dir.z*car.speed);
  }else if(mode===previousShot&&dt>0&&dt<.35){
   velocity.subVectors(camera.position,previous).multiplyScalar(1/dt);
   // A fixed trackside mount jumps at the end of its shot.
   if(velocity.lengthSq()>140*140)velocity.set(0,0,0);
  }else velocity.set(0,0,0);
  previous.copy(camera.position);lastWall=seconds;previousShot=mode;
  if(dt>0&&dt<1)rainTime+=dt;
  drops.uniforms.clock.value=rainTime;drops.uniforms.strength.value=rain;
  drops.uniforms.travel.value.copy(velocity);
  drops.geometry.instanceCount=reducedMotion||mode==='showroom'?0:Math.round(rainBudget*rain);
  drops.mesh.visible=drops.geometry.instanceCount>0;
  if(mode==='showroom')spray.clear();else spray.update(race,camera.position,water);
  beads.update(onboard&&!reducedMotion,cut,rain*.72+spray.immersion*.8,car.speed,clamp(dt,0,.2),rainTime,camera.aspect);
  return rain;
 },get beads(){return beads.count;},get drops(){return drops.geometry.instanceCount;},get spray(){return spray.count;},dispose(){beads.dispose();drops.dispose();spray.dispose();}};
}
