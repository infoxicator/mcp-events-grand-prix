import {benchmarkNames,runLiveStrategy,strategyModels,type BenchmarkName} from './strategy-benchmarks';
import {isCircuit,type CircuitId} from '../src/race/track';
import {ROOM_EXPIRED_CLOSE_CODE} from '../src/race/live';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {config as loadEnv} from 'dotenv';
import {WebSocketServer,WebSocket} from 'ws';
import {NodeStreamableHTTPServerTransport} from '@modelcontextprotocol/node';
import {isMatchup,type Matchup} from '../src/race/matchup';
import {RaceRoom} from './race-room';
import {createRaceMcp,type RaceGateway} from './race-mcp';
import type {ClientMessage} from '../src/race/types';
loadEnv({path:'.env.local',quiet:true});
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22+ is required.');
const port=Number(process.env.PORT??5277),origin=`http://127.0.0.1:${port}`,speed=Math.max(.25,Math.min(24,Number(process.env.RACE_SPEED??4))),production=process.argv.includes('--production');
const initialMatchup=process.env.RACE_MATCHUP??'jev-vs-jev';if(!isMatchup(initialMatchup))throw new Error('RACE_MATCHUP must be jev-vs-jev or jev-vs-luna');
const initialCircuit=process.env.RACE_CIRCUIT??'monza';if(!isCircuit(initialCircuit))throw new Error('RACE_CIRCUIT must be monza or las-vegas');
const rooms=new Map<string,RaceRoom>();
function create(mock=false,matchup:Matchup=initialMatchup as Matchup,circuit:CircuitId=initialCircuit as CircuitId,clock=speed,solo=false,laps=3,drive=false,watchMode=false){const r=new RaceRoom(crypto.randomUUID(),origin,mock?{JEV_MOCK:'1'}:process.env,clock,solo?'jev-vs-jev':matchup,{},circuit,solo,laps,drive,watchMode);rooms.set(r.id,r);return r;}
const defaultRoom=create();
const data=(r:RaceRoom)=>({links:r.links(),mcpToken:r.mcpToken,state:r.state()});
const gateway:RaceGateway={create:async (matchup,circuit,solo)=>data(create(true,matchup,circuit,speed,solo)),get:async id=>{const r=rooms.get(id);return r&&r.expiresAt>Date.now()?data(r):null;},html:()=>readFile(resolve('dist/mcp/mcp-app.html'),'utf8')};
const vite=production?null:await(await import('vite')).createServer({server:{middlewareMode:true,hmr:{port:port+1000,host:'127.0.0.1'}},appType:'spa'});
let benchmarkRunning=false;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url??'/',origin),path=url.pathname;const json=(v:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(v));};
 if(path==='/mcp'){
  if(![new URL(origin).host,`localhost:${port}`].includes(req.headers.host??'')){json({error:'Invalid Host'},403);return;}
  const o=req.headers.origin;if(o){try{const u=new URL(o);if(u.protocol!=='http:'||!['localhost','127.0.0.1'].includes(u.hostname))throw new Error();}catch{json({error:'Invalid MCP origin'},403);return;}res.setHeader('Access-Control-Allow-Origin',o);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID');res.setHeader('Access-Control-Allow-Methods','POST, GET, DELETE, OPTIONS');}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}const mcp=createRaceMcp(origin,gateway),transport=new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});res.on('close',()=>{void transport.close();void mcp.close();});try{await mcp.connect(transport);await transport.handleRequest(req,res);}catch{if(!res.headersSent)json({error:'MCP request failed'},500);}return;
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
server.on('upgrade',(req,socket,head)=>{const u=new URL(req.url??'/',origin),match=u.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})\/ws$/),r=match?rooms.get(match[1]):null;if(!r||r.expiresAt<Date.now()||(req.headers.origin!==`http://${req.headers.host}`&&u.searchParams.get('mcp_token')!==r.mcpToken)){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>{
 const p=r.add((m,raw)=>{if(ws.readyState===WebSocket.OPEN)ws.send(raw??JSON.stringify(m));});let windowStart=Date.now(),messages=0;
 ws.on('message',raw=>{if(Date.now()-windowStart>1000){windowStart=Date.now();messages=0;}if(++messages>120){ws.close(1008,'Message limit');return;}try{const msg=JSON.parse(raw.toString()) as ClientMessage;void r.message(p,msg).catch(()=>p.send({type:'error',message:'Invalid request'}));}catch{p.send({type:'error',message:'Invalid message'});}});
 ws.on('close',()=>r.remove(p));ws.on('error',()=>{});
 const heartbeat=setInterval(()=>{if(Date.now()>r.expiresAt){ws.close(ROOM_EXPIRED_CLOSE_CODE,'Room expired');}else if(Date.now()-p.lastSeen>35000){ws.close(1000,'Heartbeat lost');}},2000);ws.on('close',()=>clearInterval(heartbeat));
 });});
let previous=performance.now(),accumulator=0,realAccumulator=0,lastBroadcast=0;
const timer=setInterval(()=>{const now=performance.now();const dt=Math.min((now-previous)/1000,.25);accumulator+=dt*speed;realAccumulator+=dt;const realSteps=Math.floor(realAccumulator*120);realAccumulator-=realSteps/120;previous=now;const steps=Math.min(120,Math.floor(accumulator*120));accumulator-=steps/120;for(const [id,r] of rooms){if(Date.now()>r.expiresAt){for(const p of r.peers)p.send({type:'error',message:'Room expired'});rooms.delete(id);continue;}r.advance(r.speed===speed?steps:realSteps);}if(now-lastBroadcast>=1000/30){lastBroadcast=now;for(const r of rooms.values())if(r.peers.size)r.broadcast();}},4);
server.listen(port,'127.0.0.1',()=>console.log(`MCP GRAND PRIX · ${defaultRoom.race.circuit.toUpperCase()} · ${defaultRoom.matchup.toUpperCase()} · ${defaultRoom.mode.toUpperCase()} · ${speed}× race clock\n${origin}/?team=a\n${origin}/?spectate\n${origin}/?team=b\nMCP: ${origin}/mcp`));
async function shutdown(){clearInterval(timer);for(const ws of wss.clients)ws.terminate();wss.close();server.close();await vite?.close();process.exit(0);}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
