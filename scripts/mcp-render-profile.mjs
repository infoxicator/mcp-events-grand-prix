// Instrument only a temporary copy of the production entry point. This wraps the
// same public scene.render call in historical bundles that predate the benchmark.
import {cp,mkdtemp,readdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

export async function profileHost(source,dist=resolve(source,'dist')){
 const cwd=await mkdtemp(join(tmpdir(),'mcp-frame-profile-'));
 try{
  for(const name of ['scripts','server','node_modules'])await symlink(resolve(source,name),join(cwd,name));
  await cp(dist,join(cwd,'dist'),{recursive:true,dereference:true});
  const dir=join(cwd,'dist/mcp/assets');
  let instrumented=0;
  for(const name of await readdir(dir)){
   if(!name.endsWith('.js'))continue;
   const file=join(dir,name),code=await readFile(file,'utf8');
   const result=code.replace(/\{render:([\w$]+),get activeCamera\(\)\{/g,(_match,fn)=>{
    instrumented++;return '{render:window.bench.wrap('+fn+'),get activeCamera(){';
   });
   if(result!==code)await writeFile(file,result);
  }
  if(instrumented!==1)throw Error('Expected one production race scene entry point, found '+instrumented);
  return cwd;
 }catch(error){await rm(cwd,{recursive:true,force:true});throw error;}
}

// Playwright serializes this function into the sandbox and its ancestors.
export function installProfile(){
 const bench=window.bench,clock=()=>performance.now();
 let current,frameCount=0,lastTime=0,lastCamera='',allCalls=0,allTriangles=0,worstCutMs=0;
 const frames=[],spikes=[],cuts=[],parts={},hot={},startup=[];
 const bin=(dict,key)=>dict[key]??=( {calls:0,triangles:0,ms:0} );
 let sampled=0,measure=false,rng=27;
 bench.begin=()=>{measure=true;lastTime=0;};
 bench.profile=()=>{
  const sorted=frames.slice().sort((a,b)=>a-b),value=p=>sorted[Math.ceil(sorted.length*p)-1];
  return {renderMs:{p50:value(.5),p95:value(.95),max:sorted.at(-1)},frameCount,sampledFrames:sampled,
   meanCalls:allCalls/frameCount,meanTriangles:allTriangles/frameCount,worstCutMs,cuts,spikes,startup,
   perSampledFrame:Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,{calls:v.calls/sampled,triangles:v.triangles/sampled,ms:v.ms/sampled}])),
   topDraws:Object.entries(hot).sort((a,b)=>b[1].triangles-a[1].triangles).slice(0,30)};
 };
 bench.wrap=fn=>function(...args){
  const start=clock(),cameraBefore=lastCamera;
  current={sample:measure&&((rng=(Math.imul(rng,1664525)+1013904223)>>>0)<0x15555555),main:0,mirror:0,reflection:0,warmup:0,compile:0,linkQuery:0,uniforms:0,attributes:0,shadow:0,calls:0,triangles:0};
  try{return fn.apply(this,args);}
  finally{
   const end=clock(),ms=end-start,mode=this.activeCamera,frame=current;
   if(frame.main){
    if(!measure&&startup.length<5)startup.push({start,ms,mode,...frame});
    if(measure){
     frameCount++;frames.push(ms);allCalls+=frame.calls;allTriangles+=frame.triangles;
     if(frame.sample)sampled++;
     const interval=lastTime?end-lastTime:0,cut=!!lastTime&&cameraBefore!==mode;
     if(cut)worstCutMs=Math.max(worstCutMs,interval);
     if(cut||interval>40){
      const event={t:end,mode,from:cameraBefore,cut,interval,sceneMs:ms,mainMs:frame.main,mirrorMs:frame.mirror,shadowMs:frame.shadow,reflectionMs:frame.reflection,warmupMs:frame.warmup,compileMs:frame.compile,linkPollMs:frame.linkQuery,uniformReflectionMs:frame.uniforms,attributeReflectionMs:frame.attributes,otherSceneMs:Math.max(0,ms-frame.main-frame.mirror-frame.warmup-frame.compile),outsideSceneMs:Math.max(0,interval-ms)};
      if(cut)cuts.push(event);
      if(interval>40)spikes.push(event);
     }
     lastTime=end;
    }
    lastCamera=mode;
   }else if(!measure&&ms>4)startup.push({start,ms,...frame});
   current=undefined;
  }
 };
 window.__THREE_DEVTOOLS__.addEventListener('observe',({detail:r})=>{
  if(!r.isWebGLRenderer)return;
  const owners=new WeakMap(),heroes=new Map();
  function owner(o){
   let label=owners.get(o);if(label)return label;
   let top=o;while(top.parent&&!top.parent.isScene)top=top.parent;
   if(top.children[0]?.children.some(c=>c.isLOD)){
    if(!heroes.has(top)){
     const roots=top.parent.children.filter(n=>n.children[0]?.children.some(c=>c.isLOD));
     heroes.set(top,roots.indexOf(top)===0?'Hero A':'Hero B');
    }
    label=heroes.get(top);
   }else if(o.userData.cullCenter||top.isReflector||top.name==='Scene')label='Circuit';
   else if(top.children.some(c=>c.name.startsWith('Field ')||c.name==='Legacy DRS activation'))label='Field';
   else if(top.children.some(c=>c.name==='Garage fascia signs'||c.children.some(g=>/ pit /.test(g.name)))||o.material?.map?.image?.width===256&&o.material?.map?.image?.height===96)label='Pit crew';
   else label='Effects and other';
   owners.set(o,label);return label;
  }
  const render=r.render,compile=r.compile,shadow=r.shadowMap.render,direct=r.renderBufferDirect;
  let pass='main';
  const gl=r.getContext(),getProgramParameter=gl.getProgramParameter;
  gl.getProgramParameter=function(...args){const t=clock();try{return getProgramParameter.apply(this,args);}finally{if(current)current.linkQuery+=clock()-t;}};
  r.compile=function(...args){
   const start=clock(),offset=this.info.programs.length;
   try{return compile.apply(this,args);}
   finally{
    if(current)current.compile+=clock()-start;
    for(const program of this.info.programs.slice(offset))for(const [method,key] of [['getUniforms','uniforms'],['getAttributes','attributes']]){
     const call=program[method];
     program[method]=function(...args){
      const t=clock();try{return call.apply(this,args);}finally{if(current)current[key]+=clock()-t;program[method]=call;}
     };
    }
   }
  };
  r.shadowMap.render=function(...args){const t=clock();try{return shadow.apply(this,args);}finally{if(current)current.shadow+=clock()-t;}};
  r.render=function(scene,camera){
   const previous=pass,rt=this.getRenderTarget(),priorCalls=this.info.render.calls,priorTriangles=this.info.render.triangles;
   pass=camera.name==='Shader warmup'?'warmup':!rt?'main':rt.width===512&&rt.height===128?'mirror':'reflection';
   const t=clock();try{return render.call(this,scene,camera);}finally{
    if(current){current[pass]+=clock()-t;if(camera.name==='Race camera'&&!rt){current.calls=this.info.render.calls;current.triangles=this.info.render.triangles;}else if(pass==='warmup'){current.calls+=this.info.render.calls-priorCalls;current.triangles+=this.info.render.triangles-priorTriangles;}}
    pass=previous;
   }
  };
  r.renderBufferDirect=function(camera,scene,geometry,material,object,group){
   if(!current?.sample)return direct.call(this,camera,scene,geometry,material,object,group);
   const info=this.info.render,c=info.calls,tr=info.triangles,t=clock();
   direct.call(this,camera,scene,geometry,material,object,group);
   const ms=clock()-t,dc=info.calls-c,dt=info.triangles-tr,category=owner(object);
   const passName=scene===null?'Shadow':pass==='warmup'?'Warmup':pass==='mirror'?'Mirror':pass==='reflection'?'Reflection':'Main';
   for(const row of [bin(parts,category),bin(parts,passName),bin(hot,category+'/'+(object.name||object.material?.name||object.type))]){
    row.calls+=dc;row.triangles+=dt;row.ms+=ms;
   }
  };
 });
}
