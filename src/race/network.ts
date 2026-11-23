import {isLiveKey,isRoomId,ROOM_EXPIRED_CLOSE_CODE} from './live';
import type {HostedRoom,Team,RaceState,ClientMessage,ServerMessage,Race,PeerRole} from './types';
import type {RaceLogUpdate} from './event-log';

export const PING_INTERVAL_MS = 10_000;
export const DECIDE_INTERVAL_MS = 400;
export const HIDDEN_DISCONNECT_MS = 20_000;
export const FINISHED_IDLE_CLOSE_MS = 45_000;
export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 30_000;
export const MAX_RECONNECT_ATTEMPTS = 6;
export const MAX_HANDSHAKE_FAILURES = 3;

export interface ConnectOptions{
 role?:PeerRole;
 shouldDecide?:(state:RaceState)=>boolean;
 pingIntervalMs?:number;
 decideIntervalMs?:number;
 hiddenDisconnectMs?:number;
 finishedCloseMs?:number;
 reconnectBaseMs?:number;
 reconnectMaxMs?:number;
 maxReconnectAttempts?:number;
}
export interface Connection{onSnapshot?:(s:RaceState,received:number)=>void;onAudioLost?:()=>void;onEventLog?:(log:RaceLogUpdate)=>void;subscribeEventLog:(subscribe:boolean)=>void;claimAudio:()=>Promise<boolean>;releaseAudio:()=>void;state:RaceState|null;team:Team|null;role?:PeerRole;canReset:boolean;status:string;latency:number;received:number;onReplay:(frames:Race[])=>void;send:(msg:ClientMessage)=>void;close:()=>void;}

function isHidden(){
 return typeof document !== 'undefined' && (document.hidden || document.documentElement?.dataset?.mcpHidden === 'true');
}

function isRaceEnded(state:RaceState|null){
 return Boolean(state && (state.race.phase === 'finished' || (state.live && state.live !== 'running')));
}

