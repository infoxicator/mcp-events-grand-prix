import {connect,prepareRoom} from './race/network';
import {mountRace} from './race/ui';
import type {RoomLinks} from './race/types';

async function start(){
 const params=new URLSearchParams(location.search);
 if(params.has('drive')){
  if(!params.has('room')&&!params.has('live')){
   const circuit=params.get('circuit')??'monza';
   const createParams=new URLSearchParams({drive:'',circuit});
   const laps=params.get('laps');if(laps)createParams.set('laps',laps);
   if(params.has('multiplayer'))createParams.set('multiplayer','');
   const response=await fetch('/api/rooms?'+createParams.toString(),{method:'POST'});
   if(!response.ok)throw Error('Could not open drive race ('+response.status+').');
   const links:RoomLinks=await response.json(),url=new URL(links.owner);
   url.searchParams.set('drive','');
   url.searchParams.set('team',params.get('team')==='b'?'b':'a');
   for(const key of ['driver','engineer','autostart']){
    const val=params.get(key);if(params.has(key))url.searchParams.set(key,val??'');
   }
   history.replaceState(null,'',url.pathname+url.search+url.hash);
  }
  const room=await prepareRoom();
  const {mountDrive}=await import('./race/drive-view');
  const driveView=mountDrive(room);
  window.addEventListener('pagehide',driveView.dispose,{once:true});
  window.addEventListener('beforeunload',driveView.dispose,{once:true});
  return;
 }
 if(params.has('strategy')){const {mountStrategy}=await import('./race/strategy-view');mountStrategy();return;}
 if(params.has('track')){await import('./race/flythrough');return;}
 if(params.has('solo')&&!params.has('room')&&!params.has('live')){
  const circuit=params.get('circuit')??'monza';
  const response=await fetch('/api/rooms?solo&circuit='+encodeURIComponent(circuit),{method:'POST'});
  if(!response.ok)throw Error('Could not open solo race ('+response.status+').');
  const links:RoomLinks=await response.json(),url=new URL(links.owner);
  url.searchParams.set('team','a');
  if(params.get('view')==='telemetry')url.searchParams.set('view','telemetry');
  history.replaceState(null,'',url.pathname+url.search+url.hash);
 }
 if(params.has('watch')&&!params.has('solo')&&!params.has('room')&&!params.has('live')){
  const circuit=params.get('circuit')??'monza';
  const response=await fetch('/api/rooms?watch&circuit='+encodeURIComponent(circuit),{method:'POST'});
  if(!response.ok)throw Error('Could not open this mock race ('+response.status+').');
  const links:RoomLinks=await response.json(),url=new URL(links.owner);
  url.searchParams.set('watch','');sessionStorage.setItem('jev-watch-room',links.room);
  history.replaceState(null,'',url.pathname+url.search+url.hash);
 }
 const room=await prepareRoom();
 // Only the tab that explicitly created this private mock race supplies its
 // two drivers. Shared spectators and normal seat invitations retain their roles.
 const watching=params.has('watch')&&!params.has('solo')&&room.links&&sessionStorage.getItem('jev-watch-room')===room.room;
 const view=mountRace(room);
 if(watching&&params.get('view')!=='telemetry'){
  // Let the single renderer finish loading before making the grid ready.
  while(!(window as Window&{__renderStats?:{modelsReady:boolean;modelError?:string}}).__renderStats?.modelsReady){
   const error=(window as Window&{__renderStats?:{modelError?:string}}).__renderStats?.modelError;
   if(error)throw Error(error);
   await new Promise<void>(done=>setTimeout(done,50));
  }
 }
 const watchControllers:ReturnType<typeof connect>[]=[];
 const disposeAll=()=>{for(const c of watchControllers)c.close();watchControllers.length=0;view.dispose();};
 window.addEventListener('pagehide',disposeAll,{once:true});
 window.addEventListener('beforeunload',disposeAll,{once:true});
 if(watching&&room.links)for(const seat of ['a','b'] as const){
  const token=new URLSearchParams(new URL(room.links[seat]).hash.slice(1)).get('token');
  if(token)watchControllers.push(connect(seat,{...room,token}));
 }
}
start().catch(()=>{
 const app=document.getElementById('app')!;app.textContent='The race could not be opened. ';
 const link=document.createElement('a');link.href='/';link.textContent='Return to the race';app.append(link);
});
