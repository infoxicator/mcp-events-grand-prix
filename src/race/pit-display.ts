import * as T from 'three';
import {cornerService,canRelease,serviceClock,type PitTelemetry} from './pit-service';

/** Stop clock and release tree stay attached to the fixed bay when the crew withdraws. */
export function pitDisplay(parent:T.Scene,point:{x:number;z:number},y:number,yaw:number){
 const board=document.createElement('canvas');board.width=256;board.height=96;
 const ctx=board.getContext('2d')!,map=new T.CanvasTexture(board);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
 const mesh=new T.Mesh(new T.PlaneGeometry(1.30,.49),new T.MeshBasicMaterial({map,side:T.DoubleSide}));
 mesh.position.set(point.x,y,point.z);mesh.rotation.y=yaw;parent.add(mesh);
 const lamps=[['red','#ff3121'],['amber','#ffb822'],['green','#4cf86b']];
 const corner=cornerService(0,0);
 let lastTenth=NaN,lastState='',lastReady=-1;
 function update(car?:PitTelemetry){
  const stopped=car?.pit==='stopped',clock=stopped?serviceClock(car!):-1;
  const go=car&&canRelease(car);
  const state=go?'green':stopped?'red':car?.pit==='entry'?'amber':'idle';
  const tenth=stopped?Number((car.pitTime??0).toFixed(1)):-1;
  let ready=0;
  if(stopped)for(let i=0;i<4;i++)if(cornerService(clock,i,corner).fit>=1)ready|=1<<i;
  if(tenth===lastTenth&&state===lastState&&ready===lastReady)return;
  lastTenth=tenth;lastState=state;lastReady=ready;
  const time=stopped?tenth.toFixed(1):'—';
  ctx.fillStyle='#13191b';ctx.fillRect(0,0,256,96);
  ctx.font='bold 56px monospace';ctx.fillStyle='#edf7ee';ctx.fillText(time,9,60);
  for(const [j,[name,col]] of lamps.entries()){
   ctx.fillStyle=state===name?col:'#2e3537';ctx.beginPath();ctx.arc(159+j*33,37,13,0,Math.PI*2);ctx.fill();
  }
  for(let i=0;i<4;i++){ctx.fillStyle=(ready&(1<<i))||go?'#62f281':'#495052';ctx.fillRect(14+i*60,77,42,7);}
  map.needsUpdate=true;
 }
 update();return {update,dispose(){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();map.dispose();}};
}
