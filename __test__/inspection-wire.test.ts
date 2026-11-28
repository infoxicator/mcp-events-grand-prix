import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {BufferGeometry,Float32BufferAttribute} from 'three';
import {expect,it} from 'vitest';
import {inspectionWire,shellGeometry,type InspectionShell} from '../src/race/inspection-wire';

it('omits a shared panel diagonal even when the exporter splits its vertices at a UV seam',()=>{
 const panel=new BufferGeometry().setAttribute('position',new Float32BufferAttribute([
  0,0,0, 2,0,0, 2,1,0,
  0,0,0, 2,1,0, 0,1,0,
 ],3));
 expect(inspectionWire(panel).getAttribute('position').count).toBe(8);
});

it('retains the common edge of two folded surfaces',()=>{
 const folded=new BufferGeometry().setAttribute('position',new Float32BufferAttribute([
  -1,0,0, 1,0,0, 0,1,0, 0,0,1,
 ],3)).setIndex([0,1,2,1,0,3]);
 expect(inspectionWire(folded).getAttribute('position').count).toBe(10);
});

it('divides each wheel triangle into three equal rows along every edge direction',()=>{
 const panel=new BufferGeometry().setAttribute('position',new Float32BufferAttribute([
  0,0,0, 3,0,0, 0,3,0,
 ],3));
 const lines=inspectionWire(panel,true,3).getAttribute('position');
 const point=(i:number)=>[lines.getX(i),lines.getY(i),lines.getZ(i)].join(',');
 const segments=Array.from({length:lines.count/2},(_,i)=>[point(2*i),point(2*i+1)].sort().join('|'));
 expect(segments).toHaveLength(9);
 expect(segments).toEqual(expect.arrayContaining([
  '0,1,0|1,0,0','0,2,0|2,0,0','2,0,0|2,1,0','1,0,0|1,2,0',
  '0,2,0|1,2,0','0,1,0|2,1,0',
 ]));
});

it('retains both panel diagonals and draws their common boundary once',()=>{
 const {surface,grid}=shellGeometry({
  points:[[0,0,0],[10000,0,0],[10000,10000,0],[0,10000,0],[20000,0,0],[20000,10000,0]],
  faces:[[0,1,2,3],[1,4,5,2]],
 });
 expect(surface.index?.count).toBe(12);
 expect(grid.index?.count).toBe(18);
 expect(grid.getAttribute('position').getX(4)).toBe(2);
});

it('shares the boundary between a triangular nose joint and a four-sided panel',()=>{
 const {surface,grid}=shellGeometry({
  points:[[0,0,0],[10000,0,0],[10000,10000,0],[0,10000,0],[20000,0,0]],
  faces:[[0,1,2,3],[1,4,2]],
 });
 expect(Array.from(surface.index!.array)).toEqual([0,1,2,0,2,3,1,4,2]);
 expect(grid.index?.count).toBe(14);
});

it('keeps the exported nose joint closed where the perimeter folds back at the shoulder',()=>{
 const file=new URL('../src/race/assets/jgp26-wire-shell.json.gz',import.meta.url);
 const shell:InspectionShell=JSON.parse(gunzipSync(readFileSync(file)).toString());
 const counts=new Map<number,number>();
 for(const face of shell.faces){
  for(let i=0;i<face.length;i++){
   const a=face[i], b=face[(i+1)%face.length];
   const edge=Math.min(a,b)*shell.points.length+Math.max(a,b);
   counts.set(edge,(counts.get(edge)??0)+1);
  }
 }
 expect(new Set(counts.values())).toEqual(new Set([2]));
});

