import * as T from 'three';
import type {Track} from './track';
import type {RenderRace} from './scene';
/** Rendering-only titanium skid sparks. Deterministic road excitation + aero load,
 * short ballistic trails, never an engine exhaust or an always-on fire effect. */
export function sparkContact(speed:number,distance:number,pit:string='none'){
 return pit==='none'&&speed>67?Math.max(0,(speed-67)/30)*Math.max(0,Math.sin(distance*.17)+.25*Math.sin(distance*.61)-.32):0;
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
 return {get active(){return mesh.count;},update(race:RenderRace,focus?:T.Vector3){
  mesh.count=0;glow.count=0;
  if(race.phase!=='racing')return;
  for(const [i,car] of [race.cars.a,race.cars.b,...race.field??[]].entries()){
   if(car.speed<64||car.pit&&car.pit!=='none')continue;
   const at=track.pointAt(car.distance,car.offset);
   if(focus&&Math.hypot(at.x-focus.x,at.z-focus.z)>170)continue;
   const edgeContact=(d:number)=>{const edge=Math.abs(car.offset)-track.trackHalfWidth(d);return edge>-.48&&edge<.87?.36:0;};
   const heat=sparkContact(car.speed,car.distance)+edgeContact(car.distance);
   if(heat>.06){
    const d=car.distance-1.95,p=track.pointAt(d,car.offset),t=track.tangentAt(d);
    pose.position.set(p.x,heightAt(d)+.076,p.z);pose.rotation.set(-Math.PI/2,Math.atan2(t.x,t.z),0,'YXZ');
    pose.scale.set(1.42,2.36,1);pose.updateMatrix();glow.setMatrixAt(glow.count,pose.matrix);
    glow.setColorAt(glow.count++,colour.setScalar(Math.min(1,heat)));
   }
   for(let n=0;n<(i<2?46:18)&&mesh.count<limit;n++){
    const cycle=race.time*1.7+n*.618033,age=(cycle%1)*.55,seed=Math.floor(cycle)*97+n*17+i*29;
    const emission=car.distance-car.speed*age;
    const contact=sparkContact(car.speed,emission)+edgeContact(emission);
    if(contact<=rand(seed)*.8)continue;
    const d=car.distance-car.speed*age*.75-2.2,p=track.pointAt(d,car.offset+(rand(seed+1)-.5)*(.7+age*7)),t=track.tangentAt(d);
    pose.position.set(p.x,heightAt(d)+Math.max(.04,.14+rand(seed+2)*2.2*age-4.9*age*age),p.z);
    pose.rotation.set(Math.PI/2-.07+age*.28,Math.atan2(t.x,t.z)+(rand(seed+1)-.5)*.19,0,'YXZ');
    pose.scale.set(.026+rand(seed+3)*.026,.32+car.speed*.022*(1-age/.6),1);
    pose.updateMatrix();mesh.setMatrixAt(mesh.count,pose.matrix);
    const fade=1-age/.6;colour.setRGB(2.5+2.5*fade,.42+2.65*fade*fade,.06+1.64*fade**3);mesh.setColorAt(mesh.count++,colour);
   }
  }
  for(const batch of [mesh,glow])if(batch.count){batch.instanceMatrix.needsUpdate=true;batch.instanceColor!.needsUpdate=true;}
 },dispose(){geometry.dispose();material.dispose();glowMaterial.dispose();for(const batch of [mesh,glow]){batch.dispose();batch.removeFromParent();}}};
}
