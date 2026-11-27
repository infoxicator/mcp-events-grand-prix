import {MeshResources} from './mesh-resources';
import * as T from 'three';
import gtURL from './assets/safety-gt.glb.gz?url';
import {embeddedGLB} from './embedded-glb';

export const safetyWheelStations=[{x:-.93,z:1.49},{x:.93,z:1.49},{x:-.93,z:-1.49},{x:.93,z:-1.49}] as const;

export function createSafetyCar(){
 const car=new T.Group();
 car.name='Safety car';
 const wheels:T.Group[]=[];let disposed=false;
 const alloy=new T.MeshStandardMaterial({color:'#9399a3',metalness:.86,roughness:.27});
 const rubber=new T.MeshStandardMaterial({color:'#101214',roughness:.82});
 const amber=new T.MeshBasicMaterial({color:'#ffb625'});
 const tail=new T.MeshBasicMaterial({color:new T.Color(2.3,.035,.02)});
 const lamps=new T.MeshBasicMaterial({color:'#edeeff'});
 function box(material:T.Material,width:number,height:number,length:number,x:number,y:number,z:number){
  const mesh=new T.Mesh(new T.BoxGeometry(width,height,length),material);
  mesh.position.set(x,y,z);
  car.add(mesh);
  return mesh;
 }
 void embeddedGLB(gtURL,true).then(g=>{
  if(disposed){new MeshResources().collect(g.scene).dispose();return;}
  g.scene.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;}});
  car.add(g.scene);
 });
 box(rubber,1.17,.046,.21,0,1.452,-.18);
 const beacon=Array.from({length:8},(_,i)=>box(amber,.123,.084,.18,(i-3.5)*.139,1.514,-.18));
 const wheel=new T.CylinderGeometry(.33,.33,.23,32);
 wheel.rotateZ(Math.PI/2);
 for(const side of [-1,1]){
  box(lamps,.33,.047,.07,side*.63,.605,2.32).rotation.z=side*.095;
  box(tail,.46,.042,.055,side*.57,.658,-2.35);
 }
 for(const w of safetyWheelStations){
  const tyre=new T.Mesh(wheel,rubber);
  const hub=new T.Group();hub.position.set(w.x,.33,w.z);hub.add(tyre);car.add(hub);wheels.push(hub);
  for(let j=0;j<5;j++){
   const spoke=new T.Mesh(new T.BoxGeometry(.035,.39,.036),alloy);
   spoke.position.x=Math.sign(w.x)*.117;spoke.rotation.x=j*Math.PI/5;hub.add(spoke);
  }
 }
 return {car,dispose(){disposed=true;},flash(time:number,distance:number){beacon.forEach((cell,i)=>{cell.visible=(Math.floor(time*12)+(i<4?0:2))%4<2;});for(const w of wheels)w.rotation.x=distance/.33;}};
}
