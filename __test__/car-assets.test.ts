import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
function glb(name:string){const data=readFileSync(new URL(`../src/race/assets/jgp26-${name}.glb`,import.meta.url));expect(data.toString('ascii',0,4)).toBe('glTF');expect(data.readUInt32LE(4)).toBe(2);return JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));}
describe('Blender assets',()=>{
 it('contains independent animation rigs, two liveries’ numbers and embedded resources',()=>{for(const level of ['high','low']){const g=glb(level),names=g.nodes.map((n:any)=>n.name);for(const name of ['Chassis','Steering','DRS','Helmet','FrontL','FrontR','RearL','RearR','NumberA','NumberB','HelmetNumberA','HelmetNumberB','Hands','HandL','HandR','ForearmL','ForearmR',...['L','R'].flatMap(side=>Array.from({length:5},(_,i)=>`Finger${side}${i}`))])expect(names).toContain(name);expect(g.buffers.every((b:any)=>!b.uri)).toBe(true);for(const name of ['Carbon','WheelDish','BrakeDisc','GloveFabric','GloveSuede','GloveStitch','Sleeve'])expect(g.materials.map((m:any)=>m.name)).toContain(name);expect(JSON.stringify(g)).not.toMatch(/UniCredit|Pirelli|Ferrari|Peroni|Richard Mille/);}});
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

import {fingerCurl} from '../src/race/grip';
it('keeps individual digit motion bounded, varied and responsive to steering',()=>{
 const poses=Array.from({length:5},(_,i)=>fingerCurl(-1,i,.2,120,60));
 expect(new Set(poses.map(p=>p.curl)).size).toBe(5);
 for(let i=0;i<5;i++){expect(Math.abs(poses[i].curl)).toBeLessThan(.04);expect(fingerCurl(-1,i,-.2,120,60).curl).not.toBe(poses[i].curl);expect(fingerCurl(-1,i,.2,120,60)).toEqual(poses[i]);}
 expect(fingerCurl(1,0,0,0,0).curl).toBeCloseTo(0);expect(fingerCurl(1,0,0,0,0).spread).toBeCloseTo(0);
});

it('leaves the airbox and sidepod mouths physically open in the exported painted shell',()=>{
 const b=readFileSync(new URL('../src/race/assets/jgp26-high.glb',import.meta.url)),length=b.readUInt32LE(12),g=JSON.parse(b.toString('utf8',20,20+length)),bin=28+length;
 const shell=g.nodes.find((n:any)=>n.name==='Chassis_TwoToneCover');
 const read=(index:number)=>{const a=g.accessors[index],v=g.bufferViews[a.bufferView],size=a.type==='VEC3'?3:1,bytes=a.componentType===5123?2:4,start=bin+(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??size*bytes;return Array.from({length:a.count},(_,i)=>Array.from({length:size},(_,j)=>{const at=start+i*stride+j*bytes;return a.componentType===5126?b.readFloatLE(at):a.componentType===5123?b.readUInt16LE(at):b.readUInt32LE(at);}));};
 // Project triangles onto XY and cast -Z rays through the mouths. A painted cap
 // would intersect near the lip; an open duct first meets the deeper rear wall.
 for(const [x,y,front,deep] of [[0,.98,-.45,-.74],[-.55,.548,.61,.33],[.55,.548,.61,.33]]){
  let nearest=-Infinity;
  for(const primitive of g.meshes[shell.mesh].primitives){const vertices=read(primitive.attributes.POSITION),indices=read(primitive.indices).flat();
   for(let i=0;i<indices.length;i+=3){const [a,c,d]=indices.slice(i,i+3).map(j=>vertices[j]);const det=(c[1]-d[1])*(a[0]-d[0])+(d[0]-c[0])*(a[1]-d[1]);if(Math.abs(det)<1e-12)continue;
    const u=((c[1]-d[1])*(x-d[0])+(d[0]-c[0])*(y-d[1]))/det,v=((d[1]-a[1])*(x-d[0])+(a[0]-d[0])*(y-d[1]))/det;
    if(u>=0&&v>=0&&u+v<=1){const z=u*a[2]+v*c[2]+(1-u-v)*d[2];if(z<=front)nearest=Math.max(nearest,z);}
   }
  }
  expect(Number.isFinite(nearest)).toBe(true);expect(nearest).toBeLessThan(deep);
 }
});
