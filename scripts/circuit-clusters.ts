import {packCircuitAtlases} from './circuit-atlases';
import {readFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {Plugin} from 'vite';

// Store bounds for consecutive index ranges. Vertex data, surveyed placements,
// triangle ordering and every material are identical to the authored export.
export function circuitClusters():Plugin{
 return {name:'mcp-circuit-clusters',enforce:'pre',async load(id){
  if(!/[/](monza|las-vegas)-mcp\.glb\.gz\?url$/.test(id))return;
  const path=id.slice(0,-4),glb=gunzipSync(await readFile(path));
  const jsonSize=glb.readUInt32LE(12),doc=JSON.parse(glb.toString('utf8',20,20+jsonSize)),bin=glb.subarray(28+jsonSize);
  for(const mesh of doc.meshes)for(const prim of mesh.primitives){
   const pos=doc.accessors[prim.attributes.POSITION],index=doc.accessors[prim.indices];
   if(!index||index.count<1200||pos.componentType!==5122||!pos.normalized||![5123,5125].includes(index.componentType))continue;
   const vertices=doc.bufferViews[pos.bufferView],indices=doc.bufferViews[index.bufferView],stride=vertices.byteStride??6;
   const base=(vertices.byteOffset??0)+(pos.byteOffset??0),start=(indices.byteOffset??0)+(index.byteOffset??0);
   const wide=index.componentType===5125,step=384,bounds:number[]=[];
   for(let i=0;i<index.count;i+=step){
    let x0=32767,y0=32767,z0=32767,x1=-32768,y1=-32768,z1=-32768;
    for(let p=i,end=Math.min(i+step,index.count);p<end;p++){
     const vertex=wide?bin.readUInt32LE(start+4*p):bin.readUInt16LE(start+2*p);
     const offset=base+vertex*stride,x=bin.readInt16LE(offset),y=bin.readInt16LE(offset+2),z=bin.readInt16LE(offset+4);
     x0=Math.min(x0,x);y0=Math.min(y0,y);z0=Math.min(z0,z);x1=Math.max(x1,x);y1=Math.max(y1,y);z1=Math.max(z1,z);
    }
    bounds.push(x0,y0,z0,x1,y1,z1);
   }
   prim.extras={...prim.extras,clusterStep:step,clusterBounds:bounds};
  }
  // Blender gives each quantized chunk an identity placement parent. Reference
  // its positioned child directly so GLTFLoader creates only one Object3D.
  for(const scene of doc.scenes)scene.nodes=scene.nodes.map((i:number)=>{
   const node=doc.nodes[i];
   if(!node.name?.endsWith('_placement')||node.children?.length!==1||Object.keys(node).length!==2)return i;
   const [child]=node.children;delete node.children;return child;
  });
  const packed=await packCircuitAtlases(doc,bin);
  const json=Buffer.from(JSON.stringify(doc)),padded=Math.ceil(json.length/4)*4,head=Buffer.alloc(20+padded,32);
  glb.copy(head,0,0,20);head.writeUInt32LE(head.length+8+packed.length,8);head.writeUInt32LE(padded,12);json.copy(head,20);
  const chunk=Buffer.alloc(8);chunk.writeUInt32LE(packed.length);chunk.writeUInt32LE(0x004e4942,4);
  const source=gzipSync(Buffer.concat([head,chunk,packed]),{level:9,memLevel:5});
  const ref=this.emitFile({type:'asset',name:path.split('/').at(-1),source});
  return 'export default import.meta.ROLLUP_FILE_URL_'+ref;
 }};
}
