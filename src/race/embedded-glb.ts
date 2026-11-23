import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Texture,TextureLoader} from 'three';
/** Decode data URIs without fetch(data:), which may be blocked by the host CSP. */
export async function assetBytes(url:string):Promise<ArrayBuffer>{
 if(!url.startsWith('data:'))return fetch(url).then(r=>{if(!r.ok)throw new Error(`Asset ${r.status}`);return r.arrayBuffer();});
 const raw=atob(url.slice(url.indexOf(',')+1)),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes.buffer;
}
// Normal web servers may serve a precompressed asset with Content-Encoding.
export async function gzipBytes(url:string){
 const bytes=await assetBytes(url);
 const signature=new Uint8Array(bytes,0,2);
 if(signature[0]!==0x1f||signature[1]!==0x8b)return bytes;
 return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
function base64(bytes:Uint8Array){const parts:string[]=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(parts.join(''));}
async function decodeBufferImage(bufferView:ArrayBuffer,mime:string,fallbackLoader:TextureLoader):Promise<Texture>{
 // Decode directly from the in-memory Blob on a worker thread via createImageBitmap,
 // avoiding both blob: URL fetches (blocked by strict MCP CSP) and 25 MB GLB duplication.
 if(typeof createImageBitmap==='function'){
  try{
   const bitmap=await createImageBitmap(new Blob([bufferView],{type:mime}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
   const texture=new Texture(bitmap);
   texture.needsUpdate=true;
   return texture;
  }catch{/* fall back to data: URI Image below */}
 }
 const uri=`data:${mime};base64,${base64(new Uint8Array(bufferView))}`;
 return new Promise<Texture>((resolve,reject)=>fallbackLoader.load(uri,resolve,undefined,reject));
}
export async function embeddedGLB(url:string,gzip=false){
 const bytes=await (gzip?gzipBytes(url):assetBytes(url));
 if(import.meta.env.MCP_APP!=='true')return new GLTFLoader().parseAsync(bytes,'');
 const loader=new GLTFLoader().register(parser=>{
  const fallbackLoader=new TextureLoader(parser.options.manager);
  const p=parser as unknown as {
   json:{images?:Array<{bufferView?:number;mimeType?:string;uri?:string;extras?:Record<string,unknown>}>};
   sourceCache:Record<number,Promise<Texture>|undefined>;
   getDependency:(type:string,index:number)=>Promise<ArrayBuffer>;
   loadImageSource:(sourceIndex:number,texLoader:unknown)=>Promise<Texture>;
  };
  const originalLoad=p.loadImageSource.bind(parser);
  p.loadImageSource=(sourceIndex:number,texLoader:unknown)=>{
   const sourceDef=p.json.images?.[sourceIndex];
   if(sourceDef?.bufferView===undefined)return originalLoad(sourceIndex,texLoader);
   const cached=p.sourceCache[sourceIndex];
   if(cached!==undefined)return cached.then(t=>t.clone());
   const mime=sourceDef.mimeType||'image/png';
   const promise=p.getDependency('bufferView',sourceDef.bufferView).then(async bufferView=>{
    const texture=await decodeBufferImage(bufferView,mime,fallbackLoader);
    if(sourceDef.extras)Object.assign(texture.userData,sourceDef.extras);
    texture.userData.mimeType=mime;
    return texture;
   });
   p.sourceCache[sourceIndex]=promise;
   return promise;
  };
  return {name:'EmbeddedImages'};
 });
 return loader.parseAsync(bytes,'');
}
