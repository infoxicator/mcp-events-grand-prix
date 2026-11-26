import {benchmarkNames,runLiveStrategy,strategyModels,type BenchmarkName} from './strategy-benchmarks';
import {isCircuit,type CircuitId} from '../src/race/track';
import {CHAT_STRATEGY_LAPS,CHAT_STRATEGY_MAX_LAPS,newLiveKey,ROOM_EXPIRED_CLOSE_CODE,strategyTimeBudgetMs} from '../src/race/live';
import {createServer,type IncomingMessage} from 'node:http';
import {ReplayBenchmark,isReplayAuthorization,type ReplayStrategyEvent,type StartReplayInput} from './replay-benchmark';
import {isArchiveReplay,replayCatalog,type ReplayRace,type ReplayTiming} from '../src/race/replay';
import {archivedTiming,archiveRequest,serveArchive} from './replay-archive';
import {strategyEventDefinition} from './strategy-events';
import {postStrategyEvent,subscribeInput,unsubscribeInput,verifyStrategyWebhook,webhookId,type StrategyWebhook} from '../worker/strategy-webhook';
import {WEBHOOK_STRATEGY_RESPONSE_MS} from '../src/race/strategy-events';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {config as loadEnv} from 'dotenv';
import {WebSocketServer,WebSocket} from 'ws';
import {NodeStreamableHTTPServerTransport,toNodeHandler,toWebRequest} from '@modelcontextprotocol/node';
import {createMcpHandler,isLegacyRequest} from '@modelcontextprotocol/server';
import {isMatchup,type Matchup} from '../src/race/matchup';
import {RaceRoom} from './race-room';
import {createRaceMcp,type RaceGateway,type StrategyDriver} from './race-mcp';
import type {ClientMessage} from '../src/race/types';
loadEnv({path:'.env.local',quiet:true});
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22+ is required.');
const port=Number(process.env.PORT??5277),origin=`http://127.0.0.1:${port}`,speed=Math.max(.25,Math.min(24,Number(process.env.RACE_SPEED??4))),production=process.argv.includes('--production');
const initialMatchup=process.env.RACE_MATCHUP??'jev-vs-jev';if(!isMatchup(initialMatchup))throw new Error('RACE_MATCHUP must be jev-vs-jev or jev-vs-luna');
const initialCircuit=process.env.RACE_CIRCUIT??'monza';if(!isCircuit(initialCircuit))throw new Error('RACE_CIRCUIT must be monza or las-vegas');
const rooms=new Map<string,RaceRoom>();
type LocalSeat={key:string;subscriptionKey:string;subscription?:StrategyWebhook;disconnect?:()=>void;verification?:symbol};
type LocalStrategyRoom={room:RaceRoom;guestInviteKey:string;seats:Partial<Record<'a'|'b',LocalSeat>>};
const strategyRooms=new Map<string,LocalStrategyRoom>();
async function changeLiveSubscription(input:ReturnType<typeof subscribeInput.parse>|ReturnType<typeof unsubscribeInput.parse>){
 const entry=strategyRooms.get(input.arguments.room);
 const team=(['a','b'] as const).find(team=>entry?.seats[team]?.subscriptionKey===input.arguments.subscription_key);
 const seat=team&&entry?.seats[team];
 if(!entry||!team||!seat||entry.room.live!=='running'||entry.room.expiresAt<=Date.now())return {error:{code:-32024,message:'This strategy seat is invalid or expired.'}};
 const room=entry.room;
 const url=input.delivery.url;
 const statusKey=team==='a'?'strategyWebhook':'guestStrategyWebhook';
 if(!('secret' in input.delivery)){
  if(seat.subscription?.url===url){
   seat.disconnect?.();
   delete seat.subscription;
   room[statusKey]='waiting';
   room.broadcast();
  }
  delete seat.verification;
  return {result:{}};
 }
 const ttlMs='ttlMs' in input?input.ttlMs:undefined;
 const expiresAt=Math.min(room.expiresAt,Date.now()+(ttlMs??strategyTimeBudgetMs(room.race.laps)));
 const current=seat.subscription;
 const active=current&&current.expiresAt>Date.now();
 if(seat.verification||(active&&current.url!==url))return {error:{code:-32025,message:'This seat already has a subscription.'}};
 if(active&&current.secret===input.delivery.secret)current.expiresAt=expiresAt;
 else{
  const verifying=seat.verification=Symbol();
  try{
   const subscription={id:await webhookId(room.id,url,team),url,secret:input.delivery.secret,expiresAt};
   if(await verifyStrategyWebhook(fetch,subscription))return {error:{code:-32015,message:'The callback endpoint did not verify.'}};
   if(seat.verification!==verifying||room.live!=='running'||Date.now()>=expiresAt)return {error:{code:-32024,message:'This subscription has ended.'}};
   seat.disconnect?.();
   seat.subscription=subscription;
   const abort=new AbortController();
   const stop=room.strategyFor(team)!.subscribe(event=>{
    void postStrategyEvent(fetch,subscription,event,abort.signal).then(status=>{
     if(abort.signal.aborted||room.live!=='running')return;
     room[statusKey]=status==='delivered'?'delivered':'failed';
     room.logStrategyDelivery(event,status==='delivered');
     room.broadcast();
    });
   });
   seat.disconnect=()=>{stop();abort.abort();};
   room[statusKey]='connected';
   room.broadcast();
  }finally{if(seat.verification===verifying)delete seat.verification;}
 }
 return {result:{id:seat.subscription!.id,refreshBefore:new Date(expiresAt).toISOString(),cursor:null,truncated:false}};
}
function create(mock=false,matchup:Matchup=initialMatchup as Matchup,circuit:CircuitId=initialCircuit as CircuitId,clock=speed,solo=false,laps=3,drive=false,watchMode=false){const r=new RaceRoom(crypto.randomUUID(),origin,mock?{JEV_MOCK:'1'}:process.env,clock,solo?'jev-vs-jev':matchup,{},circuit,solo,laps,drive,watchMode);rooms.set(r.id,r);return r;}
const defaultRoom=create();
const data=(r:RaceRoom)=>({links:r.links(),mcpToken:r.mcpToken,state:r.state()});
const replays=new Map<string,ReplayBenchmark>();
const replayAsset=async <T>(name:string)=>JSON.parse(await readFile(resolve(production?'dist':'public','replays',name+'.json'),'utf8')) as T;
const replayRequest=(id:string,path:string,body:unknown,headers?:HeadersInit)=>replays.get(id)?.handle(
 new Request(origin+'/internal-'+path,{method:'POST',headers,body:JSON.stringify(body)}),
);
async function startReplay(input:StartReplayInput){
 for(const [id,replay] of replays)if(replay.expired)replays.delete(id);
 const race=await (isArchiveReplay(input.race)?archivedTiming(input.race):replayAsset<ReplayTiming>(input.race)).catch(()=>null);
 if(replays.size>=100)throw new Error('Replay benchmark limit reached.');
 if(!race)throw new Error('This historical race is unavailable.');
 const room=crypto.randomUUID();
 const replay=ReplayBenchmark.create(room,input,race,false,{save:async()=>{},defer:promise=>void promise.catch(()=>{}),outbound:fetch});
 replays.set(room,replay);
 return replay.access(origin);
}
async function readMcpBody(req:IncomingMessage){
 const chunks:Buffer[]=[];
 let length=0;
 for await(const part of req){
  const bytes=Buffer.isBuffer(part)?part:Buffer.from(part);
  length+=bytes.length;
  if(length>1024*1024)throw new Error('MCP request is too large.');
  chunks.push(bytes);
 }
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const gateway:RaceGateway={
 replayCatalog:async()=>replayCatalog(await replayAsset<ReplayRace[]>('index'),await replayAsset<ReplayRace[]>('archive').catch(()=>[])),
 startReplay,
 create:async (matchup,circuit,solo)=>data(create(true,matchup,circuit,speed,solo)),
 get:async id=>{const r=rooms.get(id);return r&&r.expiresAt>Date.now()?data(r):null;},
 watchLive:async invite=>{const r=rooms.get(invite.room);return r&&r.live&&r.viewerKey===invite.key&&r.expiresAt>Date.now()?r.state():null;},
 startChatPractice:async (circuit,lapsInput=CHAT_STRATEGY_LAPS,driver:StrategyDriver='autopilot')=>{
  const laps=Number.isFinite(lapsInput)&&lapsInput>=3&&lapsInput<=CHAT_STRATEGY_MAX_LAPS?Math.round(lapsInput):CHAT_STRATEGY_LAPS;
  const id=crypto.randomUUID();
  const r=new RaceRoom(id,origin,{JEV_MOCK:'1'},1,'jev-vs-jev',{},circuit,true,laps,driver==='human');
  const seatA={key:newLiveKey(),subscriptionKey:newLiveKey()};
  const guestInviteKey=newLiveKey();
  r.strategyPractice=true;
  r.live='running';
  r.viewerKey=newLiveKey();
  r.driverMode={a:driver,b:'autopilot'};
  r.strategyDriverKeys={a:seatA.key};
  r.enableChatStrategy(WEBHOOK_STRATEGY_RESPONSE_MS,'a');
  r.strategyWebhook='connected';
  r.expiresAt=Date.now()+strategyTimeBudgetMs(laps);
  rooms.set(id,r);
  strategyRooms.set(id,{room:r,guestInviteKey,seats:{a:seatA}});
  return {room:id,key:r.viewerKey,phase:'running',strategyKey:seatA.key,subscriptionKey:seatA.subscriptionKey,guestInviteKey,laps,driver};
 },
 configureChatPractice:async (room,key,circuit,lapsInput=CHAT_STRATEGY_LAPS,driver:StrategyDriver='autopilot')=>{
  const entry=strategyRooms.get(room);
  if(!entry||entry.room.expiresAt<=Date.now()||entry.room.live!=='running'||entry.room.race.phase!=='lobby'||entry.seats.a?.key!==key)return null;
  const laps=Number.isFinite(lapsInput)&&lapsInput>=3&&lapsInput<=CHAT_STRATEGY_MAX_LAPS?Math.round(lapsInput):CHAT_STRATEGY_LAPS;
  const r=entry.room;
  if(!r.configureStrategyLobby(circuit,laps,driver))return null;
  r.expiresAt=Math.max(r.expiresAt,Date.now()+strategyTimeBudgetMs(laps));
  const seatA=entry.seats.a;
  return {room:r.id,key:r.viewerKey!,phase:'running',strategyKey:seatA.key,subscriptionKey:seatA.subscriptionKey,guestInviteKey:entry.guestInviteKey,circuit:r.race.circuit,laps:r.race.laps,driver};
 },
 joinChatPractice:async (invite,driver:StrategyDriver='autopilot')=>{
  const entry=strategyRooms.get(invite.room);
  if(!entry||entry.room.expiresAt<=Date.now()||entry.room.live!=='running'||entry.guestInviteKey!==invite.key)return null;
  const r=entry.room;
  entry.seats.b??={key:newLiveKey(),subscriptionKey:newLiveKey()};
  r.enableChatStrategy(WEBHOOK_STRATEGY_RESPONSE_MS,'b');
  r.guestStrategyWebhook='connected';
  r.driverMode.b=driver;
  r.strategyDriverKeys={...r.strategyDriverKeys,b:entry.seats.b.key};
  r.broadcast();
  return {room:r.id,key:r.viewerKey!,phase:'running',strategyKey:entry.seats.b.key,subscriptionKey:entry.seats.b.subscriptionKey,circuit:r.race.circuit,laps:r.race.laps,driver};
 },
 stopChatPractice:async (room,key)=>{
  const entry=strategyRooms.get(room);
  if(!entry||entry.seats.a?.key!==key)return false;
  for(const seat of Object.values(entry.seats))seat.disconnect?.();
  entry.room.finishLive('stopped');
  return true;
 },
 strategyEvent:async (room,eventId,team)=>{
  const replay=await replayRequest(room,'strategy-event',{room,event_id:eventId,team});
  if(replay)return replay.ok?await replay.json() as ReplayStrategyEvent:null;
  const r=rooms.get(room);
  return r&&r.live&&r.expiresAt>Date.now()?r.readLiveStrategyEvent(eventId,team)??null:null;
 },
 submitStrategy:async input=>{
  const replay=await replayRequest(input.room,'strategy-radio',input);
  if(replay)return replay.json();
  const r=rooms.get(input.room);
  if(!r||!r.live||r.expiresAt<=Date.now())return {error:'Race not found or expired.'};
  return r.submitStrategyEvent(input);
 },
 driverQuestion:async (room,eventId,team)=>{
  const r=rooms.get(room);
  const event=r&&r.expiresAt>Date.now()?r.readDriverQuestion(eventId,team):undefined;
  return r&&event?{team:event.team,question:event.driverQuestion.text,elicitationKey:r.elicitationKey}:null;
 },
 answerDriver:async input=>{
  const r=rooms.get(input.room);
  return r&&r.expiresAt>Date.now()?r.answerDriver(input):{error:'Race not found or expired.'};
 },
 html:()=>readFile(resolve('dist/mcp/mcp-app.html'),'utf8'),
};
const modernMcp=createMcpHandler(()=>createRaceMcp(origin,gateway),{legacy:'reject'});
const handleModernMcp=toNodeHandler({
 async fetch(request,options){
  const response=await modernMcp.fetch(request,options);
  const body=options?.parsedBody as {method?:string}|undefined;
  if(!response.ok||body?.method!=='server/discover')return response;
  const discovery=await response.json() as {result?:{capabilities?:Record<string,unknown>}};
  if(discovery.result?.capabilities)discovery.result.capabilities.events={};
  const headers=new Headers(response.headers);
  headers.delete('Content-Length');
  return Response.json(discovery,{status:response.status,headers});
 },
});
const vite=production?null:await(await import('vite')).createServer({server:{middlewareMode:true,hmr:{port:port+1000,host:'127.0.0.1'}},appType:'spa'});
let benchmarkRunning=false;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url??'/',origin),path=url.pathname;const json=(v:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(v));};
 if(path==='/mcp'){
  if(![new URL(origin).host,`localhost:${port}`].includes(req.headers.host??'')){json({error:'Invalid Host'},403);return;}
  const o=req.headers.origin;if(o){try{const u=new URL(o);if(u.protocol!=='http:'||!['localhost','127.0.0.1'].includes(u.hostname))throw new Error();}catch{json({error:'Invalid MCP origin'},403);return;}res.setHeader('Access-Control-Allow-Origin',o);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, MCP-Protocol-Version, MCP-Session-Id, Mcp-Method, Mcp-Name, Last-Event-ID');res.setHeader('Access-Control-Allow-Methods','POST, GET, DELETE, OPTIONS');}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  let body;
  if(req.method==='POST'){
   try{body=await readMcpBody(req);}
   catch{json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid MCP request body.'}},400);return;}
   if(body?.jsonrpc==='2.0'&&['events/list','events/subscribe','events/unsubscribe'].includes(body.method)){
    const id=body.id;
    if(typeof id!=='string'&&typeof id!=='number'){
     json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'An event request needs an ID.'}},400);return;
    }
    if(body.method==='events/list'){
     json({jsonrpc:'2.0',id,result:{events:[strategyEventDefinition]}});return;
    }
    const subscribing=body.method==='events/subscribe';
    const input=(subscribing?subscribeInput:unsubscribeInput).safeParse(body.params);
    if(!input.success){
     json({jsonrpc:'2.0',id,error:{code:-32602,message:'Use the strategy event filter and a ChatGPT MCP Events webhook.'}});return;
    }
    const result=await replayRequest(input.data.arguments.room,subscribing?'strategy-subscribe':'strategy-unsubscribe',input.data);
    json({jsonrpc:'2.0',id,...(result?.ok?await result.json():await changeLiveSubscription(input.data))});
    return;
   }
   const probe=await toWebRequest(req,body);
   if(!await isLegacyRequest(probe,body)){await handleModernMcp(req,res,body);return;}
  }
  const mcp=createRaceMcp(origin,gateway);
  const capabilities={tools:{},events:{}};
  mcp.server.registerCapabilities(capabilities);
  const transport=new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{void transport.close();void mcp.close();});
  try{await mcp.connect(transport);await transport.handleRequest(req,res,body);}
  catch{if(!res.headersSent)json({error:'MCP request failed'},500);}
  return;
 }
 if(path==='/health'){json({ok:true,game:'MCP Grand Prix',mode:defaultRoom.mode,matchup:defaultRoom.matchup,circuit:defaultRoom.race.circuit,players:defaultRoom.players,physicsHz:120,snapshotHz:30,speed,rooms:rooms.size,tick:defaultRoom.race.tick,connected:defaultRoom.connected(),drivers:Object.fromEntries(['a','b'].map(t=>{const team=t as 'a'|'b',d=defaultRoom.decisions[team];return [t,{...defaultRoom.driverStats[team],source:d?.source??null,api:d?.api,warning:d?.warning}];})),paidCalls:[...rooms.values()].reduce((n,r)=>n+r.paidCalls,0)});return;}
 if(path==='/api/config'){json({hosted:true,game:'grand-prix'});return;}
 if(path==='/api/strategy/models'&&req.method==='GET'){json(strategyModels(process.env));return;}
 if(path==='/api/strategy/live'&&req.method==='POST'){
  const host=req.headers.host??'';
  if(![new URL(origin).host,`localhost:${port}`].includes(host)||req.headers.origin!==`http://${host}`){
   json({error:'Live benchmarks require a same-origin local game.'},403);return;
  }
  const name=url.searchParams.get('benchmark') as BenchmarkName;
  if(!benchmarkNames.includes(name)){json({error:'Unknown benchmark.'},400);return;}
  const models=strategyModels(process.env);
  if(!(name==='corner'?models.jev:models.chatgpt)){json({error:'Configure a live provider for this benchmark.'},503);return;}
  if(benchmarkRunning){json({error:'A live benchmark is already in progress.'},409);return;}
  const abort=new AbortController();
  res.once('close',()=>abort.abort());
  benchmarkRunning=true;
  try{
   const result=await runLiveStrategy(name,process.env,abort.signal);
   if(!abort.signal.aborted)json(result);
  }catch{
   if(!abort.signal.aborted)json({error:'The model request failed or did not return a valid benchmark decision.'},502);
  }finally{benchmarkRunning=false;}
  return;
 }
 const archived=archiveRequest(path);
 if(archived&&req.method==='GET'){
  const response=await serveArchive(url,archived);
  res.writeHead(response.status,Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
  return;
 }
 const replayMatch=path.match(/^\/api\/replay-benchmarks\/([a-f0-9-]{36})\/(status|next)$/);
 if(replayMatch){
  const [,id,action]=replayMatch,authorization=req.headers.authorization??null;
  if(!isReplayAuthorization(authorization)||(action==='next'?(req.method!=='POST'||req.headers.origin!==`http://${req.headers.host}`):req.method!=='GET')){
   json({error:'Replay controller required.'},403);return;
  }
  const response=await replayRequest(id,'replay-'+action,undefined,{Authorization:authorization!});
  if(!response){json({error:'Replay benchmark expired.'},404);return;}
  json(await response.json(),response.status);
  return;
 }
 if(path==='/api/default'){json(defaultRoom.links());return;}
 if(path==='/api/rooms'&&req.method==='POST'){if(req.headers.origin!==`http://${req.headers.host}`){json({error:'Same-origin requests required'},403);return;}if(rooms.size>100){json({error:'Room limit reached'},429);return;}const circuit=url.searchParams.get('circuit')??initialCircuit;if(!isCircuit(circuit)){json({error:'Invalid circuit'},400);return;}const isDrive=url.searchParams.has('drive');const lapsParam=Number(url.searchParams.get('laps'));const laps=Number.isFinite(lapsParam)&&lapsParam>=1&&lapsParam<=20?Math.round(lapsParam):3;const isWatch=url.searchParams.has('watch');json(create(!isDrive,initialMatchup,circuit,isWatch||isDrive?1:speed,url.searchParams.has('solo')||(isDrive&&!url.searchParams.has('multiplayer')),laps,isDrive,isWatch&&!isDrive).links());return;}
 const match=path.match(/^\/api\/rooms\/([a-f0-9-]{36})\/(status|info|links)$/);
 if(match){const r=rooms.get(match[1]);if(!r||r.expiresAt<Date.now()){json({error:'Race expired'},404);return;}if(match[2]==='links'){if(req.headers.authorization!==`Bearer ${r.tokens.owner}`){json({error:'Owner credential required'},403);return;}json(r.links());}else json(match[2]==='status'?r.state():{room:r.id,expiresAt:r.expiresAt});return;}
 if(path.startsWith('/api/')){json({error:'Not found'},404);return;}
 const mcpAsset=path.startsWith('/mcp/assets/');
 if(mcpAsset){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cross-Origin-Resource-Policy','cross-origin');
 }
 if(vite&&!mcpAsset){vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});return;}
 try{const file=resolve('dist','.'+decodeURIComponent(path)),root=resolve('dist');if(file!==root&&!file.startsWith(root+'/'))throw new Error();const p=extname(file)?file:resolve(root,'index.html');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.woff':'font/woff','.wasm':'application/wasm','.json':'application/json'} as Record<string,string>)[extname(p)]??'application/octet-stream');res.end(await readFile(p));}catch{res.writeHead(404);res.end('Not found');}
});
const wss=new WebSocketServer({noServer:true,maxPayload:4096});
server.on('upgrade',(req,socket,head)=>{const u=new URL(req.url??'/',origin),match=u.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})\/ws$/),r=match?rooms.get(match[1]):null;if(!r||r.expiresAt<Date.now()||(!r.live&&req.headers.origin!==`http://${req.headers.host}`&&u.searchParams.get('mcp_token')!==r.mcpToken)){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>{
 const p=r.add((m,raw)=>{if(ws.readyState===WebSocket.OPEN)ws.send(raw??JSON.stringify(m));});let windowStart=Date.now(),messages=0;
 ws.on('message',raw=>{if(Date.now()-windowStart>1000){windowStart=Date.now();messages=0;}if(++messages>120){ws.close(1008,'Message limit');return;}try{const msg=JSON.parse(raw.toString()) as ClientMessage;const validStrategyDriver=r.strategyPractice&&msg.type==='join'&&(msg.team==='a'||msg.team==='b')&&msg.token===r.strategyDriverKeys?.[msg.team];if(r.live&&!p.joined&&(msg.type!=='join'||(msg.token!==r.viewerKey&&!validStrategyDriver))){ws.close(1008,'Invalid live invitation');return;}void r.message(p,msg).catch(()=>p.send({type:'error',message:'Invalid request'}));}catch{p.send({type:'error',message:'Invalid message'});}});
 ws.on('close',()=>r.remove(p));ws.on('error',()=>{});
 const heartbeat=setInterval(()=>{if(Date.now()>r.expiresAt){ws.close(ROOM_EXPIRED_CLOSE_CODE,'Room expired');}else if(Date.now()-p.lastSeen>35000){ws.close(1000,'Heartbeat lost');}},2000);ws.on('close',()=>clearInterval(heartbeat));
 });});
