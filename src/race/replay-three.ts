import * as THREE from 'three';
import {activeReplayCars,replayBounds,type ReplayMap} from './replay-map';
import type {ReplayPoint,ReplayTiming} from './replay';
import type {ReplayMotion} from './replay-motion';

export function createReplayScene(canvas:HTMLCanvasElement,race:ReplayTiming,positions:ReplayMotion):ReplayMap{
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
 renderer.setPixelRatio(Math.min(2,devicePixelRatio||1));
 const world=new THREE.Scene();
 const camera=new THREE.PerspectiveCamera(35,1,.1,400);
 const {left,right,bottom,top,base}=replayBounds(positions.track);
 const size=Math.max(right-left,top-bottom);
 const rotate=top-bottom>right-left;
 const normalize=([x,y,z]:ReplayPoint)=>{
  const dx=(x-(left+right)/2)*24/size,dy=(y-(bottom+top)/2)*24/size;
  return new THREE.Vector3(rotate?dy:dx,(z-base)*24/size,rotate?-dx:dy);
 };
 const points=positions.track.map(normalize);
 const route=new THREE.CatmullRomCurve3(points,true);
 const road=new THREE.Mesh(new THREE.TubeGeometry(route,points.length*2,.115,5,true),new THREE.MeshStandardMaterial({color:0x242e3b,roughness:.85}));
 world.add(road);
 const centerline=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points.map(p=>p.clone().add(new THREE.Vector3(0,.116,0)))),new THREE.LineBasicMaterial({color:0x798c9b}));
 world.add(centerline);
 const start=new THREE.Mesh(new THREE.BoxGeometry(.10,.04,.33),new THREE.MeshBasicMaterial({color:0xf3f7f9}));
 start.position.copy(points[0]).add(new THREE.Vector3(0,.125,0));
 const tangent=route.getTangent(0);
 start.rotation.y=-Math.atan2(tangent.z,tangent.x);
 world.add(start);
 const grid=new THREE.GridHelper(95,55,0x25353d,0x21333d);
 grid.position.y=-.22;world.add(grid);
 world.add(new THREE.HemisphereLight(0xe9f5ff,0x4c6570,2.3));
 const light=new THREE.DirectionalLight(0xe4f5ff,2);
 light.position.set(9,16,-15);world.add(light);
 const geometry=new THREE.BoxGeometry(.29,.14,.16);
 const cars=new Map(race.drivers.map(driver=>{
  const car=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:driver.color,emissive:driver.color,emissiveIntensity:.3}));
  world.add(car);
  return [driver.number,car] as const;
 }));
 const highlight=new THREE.Mesh(new THREE.RingGeometry(.21,.253,30),new THREE.MeshBasicMaterial({color:0xf1ffff,side:THREE.DoubleSide}));
 highlight.rotation.x=-Math.PI/2;world.add(highlight);
 let previousWidth=0,previousHeight=0;
 let previousTime=-Infinity;
 function draw(time:number,selected:number){
  const {clientWidth:w,clientHeight:h}=canvas;
  if(!w||!h)return;
  if(w!==previousWidth||h!==previousHeight){
   previousWidth=w;previousHeight=h;
   renderer.setSize(w,h,false);
   camera.aspect=w/h;
   const zoom=Math.max(1,1.25/camera.aspect);
   camera.position.set(3*zoom,33*zoom,25*zoom);
   camera.lookAt(0,0,0);camera.updateProjectionMatrix();
  }
  const active=activeReplayCars(race,positions,time,selected);
  for(const car of cars.values())car.visible=false;
  highlight.visible=false;
  for(const {driver,point} of active){
   const car=cars.get(driver.number)!;
   const next=normalize(point);
   if(time>previousTime&&time-previousTime<1500&&car.position.distanceToSquared(next)>.0005){
    car.rotation.y=-Math.atan2(next.z-car.position.z,next.x-car.position.x);
   }
   car.position.copy(next);
   car.position.y+=.21;
   car.visible=true;
   if(driver.number===selected){
    highlight.visible=true;
    highlight.position.copy(next).add(new THREE.Vector3(0,.145,0));
   }
  }
  previousTime=time;
  renderer.render(world,camera);
 }
 return {draw,dispose:()=>{
  world.traverse(object=>{
   if(object instanceof THREE.Mesh||object instanceof THREE.Line){
    if(object.geometry!==geometry)object.geometry.dispose();
    (object.material as THREE.Material).dispose();
   }
  });
  geometry.dispose();renderer.dispose();renderer.forceContextLoss();
 }};
}
