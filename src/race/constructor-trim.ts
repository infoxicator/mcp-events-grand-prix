import * as T from 'three';
import {embeddedGLB} from './embedded-glb';
import url from './assets/constructor-trim.glb.gz?url';

let library:Promise<T.Group>|undefined;
export function constructorKit(){return library??=embeddedGLB(url,true).then(file=>file.scene);}
export function profile(team:string){
 if(['Mercedes','Aston Martin','Williams','Alpine'].includes(team))return 'Blade';
 if(['Ferrari','Haas','Audi','Cadillac'].includes(team))return 'Rolled';
 return 'Sculpted';
}
export function trimMesh(kit:T.Group,name:string,color:string){
 const geo=(kit.getObjectByName(name) as T.Mesh).geometry.clone();
 const material=name==='Contact'?new T.MeshBasicMaterial({vertexColors:true,transparent:true,depthWrite:false,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2}):
 new T.MeshStandardMaterial({color,vertexColors:true,metalness:.29,roughness:.38,side:T.DoubleSide});
 return new T.Mesh(geo,material);
}
