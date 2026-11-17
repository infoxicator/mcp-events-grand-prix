import {DataTexture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import sharp from 'sharp';

/** Read the standalone Blender GLB in Node, including its actual tyre artwork. */
export function loadCar(bytes:Buffer){
 const loader=new GLTFLoader().register(parser=>({
  name:'NodeEmbeddedImage',
  async loadTexture(index:number){
   const texture=parser.json.textures[index],source=parser.json.images[texture.source];
   const encoded:ArrayBuffer=await parser.getDependency('bufferView',source.bufferView);
   const {data,info}=await sharp(Buffer.from(encoded)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   const image=new DataTexture(new Uint8Array(data),info.width,info.height);
   image.name=source.name;image.flipY=false;image.needsUpdate=true;
   return image;
  }
 }));
 return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'');
}
