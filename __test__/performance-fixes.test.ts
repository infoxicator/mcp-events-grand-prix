import {describe,expect,it} from 'vitest';
import {RaceRoom} from '../server/race-room';
import {createRace} from '../src/race/physics';
import {blendRace,createInterpolator} from '../src/race/presentation-motion';
import {garageVisits,type Constructor,type GarageVisit} from '../src/race/pit-service';
import {getTrack} from '../src/race/track';
import type {RaceState} from '../src/race/types';

describe('performance and memory-leak regressions',()=>{
 it('pre-serializes broadcast payloads once across all joined peers',()=>{
  const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5387',{JEV_MOCK:'1'});
  const rawPayloads:Array<string|undefined>=[];
  const a=room.add((_m,raw)=>{rawPayloads.push(raw);});
  const b=room.add((_m,raw)=>{rawPayloads.push(raw);});
  const s=room.add((_m,raw)=>{rawPayloads.push(raw);});
  room.join(a,'a',room.tokens.a);
  room.join(b,'b',room.tokens.b);
  room.join(s,null,'');
  rawPayloads.length=0;
  room.broadcast();
  expect(rawPayloads).toHaveLength(3);
  expect(typeof rawPayloads[0]).toBe('string');
  expect(rawPayloads[0]).toBe(rawPayloads[1]);
  expect(rawPayloads[1]).toBe(rawPayloads[2]);
 });

 it('keeps compact 15 Hz replay buffers under 1 MiB and avoids deep-cloning history on lead changes',()=>{
  const room=new RaceRoom(crypto.randomUUID(),'http://localhost:5387',{JEV_MOCK:'1'},1,'jev-vs-jev',{},'monza',false,3);
  const a=room.add(()=>{});const b=room.add(()=>{});
  room.join(a,'a',room.tokens.a);room.join(b,'b',room.tokens.b);
  room.start();
  // Advance 12 simulated seconds of racing (~180 frames at 15 Hz -> capped at 120 history frames)
  room.advance(120*15);
  expect(room.history.length).toBeLessThanOrEqual(120);
  expect(room.history.length).toBeGreaterThan(60);
  const sample=room.history[room.history.length-1];
  expect(sample.events).toEqual([]);
  expect(sample.radio).toEqual([]);
  expect(sample.cars.a.lapTimes).toEqual([]);
  // Full 165-frame replay must stay safely under Cloudflare Workers 1 MiB WS limit
  const maxReplayEst=JSON.stringify(sample).length*165;
  expect(maxReplayEst).toBeLessThan(1024*1024);
 });

 it('reuses interpolation output objects across 60 Hz frames while matching blendRace numerically',()=>{
  const makeSnapshot=(time:number)=>{
   const race=createRace(3);
   race.phase='racing';race.time=time;race.tick=Math.round(time*120);
   race.cars.a.distance=1000+time*70;race.cars.a.speed=70;
   race.cars.b.distance=980+time*68;race.cars.b.speed=68;
   for(const [i,car] of race.field.entries()){car.distance=900+time*65-i*12;car.speed=65;}
   return {race,speed:1,physicsHz:120} as RaceState;
  };
  const interp=createInterpolator();
  const s0=makeSnapshot(10),s1=makeSnapshot(10.1),s2=makeSnapshot(10.2);
  interp.push(s0,1000);interp.push(s1,1100);interp.push(s2,1200);
  const r1=interp(s2,1200,1150);
  const r2=interp(s2,1200,1166);
  // Same scratch container reused across blended frames
  expect(r1).toBe(r2);
  expect(r1.cars).toBe(r2.cars);
  expect(r1.field).toBe(r2.field);
  // Numerically matches pure blendRace
  const pure=blendRace(s0.race,s1.race,(r2.time-s0.race.time)/(s1.race.time-s0.race.time));
  expect(r2.cars.a.distance).toBeCloseTo(pure.cars.a.distance,5);
 });

 it('reuses a caller-provided Map in garageVisits without retaining stale stops',()=>{
  const track=getTrack('monza');
  const race=createRace(3,'monza');
  const map=new Map<Constructor,GarageVisit>();
  race.cars.a.pit='stopped';
  race.cars.a.distance=track.PIT_STOP-200+28*7; // Ferrari bay
  const first=garageVisits(track,race.cars,race.field,map);
  expect(first).toBe(map);
  expect(first.has('Ferrari')).toBe(true);
  race.cars.a.pit='none';
  const second=garageVisits(track,race.cars,race.field,map);
  expect(second).toBe(map);
  expect(second.size).toBe(0);
 });
});

