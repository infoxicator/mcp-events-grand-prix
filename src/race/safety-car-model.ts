import {MeshResources} from './mesh-resources';
import * as T from 'three';
import gtURL from './assets/safety-gt.glb.gz?url';
import {embeddedGLB} from './embedded-glb';

export const safetyWheelStations=[{x:-.93,z:1.49},{x:.93,z:1.49},{x:-.93,z:-1.49},{x:.93,z:-1.49}] as const;

export function createSafetyCar(night=false){
 const car=new T.Group();
 car.name='Safety car';
 const wheels:T.Group[]=[];let disposed=false,ready=false,error:string|undefined;
 const alloy=new T.MeshStandardMaterial({color:'#9399a3',metalness:.86,roughness:.27});
 const rubber=new T.MeshStandardMaterial({color:'#101214',roughness:.82});
 const amber=new T.MeshBasicMaterial({color:new T.Color(4.1,1.64,.07)});
 const tail=new T.MeshBasicMaterial({color:new T.Color(2.3,.035,.02)});
 const lamps=new T.MeshBasicMaterial({color:new T.Color(3.0,3.2,3.7)});
 function box(material:T.Material,width:number,height:number,length:number,x:number,y:number,z:number){
  const mesh=new T.Mesh(new T.BoxGeometry(width,height,length),material);
  mesh.position.set(x,y,z);
  car.add(mesh);
  return mesh;
 }
 void embeddedGLB(gtURL,true).then(g=>{
  if(disposed){new MeshResources().collect(g.scene).dispose();return;}
  g.scene.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;}});
  car.add(g.scene);ready=true;
 }).catch(reason=>{if(!disposed)error=String(reason);});
 box(rubber,1.17,.046,.21,0,1.452,-.18);
 const beacon=Array.from({length:8},(_,i)=>box(amber,.123,.084,.18,(i-3.5)*.139,1.514,-.18));
 const wheel=new T.LatheGeometry([[.22,-.12],[.276,-.128],[.319,-.105],[.33,-.077],[.33,.077],[.319,.105],[.276,.128],[.22,.12],[.22,-.12]].map(([r,x])=>new T.Vector2(r,x)),40);
 const disc=new T.CylinderGeometry(.203,.203,.014,32);disc.rotateZ(Math.PI/2);
 const discFinish=new T.MeshStandardMaterial({color:'#616369',metalness:.75,roughness:.49});
 const spokes=new T.BoxGeometry(.022,.151,.023);
 const strobe=night?new T.PointLight('#ffad24',0,8,2):null;
 if(strobe){strobe.position.set(0,1.57,-.18);car.add(strobe);}
 wheel.rotateZ(Math.PI/2);
 for(const side of [-1,1]){
  box(lamps,.33,.047,.07,side*.63,.605,2.32).rotation.z=side*.095;
  box(tail,.46,.042,.055,side*.57,.658,-2.35);
 }
 for(const w of safetyWheelStations){
  const tyre=new T.Mesh(wheel,rubber);
  const hub=new T.Group();hub.position.set(w.x,.33,w.z);hub.add(tyre);car.add(hub);wheels.push(hub);
  const brake=new T.Mesh(disc,discFinish);brake.position.x=Math.sign(w.x)*.074;hub.add(brake);
  for(let j=0;j<10;j++){
   const spoke=new T.Mesh(spokes,alloy);
   const a=j*Math.PI/5;spoke.position.set(Math.sign(w.x)*.117,.145*Math.cos(a),.145*Math.sin(a));spoke.rotation.x=a+.08;hub.add(spoke);
  }
 }
 return {car,get ready(){return ready;},get error(){return error;},dispose(){disposed=true;},flash(time:number,distance:number,green=false,highQuality=true){
  amber.color.setRGB(green?.05:4.1,green?3.4:1.64,.07);
  if(strobe){strobe.visible=highQuality;strobe.color.copy(amber.color);strobe.intensity=Math.floor(time*12)%2?0:2.6;}
  beacon.forEach((cell,i)=>{cell.visible=(Math.floor(time*12)+(i<4?0:2))%4<2;});for(const w of wheels)w.rotation.x=distance/.33;}};
}
