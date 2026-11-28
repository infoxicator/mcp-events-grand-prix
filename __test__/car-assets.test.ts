import {loadCar} from './load-car';
import {describe,it,expect} from 'vitest';
import {gunzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {Mesh,Raycaster,Vector3} from 'three';

it('carries the masked inner cowling finish on the painted shell at both LODs',async()=>{
 for(const level of ['high','low']){
  const bytes=readFileSync(new URL(`../src/race/assets/jgp26-${level}.glb`,import.meta.url));
  const {scene}=await loadCar(bytes);
  let painted=0, carbon=0;
  scene.getObjectByName('Chassis_TwoToneCover')!.traverse(part=>{
   if(!(part instanceof Mesh))return;
   const positions=part.geometry.getAttribute('position');
   const mask=part.geometry.getAttribute('_cowllacquer');
   expect(mask.count).toBe(positions.count);
   for(let i=0;i<mask.count;i++){
    if(mask.getX(i)>.5){
     painted++;
     expect(positions.getZ(i)).toBeLessThan(-.68);
     expect(Math.abs(positions.getX(i))).toBeLessThanOrEqual(.405);
    }else carbon++;
   }
  });
  expect(painted).toBeGreaterThan(20);
  expect(carbon).toBeGreaterThan(painted);
 }
});
it('closes the helmet crown across the number at both distances',async()=>{
 for(const level of ['high','low']){
  const bytes=readFileSync(new URL(`../src/race/assets/jgp26-${level}.glb`,import.meta.url));
  const {scene}=await loadCar(bytes);
  const shell=scene.getObjectByName('Helmet_HelmetPaint') as Mesh;
  shell.updateWorldMatrix(true,false);
  const down=new Vector3(0,-1,0).transformDirection(shell.matrixWorld);
  for(const x of [-.004,0,.004])for(const z of [-.004,0,.004]){
   const origin=shell.localToWorld(new Vector3(x,1.05,-.315+z));
   const hit=new Raycaster(origin,down).intersectObject(shell,false)[0];
   expect(hit).toBeDefined();
   expect(shell.worldToLocal(hit.point).y).toBeGreaterThan(.95);
   expect(hit.uv!.y).toBeLessThan(.5);
  }
 }
});
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

it('keeps the aerofoil stacks and the moving DRS flap on both sides at each LOD',async()=>{
 const {Raycaster,Vector3}=await import('three');
 for(const level of ['high','low']){
  const bytes=readFileSync(new URL(`../src/race/assets/jgp26-${level}.glb`,import.meta.url));
  const {scene}=await loadCar(bytes);
  scene.updateMatrixWorld(true);
  for(const [part,z] of [['Chassis',2.70],['Chassis',2.53],['Chassis',2.40],['Chassis',2.27],['Chassis',-2.40],['DRS',-2.52]] as const){
   const heights=[-.58,.58].map(x=>{
    const ray=new Raycaster(new Vector3(x,1.1,z),new Vector3(0,-1,0));
    const hit=ray.intersectObject(scene.getObjectByName(part)!,true)[0];
    expect(hit,`${level} ${part} wing missing at x=${x}, z=${z}`).toBeTruthy();
    return hit.point.y;
   });
   expect(Math.abs(heights[0]-heights[1])).toBeLessThan(.008);
  }
 }
});

it('keeps both diffuser exits open through to the rising floor at each LOD',async()=>{
 const {Raycaster,Vector3}=await import('three');
 for(const level of ['high','low']){
  const bytes=readFileSync(new URL(`../src/race/assets/jgp26-${level}.glb`,import.meta.url));
  const {scene}=await loadCar(bytes);
  scene.updateMatrixWorld(true);
  const floor=scene.getObjectByName('Floor')!;
  for(const x of [-.34,.34]){
   const ray=new Raycaster(new Vector3(x,.17,-3),new Vector3(0,0,1));
   const hit=ray.intersectObject(floor,true)[0];
   expect(hit).toBeDefined();
   expect(hit.point.z).toBeGreaterThan(-2.50);
   expect(hit.point.z).toBeLessThan(-2.10);
  }
 }
});

it('keeps brake hardware on a separate knuckle when the wheel spins or comes off',async()=>{
 for(const level of ['high','low']){
  const bytes=readFileSync(new URL(`../src/race/assets/jgp26-${level}.glb`,import.meta.url));
  const {scene}=await loadCar(bytes);
  for(const corner of ['FrontL','FrontR','RearL','RearR']){
   const hub=scene.getObjectByName(corner)!,knuckle=scene.getObjectByName(corner+'Knuckle')!;
   expect(knuckle.parent).toBe(hub.parent);
   expect(knuckle.getObjectByName(corner+'Knuckle_Titanium')).toBeTruthy();
   expect(hub.getObjectByName(corner+'_BrakeDisc')).toBeTruthy();
   scene.updateMatrixWorld(true);
   const installed=knuckle.matrixWorld.clone();
   hub.rotateX(Math.PI/2);hub.visible=false;scene.updateMatrixWorld(true);
   expect(knuckle.matrixWorld.equals(installed)).toBe(true);
   expect(knuckle.visible).toBe(true);
  }
 }
});

it('prints the sidewall artwork on a dedicated UV set at both wheel LODs',async()=>{
 const {Mesh,MeshStandardMaterial,DataTexture}=await import('three');
 for(const level of ['high','low']){
  const bytes=readFileSync(new URL(`../src/race/assets/jgp26-${level}.glb`,import.meta.url));
  const {scene}=await loadCar(bytes);
  for(const wheel of ['FrontL','FrontR','RearL','RearR']){
   const tyre=scene.getObjectByName(wheel)!.children.find(o=>o instanceof Mesh&&o.material.name==='SlickRubber') as InstanceType<typeof Mesh>;
   const map=(tyre.material as InstanceType<typeof MeshStandardMaterial>).map;
   if(!(map instanceof DataTexture))throw new Error('Expected decoded sidewall print');
   expect(tyre.geometry.getAttribute('uv1').count).toBe(tyre.geometry.getAttribute('position').count);
   expect(map.channel).toBe(0);
   expect(tyre.geometry.getAttribute('uv')).not.toBe(tyre.geometry.getAttribute('uv1'));
   expect(map.image.width).toBe(1024);
   expect(map.image.data?.some((channel:number,i:number)=>i%4===0&&channel>200)).toBe(true);
  }
 }
});


it('prints the near and distant AI rear flaps upright from behind on both faces',async()=>{
 const {scene}=await loadCar(gunzipSync(readFileSync(new URL('../src/race/assets/constructor-trim.glb.gz',import.meta.url))));
 const teams={Field:0,Far:0};
 scene.traverse(part=>{
  if(!(part instanceof Mesh))return;
  const level=part.name.startsWith('Field')?'Field':part.name.startsWith('Far')?'Far':undefined;
  if(!level)return;
  const pos=part.geometry.getAttribute('position'),uv=part.geometry.getAttribute('uv');
  const flap=Array.from({length:uv.count},(_,i)=>i).filter(i=>uv.getX(i)>=0);
  const width=Math.max(...flap.map(i=>pos.getX(i)))*2;
  expect(width,part.name).toBeGreaterThan(1.5);
  for(const i of flap){
   // From the trailing car the right side of the picture is local -X.
   expect(uv.getX(i)).toBeCloseTo(.5-pos.getX(i)/width,3);
  }
  const middle=flap.filter(i=>Math.abs(pos.getX(i))<.001);
  const z=middle.map(i=>pos.getZ(i));
  for(const trailing of [true,false]){
   const edge=trailing?Math.min(...z):Math.max(...z);
   const pair=middle.filter(i=>Math.abs(pos.getZ(i)-edge)<.001).sort((a,b)=>pos.getY(a)-pos.getY(b));
   expect(pair.length).toBeGreaterThanOrEqual(2);
   expect(uv.getY(pair[0])).toBeCloseTo(trailing?1:0);
   expect(uv.getY(pair.at(-1)!)).toBeCloseTo(trailing?0:1);
  }
  teams[level]++;
 });
 expect(teams).toEqual({Field:11,Far:11});
});

it('ships sidewall markings on the tyre surface and metric cowling UVs at both LODs',async()=>{
 for(const level of ['high','low']){
  const {scene}=await loadCar(readFileSync(new URL('../src/race/assets/jgp26-'+level+'.glb',import.meta.url)));
  for(const corner of ['FrontL','FrontR','RearL','RearR']){
   expect(scene.getObjectByName(corner+'_CompoundInk')).toBeUndefined();
   expect(scene.getObjectByName(corner+'_Rubber')).toBeTruthy();
  }
  const cover=scene.getObjectByName('Chassis_TwoToneCover')!;
  let outside=0;
  cover.traverse(node=>{
   if(!(node instanceof Mesh))return;
   const uv=node.geometry.getAttribute('uv');
   for(let i=0;i<uv.count;i++){
    if(uv.getX(i)<-.01||uv.getX(i)>1.01||uv.getY(i)<-.01||uv.getY(i)>1.01)outside++;
   }
  });
  expect(outside).toBeGreaterThan(100);
 }
});
