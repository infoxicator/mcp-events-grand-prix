import {describe,it,expect} from 'vitest';
import {readFileSync,statSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {getTrack} from '../src/race/track';
import {circuitHeight} from '../src/race/elevation';
for(const id of ['monza','las-vegas'] as const)describe(id+' Blender circuit',()=>{
 it('preserves GPU instances in the decoder-free MCP asset with millimetre-scale quantization',()=>{
  const bytes=gunzipSync(readFileSync(new URL(`../src/race/assets/circuits/${id}-mcp.glb.gz`,import.meta.url))),g=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);expect(g.extensionsRequired??[]).not.toContain('KHR_draco_mesh_compression');expect(g.extensionsUsed).toContain('EXT_mesh_gpu_instancing');
  const instances=g.nodes.filter((n:any)=>n.extensions?.EXT_mesh_gpu_instancing);expect(instances.length).toBeGreaterThan(4);
  expect(instances.reduce((sum:number,n:any)=>sum+g.accessors[Object.values(n.extensions.EXT_mesh_gpu_instancing.attributes)[0] as number].count,0)).toBeGreaterThan(1000);
  for(const n of g.nodes.filter((n:any)=>n.mesh!==undefined&&n.scale&&n.name?.includes('_')&&!n.extensions?.EXT_mesh_gpu_instancing)){if(n.scale[0]===n.scale[1]&&n.scale[1]===n.scale[2])expect(2*n.scale[0]/65534).toBeLessThan(.02);}
  for(const a of g.accessors){if(a.bufferView===undefined)continue;const v=g.bufferViews[a.bufferView];expect(v.byteOffset+v.byteLength).toBeLessThanOrEqual(g.buffers[0].byteLength);if(a.componentType===5120||a.componentType===5122)expect(a.normalized).toBe(true);}
 });
 it('keeps the authoritative real path and a continuous gentle terrain profile',()=>{
  const path=JSON.parse(readFileSync(new URL(`../data/${id}-render-path.json`,import.meta.url),'utf8')),track=getTrack(id);
  expect(path.length).toBeCloseTo(track.LENGTH,5);
  for(const p of path.samples.filter((_:unknown,i:number)=>i%73===0)){const actual=track.pointAt(p.d);expect(Math.hypot(actual.x-p.x,actual.z-p.z)).toBeLessThan(.001);}
  expect(circuitHeight(id,0)).toBeCloseTo(circuitHeight(id,track.LENGTH),8);
  expect(Math.abs(circuitHeight(id,-.01)-circuitHeight(id,.01))).toBeLessThan(.002);
  for(let d=0;d<track.LENGTH;d+=10){expect(Number.isFinite(circuitHeight(id,d))).toBe(true);expect(Math.abs(circuitHeight(id,d+1)-circuitHeight(id,d))).toBeLessThan(.035);}
 });
 it('ships embedded Blender geometry with compressed chunks and key trackside materials',()=>{
  const url=new URL(`../src/race/assets/circuits/${id}.glb`,import.meta.url),b=readFileSync(url),g=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
  expect(b.toString('ascii',0,4)).toBe('glTF');expect(g.asset.generator).toContain('Blender');expect(g.extensionsRequired).toContain('KHR_draco_mesh_compression');
  expect(g.buffers.every((v:any)=>!v.uri)).toBe(true);expect(g.images.every((v:any)=>v.bufferView!==undefined)).toBe(true);
  const materials=g.materials.map((m:any)=>m.name);for(const m of ['Asphalt','Fence','Spectator0','Sign','Glass','Brake150'])expect(materials).toContain(m);
  expect(materials).toContain(id==='monza'?'Canopy0':'Sphere');expect(statSync(new URL(`../src/race/assets/circuits/${id}.glb.gz`,import.meta.url)).size).toBeLessThan(7_500_000);expect(g.extensionsUsed).toContain('EXT_mesh_gpu_instancing');if(id==='monza')expect(g.nodes.some((n:any)=>n.name==='LOD_Canopy0')).toBe(true);expect(g.nodes.filter((n:any)=>n.extensions?.EXT_mesh_gpu_instancing).length).toBeGreaterThan(4);
 });
});