import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

function parsePackedGlb(relPath:string){
 const gz=readFileSync(new URL(relPath,import.meta.url));
 const raw=gunzipSync(gz);
 expect(raw.toString('ascii',0,4)).toBe('glTF');
 const jsonLen=raw.readUInt32LE(12);
 const gltf=JSON.parse(raw.toString('utf8',20,20+jsonLen));
 const prims=gltf.meshes.flatMap((m:any)=>m.primitives);
 const tris=prims.reduce((s:number,p:any)=>s+gltf.accessors[p.indices].count/3,0);
 return {gzBytes:gz.length,rawBytes:raw.length,gltf,prims,tris};
}

it('strips sealed engine/gearbox internals from exterior racing GLBs while preserving showroom internals',()=>{
 const fullHigh=parsePackedGlb('../src/race/assets/jgp26-high.glb.gz');
 const raceHigh=parsePackedGlb('../src/race/assets/jgp26-race-high.glb.gz');
 const fullLow=parsePackedGlb('../src/race/assets/jgp26-low.glb.gz');
 const raceLow=parsePackedGlb('../src/race/assets/jgp26-race-low.glb.gz');

 const hiddenInternals=[
  'Chassis_Ground steel','Chassis_Transmission alloy','Chassis_Machined gear web',
  'Chassis_Machined intake bell','Chassis_Power unit casting','Chassis_Formed heat shield',
  'Chassis_PortRecess','Chassis_Turned shaft steel','Chassis_CowlingEdge',
  'Chassis_CowlingReturn','Chassis_Cowling spring steel','Chassis_Cowl inner laminate',
 ];
 const fullHighNames=new Set<string>(fullHigh.gltf.nodes.map((n:any)=>n.name));
 const raceHighNames=new Set<string>(raceHigh.gltf.nodes.map((n:any)=>n.name));
 const raceLowNames=new Set<string>(raceLow.gltf.nodes.map((n:any)=>n.name));

 // Full showroom/inspection GLB keeps internals and inspectionPart bindings
 for(const name of hiddenInternals)expect(fullHighNames.has(name)).toBe(true);
 expect(fullHigh.prims.some((p:any)=>p.extras?.inspectionPart)).toBe(true);

 // Exterior racing GLBs strip all sealed under-cowling internals and _COWLLACQUER
 for(const name of hiddenInternals){
  expect(raceHighNames.has(name)).toBe(false);
  expect(raceLowNames.has(name)).toBe(false);
 }
 for(const p of [...raceHigh.prims,...raceLow.prims]){
  expect(p.attributes._COWLLACQUER).toBeUndefined();
  expect(p.extras?.inspectionPart).toBeUndefined();
 }

 // Essential exterior & onboard racing rigs stay intact
 for(const name of ['Chassis','Chassis_TwoToneCover','Floor','DRS','Helmet','FrontL','FrontR','RearL','RearR','NumberA','NumberB','HelmetNumberA','HelmetNumberB']){
  expect(raceHighNames.has(name)).toBe(true);
  expect(raceLowNames.has(name)).toBe(true);
 }
 for(const name of ['Steering','Hands','HandL','HandR','ForearmL','ForearmR'])expect(raceHighNames.has(name)).toBe(true);
 // Far LOD (>=32 m) omits sub-pixel steering/gloves/deep seat internals
 for(const name of ['Steering','Hands','Continuous glove L','Continuous glove R','Chassis_SeatFoam','Chassis_Cockpit liner'])expect(raceLowNames.has(name)).toBe(false);

 expect(raceHigh.rawBytes).toBeLessThan(fullHigh.rawBytes-400_000);
 expect(raceLow.rawBytes).toBeLessThan(fullLow.rawBytes-700_000);
 expect(raceLow.prims.length).toBeLessThan(fullLow.prims.length-40);

 // AI field GLBs stay valid with all required exterior layers
 const fieldNear=parsePackedGlb('../src/race/assets/field-near.glb.gz');
 const fieldFar=parsePackedGlb('../src/race/assets/field.glb.gz');
 expect(fieldNear.tris).toBeLessThanOrEqual(28_000);
 expect(fieldNear.tris).toBeGreaterThan(fieldFar.tris);
 const nearMeshes=new Set<string>(fieldNear.gltf.meshes.map((m:any)=>m.name));
 const farMeshes=new Set<string>(fieldFar.gltf.meshes.map((m:any)=>m.name));
 for(const layer of ['Paint','Accent','Trim','HelmetTint','Tyre','WheelMetal','Carbon','UndertrayShadow'])expect(nearMeshes.has(layer)).toBe(true);
 for(const layer of ['Paint','Accent','Trim','HelmetTint'])expect(farMeshes.has(layer)).toBe(true);
});

