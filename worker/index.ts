import { handleMcp } from './mcp';
import { DurableObject } from 'cloudflare:workers';
import { createPlayers } from '../server/players';
import { createGame, startServe, step, setIntent, SIDES, WIN_SCORE, type GameState, type Side } from '../src/physics';
import { snapshot, mockBrain, type Decision } from '../src/agents';
import type { ArenaState, ClientMessage, ServerMessage } from '../src/protocol';
import { roomOptions, isMatchup, type HostedMatchup } from './room-options';
import { FixedClock } from './clock';

export interface Env {
  ASSETS:Fetcher; ROOMS:DurableObjectNamespace<GameRoom>; ROOM_CREATION:RateLimit;
  TYPESAFE_API_KEY?:string; LUNA_INTERVAL_MS?:string; LUNA_TPM_BUDGET?:string; OPENAI_API_KEY?:string; LUNA_MOCK?:string; OPENROUTER_API_KEY?:string; AI_GATEWAY_API_KEY?:string; JEV_PROVIDER?:string; JEV_MODEL?:string; JEV_MOCK?:string;
  ROOM_CREATE_TOKEN?:string;
}
interface Saved {
  game:GameState; matchup:HostedMatchup; replay:GameState[]; expiresAt:number; real:boolean; calls:number;
  mcpToken?:string;
  tokens:{owner:string;left:string;right:string};
}
interface Peer {
  side:Side|null; owner:boolean; sequence:number; accepted:number; lastDecision:number; lastRequest?:number; cooldownUntil?:number;
  windowStart:number; messages:number; joined:boolean; replayAt?:number;
}
const MAX_CALLS=1200, SESSION_MS=15*60_000;
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const bearer=(req:Request)=>req.headers.get('Authorization')?.replace(/^Bearer /,'');
const validRoom=(id:string)=>/^[a-f0-9-]{36}$/.test(id);
const peer=():Peer=>({side:null,owner:false,sequence:0,accepted:0,lastDecision:0,windowStart:Date.now(),messages:0,joined:false});

