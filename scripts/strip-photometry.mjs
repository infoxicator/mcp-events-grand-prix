// Install in the QA browser only. Sample the actual linear RenderPass target
// before UnrealBloomPass, then render material IDs from that same scene and lens.
export function installStripMeter(){
 window.prepareStripMeter=T=>{
  let image=null,shot=null;
  const original=T.Scene.prototype.onAfterRender;
  T.Scene.prototype.onAfterRender=function(renderer,scene,camera){
   original.apply(this,arguments);
   if(!window.measureStrip||camera.name!=='Race camera')return;
   const rt=renderer.getRenderTarget();
   if(!rt||rt.texture.type!==T.HalfFloatType)throw Error('Expected a linear half-float scene target');
   image=new Uint16Array(rt.width*rt.height*4);
   renderer.readRenderTargetPixels(rt,0,0,rt.width,rt.height,image);
   shot={renderer,scene,camera,width:rt.width,height:rt.height,linearTarget:rt};
   window.measureStrip=false;
  };
  window.stripMeterResult=()=>{
   if(!shot)throw Error('Missing pre-bloom target');
   const {renderer,scene,camera,width,height}=shot;
   const names=['background','paint','carbon','tyre','visor','whiteTrackPaint','tyreContact'];
   const match=(mat,hero)=>{
    if(!hero)return mat.name==='White'?5:0;
    if(['Livery','Ivory','DeepLivery'].includes(mat.name))return 1;
    if(['Carbon','AeroLaminate','HaloComposite'].includes(mat.name))return 2;
    if(mat.name==='SlickRubber')return 3;
    return mat.name==='HelmetVisor'?4:0;
   };
   const colors=names.map((_,i)=>new T.MeshBasicMaterial({color:new T.Color(i/8,0,0),side:T.DoubleSide,toneMapped:false, fog:false}));
   const rt=new T.WebGLRenderTarget(width,height),ids=new Uint8Array(width*height*4);
   rt.texture.colorSpace=T.LinearSRGBColorSpace;
   const saved=[],target=renderer.getRenderTarget(),bg=scene.background,shadow=renderer.shadowMap.autoUpdate;
   const patches=[];
   scene.traverse(o=>{
    if(o.isMesh&&!o.isInstancedMesh&&o.material.isMeshBasicMaterial&&o.material.vertexColors&&o.material.transparent&&
       o.parent?.children.some(c=>c.children.some(g=>g.isLOD))&&o.visible)patches.push(o);
   });
   let withoutContact=null;
   try{
    if(patches.length){
     withoutContact=new Uint16Array(image.length);
     for(const o of patches)o.visible=false;
     renderer.shadowMap.autoUpdate=false;renderer.setRenderTarget(shot.linearTarget);
     renderer.render(scene,camera);renderer.readRenderTargetPixels(shot.linearTarget,0,0,width,height,withoutContact);
     for(const o of patches)o.visible=true;
    }
    scene.traverse(o=>{
     if(o.isSprite||o.isLine||o.isPoints){saved.push([o,'visible',o.visible]);o.visible=false;return;}
     if(!o.isMesh)return;
     let hero=false;for(let a=o;a;a=a.parent)if(a.isLOD)hero=true;
     saved.push([o,'material',o.material]);
     o.material=patches.includes(o)?colors[6]:Array.isArray(o.material)?o.material.map(m=>colors[match(m,hero)]):colors[match(o.material,hero)];
     // Instanced circuit and field colour tints must not modify the ID.
     if(o.isInstancedMesh&&o.instanceColor){saved.push([o,'instanceColor',o.instanceColor]);o.instanceColor=null;}
    });
    scene.background=new T.Color(0);renderer.shadowMap.autoUpdate=false;
    renderer.setRenderTarget(rt);renderer.clear();renderer.render(scene,camera);
    renderer.readRenderTargetPixels(rt,0,0,width,height,ids);
   }finally{
    for(const o of patches)o.visible=true;
    renderer.setRenderTarget(target);scene.background=bg;renderer.shadowMap.autoUpdate=shadow;
    for(const [o,key,value] of saved)o[key]=value;
    colors.forEach(m=>m.dispose());rt.dispose();
   }
   const bins=names.map(()=>[]),attenuation=[];
   // Erode two pixels from material boundaries to exclude mixed edges.
   for(let y=2;y<height-2;y+=2)for(let x=2;x<width-2;x+=2){
    const i=4*(y*width+x),id=ids[i],slot=Math.round(8*id/255);
    if(!slot||slot>=bins.length||[i-8,i+8,i-width*8,i+width*8].some(k=>ids[k]!==id))continue;
    const f=T.DataUtils.fromHalfFloat;
    const luma=a=>.2126*f(a[i])+.7152*f(a[i+1])+.0722*f(a[i+2]);
    const lit=luma(image);bins[slot].push(lit);
    if(slot===6&&withoutContact){const off=luma(withoutContact);if(off>0)attenuation.push(1-lit/off);}
   }
   image=null;shot=null;
   const result=Object.fromEntries(names.slice(1).map((name,j)=>{
    const v=bins[j+1].sort((a,b)=>a-b);
    const q=n=>v.length?+v[Math.min(v.length-1,Math.floor(n*v.length))].toFixed(4):null;
    return [name,{samples:v.length,p10:q(.1),median:q(.5),p90:q(.9),p99:q(.99),max:q(1),aboveBloom:v.filter(x=>x>1.65).length}];
   }));
   attenuation.sort((a,b)=>a-b);
   result.tyreContact.attenuationMedian=attenuation.length?+attenuation[Math.floor(attenuation.length/2)].toFixed(4):null;
   result.tyreContact.visiblePixelsSampled=attenuation.length;
   return result;
  };
 };
}
