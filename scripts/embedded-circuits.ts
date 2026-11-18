import {readFileSync} from 'node:fs';
import {gzipSync,gunzipSync,deflateRawSync} from 'node:zlib';
import type {Plugin} from 'vite';

/** The host embeds both complete circuits in a single HTML file. Improve gzip's
 * locality on dense mesh buffers while preserving the Blender exports byte for byte. */
export function embeddedCircuits():Plugin{
 return {name:'pack-embedded-circuits',enforce:'pre',load(id){
  if(!id.endsWith('-mcp.glb.gz?url&inline'))return;
  const raw=gunzipSync(readFileSync(id.split('?')[0])),size=raw.readUInt32LE(12);
  const gltf=JSON.parse(raw.toString('utf8',20,20+size)),bin=raw.subarray(28+size);
  const widths:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},visited=new Set<number>();
  for(const accessor of gltf.accessors){
   const view=gltf.bufferViews[accessor.bufferView];if(!view||visited.has(accessor.bufferView))continue;
   visited.add(accessor.bufferView);
   const scalar=accessor.componentType===5126||accessor.componentType===5125?4:accessor.componentType>=5122?2:1;
   const stride=view.byteStride??scalar*widths[accessor.type],start=view.byteOffset??0;
   const bytes=bin.subarray(start,start+view.byteLength);
   if(!stride||bytes.length<512||bytes.length%stride)continue;
   const filter=Buffer.alloc(bytes.length);let at=0;
   for(let lane=0;lane<stride;lane++){let last=0;for(let j=lane;j<bytes.length;j+=stride){filter[at++]=bytes[j]-last;last=bytes[j];}}
   if(deflateRawSync(filter,{level:1}).length+32<deflateRawSync(bytes,{level:1}).length){
    filter.copy(bytes);view.extras={...view.extras,byteLanes:stride};
   }
  }
  const json=Buffer.from(JSON.stringify(gltf)),padded=Math.ceil(json.length/4)*4;
  const head=Buffer.alloc(28+padded,32);raw.copy(head,0,0,20);head.writeUInt32LE(head.length+bin.length,8);
  head.writeUInt32LE(padded,12);json.copy(head,20);head.writeUInt32LE(bin.length,20+padded);head.writeUInt32LE(0x004e4942,24+padded);
  return 'export default "data:application/gzip;base64,'+gzipSync(Buffer.concat([head,bin]),{level:9}).toString('base64')+'"';
 }};
}
