import * as T from 'three';
import type {Track} from './track';
import type {Car} from './types';
import {VEHICLE, brakeCapacity, cornerLimit} from './vehicle';
import {pavementHeight} from './pavement';
import {kerbHeight} from './suspension';
import {grip, pathCurvature} from './physics';

export type RacingLineMode = 'off' | 'corners' | 'full';

const SEGMENTS = 96;
const STEP_M = 2.4;
const LOOKBACK_M = 6;
const HALF_WIDTH = 0.52;
const BACKWARDS_SAMPLES = 150;
const BACKWARDS_STEP = 2.4;

/**
 * Dynamic 3D EA-F1-style racing line painted just above the asphalt along the
 * optimal racing line, shaded live from green (full throttle) -> amber (lift /
 * apex) -> red (braking zone) relative to the player car's actual current speed.
 */
export function createRacingLine(track: Track, heightAt: (d: number) => number) {
 const vertCount = (SEGMENTS + 1) * 2;
 const positions = new Float32Array(vertCount * 3);
 const colors = new Float32Array(vertCount * 3);
 const indices: number[] = [];
 for (let i = 0; i < SEGMENTS; i++) {
  const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
  indices.push(a, c, b, b, c, d);
 }
 const geometry = new T.BufferGeometry();
 const posAttr = new T.BufferAttribute(positions, 3);
 const colAttr = new T.BufferAttribute(colors, 3);
 posAttr.setUsage(T.DynamicDrawUsage);
 colAttr.setUsage(T.DynamicDrawUsage);
 geometry.setAttribute('position', posAttr);
 geometry.setAttribute('color', colAttr);
 const roadUv=new T.BufferAttribute(new Float32Array(vertCount*2),2).setUsage(T.DynamicDrawUsage);geometry.setAttribute('uv',roadUv);
 geometry.setIndex(indices);
 geometry.boundingSphere = new T.Sphere(new T.Vector3(), 5000);

 const material = new T.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.82,
  side: T.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
 });

 material.onBeforeCompile=shader=>{
  shader.vertexShader='varying vec2 roadMark;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nroadMark=uv;');
  shader.fragmentShader='varying vec2 roadMark;\n'+shader.fragmentShader.replace('#include <alphamap_fragment>',`#include <alphamap_fragment>
   float x=abs(roadMark.x),ax=max(.01,fwidth(x));
   float phase=roadMark.y+x*.28,ay=max(.015,fwidth(phase));
   float band=abs(fract(phase)-.5);
   diffuseColor.a*=(1.-smoothstep(1.-ax,1.,x))*(.23+.77*(1.-smoothstep(.28-ay,.28+ay,band)));`);
 };
 const mesh = new T.Mesh(geometry, material);
 mesh.frustumCulled = false;
 mesh.renderOrder = 3;
 mesh.visible = false;

 const targetSpeeds = new Float32Array(BACKWARDS_SAMPLES + 1);
 const cornerSpeeds = new Float32Array(BACKWARDS_SAMPLES + 1);

 function update(car: Car, mode: RacingLineMode, wetness: number) {
  if (mode === 'off' || car.pit !== 'none') {
   mesh.visible = false;
   return;
  }
  mesh.visible = true;
  const startD = car.distance - LOOKBACK_M;
  const mass = VEHICLE.dryMass + car.fuel;
  const g = grip(car, wetness);

  // Compute backwards braking speed envelope for the upcoming 360m.
  let limit = 105;
  for (let i = BACKWARDS_SAMPLES; i >= 0; i--) {
   const d = startD + i * BACKWARDS_STEP;
   const curve = pathCurvature(d, track);
   const cornerV = cornerLimit(curve, mass, g, 0) * 0.965;
   cornerSpeeds[i] = cornerV;
   const decel = brakeCapacity(limit, mass, g, Math.min(3 * 9.81, limit * limit * Math.abs(curve)), 0) * 0.78;
   limit = Math.min(cornerV, Math.sqrt(limit * limit + 2 * decel * BACKWARDS_STEP));
   targetSpeeds[i] = limit;
  }

  const vNow = Math.max(car.speed, 12);
  let lastBrakeZone = -1;
  if (mode === 'corners') {
   for (let i = 0; i <= SEGMENTS; i++) {
    if (cornerSpeeds[i] < 82 || targetSpeeds[i] < vNow + 8) lastBrakeZone = i;
   }
  }

  for (let i = 0; i <= SEGMENTS; i++) {
   const d = startD + i * STEP_M;
   const offset = track.racingLineOffset(d);
   const p = track.pointAt(d, offset);
   const t = track.tangentAt(d);
   const y=heightAt(d)+.024;
   const nx = -t.z, nz = t.x; // right normal

   // In "corners" mode, shrink the ribbon width to 0 on pure full-throttle straights.
   const isCornerBand = cornerSpeeds[i] < 84 || targetSpeeds[i] < vNow + 6 || (i < SEGMENTS - 6 && targetSpeeds[i + 6] < vNow + 2);
   const fadeEnd = Math.min(1, i / 4, (SEGMENTS - i) / 10);
   const w = (mode === 'corners' && !isCornerBand && i > lastBrakeZone ? 0 : HALF_WIDTH * (0.45 + 0.55 * fadeEnd));

   const vi = i * 6;
   positions[vi] = p.x - nx * w;
   positions[vi + 1] = y+pavementHeight(track,d,offset-w)+kerbHeight(track,d,offset-w);
   positions[vi + 2] = p.z - nz * w;
   positions[vi + 3] = p.x + nx * w;
   positions[vi + 4] = y+pavementHeight(track,d,offset+w)+kerbHeight(track,d,offset+w);
   roadUv.setXY(i*2,-1,d/5.4);roadUv.setXY(i*2+1,1,d/5.4);
   positions[vi + 5] = p.z + nz * w;

   // Color ramp: green (gas) -> amber (lift/turn-in) -> bright red (brake now)
   const excess = vNow - targetSpeeds[i];
   let r = 0.14, gr = 0.90, b = 0.44;
   if (excess > 2.5) {
    // Hard braking zone
    const k = Math.min(1, (excess - 2.5) / 10);
    r = 0.98; gr = 0.48 * (1 - k) + 0.10 * k; b = 0.16;
   } else if (excess > -4.5 || cornerSpeeds[i] < 72) {
    // Lift / trail-brake / apex
    const k = Math.min(1, Math.max(0, (excess + 4.5) / 7));
    r = 0.96; gr = 0.78 - 0.25 * k; b = 0.16;
   }
   // Slight dim on straight segments when corners-only mode
   if (mode === 'corners' && !isCornerBand) {
    r *= 0.2; gr *= 0.2; b *= 0.2;
   }
   const shade = 0.72 + 0.28 * fadeEnd;
   colors[vi] = r * shade;
   colors[vi + 1] = gr * shade;
   colors[vi + 2] = b * shade;
   colors[vi + 3] = r * shade;
   colors[vi + 4] = gr * shade;
   colors[vi + 5] = b * shade;
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;roadUv.needsUpdate=true;
 }

 return {
  mesh,
  update,
  dispose() {
   geometry.dispose();
   material.dispose();
  },
 };
}
