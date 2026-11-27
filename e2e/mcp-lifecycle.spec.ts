import {test,expect} from '@playwright/test';
import type {WebGLRenderer} from 'three';

type ProbeWindow=Window&{
 __THREE_DEVTOOLS__:EventTarget;
 disposedGPU?:{geometries:number;textures:number;lost:boolean};
 releasedRenderer?:WeakRef<WebGLRenderer>;
 pendingFrames:()=>number;
};

for(const driver of ['autopilot','human'])test(`MCP ${driver} releases the renderer across five offscreen cycles`,async({page,context})=>{
 // Keep the actual IntersectionObserver, teardown and restore paths. Only shorten
 // the offscreen grace period so this can run as part of the regular MCP suite.
 await page.addInitScript(()=>{
  const browserWindow=window as unknown as ProbeWindow;
  const frames=new Set<number>();
  const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame=callback=>{
   const id=request(time=>{frames.delete(id);callback(time);});
   frames.add(id);return id;
  };
  window.cancelAnimationFrame=id=>{frames.delete(id);cancel(id);};
  browserWindow.pendingFrames=()=>frames.size;
  const observers=browserWindow.__THREE_DEVTOOLS__=new EventTarget();
  observers.addEventListener('observe',event=>{
   const renderer=(event as CustomEvent<WebGLRenderer&{isWebGLRenderer?:boolean}>).detail;
   if(!renderer.isWebGLRenderer)return;
   delete browserWindow.disposedGPU;
   const dispose=renderer.dispose;
   renderer.dispose=function(){
    browserWindow.releasedRenderer=new WeakRef(this);
    dispose.call(this);
    queueMicrotask(()=>{browserWindow.disposedGPU={...this.info.memory,lost:this.getContext().isContextLost()};});
   };
  });
  const timeout=browserWindow.setTimeout.bind(browserWindow);
  browserWindow.setTimeout=(fn,ms,...args)=>timeout(fn,ms===20_000?150:ms,...args);
 });
 // Hold race state constant so legitimate new event rows and start lights do
 // not count as retained DOM when comparing checkpoints.
 let freezeSnapshots=false;
 await page.routeWebSocket('**/api/rooms/*/ws',socket=>{
  socket.connectToServer().onMessage(message=>{if(!freezeSnapshots)socket.send(message);});
 });
 await page.goto('http://127.0.0.1:5388/?driver='+driver);
 const host=page.locator('#app-frame');
 const app=page.frameLocator('#app-frame').frameLocator('iframe');
 await app.locator('#mcp-accept:enabled').waitFor();
 await app.locator('input[name=driver][value="'+driver+'"]').evaluate((el:HTMLInputElement)=>el.click());
 await app.locator('#mcp-accept').click();
 const canvas=app.locator('canvas[aria-label]');
 await expect(app.locator('body')).toHaveAttribute('data-phase','racing',{timeout:30_000});
 freezeSnapshots=true;
 const session=await context.newCDPSession(page);
 await session.send('Performance.enable');
 const samples:{heap:number;listeners:number;nodes:number}[]=[];
 for(let i=0;i<5;i++){
  await expect(canvas).toBeVisible({timeout:30_000});
  const old=await canvas.evaluateHandle((el:HTMLCanvasElement)=>el.getContext('webgl2')!);
  try{
   expect(await old.evaluate(gl=>gl.isContextLost())).toBe(false);
   await host.evaluate(el=>{el.style.transform='translateY(200vh)';});
   await expect(canvas).toHaveCount(0);
   await expect.poll(()=>old.evaluate(gl=>gl.isContextLost())).toBe(true);
  }finally{await old.dispose();}
  expect(await app.locator('body').evaluate(()=>{
   const probe=window as unknown as ProbeWindow;
   return {...probe.disposedGPU,frames:probe.pendingFrames()};
  })).toEqual({geometries:0,textures:0,lost:true,frames:0});
  await expect.poll(async()=>{
   await session.send('HeapProfiler.collectGarbage');
   return app.locator('body').evaluate(()=>!(window as unknown as ProbeWindow).releasedRenderer?.deref());
  }).toBe(true);
  const {metrics}=await session.send('Performance.getMetrics');
  const get=(name:string)=>metrics.find(m=>m.name===name)!.value;
  samples.push({heap:get('JSHeapUsedSize'),listeners:get('JSEventListeners'),nodes:get('Nodes')});
  await host.evaluate(el=>{el.style.transform='';});
 }
 await expect(canvas).toBeVisible({timeout:30_000});
 // SDK/network bookkeeping and incoming race history continue while the GL
 // context is gone. A retained scene alone is tens of MiB.
 const warmed=samples.slice(1);
 expect(Math.max(...warmed.map(s=>s.heap))-Math.min(...warmed.map(s=>s.heap))).toBeLessThan(4*1024*1024);
 expect(Math.max(...warmed.map(s=>s.listeners))-Math.min(...warmed.map(s=>s.listeners))).toBeLessThanOrEqual(4);
 expect(Math.max(...warmed.map(s=>s.nodes))-Math.min(...warmed.map(s=>s.nodes))).toBeLessThan(24);
});