it('preserves the unposed export and interpolates UVs at a separating panel seam',async()=>{
 const {posedGeometry}=await import('../src/race/inspection-pose');
 const geo=new BufferGeometry().setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3))
  .setAttribute('uv',new Float32BufferAttribute([0,0,1,0,0,1],2)).setIndex([0,1,2]);
 const identity=[1,0,0,0,0,1,0,0,0,0,1,0],shift=[1,0,0,2,0,1,0,0,0,0,1,0];
 const inspection=posedGeometry(geo,{
  poses:{service:{matrices:[identity,shift],meshes:{body:[0,[0,1]]}}},
  layouts:[[1,[0,0],{0:[[0,0,0,32768,0,0,65535],[1,32768,0,65535,0,0,65535]]}]]
 },'service','body',.5);
 const pos=inspection.getAttribute('position'),uv=inspection.getAttribute('uv');
 expect(pos.count).toBe(6);
 expect(pos.getX(3)-pos.getX(1)).toBeCloseTo(1);
 expect(uv.getX(3)).toBeCloseTo(uv.getX(1));
 expect(geo.getAttribute('position').count).toBe(3);
 expect(geo.getAttribute('position').getX(0)).toBe(0);
});

it('retains the area of every export triangle cut across two moving panels',()=>{
 const file=new URL('../src/race/assets/inspection-poses.json.gz',import.meta.url);
 const data=JSON.parse(gunzipSync(readFileSync(file)).toString()) as import('../src/race/inspection-pose').InspectionPoses;
 expect(Object.keys(data.poses).sort()).toEqual(['breakdown','exploded','lift','overhead','quarter','service']);
 let largestError=0;
 for(const [, ,cuts] of data.layouts){
  for(const patches of Object.values(cuts)){
   let area=0;
   for(const [, ...uv] of patches){
    for(let i=0;i<uv.length;i+=6)area+=Math.abs((uv[i+2]-uv[i])*(uv[i+5]-uv[i+1])-(uv[i+4]-uv[i])*(uv[i+3]-uv[i+1]));
   }
   largestError=Math.max(largestError,Math.abs(1-area/(65535*65535)));
  }
 }
 expect(largestError).toBeLessThan(.0002);
});

it('carries the tyre print through every pose and releases the outer cover in the wire breakdown',()=>{
 const asset=readFileSync(new URL('../src/race/assets/jgp26-high.glb',import.meta.url));
 const gltf=JSON.parse(asset.toString('utf8',20,20+asset.readUInt32LE(12))) as {nodes:{name:string;mesh:number}[]};
 const bindings=readFileSync(new URL('../src/race/assets/inspection-poses.json.gz',import.meta.url));
 const {poses}=JSON.parse(gunzipSync(bindings).toString()) as import('../src/race/inspection-pose').InspectionPoses;
 for(const wheel of ['FrontL','FrontR','RearL','RearR']){
  for(const [name,pose] of Object.entries(poses)){
   function transforms(part:string){
    const mesh=gltf.nodes.find(node=>node.name===wheel+'_'+part)!.mesh;
    const [,palette]=pose.meshes[mesh+'/0'];
    return palette.map(index=>pose.matrices[index]);
   }
   const tyre=transforms('Rubber');
   expect(tyre).toHaveLength(1);
   expect(gltf.nodes.some(node=>node.name===wheel+'_CompoundInk')).toBe(false);
   // The dish has a rotated local frame. Compare how far each part travels.
   const distance=(m:number[])=>Math.hypot(m[3],m[7],m[11]);
   const coverTravel=transforms('WheelDish').map(distance).sort((a,b)=>a-b);
   const tyreTravel=distance(tyre[0]);
   expect(coverTravel).toHaveLength(name==='exploded'?2:1);
   if(name==='service'){
    expect(coverTravel[0]).toBeCloseTo(tyreTravel,4);
    continue;
   }
   expect(tyreTravel-coverTravel[0]).toBeGreaterThan(.1);
   if(name==='exploded'){
    // The outboard cover sits just inside the tyre. The inner dish stays at the hub.
    expect(tyreTravel-coverTravel[1]).toBeGreaterThan(.04);
    expect(tyreTravel-coverTravel[1]).toBeLessThan(.06);
   }
  }
 }
});
