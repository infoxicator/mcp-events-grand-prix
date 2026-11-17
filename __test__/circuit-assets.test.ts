import {describe,it,expect} from 'vitest';
import {readFileSync,statSync} from 'node:fs';
import {getTrack} from '../src/race/track';
import {circuitHeight} from '../src/race/elevation';
for(const id of ['monza','las-vegas'] as const)describe(id+' Blender circuit',()=>{
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
  const materials=g.materials.map((m:any)=>m.name);for(const m of ['Asphalt','Fence','Crowd','Sign','Glass','Brake150'])expect(materials).toContain(m);
  expect(materials).toContain(id==='monza'?'Foliage':'Sphere');expect(statSync(url).size).toBeLessThan(7_000_000);
 });
});
