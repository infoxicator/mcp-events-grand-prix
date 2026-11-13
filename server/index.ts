import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { createPlayers } from './players';
import { isMatchup, matchupTitle, type Matchup, type Engine } from '../src/match';
import { createGame, step, DT, startServe, setIntent, SIDES, type Side, type GameState } from '../src/physics';
import { snapshot, type Decision } from '../src/agents';
import type { ClientMessage, ServerMessage, ArenaState } from '../src/protocol';
import { createPongMcp, PONG_RESOURCE } from './mcp';
loadEnv({path:'.env.local',quiet:true});
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Jev Pong requires Node.js 22 or newer.');
const initialMatchup=process.env.PONG_MATCHUP??'jev-vs-jev';
if(!isMatchup(initialMatchup))throw new Error('PONG_MATCHUP must be jev-vs-jev or jev-vs-luna');
let matchup:Matchup=initialMatchup,roster=createPlayers(process.env,matchup);
const port=Number(process.env.PORT??5177), production=process.argv.includes('--production');
const vite=production?null:await (await import('vite')).createServer({server:{middlewareMode:true,hmr:{port:port+1000,host:'127.0.0.1'}},appType:'spa'});
let game=createGame(),generation=0;
const players:Record<Side,WebSocket|null>={left:null,right:null};
const decisions:Record<Side,Decision|null>={left:null,right:null},intents={left:0,right:0},intentTicks={left:0,right:0};
// Provider cooldown survives player reconnects, new matches, and matchup changes.
const providerCooldowns:Partial<Record<Engine,number>>={};
let history:GameState[]=[],lastReplay:GameState[]=[];
const send=(ws:WebSocket,message:ServerMessage)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(message));};
const connected=()=>({left:players.left?.readyState===WebSocket.OPEN,right:players.right?.readyState===WebSocket.OPEN});
const state=():ArenaState=>({type:'state',game,connected:connected(),serverTime:Date.now(),decisions,intents,mode:roster.mode,matchup,players:roster.players});
const mcp=createPongMcp(`http://127.0.0.1:${port}`,state);
const server=createServer(async(req,res)=>{
  if(req.url?.split('?')[0]==='/mcp'){await mcp.handle(req,res);return;}
  if(req.url==='/health') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,mode:roster.mode,matchup,players:roster.players,tick:game.tick,connected:connected(),physicsHz:120,snapshotHz:30,node:process.versions.node,mcp:{endpoint:'/mcp',resource:PONG_RESOURCE}}));return;}
  if(vite){vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});return;}
  try {
    const pathname=decodeURIComponent(new URL(req.url??'/', 'http://localhost').pathname);
    const file=resolve('dist','.'+pathname),root=resolve('dist');
    if(!file.startsWith(root+'/')&&file!==root)throw new Error('Invalid path');
    const path=extname(file)?file:resolve(root,'index.html');
    const mime:Record<string,string>={'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'};
    res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');res.end(await readFile(path));
  }catch{res.writeHead(404);res.end('Not found');}
});
const wss=new WebSocketServer({noServer:true,maxPayload:4096});
server.on('upgrade',(req,socket,head)=>{
  // Loopback-only game: same-origin web clients or an explicit MCP connection capability.
  const expected=`http://${req.headers.host}`;
  const url=new URL(req.url??'/',expected);
  if((req.headers.origin!==expected&&!mcp.acceptsToken(url.searchParams.get('mcp_token')))||url.pathname!=='/ws'){socket.destroy();return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
});
wss.on('connection',(ws,req)=>{
  const requested=new URL(req.url??'/',`http://${req.headers.host}`).searchParams.get('side');
  const side:Side|null=requested==='left'||requested==='right'?requested:null;
  const assigned=side&&!players[side]?side:null;
  if(assigned) {
    players[assigned]=ws;decisions[assigned]=null;intentTicks[assigned]=game.tick;
    if(connected().left&&connected().right&&game.phase==='lobby') {game.ball={x:500,y:280,vx:430,vy:148};game.rally=0;startServe(game);}
  }
  send(ws,{type:'joined',side:assigned,...(side&&!assigned?{reason:'This paddle is already connected. Watching as spectator.'}:{})});send(ws,state());
  let busy=false,lastDecision=0,sequence=0,lastAccepted=0,lastSeen=Date.now(),windowStart=Date.now(),messages=0;
  const heartbeat=setInterval(()=>{if(Date.now()-lastSeen>10000)ws.terminate();},2000);
  ws.on('message',async data=>{
    lastSeen=Date.now();
    if(Date.now()-windowStart>1000){windowStart=Date.now();messages=0;}
    if(++messages>40){ws.close(1008,'Too many messages');return;}
    try {
      const msg=JSON.parse(data.toString()) as ClientMessage;
      if(msg.type==='ping'&&Number.isFinite(msg.sent)){send(ws,{type:'pong',sent:msg.sent});return;}
      if(msg.type==='replay'){send(ws,{type:'replay',frames:lastReplay});return;}
      if(msg.type==='reset'||msg.type==='matchup') {
        if(msg.type==='matchup'){if(!isMatchup(msg.matchup)){send(ws,{type:'error',message:'Invalid matchup'});return;}const nextRoster=createPlayers(process.env,msg.matchup);matchup=msg.matchup;roster=nextRoster;}
        game=createGame();generation++;history=[];lastReplay=[];
        for(const s of SIDES){decisions[s]=null;intents[s]=0;intentTicks[s]=0;}
        if(connected().left&&connected().right)startServe(game);return;
      }
      if(!assigned||players[assigned]!==ws)return;
      if(msg.type==='decide') {
        if(busy||Date.now()-lastDecision<150||game.phase==='lobby'||game.phase==='won')return;
        const engine=roster.players[assigned].engine,retryAfterMs=(providerCooldowns[engine]??0)-Date.now();
        if(retryAfterMs>0){send(ws,{type:'cooldown',retryAfterMs});return;}
        busy=true;lastDecision=Date.now();const capturedPoint=game.pointId,capturedGeneration=generation;
        try {
          const decision=await roster.brains[assigned](snapshot(game,assigned),++sequence);
          if(decision.retryAfterMs)providerCooldowns[engine]=Date.now()+decision.retryAfterMs;
          if(players[assigned]!==ws||ws.readyState!==WebSocket.OPEN||capturedPoint!==game.pointId||capturedGeneration!==generation)return;
          decisions[assigned]=decision;send(ws,{type:'decision',decision});
        }finally{busy=false;}
      }
      if(msg.type==='intent') {
        const d=decisions[assigned];
        if(d&&msg.sequence===d.sequence&&msg.sequence>lastAccepted&&Number.isFinite(msg.target_y)&&Math.abs(msg.target_y-d.action.target_y)<0.01){lastAccepted=msg.sequence;setIntent(game,assigned,msg.target_y);intents[assigned]++;intentTicks[assigned]=game.tick;decisions[assigned]={...d};}
      }
    }catch{send(ws,{type:'error',message:'Invalid message'});}
  });
  ws.on('error',()=>{});
  ws.on('close',()=>{clearInterval(heartbeat);if(assigned&&players[assigned]===ws){players[assigned]=null;game.phase='lobby';}});
});
let previous=performance.now(),accumulator=0,lastBroadcast=-1;
const timer=setInterval(()=>{
  const now=performance.now();accumulator+=Math.min((now-previous)/1000,0.25);previous=now;
  while(accumulator>=DT){
    for(const side of SIDES)if(game.tick-intentTicks[side]>240)setIntent(game,side,280);
    const point=game.pointId;step(game);accumulator-=DT;
    if(game.pointId!==point){lastReplay=[...history,structuredClone(game)];history=[];}
    if(game.tick%4===0&&game.phase==='play'){history.push(structuredClone(game));if(history.length>240)history.shift();}
  }
  if(Math.floor(game.tick/4)!==lastBroadcast){lastBroadcast=Math.floor(game.tick/4);const message=state();for(const client of wss.clients)send(client,message);}
},4);
server.listen(port,'127.0.0.1',()=>console.log(`\n${matchupTitle(matchup)} · ${matchup.toUpperCase()} / ${roster.mode.toUpperCase()}\n  Local: http://127.0.0.1:${port}\n  Left:  http://127.0.0.1:${port}/?side=left\n  Right: http://127.0.0.1:${port}/?side=right\n  Watch: http://127.0.0.1:${port}/?spectate\n`));
async function shutdown(){clearInterval(timer);for(const ws of wss.clients)ws.terminate();wss.close();server.close();await vite?.close();process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
