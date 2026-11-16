import * as T from 'three';
import type {Track} from './track';
import type {RenderRace} from './scene';
/** Rendering-only titanium skid sparks. Deterministic road excitation + aero load,
 * short ballistic trails, never an engine exhaust or an always-on fire effect. */
export function sparkContact(speed:number,distance:number,pit:string='none'){
 return pit==='none'&&speed>67?Math.max(0,(speed-67)/30)*Math.max(0,Math.sin(distance*.17)+.25*Math.sin(distance*.61)-.32):0;
}
export function createSparks(scene:T.Scene,track:Track){
 const count=128,positions=new Float32Array(count*2*3),colours=new Float32Array(count*2*3),geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));geometry.setAttribute('color',new T.BufferAttribute(colours,3).setUsage(T.DynamicDrawUsage));
 const lines=new T.LineSegments(geometry,new T.LineBasicMaterial({vertexColors:true,transparent:true,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false}));lines.frustumCulled=false;scene.add(lines);let active=0;
 const rand=(n:number)=>{const a=Math.sin(n*12.9898)*43758.5453;return a-Math.floor(a);};
 return {get active(){return active;},update(race:RenderRace){active=0;let i=0;for(const car of [race.cars.a,race.cars.b])for(let n=0;n<count/2;n++,i++){
  const age=((race.time*1.7+n*.618033)%1)*.55,seed=Math.floor(race.time*1.7+n*.618033)*97+n*17,back=car.speed*age*.75,emission=car.distance-car.speed*age;
  const contact=sparkContact(car.speed,emission,car.pit??'none'),alive=contact>rand(seed)*.8&&race.phase==='racing';
  const p=track.pointAt(car.distance-back-2.2,car.offset+(rand(seed+1)-.5)*(.7+age*7)),t=track.tangentAt(car.distance-back),height=Math.max(.025,.12+rand(seed+2)*2.2*age-4.9*age*age),length=.18+car.speed*.014*(1-age/.6),fade=alive?(1-age/.6)*2.8:0;
  positions.set([p.x,height,p.z,p.x+t.x*length,height+.02,p.z+t.z*length],i*6);colours.set([fade,fade*.47,fade*.08,fade,fade*.88,fade*.5],i*6);if(alive)active++;
 }geometry.attributes.position.needsUpdate=true;geometry.attributes.color.needsUpdate=true;},dispose(){geometry.dispose();(lines.material as T.Material).dispose();lines.removeFromParent();}};
}
