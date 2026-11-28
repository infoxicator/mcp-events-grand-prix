import * as T from 'three';
import {cornerLocked,canRelease,serviceClock,type PitTelemetry} from './pit-service';

/** Stop clock and release tree stay attached to the fixed bay when the crew withdraws. */
export function pitDisplay(parent:T.Scene,point:{x:number;z:number},y:number,yaw:number,team:string){
 const board=document.createElement('canvas');board.width=512;board.height=192;
 const ctx=board.getContext('2d')!,map=new T.CanvasTexture(board);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
 const mesh=new T.Mesh(new T.PlaneGeometry(1.30,.49),new T.MeshBasicMaterial({map,side:T.DoubleSide}));
 mesh.position.set(point.x,y,point.z);mesh.rotation.y=yaw;parent.add(mesh);
 const lamps=[['red','#ff3121'],['amber','#ffb822'],['green','#4cf86b']];
 let lastTenth=NaN,lastState='',lastReady=-1,lastDriver='';
 function update(car?:PitTelemetry,driver=''){
  const stopped=car?.pit==='stopped',clock=stopped?serviceClock(car!):-1;
  const go=car&&canRelease(car);
  const state=go?'green':stopped?'red':car?.pit==='entry'?'amber':'idle';
  const tenth=stopped?Number((car.pitTime??0).toFixed(1)):-1;
  let ready=0;
  if(stopped)for(let i=0;i<4;i++)if(cornerLocked(clock,i))ready|=1<<i;
  if(tenth===lastTenth&&state===lastState&&ready===lastReady&&driver===lastDriver)return;
  lastDriver=driver;lastTenth=tenth;lastState=state;lastReady=ready;
  const time=stopped?tenth.toFixed(1):'—';
  ctx.setTransform(2,0,0,2,0,0);ctx.fillStyle='#13191b';ctx.fillRect(0,0,256,96);
  ctx.fillStyle='#9db8bf';ctx.font='bold 15px Arial';ctx.fillText(team.toUpperCase()+'   '+driver,8,16,242);
  ctx.font='bold 43px monospace';ctx.fillStyle='#edf7ee';ctx.fillText(time,9,60);
  for(const [j,[name,col]] of lamps.entries()){
   ctx.fillStyle=state===name?col:'#2e3537';ctx.beginPath();ctx.arc(163+j*32,44,10,0,Math.PI*2);ctx.fill();
  }
  for(let i=0;i<4;i++){ctx.fillStyle=(ready&(1<<i))||go?'#62f281':'#495052';ctx.fillRect(9+i*63,74,53,5);ctx.fillStyle='#dae3df';ctx.font='bold 11px monospace';ctx.fillText(['FL','FR','RL','RR'][i],9+i*63,92);}
  map.needsUpdate=true;
 }
 update();return {update,setCameraRange(camera:T.Vector3){
  // A 1.3 m clock is only a few pixels wide beyond the working lane.
  mesh.visible=mesh.position.distanceToSquared(camera)<180**2;
 },dispose(){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();map.dispose();}};
}
