import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {TextureLoader} from 'three';
/** Decode embedded assets without fetch(data:), blob workers or eval: strict MCP CSP. */
export async function assetBytes(url:string):Promise<ArrayBuffer>{
 if(!url.startsWith('data:'))return fetch(url).then(r=>{if(!r.ok)throw new Error(`Asset ${r.status}`);return r.arrayBuffer();});
 const raw=atob(url.slice(url.indexOf(',')+1)),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes.buffer;
}
function base64(bytes:Uint8Array){const parts:string[]=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(parts.join(''));}
export async function embeddedGLB(url:string,gzip=false){
 let bytes=await assetBytes(url);if(gzip)bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 const view=new DataView(bytes),jsonSize=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonSize))),binStart=20+jsonSize+8;
 // Replace embedded image buffer views with img-src data: images. GLTFLoader's
 // default ImageBitmapLoader fetches blob: URLs, which strict MCP hosts forbid.
 for(const img of json.images??[])if(img.bufferView!==undefined){const b=json.bufferViews[img.bufferView];img.uri=`data:${img.mimeType};base64,${base64(new Uint8Array(bytes,binStart+(b.byteOffset??0),b.byteLength))}`;delete img.bufferView;}
 const encoded=new TextEncoder().encode(JSON.stringify(json)),padded=Math.ceil(encoded.length/4)*4,binary=new Uint8Array(bytes,binStart),result=new ArrayBuffer(20+padded+8+binary.length),out=new DataView(result),body=new Uint8Array(result);
 out.setUint32(0,0x46546c67,true);out.setUint32(4,2,true);out.setUint32(8,result.byteLength,true);out.setUint32(12,padded,true);out.setUint32(16,0x4e4f534a,true);body.fill(32,20,20+padded);body.set(encoded,20);out.setUint32(20+padded,binary.length,true);out.setUint32(24+padded,0x004e4942,true);body.set(binary,28+padded);
 const loader=new GLTFLoader().register(parser=>{parser.textureLoader=new TextureLoader(parser.options.manager);return {name:'EmbeddedImages'};});return loader.parseAsync(result,'');
}
