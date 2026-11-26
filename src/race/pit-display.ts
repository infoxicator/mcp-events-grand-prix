import * as T from 'three';
import {cornerService,canRelease,serviceClock,type PitTelemetry} from './pit-service';

/** Stop clock and release tree stay attached to the fixed bay when the crew withdraws. */
export function pitDisplay(parent:T.Scene,point:{x:number;z:number},y:number,yaw:number){
 const board=document.createElement('canvas');board.width=256;board.height=96;
 const ctx=board.getContext('2d')!,map=new T.CanvasTexture(board);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
 const mesh=new T.Mesh(new T.PlaneGeometry(1.30,.49),new T.MeshBasicMaterial({map,side:T.DoubleSide}));
 mesh.position.set(point.x,y,point.z);mesh.rotation.y=yaw;parent.add(mesh);
 let before='';
 function update(car?:PitTelemetry){
  const stopped=car?.pit==='stopped',clock=stopped?serviceClock(car!):-1;
  const time=stopped?(car!.pitTime??0).toFixed(1):'—';
  const go=car&&canRelease(car);
  const state=go?'green':stopped?'red':car?.pit==='entry'?'amber':'idle';
  const ready=[0,1,2,3].map(i=>stopped&&cornerService(clock,i).fit>=1);
  const key=[time,state,...ready].join();if(key===before)return;before=key;
  ctx.fillStyle='#13191b';ctx.fillRect(0,0,256,96);
  ctx.font='bold 56px monospace';ctx.fillStyle='#edf7ee';ctx.fillText(time,9,60);
  for(const [j,[name,col]] of [['red','#ff3121'],['amber','#ffb822'],['green','#4cf86b']].entries()){
   ctx.fillStyle=state===name?col:'#2e3537';ctx.beginPath();ctx.arc(159+j*33,37,13,0,Math.PI*2);ctx.fill();
  }
  ready.forEach((v,i)=>{ctx.fillStyle=v||go?'#62f281':'#495052';ctx.fillRect(14+i*60,77,42,7);});
  map.needsUpdate=true;
 }
 update();return {update,dispose(){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();map.dispose();}};
}
