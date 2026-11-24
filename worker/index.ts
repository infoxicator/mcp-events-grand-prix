import {strategyEventDefinition,eventInput,radioInput,type LiveStrategyRead} from '../server/strategy-events';
import {STRATEGY_EVENT,WEBHOOK_STRATEGY_RESPONSE_MS,type LiveStrategist} from '../src/race/strategy-events';
import {postStrategyEvent,postSepStrategyEvent,postSepTermination,subscribeInput,unsubscribeInput,verifyStrategyWebhook,webhookId,subscriptionId,type CallbackFailure,type SepStrategyWebhook,type StrategyWebhook} from './strategy-webhook';
import {registerSepEvents,sepRequestAuthorized,sepCallbackTransport,sepEventHeaderError,sepEventsEnabled,SEP_AUTH_REQUIRED,SEP_EVENTS_PATH,SEP_EVENTS_PRINCIPAL,type SepEventsBindings,type SepSubscribe,type SepUnsubscribe} from './sep-events';
import {DurableObject} from 'cloudflare:workers';
import {createMcpHandler,isLegacyRequest,WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import {RaceRoom,type Peer} from '../server/race-room';
import {createRaceMcp,type McpRoom,type StrategySeatAccess} from '../server/race-mcp';
import {isCircuit,type CircuitId} from '../src/race/track';
import {isMatchup,type Matchup} from '../src/race/matchup';
import {TEAMS,type Team,type Race,type ClientMessage,type RaceState} from '../src/race/types';
import {isLiveKey,isRoomId,newLiveKey,LIVE_CALL_LIMIT,LIVE_DRIVER_INTERVAL_MS,LIVE_PAIR_PATH,LIVE_TIME_MS,OWNER_LIVE_PATH,
 CHAT_STRATEGY_LAPS,CHAT_STRATEGY_MAX_LAPS,CHAT_STRATEGY_TIME_MS,strategyTimeBudgetMs,PAIR_TTL_MS,ROOM_EXPIRED_CLOSE_CODE,FINISHED_GRACE_MS,STRATEGY_LOBBY_TTL_MS,STRATEGY_IDLE_STOP_MS,STRATEGY_MAX_CONSECUTIVE_FAILURES,type LivePhase} from '../src/race/live';
import {handleOwnerLive,handlePairing,roomStub,type LiveControls} from './owner-live';
import {liveAvailable,livePairingAvailable,raceProviders,type LiveBindings} from './live-providers';
import {json,privateHeaders} from './http';

const EXPIRED_ROOM_CACHE_TTL_MS=10*60_000;
const EXPIRED_ROOM_CACHE_MAX=2000;
const expiredResponse=()=>Response.json({error:'Race expired'},{status:404,headers:{...privateHeaders,'X-Race-Expired':'1'}});

export interface Env extends LiveBindings, SepEventsBindings {
 ASSETS: Fetcher;
 ROOMS: DurableObjectNamespace<GameRoom>;
 ROOM_CREATION: RateLimit;
 MCP_ROOM_CREATION?: RateLimit;
}

async function create(env:Env,origin:string,matchup:Matchup='jev-vs-jev',circuit:CircuitId='monza',clock=4,solo=false,drive=false,laps=3,watchMode=false):Promise<McpRoom>{
 const id=crypto.randomUUID();
 const response=await roomStub(env,id).fetch(new Request(`${origin}/internal-create?room=${id}&matchup=${matchup}&circuit=${circuit}&clock=${clock}&solo=${solo}&drive=${drive}&laps=${laps}&watch=${watchMode}`,{method:'POST'}));
 if(!response.ok)throw new Error('Unable to create race');
 return response.json();
}

async function get(env:Env,origin:string,id:string):Promise<McpRoom|null>{
 if(!isRoomId(id))return null;
 const response=await roomStub(env,id).fetch(`${origin}/internal-data`);
 return response.ok?response.json():null;
}

export function createWorker(fetchKeys:typeof fetch=fetch): ExportedHandler<Env>{
 const expiredRooms=new Map<string,number>();
 const isCachedExpired=(id:string)=>{
  const until=expiredRooms.get(id);
  if(until===undefined)return false;
  if(Date.now()>=until){expiredRooms.delete(id);return false;}
  return true;
 };
 const markExpired=(id:string)=>{
  if(expiredRooms.size>=EXPIRED_ROOM_CACHE_MAX){
   const oldest=expiredRooms.keys().next().value;
   if(oldest!==undefined)expiredRooms.delete(oldest);
  }
  expiredRooms.set(id,Date.now()+EXPIRED_ROOM_CACHE_TTL_MS);
 };
 return {async fetch(req,env){
  const url=new URL(req.url), {pathname:path,origin,searchParams}=url;
  if(path==='/health')return json({ok:true,game:'MCP Grand Prix',runtime:'cloudflare-workers',mode:'mock',physicsHz:120,snapshotHz:30,paidCalls:0});
  if(path==='/api/config')return json({hosted:true});
  if(path===OWNER_LIVE_PATH)return handleOwnerLive(req,env,fetchKeys);
  if(path===LIVE_PAIR_PATH||path===`${LIVE_PAIR_PATH}/claim`)return handlePairing(req,env,id=>expiredRooms.delete(id));

  const allowCreate=()=>env.ROOM_CREATION.limit({key:req.headers.get('CF-Connecting-IP')??'local'});
  const allowMcpCreate=()=>{
   const limiter=env.MCP_ROOM_CREATION??env.ROOM_CREATION;
   const connectingIP=req.headers.get('CF-Connecting-IP')||'local';
   const key=path===SEP_EVENTS_PATH?'sep-create:'+connectingIP:req.headers.get('Mcp-Session-Id')||connectingIP;
   return limiter.limit({key});
  };
  if(path==='/api/default'||path==='/api/rooms'&&req.method==='POST'){
   if(path==='/api/rooms'&&req.headers.get('Origin')!==origin)return json({error:'Same-origin required'},403);
   if(!(await allowCreate()).success)return json({error:'Room creation limit'},429);
   const circuit=searchParams.get('circuit')??'monza';
   if(!isCircuit(circuit))return json({error:'Invalid circuit'},400);
   const isDrive=path==='/api/rooms'&&searchParams.has('drive');const isWatch=path==='/api/rooms'&&searchParams.has('watch')&&!isDrive;const lapsParam=Number(searchParams.get('laps'));const laps=Number.isFinite(lapsParam)&&lapsParam>=1&&lapsParam<=20?Math.round(lapsParam):3;const created=await create(env,origin,'jev-vs-jev',circuit,isWatch||isDrive?1:4,path==='/api/rooms'&&(searchParams.has('solo')||(isDrive&&!searchParams.has('multiplayer'))),isDrive,laps,isWatch);expiredRooms.delete(created.links.room);return json(created.links);
  }

  if(path==='/mcp'||path===SEP_EVENTS_PATH){
   const sep=path===SEP_EVENTS_PATH;
   if(sep&&!sepEventsEnabled(env))return json({error:'Not found'},404);
   const requestOrigin=req.headers.get('Origin');
   if(sep&&requestOrigin&&requestOrigin!==origin)return json({error:'Invalid MCP origin'},403);
   const cors={'Access-Control-Allow-Origin':sep?origin:'*','Access-Control-Allow-Headers':`Content-Type, MCP-Protocol-Version, MCP-Session-Id, Mcp-Method, Mcp-Name${sep?', Authorization':''}`,'Access-Control-Allow-Methods':'POST, OPTIONS'};
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
   if(req.method!=='POST')return new Response('Use POST',{status:405,headers:cors});
   const rpc=await req.clone().json().catch(()=>null) as {
    jsonrpc?:unknown;id?:string|number;method?:string;params?:{name?:unknown;arguments?:{room?:unknown};_meta?:Record<string,unknown>};
   }|null;
   if(sep&&rpc?.jsonrpc==='2.0'){
    const headerError=sepEventHeaderError(req,rpc);
    if(headerError)return new Response(headerError.body,{status:400,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
   }
   if(!sep&&rpc?.jsonrpc==='2.0'&&['events/list','events/subscribe','events/unsubscribe','events/stream'].includes(rpc.method??'')){
    const id=rpc.id;
    if(typeof id!=='string'&&typeof id!=='number')return Response.json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'An event request needs an ID.'}},{headers:cors,status:400});
    if(rpc.method==='events/list')return Response.json({jsonrpc:'2.0',id,result:{events:[strategyEventDefinition]}},{headers:cors});
    if(rpc.method==='events/subscribe'||rpc.method==='events/unsubscribe'){
     const subscribing=rpc.method==='events/subscribe';
     const parsed=(subscribing?subscribeInput:unsubscribeInput).safeParse(rpc.params);
     if(!parsed.success)return Response.json({jsonrpc:'2.0',id,error:{code:-32602,message:'Use the race event filter and a ChatGPT MCP Events webhook.'}},{headers:cors});
     const result=await roomStub(env,parsed.data.arguments.room).fetch(new Request(`${origin}/internal-strategy-${subscribing?'subscribe':'unsubscribe'}`,{
      method:'POST',body:JSON.stringify(parsed.data),
     }));
     return Response.json({jsonrpc:'2.0',id,...await result.json<object>()},{headers:{...cors,'Cache-Control':'no-store'}});
    }
    // Older open widgets stop polling when their former stream returns 403.
    return Response.json({jsonrpc:'2.0',id,error:{code:-32024,message:'Subscribe through native MCP Events in ChatGPT Work.'}},{headers:cors,status:403});
   }
   const authenticated=sep&&sepRequestAuthorized(req,env);
   if(sep&&!authenticated&&rpc?.jsonrpc==='2.0'&&rpc.method==='tools/call'){
    return Response.json({jsonrpc:'2.0',id:rpc.id??null,error:{code:-32024,message:SEP_AUTH_REQUIRED}},
     {status:401,headers:{...cors,'WWW-Authenticate':'Bearer','Cache-Control':'no-store'}});
   }
   const credentialHeaders=authenticated?{Authorization:`Bearer ${env.SEP_EVENTS_AUTH_TOKEN}`}:undefined;
   const sepQuery=sep?'?sep=1':'';
   const factory=()=>createRaceMcp(origin,{
    sepEvents:sep,
    create:async (matchup,circuit,solo)=>{
     if(!(await allowMcpCreate()).success)throw new Error('Room creation limit');
     const created=await create(env,origin,matchup,circuit,4,solo);
     expiredRooms.delete(created.links.room);
     return created;
    },
    get:id=>get(env,origin,id),
    liveAvailable:livePairingAvailable(env),
    liveOptions:{provider:liveAvailable(env),chatgpt:liveAvailable(env,'jev-vs-jev','chatgpt'),luna:liveAvailable(env,'jev-vs-luna')},
    startChatPractice:async (circuit,laps,driver='autopilot')=>{
     if(!(await allowMcpCreate()).success)throw new Error('Room creation limit');
     const room=crypto.randomUUID();
     expiredRooms.delete(room);
     const lapQuery=laps!==undefined?`&laps=${laps}`:'';
     const driverQuery=`&driver=${driver}`;
     const started=await roomStub(env,room).fetch(new Request(`${origin}/internal-chat-practice?room=${room}&circuit=${circuit}${lapQuery}${driverQuery}${sep?'&sep=1':''}`,{method:'POST'}));
     if(!started.ok)throw new Error('Unable to create a ChatGPT strategy race');
     return started.json<StrategySeatAccess>();
    },
    configureChatPractice:async(room,key,circuit,laps,driver='autopilot')=>{
     const configured=await roomStub(env,room).fetch(new Request(`${origin}/internal-chat-practice-configure${sepQuery}`,{
      method:'POST',body:JSON.stringify({key,circuit,laps,driver}),
     }));
     return configured.ok?configured.json<StrategySeatAccess&{circuit:CircuitId}>():null;
    },
    joinChatPractice:async({room,key},driver='autopilot')=>{
     const joined=await roomStub(env,room).fetch(new Request(`${origin}/internal-chat-seat${sepQuery}`,{method:'POST',body:JSON.stringify({key,driver})}));
     return joined.ok?joined.json<StrategySeatAccess&{circuit:CircuitId}>():null;
    },
    stopChatPractice:async(room,key)=>{
     const stopped=await roomStub(env,room).fetch(new Request(`${origin}/internal-chat-practice-stop${sepQuery}`,{method:'POST',body:key}));
     return stopped.ok;
    },
    strategyEvent:async(room,eventId,team)=>{
     const result=await roomStub(env,room).fetch(new Request(`${origin}/internal-strategy-event${sepQuery}`,{
      method:'POST',headers:credentialHeaders,body:JSON.stringify({room,...(eventId?{event_id:eventId}:{}),...(team?{team}:{})}),
     }));
     return result.ok?result.json<LiveStrategyRead>():null;
    },
    submitStrategy:async input=>{
     const result=await roomStub(env,input.room).fetch(new Request(`${origin}/internal-strategy-radio${sepQuery}`,{
      method:'POST',headers:credentialHeaders,body:JSON.stringify(input),
     }));
     return result.json<{team:'a'|'b';line:string}|{error:string}>();
    },
    watchLive:async ({room,key})=>{
     const response=await roomStub(env,room).fetch(new Request(`${origin}/internal-watch`,{method:'POST',body:key}));
     return response.ok?response.json<RaceState>():null;
    },
    html:async()=>{
     const response=await env.ASSETS.fetch(new Request(`${origin}/mcp/mcp-app.html`));
     if(!response.ok)throw new Error('Build MCP resource first');
     return response.text();
    },
   });
   let response:Response;
   if(sep){
    response=await createMcpHandler(()=>{
     const server=factory();
     registerSepEvents(server,authenticated,async(input,method)=>{
      const result=await roomStub(env,input.arguments.room).fetch(new Request(`${origin}/internal-sep-${method}`,{
       method:'POST',headers:credentialHeaders,body:JSON.stringify(input),
      }));
      return result.json();
     });
     return server;
    },{legacy:'reject'}).fetch(req);
   }else if(await isLegacyRequest(req,rpc)){
    const server=factory(),transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    try{
     await server.connect(transport);
     response=await transport.handleRequest(req);
    }finally {await server.close();}
   }else{
    response=await createMcpHandler(factory,{legacy:'reject'}).fetch(req);
   }
   const headers=new Headers(response.headers);
   for(const [key,value] of Object.entries(cors))headers.set(key,value);
   headers.set('Cache-Control','no-store');
   // MCP Events is a draft capability and isn't in the SDK's handshake schema yet.
   if(!sep&&response.ok&&(rpc?.method==='initialize'||rpc?.method==='server/discover')){
    const body=await response.json() as {result?:{capabilities?:Record<string,unknown>}};
    if(body.result?.capabilities)body.result.capabilities.events={};
    headers.delete('Content-Length');
    return Response.json(body,{status:response.status,headers});
   }
   return new Response(response.body,{status:response.status,headers});
  }

  const match=path.match(/^\/api\/rooms\/([^/]+)\/(info|links|status|ws)$/);
  if(match&&isRoomId(match[1])){
   const [,roomId,endpoint]=match;
   if(endpoint==='ws'&&req.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'WebSocket upgrade required'},426);
   if(isCachedExpired(roomId))return expiredResponse();
   const response=await roomStub(env,roomId).fetch(req);
   if(response.headers.get('X-Race-Expired')==='1')markExpired(roomId);
   return response;
  }
  if(path.startsWith('/api/')||path.startsWith('/internal')||path.startsWith('/owner/'))return json({error:'Not found'},404);
  if(path.startsWith('/mcp/assets/')){
   const response=await env.ASSETS.fetch(req);
   const headers=new Headers(response.headers);
   headers.set('Access-Control-Allow-Origin','*');
   headers.set('Cross-Origin-Resource-Policy','cross-origin');
   if(response.ok)headers.set('Cache-Control','public, max-age=31536000, immutable');
   return new Response(response.body,{status:response.status,headers});
  }
  return env.ASSETS.fetch(req);
 }};
}