import {loadCar} from './load-car';
import {Mesh,SkinnedMesh} from 'three';

it('loads exterior racing and AI field GLBs cleanly through Three.js GLTFLoader',async()=>{
 for(const file of ['jgp26-race-high.glb.gz','jgp26-race-low.glb.gz','field-near.glb.gz','field.glb.gz']){
  const raw=gunzipSync(readFileSync(new URL(`../src/race/assets/${file}`,import.meta.url)));
  const {scene}=await loadCar(raw);
  let meshes=0,skinned=0;
  scene.traverse(o=>{if(o instanceof Mesh)meshes++;if(o instanceof SkinnedMesh)skinned++;});
  expect(meshes).toBeGreaterThan(0);
  if(file==='jgp26-race-high.glb.gz'){
   expect(skinned).toBeGreaterThan(0);
   expect(scene.getObjectByName('Chassis_TwoToneCover')).toBeTruthy();
   expect(scene.getObjectByName('Chassis_Power unit casting')).toBeUndefined();
  }
  if(file==='jgp26-race-low.glb.gz'){
   expect(skinned).toBe(0);
   expect(scene.getObjectByName('Chassis_TwoToneCover')).toBeTruthy();
   expect(scene.getObjectByName('Steering')).toBeUndefined();
   expect(scene.getObjectByName('Chassis_Power unit casting')).toBeUndefined();
  }
 }
});

import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {bindGloveCompression} from '../src/race/grip';

it('initialises morphTargetInfluences on all car clones sharing template hand geometry',async()=>{
 const raw=gunzipSync(readFileSync(new URL('../src/race/assets/jgp26-race-high.glb.gz',import.meta.url)));
 const {scene:template}=await loadCar(raw);
 const carA=cloneSkeleton(template);
 const carB=cloneSkeleton(template);
 for(const car of [carA,carB]){
  for(const side of [-1,1] as const){
   const hand=car.getObjectByName(side<0?'HandL':'HandR')!;
   const bound=bindGloveCompression(hand,side);
   expect(bound.length).toBeGreaterThan(0);
  }
  car.traverse(o=>{
   if(o instanceof Mesh&&o.geometry.morphAttributes.position?.length){
    expect(Array.isArray(o.morphTargetInfluences)).toBe(true);
    expect(o.morphTargetInfluences!.length).toBe(o.geometry.morphAttributes.position.length);
   }
  });
 }
});
