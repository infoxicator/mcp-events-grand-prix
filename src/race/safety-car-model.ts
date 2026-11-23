import * as T from 'three';

export const safetyWheelStations=[{x:-.93,z:1.49},{x:.93,z:1.49},{x:-.93,z:-1.49},{x:.93,z:-1.49}] as const;

export function createSafetyCar(){
 const car=new T.Group();
 car.name='Safety car';
 const paint=new T.MeshStandardMaterial({color:'#d83432',metalness:.5,roughness:.29});
 const glass=new T.MeshStandardMaterial({color:'#253944',metalness:.35,roughness:.2});
 const rubber=new T.MeshStandardMaterial({color:'#101214',roughness:.82});
 const amber=new T.MeshBasicMaterial({color:'#ffb625'});
 const lamps=new T.MeshBasicMaterial({color:'#edeeff'});
 function box(material:T.Material,width:number,height:number,length:number,x:number,y:number,z:number){
  const mesh=new T.Mesh(new T.BoxGeometry(width,height,length),material);
  mesh.position.set(x,y,z);
  car.add(mesh);
  return mesh;
 }
 box(paint,1.93,.52,4.72,0,.61,0);
 box(glass,1.56,.53,2.24,0,1.09,-.17);
 box(paint,1.58,.10,1.65,0,1.39,-.28);
 const beacon=box(amber,1.2,.15,.23,0,1.52,-.18);
 const wheel=new T.CylinderGeometry(.33,.33,.23,12);
 wheel.rotateZ(Math.PI/2);
 for(const side of [-1,1]){
  box(lamps,.41,.12,.055,side*.61,.65,2.35);
  box(amber,.31,.09,.055,side*.66,.65,-2.35);
 }
 for(const w of safetyWheelStations){
  const tyre=new T.Mesh(wheel,rubber);
  tyre.position.set(w.x,.32,w.z);car.add(tyre);
 }
 return {car,flash:(time:number)=>{beacon.visible=Math.floor(time*8)%4!==2;}};
}
