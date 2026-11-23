import {prepareRoom} from './race/network';
import {isCircuit} from './race/track';
import {mountRace} from './race/ui';
import type {HostedRoom,RoomLinks} from './race/types';

async function start(){
 const params=new URLSearchParams(location.search);
 if(params.has('drive')){
  const online=params.has('room')||params.has('live')||params.has('multiplayer')||params.has('online')||params.get('engineer')==='joined';
  let room:HostedRoom;
  if(!online){
   const rawCircuit=params.get('circuit')??'monza';
   const circuit=isCircuit(rawCircuit)?rawCircuit:'monza';
   const lapsParam=Number(params.get('laps'));
   const laps=Number.isFinite(lapsParam)&&lapsParam>=1&&lapsParam<=20?Math.round(lapsParam):3;
   room={room:crypto.randomUUID(),token:'',links:null,local:{circuit,laps,speed:1,solo:true,drive:true,watch:false}};
  }else{
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
   room=await prepareRoom();
  }
  const {mountDrive}=await import('./race/drive-view');
  const driveView=mountDrive(room);
  window.addEventListener('pagehide',driveView.dispose,{once:true});
  window.addEventListener('beforeunload',driveView.dispose,{once:true});
  return;
 }
 if(params.has('strategy')){const {mountStrategy}=await import('./race/strategy-view');mountStrategy();return;}
 if(params.has('track')){await import('./race/flythrough');return;}
 if(params.has('solo')&&!params.has('room')&&!params.has('live')){
  if(params.has('local')){
   const rawCircuit=params.get('circuit')??'monza';
   const circuit=isCircuit(rawCircuit)?rawCircuit:'monza';
   const room:HostedRoom={room:crypto.randomUUID(),token:'',links:null,local:{circuit,laps:3,speed:4,solo:true,drive:false,watch:false}};
   const view=mountRace(room);
   window.addEventListener('pagehide',view.dispose,{once:true});
   window.addEventListener('beforeunload',view.dispose,{once:true});
   return;
  }
  const circuit=params.get('circuit')??'monza';
  const response=await fetch('/api/rooms?solo&circuit='+encodeURIComponent(circuit),{method:'POST'});
  if(!response.ok)throw Error('Could not open solo race ('+response.status+').');
  const links:RoomLinks=await response.json(),url=new URL(links.owner);
  url.searchParams.set('team','a');
  if(params.get('view')==='telemetry')url.searchParams.set('view','telemetry');
  history.replaceState(null,'',url.pathname+url.search+url.hash);
 }
 if(params.has('watch')&&!params.has('solo')&&!params.has('room')&&!params.has('live')){
  const rawCircuit=params.get('circuit')??'monza';
  const circuit=isCircuit(rawCircuit)?rawCircuit:'monza';
  if(!params.has('online')){
   const room:HostedRoom={room:crypto.randomUUID(),token:'',links:null,local:{circuit,laps:3,speed:1,solo:false,drive:false,watch:true}};
   const view=mountRace(room);
   window.addEventListener('pagehide',view.dispose,{once:true});
   window.addEventListener('beforeunload',view.dispose,{once:true});
   return;
  }
  const response=await fetch('/api/rooms?watch&circuit='+encodeURIComponent(circuit),{method:'POST'});
  if(!response.ok)throw Error('Could not open this mock race ('+response.status+').');
  const links:RoomLinks=await response.json(),url=new URL(links.owner);
  url.searchParams.set('watch','');
  history.replaceState(null,'',url.pathname+url.search+url.hash);
 }
 const room=await prepareRoom();
 const view=mountRace(room);
 window.addEventListener('pagehide',view.dispose,{once:true});
 window.addEventListener('beforeunload',view.dispose,{once:true});
}
start().catch(()=>{
 const app=document.getElementById('app')!;app.textContent='The race could not be opened. ';
 const link=document.createElement('a');link.href='/';link.textContent='Return to the race';app.append(link);
});
