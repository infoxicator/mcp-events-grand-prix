// Keep the browser trace on the native clock. The User Timing mark maps the
// recorded rAF intervals onto the renderer, compositor and GPU process lanes.
export async function traceHitches(browser) {
 const cdp=await browser.newBrowserCDPSession();
 const traceEvents=[];
 const frameEvent=/BeginFrame|SwapBuffers|DrawFrame|FramePresented|PipelineState|CompileShader|LinkProgram|GpuFence/;
 // Three concurrent ReturnAsStream recordings can exhaust Chromium's temp
 // backing store. Keep just the scheduler slices used by the correlation.
 cdp.on('Tracing.dataCollected',({value})=>{
  for(const e of value)if(e.ph==='M'||e.name==='jev-measure-start'||(e.ph==='X'&&e.dur>=2000)||frameEvent.test(e.name))traceEvents.push(e);
 });
 await cdp.send('Tracing.start',{categories:'toplevel,devtools.timeline,v8,blink.user_timing,cc,gpu,benchmark',transferMode:'ReportEvents'});
 return async slow=>{
  const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
  await cdp.send('Tracing.end');await complete;await cdp.detach();
  const origin=traceEvents.find(e=>e.name==='jev-measure-start');
  if(!origin)throw Error('Chromium trace has no matching measurement mark');
  const threads=new Map(),processes=new Map();
  for(const e of traceEvents){
   if(e.name==='thread_name')threads.set(e.pid+'/'+e.tid,e.args.name);
   if(e.name==='process_name')processes.set(e.pid,e.args.name);
  }
  const events=traceEvents.filter(e=>e.ph==='X'&&e.dur>=2000&&e.ts+e.dur>=origin.ts&&e.ts<=origin.ts+8.2e6).map(e=>({
   at:+((e.ts-origin.ts)/1000).toFixed(2),ms:+(e.dur/1000).toFixed(2),name:e.name,
   thread:threads.get(e.pid+'/'+e.tid),process:processes.get(e.pid),pid:e.pid,
   ...(e.args?.src_file?{src:e.args.src_file+':'+e.args.src_func}:{}),
  }));
  const near = e=>slow.some(f=>e.ts>=origin.ts+(f.endingAtMs-f.ms-15)*1000&&e.ts<=origin.ts+(f.endingAtMs+10)*1000);
  const frameEvents=traceEvents.filter(e=>near(e)&&frameEvent.test(e.name))
   .map(e=>({at:+((e.ts-origin.ts)/1000).toFixed(2),name:e.name,phase:e.ph,
    ms:e.dur?+(e.dur/1000).toFixed(2):undefined,thread:threads.get(e.pid+'/'+e.tid),process:processes.get(e.pid)}));
  return {frameEvents,clock:'ms relative to jev-measure-start',renderer:origin.pid,slow,
   // Retain every long slice and >=2 ms activity within each outlier, even
   // if the apparent stall is idle time waiting for the next begin frame.
   events:events.filter(e=>e.ms>=20||(e.at<=4060&&e.at+e.ms>=3450)||slow.some(f=>e.at<=f.endingAtMs+8&&e.at+e.ms>=f.endingAtMs-f.ms-10))
  };
 };
}