export default createWorker();

interface SavedStrategySeat {key:string;subscriptionKey?:string;webhook?:StrategyWebhook;sep?:true;sepWebhook?:SepStrategyWebhook}
interface StrategySeat extends SavedStrategySeat {
 webhookVerification?:{url:string};
 webhookAbort?:AbortController;
 sepChange?:Promise<void>;
}

const strategyWebhook=(seat:SavedStrategySeat|undefined)=>seat?.sep?seat.sepWebhook:seat?.webhook;
type SepVerificationReply={failure:CallbackFailure|null}|{error:{code:number;message:string;data?:object}};

interface Saved {
 speed?:number;solo?:boolean;drive?:boolean;watchMode?:boolean;driverMode?:RaceRoom['driverMode'];engineerMode?:RaceRoom['engineerMode'];matchup?:Matchup;id:string;origin:string;race:Race;tokens:RaceRoom['tokens'];mcpToken:string;expiresAt:number;
 intents:RaceState['intents'];engineerCalls:RaceState['engineerCalls'];
 live?:{phase:LivePhase;key:string;deadline:number;lobbyDeadline?:number;strategyPractice?:boolean;guestInviteKey?:string;subscriptionKey?:string;webhook?:StrategyWebhook;strategySeats?:Partial<Record<Team,SavedStrategySeat>>;
  state:Pick<RaceState,'players'|'mode'|'paidCalls'|'driverStats'|'decisions'|'latestChatRadio'|'guestChatStrategy'>};
}

