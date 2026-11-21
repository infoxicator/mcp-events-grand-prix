import {isLiveKey,isRoomId} from './live';
import type {HostedRoom,Team,RaceState,ClientMessage,ServerMessage,Race} from './types';
export interface Connection{onSnapshot?:(s:RaceState,received:number)=>void;onAudioLost?:()=>void;claimAudio:()=>Promise<boolean>;releaseAudio:()=>void;state:RaceState|null;team:Team|null;canReset:boolean;status:string;latency:number;received:number;onReplay:(frames:Race[])=>void;send:(msg:ClientMessage)=>void;close:()=>void;}
export function connect(team:Team|null,room:HostedRoom):Connection{
 let ws:WebSocket|null=null,closed=false,retry=300,awaiting=false,lastRequest=0,lastDecide=0,nextDecisionAt=0,seatRetry:ReturnType<typeof setTimeout>|undefined,reconnect:ReturnType<typeof setTimeout>|undefined;
 type RoomChoice=Extract<ClientMessage,{type:'matchup'|'circuit'}>;
 const unconfirmed=new Map<RoomChoice['type'],RoomChoice>();
 let reconcileOnJoin=false;
 function transmit(message:ClientMessage){
  if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(message));
 }
 function send(message:ClientMessage){
  if(message.type==='matchup'||message.type==='circuit'){
   if(!c.canReset)return;
   unconfirmed.set(message.type,message);
  }
  transmit(message);
 }
 function confirmChoices(state:RaceState){
  if(!c.canReset)return;
  for(const [type,choice] of unconfirmed){
   const accepted=choice.type==='matchup'?state.matchup===choice.matchup:state.race.circuit===choice.circuit;
   if(accepted)unconfirmed.delete(type);
   else if(reconcileOnJoin)transmit(choice);
  }
  reconcileOnJoin=false;
 }
 let audioReply:((ok:boolean)=>void)|undefined;
 const c:Connection={claimAudio:()=>new Promise(resolve=>{
  if(ws?.readyState!==WebSocket.OPEN){resolve(false);return;}
  const timer=setTimeout(()=>{audioReply=undefined;c.releaseAudio();resolve(false);},2500);
  audioReply=ok=>{clearTimeout(timer);audioReply=undefined;resolve(ok);};c.send({type:'audio',claim:true});
 }),releaseAudio:()=>c.send({type:'audio',claim:false}),state:null,team:null,canReset:false,status:'CONNECTING',latency:0,received:0,onReplay:()=>{},send,close:()=>{closed=true;clearTimeout(reconnect);clearTimeout(seatRetry);clearInterval(agent);clearInterval(ping);removeEventListener('pagehide',c.close);ws?.close();}};
 function open(){if(closed)return;const u=new URL(`/api/rooms/${room.room}/ws`,room.origin??location.origin);u.protocol=u.protocol==='https:'?'wss:':'ws:';if(room.mcpToken)u.searchParams.set('mcp_token',room.mcpToken);ws=new WebSocket(u);
  ws.onopen=()=>{retry=300;c.status='CONNECTED';c.send({type:'join',team,token:room.token});};ws.onmessage=e=>{const m=JSON.parse(e.data) as ServerMessage;if(m.type==='audio')audioReply?.(m.granted);if(m.type==='joined'){c.team=m.team;c.canReset=m.canReset;reconcileOnJoin=m.canReset;if(!m.canReset)unconfirmed.clear();c.status=m.reason??'CONNECTED';if(m.reason?.includes('SEAT TAKEN')&&team)seatRetry=setTimeout(()=>ws?.close(),1400);}if(m.type==='state'){if(c.state&&(c.state.matchup!==m.matchup||c.state.race.circuit!==m.race.circuit)){awaiting=false;lastDecide=0;nextDecisionAt=0;}confirmChoices(m);c.state=m;c.received=performance.now();c.onSnapshot?.(m,c.received);requestDecision();}if(m.type==='decision'){awaiting=false;nextDecisionAt=performance.now()+(m.decision.retryAfterMs??0);c.send({type:'intent',sequence:m.decision.sequence});}if(m.type==='pong')c.latency=Math.round(performance.now()-m.sent);if(m.type==='replay')c.onReplay(m.frames);if(m.type==='error')c.status=m.message;};
  ws.onclose=event=>{clearTimeout(seatRetry);audioReply?.(false);c.onAudioLost?.();c.team=null;c.canReset=false;reconcileOnJoin=false;awaiting=false;const denied=room.live&&event.code===1008;c.status=denied?'INVALID LIVE INVITATION':closed?'DISCONNECTED':'RECONNECTING';if(!closed&&!denied){reconnect=setTimeout(open,retry);retry=Math.min(3000,retry*1.5);}};ws.onerror=()=>ws?.close();
 }
 function requestDecision(){const now=performance.now();if(c.team&&c.state?.race.phase==='racing'&&now>=nextDecisionAt&&now-lastDecide>=200&&(!awaiting||now-lastRequest>2000)){awaiting=true;lastRequest=now;lastDecide=now;c.send({type:'decide'});}}
 const agent=setInterval(requestDecision,25);
 const ping=setInterval(()=>c.send({type:'ping',sent:performance.now()}),1000);open();addEventListener('pagehide',c.close,{once:true});return c;
}
export {createInterpolator} from './presentation-motion';
export async function prepareRoom():Promise<HostedRoom>{
 const q=new URLSearchParams(location.search),id=q.get('room');
 if(q.has('live')){
  const room=q.get('live'),token=new URLSearchParams(location.hash.slice(1)).get('token');
  if(!isRoomId(room)||!isLiveKey(token))throw new Error('Invalid live race invitation.');
  return {room,token,links:null,live:true};
 }
 let token=new URLSearchParams(location.hash.slice(1)).get('token')??'',links=null;
 if(!id){links=await fetch('/api/default').then(r=>r.json());const route=q.get('team')==='a'?'a':q.get('team')==='b'?'b':'owner';token=new URLSearchParams(new URL(links[route]).hash.slice(1)).get('token')!;return {room:links.room,token,links};}
 const res=await fetch(`/api/rooms/${id}/info`);if(!res.ok)throw new Error('This race has expired. Open a fresh race.');if(token){const owner=await fetch(`/api/rooms/${id}/links`,{headers:{Authorization:`Bearer ${token}`}});if(owner.ok)links=await owner.json();}return {room:id,token,links};
}
