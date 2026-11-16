import {isCircuit,type CircuitId} from '../src/race/track';
import {DurableObject} from 'cloudflare:workers';
import {RaceRoom,type Peer} from '../server/race-room';
import {createRaceMcp,type McpRoom} from '../server/race-mcp';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import {isMatchup,type Matchup} from '../src/race/matchup';
import type {Race,ClientMessage} from '../src/race/types';
interface Env{ASSETS:Fetcher;ROOMS:DurableObjectNamespace<GameRoom>;ROOM_CREATION:RateLimit;}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const valid=(id:string)=>/^[a-f0-9-]{36}$/.test(id);
async function create(env:Env,origin:string,matchup:Matchup='jev-vs-jev',circuit:CircuitId='monza'):Promise<McpRoom>{const id=crypto.randomUUID();const r=await env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(new Request(`${origin}/internal-create?room=${id}&matchup=${matchup}&circuit=${circuit}`,{method:'POST'}));return r.json() as Promise<McpRoom>;}
async function get(env:Env,origin:string,id:string):Promise<McpRoom|null>{if(!valid(id))return null;const r=await env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(new Request(`${origin}/internal-data`));return r.ok?r.json() as Promise<McpRoom>:null;}
export default {async fetch(req:Request,env:Env):Promise<Response>{const u=new URL(req.url),p=u.pathname;
 if(p==='/health')return json({ok:true,game:'Jev Grand Prix',runtime:'cloudflare-workers',mode:'mock',physicsHz:120,snapshotHz:30,paidCalls:0});
 if(p==='/api/config')return json({hosted:true});
 if(p==='/api/default'||p==='/api/rooms'&&req.method==='POST'){
  if(p==='/api/rooms'&&req.headers.get('Origin')!==u.origin)return json({error:'Same-origin required'},403);
  if(!(await env.ROOM_CREATION.limit({key:req.headers.get('CF-Connecting-IP')??'local'})).success)return json({error:'Room creation limit'},429);const circuit=u.searchParams.get('circuit')??'monza';if(!isCircuit(circuit))return json({error:'Invalid circuit'},400);return json((await create(env,u.origin,'jev-vs-jev',circuit)).links);
 }
 if(p==='/mcp'){
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, MCP-Protocol-Version, MCP-Session-Id','Access-Control-Allow-Methods':'POST, OPTIONS'};
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});if(req.method!=='POST')return new Response('Use POST',{status:405,headers:cors});
  const server=createRaceMcp(u.origin,{create:async (matchup,circuit)=>{if(!(await env.ROOM_CREATION.limit({key:req.headers.get('CF-Connecting-IP')??'mcp'})).success)throw new Error('Room creation limit');return create(env,u.origin,matchup,circuit);},get:id=>get(env,u.origin,id),html:async()=>{const r=await env.ASSETS.fetch(new Request(`${u.origin}/mcp/mcp-app.html`));if(!r.ok)throw new Error('Build MCP resource first');return r.text();}}),transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});try{await server.connect(transport);const response=await transport.handleRequest(req);const headers=new Headers(response.headers);for(const [k,v] of Object.entries(cors))headers.set(k,v);return new Response(response.body,{status:response.status,headers});}finally{await server.close();}
 }
 const match=p.match(/^\/api\/rooms\/([a-f0-9-]{36})\/(info|links|status|ws)$/);if(match){if(match[2]==='ws'&&req.headers.get('Origin')!==u.origin&&!u.searchParams.has('mcp_token'))return json({error:'Origin denied'},403);return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(req);}
 if(p.startsWith('/api/')||p.startsWith('/internal'))return json({error:'Not found'},404);
 const r=await env.ASSETS.fetch(req);return new Response(r.body,{status:r.status,headers:r.headers});
}} satisfies ExportedHandler<Env>;
interface Saved{ matchup?:Matchup;id:string;origin:string;race:Race;tokens:RaceRoom['tokens'];mcpToken:string;expiresAt:number;intents:{a:number;b:number};engineerCalls:{a:number;b:number}; }
export class GameRoom extends DurableObject<Env>{
 private room:RaceRoom|null=null;private peers=new Map<WebSocket,Peer>();private timer:ReturnType<typeof setInterval>|null=null;private prev=Date.now();private accumulator=0;private broadcastAt=0;private checkpointAt=0;private ready:Promise<void>;
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);this.ready=ctx.blockConcurrencyWhile(async()=>{const saved=await ctx.storage.get<Saved>('race');if(saved){this.room=new RaceRoom(saved.id,saved.origin,{JEV_MOCK:'1'},4,saved.matchup??'jev-vs-jev');Object.assign(this.room.tokens,saved.tokens);this.room.mcpToken=saved.mcpToken;this.room.race={...saved.race,circuit:saved.race.circuit??'monza'};this.room.expiresAt=saved.expiresAt;this.room.intents=saved.intents;this.room.engineerCalls=saved.engineerCalls;for(const ws of ctx.getWebSockets()){const meta=ws.deserializeAttachment() as {team:Peer['team'];owner:boolean;joined:boolean};const peer=this.attach(ws);Object.assign(peer,meta);}}this.activate();});}
 private attach(ws:WebSocket){const p=this.room!.add(m=>{try{ws.send(JSON.stringify(m));}catch{}});this.peers.set(ws,p);return p;}
 private save(){const r=this.room;if(!r)return;const saved:Saved={matchup:r.matchup,id:r.id,origin:r.origin,race:structuredClone(r.race),tokens:r.tokens,mcpToken:r.mcpToken,expiresAt:r.expiresAt,intents:r.intents,engineerCalls:r.engineerCalls};this.ctx.waitUntil(this.ctx.storage.put('race',saved));}
 private activate(){if(this.timer||!this.room?.connected().a||!this.room.connected().b)return;this.prev=Date.now();this.timer=setInterval(()=>{const now=Date.now();this.accumulator+=Math.min(.25,(now-this.prev)/1000)*4;this.prev=now;const steps=Math.min(120,Math.floor(this.accumulator*120));this.accumulator-=steps/120;this.room!.advance(steps);if(now-this.broadcastAt>33){this.room!.broadcast();this.broadcastAt=now;}if(now-this.checkpointAt>1000){this.save();this.checkpointAt=now;}if(!this.room!.connected().a||!this.room!.connected().b||this.room!.race.phase==='finished'){clearInterval(this.timer!);this.timer=null;this.save();}},8);}
 async fetch(req:Request){await this.ready;const u=new URL(req.url);if(u.pathname==='/internal-create'&&!this.room){const matchup=u.searchParams.get('matchup')??'jev-vs-jev',circuit=u.searchParams.get('circuit')??'monza';if(!isCircuit(circuit))return json({error:'Invalid circuit'},400);if(!isMatchup(matchup))return json({error:'Invalid matchup'},400);this.room=new RaceRoom(u.searchParams.get('room')!,u.origin,{JEV_MOCK:'1'},4,matchup,{},circuit);this.room.expiresAt=Date.now()+15*60_000;await this.ctx.storage.setAlarm(this.room.expiresAt);this.save();}
  const r=this.room;if(!r||Date.now()>r.expiresAt)return json({error:'Race expired'},404);
  if(u.pathname.startsWith('/internal'))return json({links:r.links(),mcpToken:r.mcpToken,state:r.state()});
  if(u.pathname.endsWith('/info'))return json({room:r.id,expiresAt:r.expiresAt});if(u.pathname.endsWith('/status'))return json(r.state());if(u.pathname.endsWith('/links'))return req.headers.get('Authorization')===`Bearer ${r.tokens.owner}`?json(r.links()):json({error:'Owner required'},403);
  if(u.pathname.endsWith('/ws')&&req.headers.get('Upgrade')?.toLowerCase()==='websocket'){
   if(req.headers.get('Origin')!==u.origin&&u.searchParams.get('mcp_token')!==r.mcpToken)return json({error:'Invalid origin capability'},403);const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);const p=this.attach(pair[1]);pair[1].serializeAttachment({team:p.team,owner:p.owner,joined:p.joined});return new Response(null,{status:101,webSocket:pair[0]});
  }return json({error:'Not found'},404);
 }
 async webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer){await this.ready;const p=this.peers.get(ws);if(!p||typeof raw!=='string'||raw.length>4096){ws.close(1008,'Invalid payload');return;}try{const message=JSON.parse(raw) as ClientMessage;await this.room!.message(p,message);if(message.type==='circuit'||message.type==='matchup'||message.type==='reset')this.save();ws.serializeAttachment({team:p.team,owner:p.owner,joined:p.joined});this.activate();}catch{ws.send(JSON.stringify({type:'error',message:'Invalid request'}));}}
 async webSocketClose(ws:WebSocket){const p=this.peers.get(ws);if(p)this.room?.remove(p);this.peers.delete(ws);this.save();}webSocketError(ws:WebSocket){void this.webSocketClose(ws);}async alarm(){if(this.timer)clearInterval(this.timer);for(const ws of this.peers.keys())ws.close(1000,'Room expired');await this.ctx.storage.deleteAll();}
}