export function connect(team:Team|null,room:HostedRoom,options?:ConnectOptions):Connection{
 const pingMs = options?.pingIntervalMs ?? PING_INTERVAL_MS;
 const decideMs = options?.decideIntervalMs ?? DECIDE_INTERVAL_MS;
 const hiddenCloseMs = options?.hiddenDisconnectMs ?? HIDDEN_DISCONNECT_MS;
 const finishedCloseMs = options?.finishedCloseMs ?? FINISHED_IDLE_CLOSE_MS;
 const baseRetryMs = options?.reconnectBaseMs ?? RECONNECT_BASE_MS;
 const maxRetryMs = options?.reconnectMaxMs ?? RECONNECT_MAX_MS;
 const maxAttempts = options?.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS;

 let ws:WebSocket|null=null;
 let closed=false,terminal=false,pausedHidden=false,pausedFinished=false,claimingSeat=false;
 let opened=false,joined=false,eventLog=false,reconcileOnJoin=false,waitingForSeat=false;
 let retry=baseRetryMs,attempts=0,handshakeFailures=0;
 let awaiting=false,lastRequest=0,lastDecide=0,nextDecisionAt=0,lastPingSent=0;
 let reconnect:ReturnType<typeof setTimeout>|undefined;
 let hiddenTimer:ReturnType<typeof setTimeout>|undefined;
 let finishTimer:ReturnType<typeof setTimeout>|undefined;
 type RoomChoice=Extract<ClientMessage,{type:'matchup'|'circuit'}>;
 const unconfirmed=new Map<RoomChoice['type'],RoomChoice>();
 let pendingAfterReopen:ClientMessage|null=null;
 let audioReply:((ok:boolean)=>void)|undefined;

 function clearTimers(){
  clearTimeout(reconnect);reconnect=undefined;
  clearTimeout(hiddenTimer);hiddenTimer=undefined;
  clearTimeout(finishTimer);finishTimer=undefined;
 }
 function transmit(message:ClientMessage){
  if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(message));
 }
 function sendPing(){
  if(ws?.readyState!==WebSocket.OPEN)return;
  lastPingSent=performance.now();
  ws.send('{"type":"ping"}');
 }
 function send(message:ClientMessage){
  if(closed||terminal)return;
  if(message.type==='matchup'||message.type==='circuit'){
   if(!c.canReset)return;
   unconfirmed.set(message.type,message);
  }
  if(pausedFinished&&(message.type==='reset'||message.type==='replay')){
   pausedFinished=false;
   pendingAfterReopen=message;
   retry=baseRetryMs;
   attempts=0;
   handshakeFailures=0;
   open();
   return;
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
 function stopPermanently(status:string){
  terminal=true;
  clearTimers();
  c.status=status;
  if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))ws.close(1000);
 }
 function scheduleFinishClose(){
  if(finishTimer!==undefined||closed||terminal||pausedFinished)return;
  if(isHidden()){
   pausedFinished=true;
   ws?.close(1000,'Race finished');
   return;
  }
  finishTimer=setTimeout(()=>{
   finishTimer=undefined;
   if(!closed&&!terminal&&isRaceEnded(c.state)){
    pausedFinished=true;
    ws?.close(1000,'Race finished');
   }
  },finishedCloseMs);
 }
 function suspendForHidden(){
  hiddenTimer=undefined;
  if(closed||terminal||!isHidden())return;
  clearTimeout(reconnect);reconnect=undefined;
  if(isRaceEnded(c.state)){
   pausedFinished=true;
   if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))ws.close(1000,'Race finished');
   return;
  }
  pausedHidden=true;
  if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))ws.close(1000,'Hidden');
 }
 function scheduleReconnect(){
  if(closed||terminal||pausedHidden||pausedFinished)return;
  if(isHidden()){pausedHidden=true;c.status='PAUSED';return;}
  if(attempts>=maxAttempts){c.status='DISCONNECTED';return;}
  const jitter=0.85+Math.random()*0.3;
  const delay=Math.round(retry*jitter);
  retry=Math.min(maxRetryMs,retry*2);
  attempts++;
  clearTimeout(reconnect);
  reconnect=setTimeout(open,delay);
 }
 async function probeRoomBeforeRetry(){
  if(closed||terminal||pausedHidden||pausedFinished)return;
  if(room.live){
   if(handshakeFailures>=MAX_HANDSHAKE_FAILURES){stopPermanently('RACE EXPIRED');return;}
   scheduleReconnect();
   return;
  }
  try{
   const infoUrl=new URL(`/api/rooms/${room.room}/info`,room.origin??location.origin);
   const res=await fetch(infoUrl,{cache:'no-store'});
   if(closed||terminal||pausedHidden||pausedFinished)return;
   if(res.status===404||res.status===410||res.status===403){
    stopPermanently('RACE EXPIRED');
    return;
   }
  }catch{/* Network offline or transient error: fall through to bounded backoff. */}
  if(handshakeFailures>=MAX_HANDSHAKE_FAILURES){c.status='DISCONNECTED';return;}
  scheduleReconnect();
 }
 const c:Connection={claimAudio:()=>new Promise(resolve=>{
  if(ws?.readyState!==WebSocket.OPEN){resolve(false);return;}
  const timer=setTimeout(()=>{audioReply=undefined;c.releaseAudio();resolve(false);},2500);
  audioReply=ok=>{clearTimeout(timer);audioReply=undefined;resolve(ok);};c.send({type:'audio',claim:true});
 }),releaseAudio:()=>c.send({type:'audio',claim:false}),subscribeEventLog:subscribe=>{
  eventLog=subscribe;
  if(joined)transmit({type:'event-log',subscribe});
 },state:null,team:null,canReset:false,status:'CONNECTING',latency:0,received:0,onReplay:()=>{},send,close:()=>{
  closed=true;
  clearTimers();
  if(agent!==undefined)clearInterval(agent);
  clearInterval(ping);
  if(typeof removeEventListener==='function'){
   removeEventListener('pagehide',c.close);
   removeEventListener('beforeunload',c.close);
  }
  if(typeof document!=='undefined'){
   document.removeEventListener('visibilitychange',onVisibility);
   document.removeEventListener('mcp-visibility',onVisibility);
  }
  ws?.close(1000);
 }};
 function open(){
  if(closed||terminal||pausedHidden||pausedFinished)return;
  if(isHidden()){pausedHidden=true;c.status='PAUSED';return;}
  clearTimeout(reconnect);reconnect=undefined;
  opened=false;
  const u=new URL(`/api/rooms/${room.room}/ws`,room.origin??location.origin);
  u.protocol=u.protocol==='https:'?'wss:':'ws:';
  if(room.mcpToken)u.searchParams.set('mcp_token',room.mcpToken);
  const socket=ws=new WebSocket(u);
  socket.onopen=()=>{
   if(ws!==socket||closed||terminal){socket.close(1000);return;}
   opened=true;
   handshakeFailures=0;
   c.status='CONNECTED';
   transmit({type:'join',team,token:room.token,...(options?.role?{role:options.role}:{})});
  };
  socket.onmessage=e=>{
   if(ws!==socket||closed)return;
   const m=JSON.parse(e.data) as ServerMessage;
   if(m.type==='audio')audioReply?.(m.granted);
   if(m.type==='joined'){
    joined=true;
    retry=baseRetryMs;
    attempts=0;
    if(eventLog)transmit({type:'event-log',subscribe:true});
    c.team=m.team;c.role=m.role;c.canReset=m.canReset;reconcileOnJoin=m.canReset;
    if(!m.canReset)unconfirmed.clear();
    c.status=m.reason??'CONNECTED';
    waitingForSeat=Boolean(m.reason?.includes('SEAT TAKEN')&&team);
    if(pendingAfterReopen){
     const queued=pendingAfterReopen;
     pendingAfterReopen=null;
     transmit(queued);
    }
   }
   if(m.type==='state'){
    if(c.state&&(c.state.matchup!==m.matchup||c.state.race.circuit!==m.race.circuit)){awaiting=false;lastDecide=0;nextDecisionAt=0;}
    confirmChoices(m);
    c.state=m;c.received=performance.now();c.onSnapshot?.(m,c.received);
    if(isRaceEnded(m))scheduleFinishClose();
    else if(finishTimer!==undefined){clearTimeout(finishTimer);finishTimer=undefined;}
    if(waitingForSeat&&team&&!m.connected[team]&&!isHidden()&&!isRaceEnded(m)){
     waitingForSeat=false;
     claimingSeat=true;
     socket.close(1000,'Claiming seat');
     return;
    }
    requestDecision();
   }
   if(m.type==='decision'){awaiting=false;nextDecisionAt=performance.now()+(m.decision.retryAfterMs??0);c.send({type:'intent',sequence:m.decision.sequence});}
   if(m.type==='pong'){const sent=m.sent??lastPingSent;if(sent>0)c.latency=Math.round(performance.now()-sent);}
   if(m.type==='replay')c.onReplay(m.frames);
   if(m.type==='event-log'&&eventLog)c.onEventLog?.(m);
   if(m.type==='error'){
    c.status=m.message;
    if(m.message.toLowerCase().includes('expired'))stopPermanently('RACE EXPIRED');
   }
  };
  socket.onclose=event=>{
   if(ws!==socket)return;
   joined=false;waitingForSeat=false;audioReply?.(false);c.onAudioLost?.();
   c.team=null;c.role=undefined;c.canReset=false;reconcileOnJoin=false;awaiting=false;
   if(claimingSeat&&!closed&&!terminal){
    claimingSeat=false;
    retry=baseRetryMs;attempts=0;
    open();
    return;
   }
   if(closed||terminal){c.status=terminal?c.status:'DISCONNECTED';return;}
   if(pausedHidden){c.status='PAUSED';return;}
   if(pausedFinished){c.status='RACE FINISHED';return;}
   if(event.code===ROOM_EXPIRED_CLOSE_CODE||event.reason?.toLowerCase().includes('expired')){
    stopPermanently('RACE EXPIRED');return;
   }
   if(event.code===1008){
    stopPermanently(room.live?'INVALID LIVE INVITATION':'DISCONNECTED');return;
   }
   if(event.code===1000){
    stopPermanently('DISCONNECTED');return;
   }
   if(isRaceEnded(c.state)){
    pausedFinished=true;c.status='RACE FINISHED';return;
   }
   c.status='RECONNECTING';
   if(!opened){
    handshakeFailures++;
    void probeRoomBeforeRetry();
    return;
   }
   scheduleReconnect();
  };
  socket.onerror=()=>{if(ws===socket&&socket.readyState===WebSocket.OPEN)socket.close();};
 }
 function requestDecision(){
  if(closed||terminal||pausedHidden||isHidden())return;
  if(options?.role==='engineer')return;
  if(c.state&&options?.shouldDecide&&!options.shouldDecide(c.state))return;
  const now=performance.now();
  if(c.team&&c.state?.race.phase==='racing'&&now>=nextDecisionAt&&now-lastDecide>=decideMs&&(!awaiting||now-lastRequest>2000)){
   awaiting=true;lastRequest=now;lastDecide=now;c.send({type:'decide'});
  }
 }
 const agent=team&&options?.role!=='engineer'?setInterval(requestDecision,100):undefined;
 const ping=setInterval(()=>{
  if(closed||terminal||pausedHidden||pausedFinished||isHidden()||isRaceEnded(c.state))return;
  sendPing();
 },pingMs);
 const onVisibility=()=>{
  if(closed||terminal)return;
  if(isHidden()){
   clearTimeout(reconnect);reconnect=undefined;
   if(isRaceEnded(c.state))suspendForHidden();
   else if(hiddenTimer===undefined)hiddenTimer=setTimeout(suspendForHidden,hiddenCloseMs);
   return;
  }
  clearTimeout(hiddenTimer);hiddenTimer=undefined;
  if(pausedHidden){
   pausedHidden=false;
   retry=baseRetryMs;attempts=0;handshakeFailures=0;
   open();
   return;
  }
  if(!pausedFinished&&!isRaceEnded(c.state)){
   sendPing();
   requestDecision();
  }
 };
 if(typeof document!=='undefined'){
  document.addEventListener('visibilitychange',onVisibility);
  document.addEventListener('mcp-visibility',onVisibility);
 }
 if(typeof addEventListener==='function'){
  addEventListener('pagehide',c.close,{once:true});
  addEventListener('beforeunload',c.close,{once:true});
 }
 open();
 return c;
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
