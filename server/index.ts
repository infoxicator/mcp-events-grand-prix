import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {config as loadEnv} from 'dotenv';
import {WebSocketServer,WebSocket} from 'ws';
import {NodeStreamableHTTPServerTransport} from '@modelcontextprotocol/node';
import {RaceRoom} from './race-room';
import {createRaceMcp,type RaceGateway} from './race-mcp';
import type {ClientMessage} from '../src/race/types';
loadEnv({path:'.env.local',quiet:true});
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22+ is required.');
const port=Number(process.env.PORT??5277),origin=`http://127.0.0.1:${port}`,speed=Math.max(.25,Math.min(24,Number(process.env.RACE_SPEED??4))),production=process.argv.includes('--production');
const rooms=new Map<string,RaceRoom>();
function create(mock=false){const r=new RaceRoom(crypto.randomUUID(),origin,mock?{JEV_MOCK:'1'}:process.env,speed);rooms.set(r.id,r);return r;}
const defaultRoom=create();
const data=(r:RaceRoom)=>({links:r.links(),mcpToken:r.mcpToken,state:r.state()});
const gateway:RaceGateway={create:async()=>data(create(true)),get:async id=>{const r=rooms.get(id);return r&&r.expiresAt>Date.now()?data(r):null;},html:()=>readFile(resolve('dist/mcp/mcp-app.html'),'utf8')};
const vite=production?null:await(await import('vite')).createServer({server:{middlewareMode:true,hmr:{port:port+1000,host:'127.0.0.1'}},appType:'spa'});
const server=createServer(async(req,res)=>{
 const url=new URL(req.url??'/',origin),path=url.pathname;const json=(v:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(v));};
 if(path==='/mcp'){
  if(![new URL(origin).host,`localhost:${port}`].includes(req.headers.host??'')){json({error:'Invalid Host'},403);return;}
  const o=req.headers.origin;if(o){try{const u=new URL(o);if(u.protocol!=='http:'||!['localhost','127.0.0.1'].includes(u.hostname))throw new Error();}catch{json({error:'Invalid MCP origin'},403);return;}res.setHeader('Access-Control-Allow-Origin',o);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID');res.setHeader('Access-Control-Allow-Methods','POST, GET, DELETE, OPTIONS');}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}const mcp=createRaceMcp(origin,gateway),transport=new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});res.on('close',()=>{void transport.close();void mcp.close();});try{await mcp.connect(transport);await transport.handleRequest(req,res);}catch{if(!res.headersSent)json({error:'MCP request failed'},500);}return;
 }
 if(path==='/health'){json({ok:true,game:'Jev Grand Prix',mode:defaultRoom.mode,physicsHz:120,snapshotHz:30,speed,rooms:rooms.size,tick:defaultRoom.race.tick,connected:defaultRoom.connected(),paidCalls:[...rooms.values()].reduce((n,r)=>n+r.paidCalls,0)});return;}
 if(path==='/api/config'){json({hosted:true,game:'grand-prix'});return;}
 if(path==='/api/default'){json(defaultRoom.links());return;}
 if(path==='/api/rooms'&&req.method==='POST'){if(req.headers.origin!==`http://${req.headers.host}`){json({error:'Same-origin requests required'},403);return;}if(rooms.size>100){json({error:'Room limit reached'},429);return;}json(create(true).links());return;}
 const match=path.match(/^\/api\/rooms\/([a-f0-9-]{36})\/(status|info|links)$/);
 if(match){const r=rooms.get(match[1]);if(!r||r.expiresAt<Date.now()){json({error:'Race expired'},404);return;}if(match[2]==='links'){if(req.headers.authorization!==`Bearer ${r.tokens.owner}`){json({error:'Owner credential required'},403);return;}json(r.links());}else json(match[2]==='status'?r.state():{room:r.id,expiresAt:r.expiresAt});return;}
 if(path.startsWith('/api/')){json({error:'Not found'},404);return;}
 if(vite){vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});return;}
 try{const file=resolve('dist','.'+decodeURIComponent(path)),root=resolve('dist');if(file!==root&&!file.startsWith(root+'/'))throw new Error();const p=extname(file)?file:resolve(root,'index.html');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.json':'application/json'} as Record<string,string>)[extname(p)]??'application/octet-stream');res.end(await readFile(p));}catch{res.writeHead(404);res.end('Not found');}
});
const wss=new WebSocketServer({noServer:true,maxPayload:4096});
server.on('upgrade',(req,socket,head)=>{const u=new URL(req.url??'/',origin),match=u.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})\/ws$/),r=match?rooms.get(match[1]):null;if(!r||r.expiresAt<Date.now()||(req.headers.origin!==`http://${req.headers.host}`&&u.searchParams.get('mcp_token')!==r.mcpToken)){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>{
 const p=r.add(m=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(m));});let windowStart=Date.now(),messages=0;
 ws.on('message',raw=>{if(Date.now()-windowStart>1000){windowStart=Date.now();messages=0;}if(++messages>40){ws.close(1008,'Message limit');return;}try{const msg=JSON.parse(raw.toString()) as ClientMessage;void r.message(p,msg).catch(()=>p.send({type:'error',message:'Invalid request'}));}catch{p.send({type:'error',message:'Invalid message'});}});
 ws.on('close',()=>r.remove(p));ws.on('error',()=>{});
 const heartbeat=setInterval(()=>{if(Date.now()-p.lastSeen>10000||Date.now()>r.expiresAt){ws.close(1000,'Room expired or heartbeat lost');}},2000);ws.on('close',()=>clearInterval(heartbeat));
 });});
let previous=performance.now(),accumulator=0,lastBroadcast=0;
const timer=setInterval(()=>{const now=performance.now();accumulator+=Math.min((now-previous)/1000,.25)*speed;previous=now;const steps=Math.min(120,Math.floor(accumulator*120));accumulator-=steps/120;for(const [id,r] of rooms){if(Date.now()>r.expiresAt){for(const p of r.peers)p.send({type:'error',message:'Room expired'});rooms.delete(id);continue;}r.advance(steps);}if(now-lastBroadcast>=1000/30){lastBroadcast=now;for(const r of rooms.values())if(r.peers.size)r.broadcast();}},4);
server.listen(port,'127.0.0.1',()=>console.log(`JEV GRAND PRIX · ${defaultRoom.mode.toUpperCase()} · ${speed}× race clock\n${origin}/?team=a\n${origin}/?spectate\n${origin}/?team=b\nMCP: ${origin}/mcp`));
async function shutdown(){clearInterval(timer);for(const ws of wss.clients)ws.terminate();wss.close();server.close();await vite?.close();process.exit(0);}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
