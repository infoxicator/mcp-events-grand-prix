import * as T from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';

/** One projected view of the scene, shared by all wet pavement tiles. */
export function wetRoad(){
 const matrix={value:new T.Matrix4()},image={value:null as T.Texture|null},visible={value:0},clock={value:0};
 let plane:Reflector|undefined,last=-Infinity;
 const inverse=new T.Matrix4();
 return {matrix,image,visible,clock,get width(){return visible.value?plane?.getRenderTarget().width??0:0;},update(renderer:T.WebGLRenderer,scene:T.Scene,camera:T.Camera,centre:T.Vector3,now:number,water:number,cut:boolean){
  clock.value=now*.001;
  if(water<.075){visible.value=0;last=-Infinity;return;}
  if(!cut&&now>=last&&now-last<82)return;
  last=now;
  if(!plane){plane=new Reflector(new T.PlaneGeometry(1,1),{textureWidth:512,textureHeight:288,clipBias:.0025,multisample:0});plane.rotation.x=-Math.PI/2;}
  plane.position.copy(centre);plane.updateMatrixWorld();
  const material=plane.material as T.ShaderMaterial;
  visible.value=0;image.value=null;
  plane.onBeforeRender(renderer,scene,camera,plane.geometry,material,null!);
  matrix.value.copy(material.uniforms.textureMatrix.value).multiply(inverse.copy(plane.matrixWorld).invert());
  image.value=plane.getRenderTarget().texture;visible.value=1;
 },dispose(){plane?.geometry.dispose();plane?.dispose();}};
}
