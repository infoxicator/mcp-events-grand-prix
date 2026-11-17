import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
function glb(name:string){const data=readFileSync(new URL(`../src/race/assets/jgp26-${name}.glb`,import.meta.url));expect(data.toString('ascii',0,4)).toBe('glTF');expect(data.readUInt32LE(4)).toBe(2);return JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));}
describe('Blender assets',()=>{
 it('contains independent animation rigs, two liveries’ numbers and embedded resources',()=>{for(const level of ['high','low']){const g=glb(level),names=g.nodes.map((n:any)=>n.name);for(const name of ['Chassis','Steering','DRS','Helmet','FrontL','FrontR','RearL','RearR','NumberA','NumberB','Hands','HandL','HandR','ForearmL','ForearmR'])expect(names).toContain(name);expect(g.buffers.every((b:any)=>!b.uri)).toBe(true);for(const name of ['Carbon','WheelDish','BrakeDisc','GloveFabric','Sleeve'])expect(g.materials.map((m:any)=>m.name)).toContain(name);expect(JSON.stringify(g)).not.toMatch(/UniCredit|Pirelli|Ferrari|Peroni|Richard Mille/);}});
 it('has a useful reduced LOD and 3.6 metre wheelbase',()=>{const hi=glb('high'),lo=glb('low');const triangles=(g:any)=>g.meshes.flatMap((m:any)=>m.primitives).reduce((sum:number,p:any)=>sum+g.accessors[p.indices].count/3,0);expect(triangles(lo)).toBeLessThan(triangles(hi)*.45);expect(triangles(hi)).toBeLessThan(245000);const front=hi.nodes.find((n:any)=>n.name==='FrontL'),rear=hi.nodes.find((n:any)=>n.name==='RearL');expect(front.translation[2]-rear.translation[2]).toBeCloseTo(3.6,4);});
});

it('exports the blended outer body as one connected surface across paint boundaries',()=>{
 const b=readFileSync(new URL('../src/race/assets/jgp26-high.glb',import.meta.url)),jsonLength=b.readUInt32LE(12),g=JSON.parse(b.toString('utf8',20,20+jsonLength)),bin=28+jsonLength;
 const node=g.nodes.find((n:any)=>n.name==='Chassis_TwoToneCover');expect(node).toBeTruthy();
 const vertices=new Map<string,number>(),parents:number[]=[];
 const root=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 const read=(index:number)=>{const a=g.accessors[index],v=g.bufferViews[a.bufferView],n=a.type==='VEC3'?3:1,bytes=a.componentType===5123?2:4,start=bin+(v.byteOffset??0)+(a.byteOffset??0),step=v.byteStride??n*bytes;return Array.from({length:a.count},(_,i)=>Array.from({length:n},(_,j)=>{const offset=start+i*step+j*bytes;return a.componentType===5126?b.readFloatLE(offset):a.componentType===5123?b.readUInt16LE(offset):b.readUInt32LE(offset);}));};
 for(const p of g.meshes[node.mesh].primitives){
  const ids=read(p.attributes.POSITION).map(v=>{const key=v.map(x=>x.toFixed(5)).join(',');if(!vertices.has(key)){vertices.set(key,parents.length);parents.push(parents.length);}return vertices.get(key)!;});
  const indices=read(p.indices).flat();for(let i=0;i<indices.length;i+=3){const a=root(ids[indices[i]]),c=root(ids[indices[i+1]]),d=root(ids[indices[i+2]]);parents[c]=a;parents[d]=a;}
 }
 expect(vertices.size).toBeGreaterThan(10000);expect(new Set(parents.map((_,i)=>root(i))).size).toBe(1);
});
