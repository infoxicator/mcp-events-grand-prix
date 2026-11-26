import type {MeshStandardMaterial} from 'three';

// Both rigs supply the friction face in metres relative to the wheel spindle.
export function finishRotor(material:MeshStandardMaterial,heat?:{value:number}){
 material.onBeforeCompile=shader=>{
  if(heat)shader.uniforms.discHeat=heat;
  const inputs=heat?'attribute vec2 rotorPlane;uniform float discHeat;':'attribute float rotorHeat;';
  shader.vertexShader=inputs+'\nvarying vec3 disc;\n'+shader.vertexShader.replace('#include <begin_vertex>',
   '#include <begin_vertex>\ndisc='+ (heat?'vec3(rotorPlane,discHeat);':'vec3(position.y-.36,position.z-(position.z>0.?1.55:-2.05),rotorHeat);'));
  shader.fragmentShader='varying vec3 disc;\n'+shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
   float radius=length(disc.xy);
   if(radius>.071 && radius<.213){
    float track=smoothstep(.075,.203,radius);
    float row=floor((radius-.087)/.013);
    float pitch=(atan(disc.y,disc.x)/6.2831853+.5)*48.+row*.39;
    vec2 cell=vec2(fract(pitch)-.5,fract((radius-.087)/.013)-.5);
    float resolved=1.-smoothstep(.001,.006,length(fwidth(disc.xy)));
    float vent=(1.-smoothstep(.09,.20,length(cell)))*resolved*smoothstep(.09,.12,radius);
    float hot=clamp(disc.z*(.20+.80*track),0.,1.);
    vec3 glow=vec3(2.35,.035,.009)*hot*hot
      +vec3(1.4,.78,.046)*smoothstep(.38,.87,hot)
      +vec3(.64,.92,.45)*smoothstep(.81,1.,hot);
    totalEmissiveRadiance+=glow*(1.-.91*vent);
    diffuseColor.rgb*=1.-.7*vent;
   }`);
 };
 material.customProgramCacheKey=()=>heat?'wheel-friction-ring':'field-friction-ring';
}
