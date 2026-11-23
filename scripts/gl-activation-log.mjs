// QA-only WebGL telemetry. Record program/viewport combinations on their first
// real draw (including warmup), and buffer allocations made during playback.
export function installGpuActivationLog(){
 const api=WebGL2RenderingContext.prototype,contexts=new WeakMap();
 window.gpuActivations=[];
 function state(gl){
  if(!contexts.has(gl))contexts.set(gl,{program:null,width:0,height:0,changed:true,uses:new WeakMap(),serial:0});
  return contexts.get(gl);
 }
 function hook(name,observe){
  const original=api[name];
  api[name]=function(...args){observe(state(this),args);return original.apply(this,args);};
 }
 function record(event){
  if(window.reviewStart)window.gpuActivations.push({atMs:performance.now()-window.reviewStart,tick:window.__raceState?.race?.tick,...event});
 }
 hook('viewport',(s,[,,w,h])=>{if(w!==s.width||h!==s.height){s.width=w;s.height=h;s.changed=true;}});
 hook('useProgram',(s,[program])=>{if(s.program!==program){s.program=program;s.changed=true;}});
 hook('linkProgram',()=>record({kind:'linkProgram'}));
 hook('bufferData',(_s,[target,data])=>{
  const bytes=typeof data==='number'?data:data?.byteLength;
  if(bytes>=8192)record({kind:'bufferData',target,bytes});
 });
 function draw(s){
  if(!s.changed||!s.program)return;
  s.changed=false;
  if(!s.uses.has(s.program))s.uses.set(s.program,{id:++s.serial,views:new Set()});
  const program=s.uses.get(s.program),viewport=s.width+'x'+s.height;
  if(program.views.has(viewport))return;
  program.views.add(viewport);record({kind:'firstDraw',program:program.id,viewport});
 }
 for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced'])hook(name,draw);
}
