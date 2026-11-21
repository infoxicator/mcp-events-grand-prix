import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {TextureLoader} from 'three';
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
export async function embeddedGLB(url:string,gzip=false){
 const bytes=await (gzip?gzipBytes(url):assetBytes(url));
 if(import.meta.env.MCP_APP!=='true')return new GLTFLoader().parseAsync(bytes,'');
 const view=new DataView(bytes),jsonSize=view.getUint32(12,true);
 const json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonSize))),binStart=20+jsonSize+8;
 // Replace embedded image buffer views with img-src data: images. GLTFLoader's
 // default ImageBitmapLoader fetches blob: URLs, which strict MCP hosts forbid.
 for(const img of json.images??[])if(img.bufferView!==undefined){const b=json.bufferViews[img.bufferView];img.uri=`data:${img.mimeType};base64,${base64(new Uint8Array(bytes,binStart+(b.byteOffset??0),b.byteLength))}`;delete img.bufferView;}
 const encoded=new TextEncoder().encode(JSON.stringify(json)),padded=Math.ceil(encoded.length/4)*4,binary=new Uint8Array(bytes,binStart),result=new ArrayBuffer(20+padded+8+binary.length),out=new DataView(result),body=new Uint8Array(result);
 out.setUint32(0,0x46546c67,true);out.setUint32(4,2,true);out.setUint32(8,result.byteLength,true);out.setUint32(12,padded,true);out.setUint32(16,0x4e4f534a,true);body.fill(32,20,20+padded);body.set(encoded,20);out.setUint32(20+padded,binary.length,true);out.setUint32(24+padded,0x004e4942,true);body.set(binary,28+padded);
 const loader=new GLTFLoader().register(parser=>{parser.textureLoader=new TextureLoader(parser.options.manager);return {name:'EmbeddedImages'};});return loader.parseAsync(result,'');
}