export class GameRoom extends DurableObject<Env> {
 private room:RaceRoom|null=null;
 private peers=new Map<WebSocket,Peer>();
 private timer:ReturnType<typeof setInterval>|null=null;
 private prev=Date.now();
 private accumulator=0;
 private broadcastAt=0;
 private checkpointAt=0;
 private pairing?:{challenge:string;expiresAt:number;chat:boolean};
 private strategySeats:Partial<Record<Team,StrategySeat>>={};
 private sepVerifiedUntil=0;
 private sepVerification?:Promise<SepVerificationReply>;
 private strategyDeliveries:Partial<Record<Team,string>>={};
 private guestInviteKey?:string;
 private liveDeadline=0;
 private lobbyDeadline=0;
 private emptyViewersSince:number|null=null;
 private lastStrategyRadioAt=0;
 private consecutiveWebhookFailures:Partial<Record<Team,number>>={};
 private liveAbort?:AbortController;

 constructor(ctx:DurableObjectState,env:Env){
  super(ctx,env);
  if(typeof ctx.setWebSocketAutoResponse==='function'&&typeof WebSocketRequestResponsePair==='function'){
   ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}','{"type":"pong"}'));
  }
  void ctx.blockConcurrencyWhile(async()=>{
   const saved=await ctx.storage.get<Saved>('race');
   if(!saved)return;
   const waiting=saved.live?.phase==='running'&&saved.race.phase==='lobby'&&Date.now()<saved.live.deadline;
   const paidLobby=waiting&&!saved.live?.strategyPractice&&saved.solo===true&&saved.live?.strategySeats?.a?.subscriptionKey&&
    liveAvailable(this.env,'jev-vs-jev','chatgpt');
   const room=this.room=paidLobby?this.createPaidRace(saved.id,saved.origin,'jev-vs-jev',saved.race.circuit,true)
    :new RaceRoom(saved.id,saved.origin,{JEV_MOCK:'1'},saved.speed??4,saved.matchup??'jev-vs-jev',{},saved.race.circuit??'monza',saved.solo??false,saved.race.laps??3,saved.drive??false,saved.watchMode??false);
   Object.assign(room.tokens,saved.tokens);
   room.mcpToken=saved.mcpToken;
   room.race={...saved.race,field:saved.race.field??(saved.race.phase==='lobby'?room.race.field:[]),circuit:saved.race.circuit??'monza'};
   room.expiresAt=saved.expiresAt;
   if(saved.driverMode)room.driverMode={...saved.driverMode};
   if(saved.engineerMode)room.engineerMode={...saved.engineerMode};
   room.intents=saved.intents;
   room.engineerCalls=saved.engineerCalls;
   if(saved.live){
    const {phase,key,deadline,state}=saved.live;
    // Restore unstarted lobbies so the host can still choose when to start.
    const restoreLobby=waiting&&(saved.live.strategyPractice||paidLobby);
    room.live=phase==='running'&&!restoreLobby?'interrupted':phase;
    room.viewerKey=key;
    room.strategyPractice=saved.live.strategyPractice;
    this.guestInviteKey=saved.live.guestInviteKey;
    this.strategySeats=saved.live.strategySeats??(saved.live.subscriptionKey?{
     a:{key:newLiveKey(),subscriptionKey:saved.live.subscriptionKey,webhook:saved.live.webhook},
    }:{});
    room.strategyDriverKeys={
     ...(this.strategySeats.a?{a:this.strategySeats.a.key}:{}),
     ...(this.strategySeats.b?{b:this.strategySeats.b.key}:{}),
    };
    room.guestChatStrategy=state.guestChatStrategy;
    room.players=state.players;
    room.mode=state.mode;
    room.paidCalls=state.paidCalls;
    room.driverStats=state.driverStats;
    room.decisions=state.decisions;
    room.latestChatRadio=state.latestChatRadio;
    this.liveDeadline=deadline;
    this.lobbyDeadline=saved.live.lobbyDeadline??0;
    if(restoreLobby)for(const team of TEAMS){
     const seat=this.strategySeats[team];
     if(!seat||(team==='b'&&!strategyWebhook(seat)))continue;
     this.activateStrategySeat(team,seat);
     if((strategyWebhook(seat)?.expiresAt??0)>Date.now()){
      seat.webhookAbort=new AbortController();
      this.setWebhookStatus(team,'connected');
     }
    }
   }
   for(const ws of ctx.getWebSockets()){
    const meta=ws.deserializeAttachment() as Pick<Peer,'team'|'role'|'owner'|'joined'>;
    this.attach(ws,meta);
   }
   if(room.live)room.broadcast();
   else this.activate();
  });
 }

 protected outbound(input:Parameters<typeof fetch>[0],init?:RequestInit){
  return fetch(input,init);
 }

 private attach(ws:WebSocket,meta?:Pick<Peer,'team'|'role'|'owner'|'joined'>){
  const peer=this.room!.add((message,raw)=>{try{ws.send(raw??JSON.stringify(message));}catch{/* closed */}});
  if(meta)Object.assign(peer,meta);
  this.peers.set(ws,peer);
  this.emptyViewersSince=null;
  return peer;
 }

 private save(){
  const room=this.room!;
  const strategySeats:Partial<Record<Team,SavedStrategySeat>>={};
  for(const team of TEAMS){
   const seat=this.strategySeats[team];
   if(seat)strategySeats[team]={key:seat.key,subscriptionKey:seat.sep?undefined:seat.subscriptionKey,webhook:seat.webhook,sep:seat.sep,sepWebhook:seat.sepWebhook};
  }
  const saved:Saved={
   speed:room.speed,solo:room.solo,drive:room.drive,watchMode:room.watchMode,driverMode:room.driverMode,engineerMode:room.engineerMode,matchup:room.matchup,id:room.id,origin:room.origin,race:room.race,tokens:room.tokens,
   mcpToken:room.mcpToken,expiresAt:room.expiresAt,intents:room.intents,engineerCalls:room.engineerCalls,
   live:room.live?{phase:room.live,key:room.viewerKey!,deadline:this.liveDeadline,lobbyDeadline:this.lobbyDeadline||undefined,strategyPractice:room.strategyPractice,guestInviteKey:this.guestInviteKey,
    strategySeats,state:{
    players:room.players,mode:room.mode,paidCalls:room.paidCalls,driverStats:room.driverStats,decisions:room.decisions,
    latestChatRadio:room.latestChatRadio,guestChatStrategy:room.guestChatStrategy,
   }}:undefined,
  };
  return this.ctx.storage.put('race',saved);
 }

 private stopClock(){
  if(this.timer)clearInterval(this.timer);
  this.timer=null;
 }

 private tightenFinishedExpiry(){
  const room=this.room;
  if(!room)return;
  const nextExpiry=Math.min(room.expiresAt,Date.now()+FINISHED_GRACE_MS);
  if(nextExpiry<room.expiresAt){
   room.expiresAt=nextExpiry;
   this.ctx.waitUntil(this.ctx.storage.setAlarm(nextExpiry).catch(()=>{}));
  }
 }

 private async expireNow(){
  this.stopClock();
  this.liveAbort?.abort();
  this.closeStrategyWebhooks();
  for(const ws of this.peers.keys())ws.close(ROOM_EXPIRED_CLOSE_CODE,'Room expired');
  this.peers.clear();
  this.room=null;
  this.pairing=undefined;
  await this.ctx.storage.deleteAlarm();
  await this.ctx.storage.deleteAll();
 }

 private finishLive(phase:Exclude<LivePhase,'running'>){
  const room=this.room!;
  if(room.live!=='running')return;
  this.stopClock();
  this.liveAbort?.abort();
  this.closeStrategyWebhooks();
  room.finishLive(phase);
  this.tightenFinishedExpiry();
 }

 private closeStrategyWebhooks(){
  for(const seat of Object.values(this.strategySeats)){
   seat.webhookAbort?.abort();
   if(seat.sepWebhook&&seat.sepWebhook.expiresAt>Date.now()){
    this.ctx.waitUntil(postSepTermination(sepCallbackTransport(this.env,this.outbound.bind(this)),seat.sepWebhook));
   }
   seat.webhook=undefined;
   seat.sepWebhook=undefined;
  }
 }

 private activate(confirmed=false){
  const room=this.room;
  if(this.timer||!room||room.race.phase==='lobby'||room.race.phase==='finished'||(room.live&&(!confirmed||room.live!=='running')))return;
  const seats=room.connected();
  if(!seats.a||!seats.b||(!room.live&&this.peers.size===0))return;
  this.prev=Date.now();
  this.timer=setInterval(()=>{
   const now=Date.now();
   if(room.live&&(now>=this.liveDeadline||room.paidCalls>=LIVE_CALL_LIMIT)){
    this.finishLive(now>=this.liveDeadline?'time-limit':'call-limit');
    this.ctx.waitUntil(this.save());
    return;
   }
   const guest=this.strategySeats.b;
   const guestWebhook=strategyWebhook(guest);
   if(guest&&guestWebhook&&guestWebhook.expiresAt<=now){
    guest.webhookAbort?.abort();
    guest.webhook=undefined;
    guest.sepWebhook=undefined;
    room.releaseGuestStrategy();
   }
   if(room.strategyPractice&&room.live==='running'){
    const hasActiveWebhook=TEAMS.some(t=>(strategyWebhook(this.strategySeats[t])?.expiresAt??0)>now);
    if(this.peers.size===0){
     if(this.emptyViewersSince===null)this.emptyViewersSince=now;
     if(!hasActiveWebhook||(now-this.emptyViewersSince>=STRATEGY_IDLE_STOP_MS&&now-this.lastStrategyRadioAt>=STRATEGY_IDLE_STOP_MS)){
      this.finishLive('stopped');
      this.ctx.waitUntil(this.save());
      return;
     }
    }else{
     this.emptyViewersSince=null;
    }
   }
   this.accumulator+=Math.min(.25,(now-this.prev)/1000)*room.speed;
   this.prev=now;
   const steps=Math.min(120,Math.floor(this.accumulator*120));
   this.accumulator-=steps/120;
   room.advance(steps);
   room.driveLive(now);
   if(now-this.broadcastAt>=30){
    room.broadcast();
    this.broadcastAt=now;
   }
   const connected=room.connected();
   if(!connected.a||!connected.b||(!room.live&&this.peers.size===0)||room.race.phase==='lobby'||room.race.phase==='finished'){
    this.stopClock();
    if(room.live)this.finishLive('finished');
    else if(room.race.phase==='finished')this.tightenFinishedExpiry();
    this.ctx.waitUntil(this.save());
   }else if(now-this.checkpointAt>15_000){
    this.ctx.waitUntil(this.save().catch(()=>{}));
    this.checkpointAt=now;
   }
  },33);
 }

 private controls():LiveControls{
  const room=this.room!;
  return {room:room.id,key:room.viewerKey!,phase:room.live!};
 }

 private paired(challenge?:string){
  return this.pairing&&this.pairing.expiresAt>Date.now() &&
   (challenge===undefined||challenge===this.pairing.challenge);
 }

 private async startLive(req:Request,url:URL){
  const id=url.searchParams.get('room');
  const {challenge,circuit,matchup,strategist='provider'}=await req.json() as {challenge:unknown;circuit:unknown;matchup:unknown;strategist?:LiveStrategist};
  if(this.room?.live)return json(this.controls()); // The pair ID is the room's idempotency key.
  if(this.room||!isRoomId(id)||!isLiveKey(challenge)||!this.paired(challenge))return json({error:'Pairing expired'},410);
  if(!isCircuit(circuit)||!isMatchup(matchup))return json({error:'Invalid race options'},400);
  if(strategist!=='provider'&&(strategist!=='chatgpt'||!this.pairing?.chat))return json({error:'Strategist not available for this pairing'},400);
  const solo=strategist==='chatgpt',driverMatchup=solo?'jev-vs-jev':matchup;
  if(!liveAvailable(this.env,driverMatchup,strategist))return json({error:'Live racing is unavailable'},503);

  const room=this.room=this.createPaidRace(id,url.origin,driverMatchup,circuit,solo);
  if(strategist==='chatgpt'){
   this.strategySeats.a=this.newStrategySeat();
   this.activateStrategySeat('a',this.strategySeats.a);
  }
  return this.prepareLiveRace(room,{start:strategist==='provider'});
 }

 private createPaidRace(id:string,origin:string,matchup:Matchup,circuit:CircuitId,solo:boolean){
  const abort=this.liveAbort=new AbortController();
  const guardedFetch:typeof fetch=async(input,init)=>{
   if(room.live!=='running'||abort.signal.aborted||Date.now()>=this.liveDeadline||room.paidCalls>=LIVE_CALL_LIMIT){
    throw new Error('Live race request limit');
   }
   room.paidCalls++;
   const signal=init?.signal??(input instanceof Request?input.signal:null);
   return this.outbound(input,{...init,redirect:'manual',signal:signal?AbortSignal.any([signal,abort.signal]):abort.signal});
  };
  const room=new RaceRoom(id,origin,raceProviders(this.env),solo?2:4,matchup,
   {jev:guardedFetch,luna:guardedFetch,engineer:guardedFetch},circuit,solo);
  const minimum=LIVE_DRIVER_INTERVAL_MS;
  for(const driver of Object.values(room.players))driver.intervalMs=Math.max(minimum,driver.intervalMs);
  return room;
 }

 private async prepareLiveRace(room:RaceRoom,{start=false}={}){
  room.live='running';
  room.viewerKey=newLiveKey();
  const now=Date.now();
  this.liveDeadline=now+(room.strategyPractice?strategyTimeBudgetMs(room.race.laps):LIVE_TIME_MS);
  this.lobbyDeadline=!start&&room.strategyPractice?now+STRATEGY_LOBBY_TTL_MS:0;
  room.expiresAt=this.liveDeadline+FINISHED_GRACE_MS;
  if(start)room.start();
  try{
   await this.ctx.storage.setAlarm(this.lobbyDeadline?Math.min(this.liveDeadline,this.lobbyDeadline):this.liveDeadline);
   await this.save();
  }catch{
   this.finishLive('interrupted');
   return json({error:'Unable to prepare race'},503);
  }
  if(start)this.activate(true);
  return json({...this.controls(),...(room.strategyPractice?this.strategySeatAccess('a'):{})});
 }

 private startChatPractice(url:URL){
  const id=url.searchParams.get('room'),circuit=url.searchParams.get('circuit');
  if(this.room||this.paired()||!isRoomId(id)||!isCircuit(circuit))return json({error:'Invalid strategy race'},400);
  // This path never reads provider bindings or installs paid transports.
  const lapsParam=Number(url.searchParams.get('laps'));
  const laps=Number.isFinite(lapsParam)&&lapsParam>=3&&lapsParam<=CHAT_STRATEGY_MAX_LAPS?Math.round(lapsParam):CHAT_STRATEGY_LAPS;
  const driver=url.searchParams.get('driver')==='human'?'human':'autopilot';
  const room=this.room=new RaceRoom(id,url.origin,{JEV_MOCK:'1'},1,'jev-vs-jev',{},circuit,true,laps,driver==='human');
  room.strategyPractice=true;
  room.driverMode={a:driver,b:'autopilot'};
  this.guestInviteKey=newLiveKey();
  this.strategySeats.a=this.newStrategySeat(url.searchParams.get('sep')==='1');
  room.strategyDriverKeys={a:this.strategySeats.a.key};
  this.activateStrategySeat('a',this.strategySeats.a);
  return this.prepareLiveRace(room);
 }

 private newStrategySeat(sep=false):StrategySeat{
  return {key:newLiveKey(),...(sep?{sep:true}:{subscriptionKey:newLiveKey()})};
 }

 private strategySeatAccess(team:Team){
  const seat=this.strategySeats[team]!;
  return {
   strategyKey:seat.key,
   subscriptionKey:seat.sep?undefined:seat.subscriptionKey,
   laps:this.room!.race.laps,
   driver:this.room!.driverMode[team]==='human'?'human':'autopilot',
   ...(team==='a'?{guestInviteKey:this.guestInviteKey}:{}),
  };
 }

 private setWebhookStatus(team:Team,status:RaceState['strategyWebhook']){
  if(team==='a')this.room!.strategyWebhook=status;
  else this.room!.guestStrategyWebhook=status;
 }

 private activateStrategySeat(team:Team,seat:StrategySeat){
  const room=this.room!,existing=room.strategyFor(team);
  if(existing)return existing;
  const usesWebhook=seat.sep||seat.subscriptionKey;
  const events=room.enableChatStrategy(usesWebhook?WEBHOOK_STRATEGY_RESPONSE_MS:undefined,team);
  if(usesWebhook){
   this.setWebhookStatus(team,'waiting');
   events.subscribe((event,issuedAt)=>{
    const subscription=strategyWebhook(seat);
    if(subscription&&subscription.expiresAt>Date.now()){
     this.strategyDeliveries[team]=event.event_id;
     this.setWebhookStatus(team,'connected');
     this.ctx.waitUntil(seat.sepWebhook===subscription
      ?this.deliverSepStrategy(team,seat,subscription,event,issuedAt)
      :this.deliverStrategy(team,seat,subscription,event));
    }else this.setWebhookStatus(team,'waiting');
   });
  }
  return events;
 }

 private async deliverSepStrategy(team:Team,seat:StrategySeat,subscription:SepStrategyWebhook,event:Parameters<typeof postSepStrategyEvent>[2],issuedAt:number){
  const signal=seat.webhookAbort!.signal;
  const delivered=await postSepStrategyEvent(sepCallbackTransport(this.env,this.outbound.bind(this)),subscription,event,issuedAt,signal);
  const room=this.room!;
  if(signal.aborted||seat.sepWebhook!==subscription||room.live!=='running'||this.strategyDeliveries[team]!==event.event_id)return;
  this.setWebhookStatus(team,delivered?'delivered':'failed');
  room.logStrategyDelivery(event,delivered);
  room.broadcast();
 }

 private async deliverStrategy(team:Team,seat:StrategySeat,subscription:StrategyWebhook,event:Parameters<typeof postStrategyEvent>[2]){
  const room=this.room!,signal=seat.webhookAbort!.signal;
  const status=await postStrategyEvent(this.outbound.bind(this),subscription,event,signal);
  if(signal.aborted||seat.webhook!==subscription||room.live!=='running'||this.strategyDeliveries[team]!==event.event_id)return;
  this.setWebhookStatus(team,status==='delivered'?'delivered':'failed');
  room.logStrategyDelivery(event,status==='delivered');
  if(status==='delivered'){
   this.consecutiveWebhookFailures[team]=0;
  }else if(status==='gone'){
   seat.webhook=undefined;
   if(team==='b')room.releaseGuestStrategy();
   if(room.strategyPractice&&team==='a'&&this.peers.size===0&&!(this.strategySeats.b?.webhook&&this.strategySeats.b.webhook.expiresAt>Date.now())){
    this.finishLive('stopped');
   }
   await this.save();
  }else{
   const fails=(this.consecutiveWebhookFailures[team]??0)+1;
   this.consecutiveWebhookFailures[team]=fails;
   if(room.strategyPractice&&team==='a'&&this.peers.size===0&&fails>=STRATEGY_MAX_CONSECUTIVE_FAILURES){
    this.finishLive('stopped');
    await this.save();
   }
  }
  room.broadcast();
 }

 private async changeStrategySubscription(req:Request,subscribing:boolean){
  const parsed=(subscribing?subscribeInput:unsubscribeInput).safeParse(await req.json());
  const room=this.room,filter=parsed.data?.arguments;
  const team=filter&&TEAMS.find(team=>!this.strategySeats[team]?.sep&&this.strategySeats[team]?.subscriptionKey===filter.subscription_key);
  const seat=team&&this.strategySeats[team];
  if(!parsed.success||!room?.live||!team||!seat||filter?.room!==room.id){
   return json({error:{code:-32024,message:'This race event filter is invalid or expired.'}});
  }
  const url=new URL(parsed.data.delivery.url).href;
  if(!subscribing){
   if(seat.webhookVerification?.url===url)seat.webhookVerification=undefined;
   if(seat.webhook?.url===url){
    seat.webhookAbort?.abort();
    seat.webhook=undefined;
    if(team==='b')room.releaseGuestStrategy();
    else this.setWebhookStatus(team,'waiting');
    await this.save();
    room.broadcast();
   }
   return json({result:{}});
  }
  const input=subscribeInput.parse(parsed.data);
  if(room.live!=='running'||Date.now()>=this.liveDeadline)return json({error:{code:-32024,message:'This race has ended.'}});
  const current=seat.webhook;
  if(seat.webhookVerification||(current&&current.expiresAt>Date.now()&&current.url!==url)){
   return json({error:{code:-32025,message:'This race already has a strategy subscription.'}});
  }
  const verification=seat.webhookVerification={url};
  try{
   const expiresAt=Math.min(this.liveDeadline,Date.now()+(input.ttlMs??strategyTimeBudgetMs(room.race.laps)));
   const refreshing=current?.url===url&&current.secret===input.delivery.secret&&current.expiresAt>Date.now();
   const subscription=refreshing?current:{id:await webhookId(room.id,url,team),url,secret:input.delivery.secret,expiresAt};
   if(!refreshing){
    const failure=await verifyStrategyWebhook(this.outbound.bind(this),subscription);
    if(failure)return json({error:{code:-32015,message:'The ChatGPT webhook did not verify.',data:{reason:failure}}});
   }
   if(room.live!=='running'||Date.now()>=expiresAt||seat.webhookVerification!==verification){
    return json({error:{code:-32024,message:'This subscription has ended.'}});
   }
   if(!refreshing){
    seat.webhookAbort?.abort();
    seat.webhookAbort=new AbortController();
   }
   subscription.expiresAt=expiresAt;
   seat.webhook=subscription;
   this.activateStrategySeat(team,seat);
   await this.save();
   if(room.live==='running'&&seat.webhook===subscription){
    if(!refreshing)this.setWebhookStatus(team,'connected');
    room.broadcast();
   }
   return json({result:{id:subscription.id,refreshBefore:new Date(expiresAt).toISOString(),cursor:null,truncated:false}});
  }finally{
   if(seat.webhookVerification===verification)seat.webhookVerification=undefined;
  }
 }

 private scopeStrategyInput<T extends {team?:Team;event_id?:string}>(req:Request,url:URL,input:T):T|null{
  const sep=Boolean(this.strategySeats.a?.sep);
  if(sep!==(url.searchParams.get('sep')==='1'))return null;
  if(!sep)return input;
  if(!sepRequestAuthorized(req,this.env)||(input.team&&!this.strategySeats[input.team]?.sep))return null;
  const eventId=input.event_id;
  if(!eventId)return input;
  const team=TEAMS.find(team=>this.strategySeats[team]?.sep&&this.room?.strategyFor(team)?.has(eventId));
  if(!team||(input.team&&input.team!==team))return null;
  return {...input,team};
 }

 private async changeSepSubscription(req:Request,subscribing:boolean){
  const input=await req.json<SepSubscribe|SepUnsubscribe>();
  if(!sepRequestAuthorized(req,this.env))return json({error:{code:-32024,message:SEP_AUTH_REQUIRED}});
  const room=this.room,team=input.arguments.team;
  const seat=this.strategySeats[team];
  const forbidden=()=>json({error:{code:-32024,message:'This SEP race seat is unavailable.'}});
  if(!room||!seat?.sep||input.arguments.room!==room.id)return forbidden();
  const url=new URL(input.delivery.url).href;
  const previousChange=seat.sepChange;
  let release!:()=>void;
  const change=seat.sepChange=new Promise<void>(resolve=>{release=resolve;});
  try{
   await previousChange;
   if(this.room!==room)return forbidden();
   const current=seat.sepWebhook;
   const active=current&&current.expiresAt>Date.now()?current:undefined;
   if(!subscribing){
    if(active?.url!==url)return json({error:{code:-32023,message:'Subscription not found.',data:{kind:'subscription'}}});
    seat.webhookAbort?.abort();
    seat.sepWebhook=undefined;
    if(team==='b')room.releaseGuestStrategy();
    else this.setWebhookStatus(team,'waiting');
    await this.save();
    room.broadcast();
    return json({result:{}});
   }
   if(room.live!=='running'||Date.now()>=this.liveDeadline)return forbidden();
   if(active&&active.url!==url)return json({error:{code:-32025,message:'This seat already has a subscription.',data:{limit:'subscriptions',max:1}}});
   const {delivery:{secret},ttlMs}=input as SepSubscribe;
   const id=active?.id??await subscriptionId([SEP_EVENTS_PRINCIPAL,url,STRATEGY_EVENT,{room:room.id,team}]);
   const subscription={id,url,secret,expiresAt:this.liveDeadline};
   const verificationKey=await subscriptionId([SEP_EVENTS_PRINCIPAL,url]);
   const verified=await roomStub(this.env,`sep-verification:${verificationKey}`).fetch(new Request(new URL('/internal-sep-verify',req.url),{
    method:'POST',headers:{Authorization:req.headers.get('Authorization')!},body:JSON.stringify(subscription),
   }));
   const verification=await verified.json<SepVerificationReply>();
   if('error' in verification)return json(verification);
   if(verification.failure)return json({error:{code:-32027,message:'The callback endpoint did not verify.',data:{reason:verification.failure}}});
   const now=Date.now();
   if(this.room!==room||room.live!=='running'||now>=this.liveDeadline||this.strategySeats[team]!==seat)return forbidden();
   const expiresAt=subscription.expiresAt=Math.min(this.liveDeadline,now+(ttlMs??strategyTimeBudgetMs(room.race.laps)));
   if(active&&seat.sepWebhook===active&&active.expiresAt>Date.now()){
    if(active.secret!==secret)active.previousSecret={value:active.secret,expiresAt:Date.now()+60_000};
    else if(active.previousSecret&&active.previousSecret.expiresAt<=Date.now())delete active.previousSecret;
    active.secret=secret;
    active.expiresAt=expiresAt;
   }else{
    seat.webhookAbort?.abort();
    seat.webhookAbort=new AbortController();
    seat.sepWebhook=subscription;
   }
   this.activateStrategySeat(team,seat);
   await this.save();
   if(room.live==='running'&&seat.sepWebhook){
    if(!active)this.setWebhookStatus(team,'connected');
    room.broadcast();
   }
   return json({result:{id,refreshBefore:new Date(expiresAt).toISOString(),cursor:null,truncated:false}});
  }finally{
   release();
   if(seat.sepChange===change)delete seat.sepChange;
  }
 }

 private async verifySepCallback(req:Request){
  if(!sepRequestAuthorized(req,this.env))return json({error:{code:-32024,message:SEP_AUTH_REQUIRED}});
  const subscription=await req.json<SepStrategyWebhook>();
  if(this.sepVerifiedUntil>Date.now())return json({failure:null});
  // This object is addressed by principal and callback URL, so rooms share verification.
  this.sepVerification??=this.checkSepCallback(subscription);
  const checking=this.sepVerification;
  try{return json(await checking);}
  finally{if(this.sepVerification===checking)this.sepVerification=undefined;}
 }

 private async checkSepCallback(subscription:SepStrategyWebhook):Promise<SepVerificationReply>{
  const limiter=this.env.MCP_ROOM_CREATION??this.env.ROOM_CREATION;
  const hostname=new URL(subscription.url).hostname.replace(/\.$/,'');
  if(!(await limiter.limit({key:`sep-verify:${hostname}`})).success){
   return {error:{code:-32025,message:'The callback verification limit was reached.',data:{limit:'callback_verifications'}}};
  }
  const failure=await verifyStrategyWebhook(sepCallbackTransport(this.env,this.outbound.bind(this)),subscription,true);
  if(!failure)this.sepVerifiedUntil=Date.now()+5*60_000;
  return {failure};
 }

 private async internal(req:Request,url:URL){
  const path=url.pathname;
  if(path==='/internal-sep-verify'&&req.method==='POST')return this.verifySepCallback(req);
  if(path==='/internal-chat-practice'&&req.method==='POST')return this.startChatPractice(url);
  if(path==='/internal-start'&&req.method==='POST')return this.startLive(req,url);
  if(path==='/internal-pair'&&req.method==='POST'){
   const {challenge,chat}=await req.json() as {challenge:unknown;chat?:boolean};
   if(this.room||!isLiveKey(challenge))return json({error:'Pairing unavailable'},409);
   if(this.paired())return this.paired(challenge)?json({paired:true}):json({error:'Pairing unavailable'},409);
   this.pairing={challenge,chat:chat===true,expiresAt:Date.now()+PAIR_TTL_MS};
   return json({paired:true});
  }
  if(path==='/internal-claim'&&req.method==='POST'){
   if(!this.paired(await req.text()))return json({error:'Pairing expired'},410);
   if(!this.room?.live)return json({pending:true},202);
   const seat=this.strategySeats.a;
   return json({...this.controls(),...(this.room.live==='running'&&!seat?.sep&&seat?.subscriptionKey?{
    strategyKey:seat.key,eventFilter:{room:this.room.id,subscription_key:seat.subscriptionKey},
   }:{})});
  }
  const room=this.room;
  if(path==='/internal-strategy-subscribe'||path==='/internal-strategy-unsubscribe'){
   return this.changeStrategySubscription(req,path.endsWith('-subscribe'));
  }
  if(req.method==='POST'&&(path==='/internal-sep-subscribe'||path==='/internal-sep-unsubscribe')){
   return this.changeSepSubscription(req,path.endsWith('-subscribe'));
  }
  if(path==='/internal-live'){
   if(room?.live&&room.expiresAt>Date.now())return json(this.controls());
   return this.paired()?json({challenge:this.pairing!.challenge,chat:this.pairing!.chat}):json({error:'Pairing expired'},410);
  }
  if(!room&&path==='/internal-create'&&req.method==='POST'){
   const id=url.searchParams.get('room'),matchup=url.searchParams.get('matchup'),circuit=url.searchParams.get('circuit');
   if(this.paired()||!isRoomId(id)||!isCircuit(circuit)||!isMatchup(matchup))return json({error:'Invalid room'},400);
   const lapsParam=Number(url.searchParams.get('laps'));const laps=Number.isFinite(lapsParam)&&lapsParam>=1&&lapsParam<=20?Math.round(lapsParam):3;this.room=new RaceRoom(id,url.origin,{JEV_MOCK:'1'},url.searchParams.get('clock')==='1'?1:4,matchup,{},circuit,url.searchParams.get('solo')==='true',laps,url.searchParams.get('drive')==='true',url.searchParams.get('watch')==='true');
   this.room.expiresAt=Date.now()+15*60_000;
   await this.ctx.storage.setAlarm(this.room.expiresAt);
   await this.save();
  }
  const current=this.room;
  if(!current||current.expiresAt<=Date.now())return json({error:'Race expired'},404);
  if(current.live){
   const matchingStrategyEndpoint=Boolean(this.strategySeats.a?.sep)===(url.searchParams.get('sep')==='1');
   if(path==='/internal-chat-seat'&&req.method==='POST'){
    const {key,driver}=await req.json() as {key:unknown;driver?:unknown};
    if(!matchingStrategyEndpoint||!current.strategyPractice||current.live!=='running'||!this.guestInviteKey||key!==this.guestInviteKey)return json({error:'Invalid strategy invitation'},403);
    const seat=this.strategySeats.b;
    if(!(seat?.sep||seat?.subscriptionKey)){
     if(current.strategyFor('b')||seat?.webhookVerification)return json({error:'Mercedes already uses a different connection'},409);
     this.strategySeats.b=this.newStrategySeat(this.strategySeats.a?.sep);
    }
    const nextDriver=driver==='human'?'human':'autopilot';
    current.driverMode.b=nextDriver;
    current.strategyDriverKeys={...current.strategyDriverKeys,b:this.strategySeats.b!.key};
    await this.save();
    return json({...this.controls(),...this.strategySeatAccess('b'),circuit:current.race.circuit});
   }
   if(path==='/internal-strategy-event'&&req.method==='POST'){
    const parsed=eventInput.safeParse(await req.json());
    const input=parsed.success&&parsed.data.room===current.id?this.scopeStrategyInput(req,url,parsed.data):null;
    const event=input?current.readLiveStrategyEvent(input.event_id,input.team):null;
    return event?json(event):json({error:'This race is no longer active.'},410);
   }
   if(path==='/internal-strategy-radio'&&req.method==='POST'){
    const parsed=radioInput.safeParse(await req.json());
    if(!parsed.success)return json({error:'Invalid strategy order.'},400);
    const input=this.scopeStrategyInput(req,url,parsed.data);
    if(!input)return json({error:'This credential does not authorize the race seat.'},403);
    const result=current.submitStrategyEvent(input);
    if('line' in result&&result.team){this.lastStrategyRadioAt=Date.now();this.consecutiveWebhookFailures[result.team]=0;await this.save();}
    return json(result);
   }
   if(path==='/internal-watch'&&req.method==='POST'&&await req.text()===current.viewerKey)return json(current.state());
   if(path==='/internal-chat-practice-configure'&&req.method==='POST'){
    const {key,circuit,laps:lapsRaw,driver:driverRaw}=await req.json() as {key:unknown;circuit:unknown;laps?:unknown;driver?:unknown};
    if(!matchingStrategyEndpoint||!current.strategyPractice||current.live!=='running'||current.race.phase!=='lobby'||!this.strategySeats.a||key!==this.strategySeats.a.key){
     return json({error:'Strategy lobby unavailable'},409);
    }
    if(!isCircuit(circuit))return json({error:'Invalid circuit'},400);
    const lapsParam=Number(lapsRaw);
    const laps=Number.isFinite(lapsParam)&&lapsParam>=3&&lapsParam<=CHAT_STRATEGY_MAX_LAPS?Math.round(lapsParam):CHAT_STRATEGY_LAPS;
    const driver=driverRaw==='human'?'human':'autopilot';
    if(!current.configureStrategyLobby(circuit,laps,driver))return json({error:'Strategy lobby unavailable'},409);
    const now=Date.now();
    this.liveDeadline=Math.max(this.liveDeadline,now+strategyTimeBudgetMs(current.race.laps));
    current.expiresAt=this.liveDeadline+FINISHED_GRACE_MS;
    await this.ctx.storage.setAlarm(this.lobbyDeadline?Math.min(this.liveDeadline,this.lobbyDeadline):this.liveDeadline);
    await this.save();
    return json({...this.controls(),...this.strategySeatAccess('a'),circuit:current.race.circuit});
   }
   if(path==='/internal-chat-practice-stop'&&req.method==='POST'){
    if(!matchingStrategyEndpoint||!current.strategyPractice||!this.strategySeats.a||await req.text()!==this.strategySeats.a.key)return json({error:'Strategy controller required'},403);
    this.finishLive('stopped');
    await this.save();
    return json({stopped:true});
   }
   if(path==='/internal-stop'&&req.method==='POST'){
    this.finishLive('stopped');
    await this.save();
    return json(this.controls());
   }
  }else if(path==='/internal-data'||path==='/internal-create'){
   return json({links:current.links(),mcpToken:current.mcpToken,state:current.state()});
  }
  return json({error:'Not found'},404);
 }

 async fetch(req:Request){
  const url=new URL(req.url);
  if(url.pathname.startsWith('/internal-'))return this.internal(req,url);
  const room=this.room;
  if(!room||Date.now()>=room.expiresAt){
   if(room)await this.expireNow();
   return expiredResponse();
  }
  if(url.pathname.endsWith('/ws')&&req.headers.get('Upgrade')?.toLowerCase()==='websocket'){
   // Private viewers authenticate in the first frame. The capability never enters the upgrade URL.
   if(!room.live&&req.headers.get('Origin')!==url.origin&&url.searchParams.get('mcp_token')!==room.mcpToken)return json({error:'Invalid origin capability'},403);
   const pair=new WebSocketPair();
   this.ctx.acceptWebSocket(pair[1]);
   this.attach(pair[1]);
   pair[1].serializeAttachment({team:null,owner:false,joined:false});
   return new Response(null,{status:101,webSocket:pair[0]});
  }
  if(room.live)return json({error:'Not found'},404);
  if(url.pathname.endsWith('/info'))return json({room:room.id,expiresAt:room.expiresAt});
  if(url.pathname.endsWith('/status'))return json(room.state());
  if(url.pathname.endsWith('/links'))return req.headers.get('Authorization')===`Bearer ${room.tokens.owner}`?json(room.links()):json({error:'Owner required'},403);
  return json({error:'Not found'},404);
 }

 async webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer){
  const peer=this.peers.get(ws),room=this.room;
  if(!peer||!room||typeof raw!=='string'||raw.length>4096){ws.close(1008,'Invalid payload');return;}
  try{
   const message=JSON.parse(raw) as ClientMessage;
   const validStrategyDriver=room.strategyPractice&&message.type==='join'&&(message.team==='a'||message.team==='b')&&message.token===this.strategySeats[message.team]?.key;
   if(room.live&&!peer.joined&&(message.type!=='join'||(message.token!==room.viewerKey&&!validStrategyDriver))){
    ws.close(1008,'Invalid live invitation');return;
   }
   if(room.live&&message.type==='start'){
    const host=this.strategySeats.a;
    if(peer.joined&&host&&(strategyWebhook(host)?.expiresAt??0)>Date.now()&&message.startKey===host.key&&Date.now()<this.liveDeadline&&room.start()){
     const now=Date.now();
     this.lobbyDeadline=0;
     this.lastStrategyRadioAt=now;
     this.emptyViewersSince=null;
     this.liveDeadline=now+(room.strategyPractice?strategyTimeBudgetMs(room.race.laps):LIVE_TIME_MS);
     room.expiresAt=this.liveDeadline+FINISHED_GRACE_MS;
     await this.ctx.storage.setAlarm(this.liveDeadline);
     await this.save();
     this.activate(true);
    }
    return;
   }
   await room.message(peer,message);
   if(message.type==='join')ws.serializeAttachment({team:peer.team,role:peer.role,owner:peer.owner,joined:peer.joined});
   if((!room.live&&(message.type==='circuit'||message.type==='matchup'||message.type==='reset'||message.type==='start'||message.type==='driver-mode'||message.type==='engineer-mode'))||(room.strategyPractice&&message.type==='driver-mode'))await this.save();
   this.activate();
  }catch{ws.send(JSON.stringify({type:'error',message:'Invalid request'}));}
 }

 webSocketClose(ws:WebSocket){
  const peer=this.peers.get(ws);
  if(peer)this.room?.remove(peer);
  this.peers.delete(ws);
  const room=this.room;
  if(!room)return;
  const wasRunning=Boolean(this.timer);
  if(!room.live&&this.peers.size===0)this.stopClock();
  if(wasRunning||(room.race.phase!=='lobby'&&room.race.phase!=='finished'))this.ctx.waitUntil(this.save());
 }
 webSocketError(ws:WebSocket){this.webSocketClose(ws);}

 async alarm(){
  const room=this.room;
  if(!room){
   await this.expireNow();
   return;
  }
  const now=Date.now();
  if(room.race.phase==='lobby'&&this.lobbyDeadline&&now>=this.lobbyDeadline){
   await this.expireNow();
   return;
  }
  if(now<room.expiresAt){
   if(room.live==='running'&&now>=this.liveDeadline){
    this.finishLive('time-limit');
    await this.save();
   }
   await this.ctx.storage.setAlarm(room.expiresAt);
   return;
  }
  await this.expireNow();
 }
}
