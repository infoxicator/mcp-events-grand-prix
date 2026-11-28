import * as T from 'three';
import {kerbHeight} from './suspension';
import {getTrack,type Track} from './track';
import {pavementHeight} from './pavement';
import type {RenderRace} from './scene';
/** Rendering-only titanium skid sparks. Deterministic road excitation + aero load,
 * short ballistic trails, never an engine exhaust or an always-on fire effect. */
const roadCrowns=new WeakMap<Track,Float32Array>();
export function sparkContact(speed:number,distance:number,pit:string='none',track:Track=getTrack()){
 if(pit!=='none'||speed<67)return 0;
 let crowns=roadCrowns.get(track);
 if(!crowns){crowns=new Float32Array(Math.ceil(track.LENGTH)).fill(NaN);roadCrowns.set(track,crowns);}
 const station=Math.floor(track.wrap(distance));
 if(Number.isNaN(crowns[station])){
  // The plank bridges the road between the axles. A crown between them
  // subtracts from its available ride height as downforce loads the chassis.
  const front=pavementHeight(track,station+1.55,0),rear=pavementHeight(track,station-2.05,0);
  crowns[station]=pavementHeight(track,station,0)-(rear+(front-rear)*2.05/3.60);
 }
 const squat=Math.min(1,speed*speed/8100)*.016;
 return T.MathUtils.clamp((squat+crowns[station]-.0161)*420,0,1);
}
export function createSparks(scene:T.Scene,track:Track,heightAt:(d:number)=>number=()=>0){
 const limit=256,geometry=new T.PlaneGeometry(1,1);
 // A camera-facing ribbon keeps its luminous core visible at circuit-level viewing angles.
 const material=new T.ShaderMaterial({transparent:true,blending:T.AdditiveBlending,depthWrite:false,side:T.DoubleSide,
  vertexShader:`varying vec2 streak;varying vec3 ember;
   void main(){streak=uv;ember=instanceColor;
    mat4 frame=modelViewMatrix*instanceMatrix;
    vec4 mv=frame[3]+position.y*frame[1];vec2 tangent=frame[1].xy;
    vec2 side=vec2(-tangent.y,tangent.x)/max(.00001,length(tangent));
    mv.xy+=side*position.x*length(frame[0].xyz);
    gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`varying vec2 streak;varying vec3 ember;
   void main(){float y=streak.y,edge=1.-abs(streak.x*2.-1.);
    float width=smoothstep(0.,.64,edge);
    vec3 colour=mix(vec3(1.,.18,.016),ember,smoothstep(.12,.83,y));
    gl_FragColor=vec4(colour,width*smoothstep(0.,.63,y)*(1.-smoothstep(.86,1.,y)));
    #include <colorspace_fragment>
   }`});
 const mesh=new T.InstancedMesh(geometry,material,limit);
 const glowMaterial=new T.ShaderMaterial({transparent:true,blending:T.AdditiveBlending,depthWrite:false,side:T.DoubleSide,
  vertexShader:`varying vec2 st;varying float heat;void main(){st=position.xy*2.;heat=instanceColor.r;
   gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
  fragmentShader:`varying vec2 st;varying float heat;void main(){
   float f=max(0.,1.-dot(st,st));gl_FragColor=vec4(1.,.29,.035,heat*f*f*.32);
   #include <colorspace_fragment>
  }`});
 const glow=new T.InstancedMesh(geometry,glowMaterial,22);
 for(const batch of [mesh,glow]){
  batch.setColorAt(0,new T.Color());batch.frustumCulled=false;
  batch.instanceMatrix.setUsage(T.DynamicDrawUsage);batch.count=0;scene.add(batch);
 }
 const pose=new T.Object3D(),colour=new T.Color(),rand=(n:number)=>T.MathUtils.euclideanModulo(Math.sin(n*12.9898)*43758.5453,1);
 function contactAt(speed:number,offset:number,d:number){
  const edge=Math.abs(offset)-track.trackHalfWidth(d);
  if(edge>0){const kerb=kerbHeight(track,d,offset);return kerb>0?kerb*speed*.12:0;}
  return sparkContact(speed,d,'none',track)+kerbHeight(track,d,offset+Math.sign(offset)*.81)*speed*.055;
 }
 return {get active(){return mesh.count;},update(race:RenderRace,focus?:T.Vector3){
  mesh.count=0;glow.count=0;
  if(race.phase!=='racing')return;
  for(let i=0;i<2+(race.field?.length??0);i++){
   const car=i===0?race.cars.a:i===1?race.cars.b:race.field![i-2];
   if(car.speed<64||car.pit&&car.pit!=='none')continue;
   if(Math.abs(car.offset)>track.trackHalfWidth(car.distance)&&kerbHeight(track,car.distance,car.offset)===0)continue;
   const at=track.pointAt(car.distance,car.offset);
   if(focus&&Math.hypot(at.x-focus.x,at.z-focus.z)>170)continue;

   const heat=contactAt(car.speed,car.offset,car.distance);
   if(heat>.06){
    const d=car.distance-1.95,p=track.pointAt(d,car.offset),t=track.tangentAt(d);
    pose.position.set(p.x,heightAt(d)+.076,p.z);pose.rotation.set(-Math.PI/2,Math.atan2(t.x,t.z),0,'YXZ');
    pose.scale.set(1.42,2.36,1);pose.updateMatrix();glow.setMatrixAt(glow.count,pose.matrix);
    glow.setColorAt(glow.count++,colour.setScalar(Math.min(1,heat)));
   }
   for(let n=0;n<(i<2?46:18)&&mesh.count<limit;n++){
    const cycle=race.time*1.7+n*.618033,age=(cycle%1)*.55,seed=Math.floor(cycle)*97+n*17+i*29;
    const emission=car.distance-car.speed*age;
    const contact=contactAt(car.speed,car.offset,emission);
    if(contact<=rand(seed)*.8)continue;
    const d=car.distance-car.speed*age*.75-2.2,p=track.pointAt(d,car.offset+(rand(seed+1)-.5)*(.7+age*7)),t=track.tangentAt(d);
    const launch=.45+rand(seed+2)*1.5,hit=(launch+Math.sqrt(launch*launch+1.372))/9.8,after=age-hit;
    const h=after<=0?.07+launch*age-4.9*age*age:Math.max(0,.38*(9.8*hit-launch)*after-4.9*after*after);
    pose.position.set(p.x,heightAt(d)+.024+h,p.z);
    pose.rotation.set(Math.PI/2-.07+age*.28,Math.atan2(t.x,t.z)+(rand(seed+1)-.5)*.19,0,'YXZ');
    pose.scale.set(.026+rand(seed+3)*.026,.32+car.speed*.022*(1-age/.6),1);
    pose.updateMatrix();mesh.setMatrixAt(mesh.count,pose.matrix);
    const fade=1-age/.6;colour.setRGB(2.5+2.5*fade,.42+2.65*fade*fade,.06+1.64*fade**3);mesh.setColorAt(mesh.count++,colour);
   }
  }
  for(const batch of [mesh,glow])if(batch.count){batch.instanceMatrix.needsUpdate=true;batch.instanceColor!.needsUpdate=true;}
 },dispose(){geometry.dispose();material.dispose();glowMaterial.dispose();for(const batch of [mesh,glow]){batch.dispose();batch.removeFromParent();}}};
}