export default {
  async fetch(req:Request,env:Env):Promise<Response>{
    const url=new URL(req.url),path=url.pathname;
    if(path==='/mcp')return handleMcp(req,env);
    if(path==='/health')return json({ok:true,runtime:'cloudflare-workers',physicsHz:120,snapshotHz:30,publicMode:'mock'});
    if(path==='/api/config')return json({hosted:true});
    if(path==='/api/rooms'&&req.method==='POST'){
      if(req.headers.get('Origin')!==url.origin)return json({error:'Same-origin requests required'},403);
      const allowed=await env.ROOM_CREATION.limit({key:req.headers.get('CF-Connecting-IP')??'local'});
      if(!allowed.success)return json({error:'Room creation limit: try again in a minute'},429);
      const options=await roomOptions(req);if(options instanceof Response)return options;
      const id=crypto.randomUUID();
      return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(new Request(`${url.origin}/init?room=${id}`,{method:'POST',headers:{'X-Matchup':options.matchup,'X-Real-Room':String(Boolean(env.ROOM_CREATE_TOKEN&&bearer(req)===env.ROOM_CREATE_TOKEN))}}));
    }
    const match=path.match(/^\/api\/rooms\/([^/]+)\/(ws|links|status|info)$/);
    if(match){
      if(!validRoom(match[1]))return json({error:'Invalid room'},400);
      if(match[2]==='ws'&&(req.headers.get('Upgrade')?.toLowerCase()!=='websocket'||(req.headers.get('Origin')!==url.origin&&!url.searchParams.get('mcp_token'))))return json({error:'Same-origin WebSocket required'},403);
      return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(req);
    }
    if(path.startsWith('/api/'))return json({error:'Not found'},404);
    const response=await env.ASSETS.fetch(req);
    const headers=new Headers(response.headers);
    headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');
    headers.set('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; frame-ancestors 'none'");
    return new Response(response.body,{status:response.status,headers});
  }
} satisfies ExportedHandler<Env>;

export class GameRoom extends DurableObject<Env> {
  private saved:Saved|null=null;
  private game=createGame();
  private peers=new Map<WebSocket,Peer>();
  private players:Record<Side,WebSocket|null>={left:null,right:null};
  private decisions:Record<Side,Decision|null>={left:null,right:null};
  private intents={left:0,right:0};private intentTicks={left:0,right:0};
  private history:GameState[]=[];private replay:GameState[]=[];
  private timer:ReturnType<typeof setInterval>|null=null;private clock=new FixedClock();
  private ready:Promise<void>;
  private cooldowns:Record<string,number>={};
  private generation=0;private busy=new Set<WebSocket>();
  private rosterCache:ReturnType<typeof createPlayers>|null=null;
  constructor(ctx:DurableObjectState,env:Env){
    super(ctx,env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
    this.ready=ctx.blockConcurrencyWhile(async()=>{
      this.saved=await ctx.storage.get<Saved>('room')??null;
      if(this.saved){this.saved.calls=await ctx.storage.get<number>('calls')??this.saved.calls;this.game=structuredClone(this.saved.game);this.game.phase='lobby';this.replay=this.saved.replay;}
      for(const ws of ctx.getWebSockets()){
        const p=ws.deserializeAttachment() as Peer;
        this.peers.set(ws,p);if(p.side)this.players[p.side]=ws;
      }
      if(this.saved&&Date.now()<this.saved.expiresAt)this.activate();
    });
  }
  private connected(){return {left:!!this.players.left,right:!!this.players.right};}
  private state():ArenaState{return {type:'state',game:this.game,connected:this.connected(),serverTime:Date.now(),decisions:this.decisions,intents:this.intents,mode:this.roster().mode,matchup:this.saved?.matchup??'jev-vs-jev',players:this.roster().players};}
  private brainEnv():Record<string,string|undefined>{
    return this.saved?.real?{TYPESAFE_API_KEY:this.env.TYPESAFE_API_KEY,LUNA_INTERVAL_MS:this.env.LUNA_INTERVAL_MS,LUNA_TPM_BUDGET:this.env.LUNA_TPM_BUDGET,OPENAI_API_KEY:this.env.OPENAI_API_KEY,LUNA_MOCK:this.env.LUNA_MOCK,OPENROUTER_API_KEY:this.env.OPENROUTER_API_KEY,AI_GATEWAY_API_KEY:this.env.AI_GATEWAY_API_KEY,JEV_PROVIDER:this.env.JEV_PROVIDER,JEV_MODEL:this.env.JEV_MODEL,JEV_MOCK:this.env.JEV_MOCK}:{JEV_MOCK:'1'};
  }
  private roster(){return this.rosterCache??=createPlayers(this.brainEnv(),this.saved?.matchup??'jev-vs-jev');}
  private send(ws:WebSocket,message:ServerMessage){try{if(ws.readyState===1)ws.send(JSON.stringify(message));}catch{this.remove(ws);}}
  private broadcast(){const message=this.state();for(const ws of this.peers.keys())this.send(ws,message);}
  private checkpoint(){
    if(!this.saved)return;
    this.saved.game=structuredClone(this.game);this.saved.replay=this.replay;
    // Capture now; never pass mutable live physics state into an asynchronous write.
    this.ctx.waitUntil(this.ctx.storage.put('room',structuredClone(this.saved)));
  }
  private activate(){
    if(!this.saved||this.timer||!this.players.left||!this.players.right)return;
    if(this.game.phase==='lobby'){
      if(Math.max(this.game.score.left,this.game.score.right)>=WIN_SCORE){this.game.phase='won';this.game.countdown=7;}
      else{this.game.ball={x:500,y:280,vx:430,vy:148};this.game.rally=0;startServe(this.game);}
    }
    // A seat waiting in a hibernating lobby has no decision traffic. Its lease starts now.
    for(const ws of [this.players.left,this.players.right]){const p=this.peers.get(ws!);if(p){p.lastDecision=Date.now();ws!.serializeAttachment(p);}}
    this.clock=new FixedClock();
    this.timer=setInterval(()=>this.tick(),1000/30);
  }
  private pause(){
    if(this.timer){clearInterval(this.timer);this.timer=null;}
    this.game.phase='lobby';this.history=[];this.generation++;this.checkpoint();
  }
  private tick(){
    if(!this.saved)return;
    if(Date.now()>=this.saved.expiresAt){this.expire();return;}
    // Only active games need a lease watchdog. Idle sockets use protocol auto-responses.
    for(const side of SIDES){const ws=this.players[side];if(ws&&Date.now()-Math.max(this.peers.get(ws)?.lastDecision??0,this.peers.get(ws)?.cooldownUntil??0)>10_000){ws.close(1000,'Player loop inactive');this.remove(ws);}}
    if(!this.timer)return;
    this.clock.advance(Date.now(),()=>{
      for(const side of SIDES)if(this.game.tick-this.intentTicks[side]>240)setIntent(this.game,side,280);
      const point=this.game.pointId,phase=this.game.phase;step(this.game);
      if(this.game.pointId!==point){this.replay=[...this.history,structuredClone(this.game)];this.history=[];this.checkpoint();}
      if(phase==='won'&&this.game.phase!=='won')this.checkpoint();
      if(this.game.tick%4===0&&this.game.phase==='play'){this.history.push(structuredClone(this.game));if(this.history.length>240)this.history.shift();}
    });
    this.broadcast();
  }
  private remove(ws:WebSocket){
    const p=this.peers.get(ws);this.peers.delete(ws);
    if(p?.side&&this.players[p.side]===ws){this.players[p.side]=null;this.decisions[p.side]=null;this.pause();this.broadcast();}
  }
  private expire(){
    if(this.timer){clearInterval(this.timer);this.timer=null;}
    this.generation++;
    for(const ws of this.peers.keys())ws.close(1000,'Room expired; create a new match');
    this.peers.clear();this.players={left:null,right:null};this.saved=null;
    this.ctx.waitUntil(this.ctx.storage.deleteAll());
  }
  async alarm(){this.expire();}
  async fetch(req:Request){
    await this.ready;
    const url=new URL(req.url),path=url.pathname;
    if(path==='/init'){
      if(this.saved)return json({error:'Already initialized'},409);
      const matchup=req.headers.get('X-Matchup');
      this.saved={game:structuredClone(this.game),matchup:isMatchup(matchup)?matchup:'jev-vs-jev',replay:[],expiresAt:Date.now()+SESSION_MS,real:req.headers.get('X-Real-Room')==='true',calls:0,tokens:{owner:crypto.randomUUID(),left:crypto.randomUUID(),right:crypto.randomUUID()}};
      if(req.headers.get('X-MCP-Room')==='true')this.saved.mcpToken=crypto.randomUUID();
      await this.ctx.storage.put({room:this.saved,calls:0});await this.ctx.storage.setAlarm(this.saved.expiresAt);
      return json({...this.links(url.origin,url.searchParams.get('room')!),...(this.saved.mcpToken?{mcpToken:this.saved.mcpToken}:{})},201);
    }
    if(!this.saved||Date.now()>=this.saved.expiresAt)return json({error:'Room missing or expired. Create a new match.'},410);
    if(path==='/mcp-join'){
      if(!this.saved.mcpToken||this.saved.real||req.method!=='POST')return json({error:'MCP mock room required'},403);
      const input=await req.json() as {side?:string;credential?:string};
      if((input.side!=='left'&&input.side!=='right')||input.credential!==this.saved.tokens[input.side])return json({error:'Invalid player invitation'},403);
      const all=this.links(url.origin,url.searchParams.get('room')!);
      // Joiners receive only their own seat, never owner or opponent credentials.
      return json({mcpToken:this.saved.mcpToken,links:{...all,owner:'',left:input.side==='left'?all.left:'',right:input.side==='right'?all.right:''}});
    }
    if(path==='/mcp-status')return this.saved.mcpToken&&!this.saved.real?json({...this.state(),timerActive:!!this.timer,calls:this.saved.calls,expiresAt:this.saved.expiresAt}):json({error:'MCP room required'},403);
    const room=path.split('/')[3];
    if(path.endsWith('/info'))return json({room,expiresAt:this.saved.expiresAt});
    if(path.endsWith('/links')||path.endsWith('/status')){
      if(bearer(req)!==this.saved.tokens.owner)return json({error:'Owner link required'},403);
      return json(path.endsWith('/links')?this.links(url.origin,room):{...this.state(),timerActive:!!this.timer,calls:this.saved.calls,expiresAt:this.saved.expiresAt,droppedSeconds:this.clock.droppedSeconds,sockets:this.peers.size,checkpoint:this.saved.game});
    }
    if(!path.endsWith('/ws'))return json({error:'Not found'},404);
    if(req.headers.get('Origin')!==url.origin&&(!this.saved.mcpToken||url.searchParams.get('mcp_token')!==this.saved.mcpToken))return json({error:'Invalid WebSocket origin or MCP capability'},403);
    if(this.peers.size>=12)return json({error:'Room full (12 connections)'},429);
    const pair=new WebSocketPair(),[client,server]=Object.values(pair),p=peer();
    this.ctx.acceptWebSocket(server);server.serializeAttachment(p);this.peers.set(server,p);
    this.send(server,{type:'joined',side:null,canReset:false});this.send(server,this.state());
    return new Response(null,{status:101,webSocket:client});
  }
  private links(origin:string,room:string){
    const base=`${origin}/?room=${room}`;
    return {room,expiresAt:this.saved!.expiresAt,owner:`${base}&spectate#token=${this.saved!.tokens.owner}`,left:`${base}&side=left#token=${this.saved!.tokens.left}`,right:`${base}&side=right#token=${this.saved!.tokens.right}`,spectator:`${base}&spectate`};
  }
  async webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer){
    const p=this.peers.get(ws);if(!p||!this.saved)return;
    if(Date.now()>=this.saved.expiresAt){this.expire();return;}
    if(typeof raw!=='string'||raw.length>4096||new TextEncoder().encode(raw).byteLength>4096){ws.close(1009,'Message too large');this.remove(ws);return;}
    if(Date.now()-p.windowStart>=1000){p.windowStart=Date.now();p.messages=0;}
    if(++p.messages>25){ws.close(1008,'Message rate exceeded');this.remove(ws);return;}
    try{
      const msg=JSON.parse(raw) as ClientMessage;
      if(msg.type==='join'){
        if(p.joined)return;p.joined=true;p.owner=msg.token===this.saved.tokens.owner;
        const side=msg.side;
        const authorized=(side==='left'||side==='right')&&msg.token===this.saved.tokens[side];
        const assigned=authorized&&!this.players[side]?side:null;
        if(assigned){p.side=assigned;p.lastDecision=Date.now();this.players[assigned]=ws;this.decisions[assigned]=null;this.intentTicks[assigned]=this.game.tick;this.activate();}
        ws.serializeAttachment(p);
        this.send(ws,{type:'joined',side:assigned,canReset:p.owner,...(side&&!assigned?{reason:authorized?'PADDLE TAKEN · SPECTATING':'PRIVATE SEAT · OWNER LINK REQUIRED'}:{})});this.broadcast();return;
      }
      if(msg.type==='replay'){if(Date.now()-(p.replayAt??0)<1000)return;p.replayAt=Date.now();ws.serializeAttachment(p);this.send(ws,{type:'replay',frames:this.replay});return;}
      if(msg.type==='reset'||msg.type==='matchup'){
        if(!p.owner){this.send(ws,{type:'error',message:'Only the room owner can reset or change matchup'});return;}
        if(msg.type==='matchup'){
          if(!isMatchup(msg.matchup)){this.send(ws,{type:'error',message:'Unknown matchup'});return;}
          const roster=createPlayers(this.brainEnv(),msg.matchup);this.saved.matchup=msg.matchup;this.rosterCache=roster;
        }
        this.game=createGame();this.generation++;this.history=[];this.replay=[];this.decisions={left:null,right:null};this.intents={left:0,right:0};this.intentTicks={left:0,right:0};
        if(this.players.left&&this.players.right)startServe(this.game);
        this.checkpoint();this.broadcast();return;
      }
      if(!p.side||this.players[p.side]!==ws)return;
      if(msg.type==='decide'){
        if(this.busy.has(ws))return;
        const engine=this.roster().players[p.side].engine,until=this.cooldowns[engine]??0;
        if(Date.now()<until){p.cooldownUntil=until;p.lastDecision=Date.now();ws.serializeAttachment(p);this.send(ws,{type:'cooldown',retryAfterMs:until-Date.now()});return;}
        if(Date.now()-(p.lastRequest??0)<180||this.game.phase==='lobby'||this.game.phase==='won'){this.send(ws,{type:'decision-cancelled'});return;}
        p.lastRequest=p.lastDecision=Date.now();p.sequence++;ws.serializeAttachment(p);
        // Persist a reservation before each paid attempt. Reloads/resets cannot refill the budget.
        const roster=this.roster(),paid=this.saved.real&&!roster.players[p.side].mock;
        const exhausted=paid&&this.saved.calls>=MAX_CALLS;
        this.busy.add(ws);
        const capturedPoint=this.game.pointId,generation=this.generation,side=p.side;
        try{
          if(paid&&!exhausted){this.saved.calls++;await this.ctx.storage.put('calls',this.saved.calls);await this.ctx.storage.sync();}
          const decision:Decision=exhausted?{action:mockBrain(snapshot(this.game,side)),source:'fallback',responseMs:0,sequence:p.sequence,warning:'Room AI budget exhausted · heuristic fallback'}:await roster.brains[side](snapshot(this.game,side),p.sequence);
          if(decision.retryAfterMs){p.cooldownUntil=Date.now()+decision.retryAfterMs;this.cooldowns[engine]=p.cooldownUntil;ws.serializeAttachment(p);}
          if(this.players[side]!==ws)return;
          if(capturedPoint!==this.game.pointId||generation!==this.generation){this.send(ws,{type:'decision-cancelled'});return;}
          this.decisions[side]=decision;this.send(ws,{type:'decision',decision});
        }finally{this.busy.delete(ws);}
      }
      if(msg.type==='intent'){
        const d=this.decisions[p.side];
        if(d&&msg.sequence===d.sequence&&msg.sequence>p.accepted&&Number.isFinite(msg.target_y)&&Math.abs(msg.target_y-d.action.target_y)<.01){
          p.accepted=msg.sequence;ws.serializeAttachment(p);setIntent(this.game,p.side,msg.target_y);this.intents[p.side]++;this.intentTicks[p.side]=this.game.tick;
        }
      }
    }catch{this.send(ws,{type:'error',message:'Invalid message'});}
  }
  webSocketClose(ws:WebSocket,code:number,reason:string){this.remove(ws);try{ws.close(code,reason);}catch{}}
  webSocketError(ws:WebSocket){this.remove(ws);try{ws.close(1011,'Socket error');}catch{}}
}