let previous=performance.now(),accumulator=0,realAccumulator=0,lastBroadcast=0;
const timer=setInterval(()=>{const now=performance.now();const dt=Math.min((now-previous)/1000,.25);accumulator+=dt*speed;realAccumulator+=dt;const realSteps=Math.floor(realAccumulator*120);realAccumulator-=realSteps/120;previous=now;const steps=Math.min(120,Math.floor(accumulator*120));accumulator-=steps/120;for(const [id,r] of rooms){if(Date.now()>r.expiresAt){for(const p of r.peers)p.send({type:'error',message:'Room expired'});rooms.delete(id);strategyRooms.delete(id);continue;}if(!r.live||r.live==='running')r.advance(r.speed===speed?steps:realSteps);}if(now-lastBroadcast>=1000/30){lastBroadcast=now;for(const r of rooms.values())if(r.peers.size)r.broadcast();}},4);
server.listen(port,'127.0.0.1',()=>console.log(`MCP GRAND PRIX · ${defaultRoom.race.circuit.toUpperCase()} · ${defaultRoom.matchup.toUpperCase()} · ${defaultRoom.mode.toUpperCase()} · ${speed}× race clock\n${origin}/?team=a\n${origin}/?spectate\n${origin}/?team=b\nMCP: ${origin}/mcp`));
async function shutdown(){clearInterval(timer);for(const ws of wss.clients)ws.terminate();wss.close();server.close();await vite?.close();process.exit(0);}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
