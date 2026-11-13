import type { HostedRoom } from './hosting';
import type { GameState, Side } from './physics';
import type { ArenaState, ClientMessage, ServerMessage } from './protocol';
export interface Connection { state:ArenaState|null; canReset:boolean; side:Side|null; status:string; latency:number; received:number; onReplay:(frames:GameState[])=>void; send:(message:ClientMessage)=>void; close:()=>void }
let endpoint:{origin:string;token:string}|null=null;
/** Only used by the MCP entry point. Ordinary web URLs and same-origin checks are unchanged. */
export function configureMcpConnection(origin:string,token:string){endpoint={origin,token};}
export function connect(requested:Side|null,hosted:HostedRoom|null=null):Connection {
  let ws:WebSocket|null=null,retry=300,closed=false,awaiting=false,lastRequest=0,nextDecisionAt=0;
  const c:Connection={state:null,canReset:!hosted,side:null,status:'CONNECTING',latency:0,received:0,onReplay:()=>{},send:msg=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg));},close:()=>{closed=true;clearInterval(agentTimer);clearInterval(pingTimer);removeEventListener('pagehide',c.close);ws?.close();}};
  const open=()=>{
    if(closed)return;
    const url=new URL(hosted?`/api/rooms/${hosted.room}/ws`:'/ws',endpoint?.origin??location.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    if(requested)url.searchParams.set('side',requested);if(endpoint)url.searchParams.set('mcp_token',endpoint.token);
    ws=new WebSocket(url);
    ws.onopen=()=>{c.status='CONNECTED';retry=300;if(hosted)c.send({type:'join',side:requested,token:hosted.token});};
    ws.onmessage=event=>{
      if(event.data==='pong'){c.latency=Math.round(performance.now()-lastPing);return;}
      const message=JSON.parse(event.data) as ServerMessage;
      if(message.type==='joined'){c.side=message.side;c.canReset=message.canReset??!hosted;c.status=message.reason?(message.reason.includes('already connected')?'PADDLE TAKEN · SPECTATING':message.reason):'CONNECTED';}
      if(message.type==='state'){if(c.state?.matchup!==message.matchup){awaiting=false;lastRequest=0;nextDecisionAt=0;}c.state=message;c.received=performance.now();}
      if(message.type==='pong'){c.latency=Math.round(performance.now()-message.sent);}
      if(message.type==='decision'){awaiting=false;nextDecisionAt=performance.now()+(message.decision.retryAfterMs??0);if(c.side)c.send({type:'intent',sequence:message.decision.sequence,target_y:message.decision.action.target_y});}
      if(message.type==='decision-cancelled')awaiting=false;
      if(message.type==='cooldown'){awaiting=false;nextDecisionAt=performance.now()+message.retryAfterMs;}
      if(message.type==='replay')c.onReplay(message.frames);
    };
    ws.onclose=event=>{if(event.reason.includes('expired'))closed=true;c.status=closed?'DISCONNECTED':'RECONNECTING';c.side=null;awaiting=false;nextDecisionAt=0;if(!closed){setTimeout(open,retry);retry=Math.min(3000,retry*1.5);}};
    ws.onerror=()=>ws?.close();
  };
  open();
  const agentTimer=setInterval(()=>{
    // Driven by this player window; the server proxy never chooses when to act.
    if(c.side&&c.state&&c.state.game.phase!=='lobby'&&c.state.game.phase!=='won'&&performance.now()>=nextDecisionAt&&(!awaiting||performance.now()-lastRequest>2000)){
      awaiting=true;lastRequest=performance.now();c.send({type:'decide'});
    }
  },200);
  let lastPing=0;
  const pingTimer=setInterval(()=>{lastPing=performance.now();if(hosted){if(ws?.readyState===WebSocket.OPEN)ws.send('ping');}else c.send({type:'ping',sent:lastPing});},1000);
  addEventListener('pagehide',c.close,{once:true});
  return c;
}
/** Buffered interpolation uses arrival times, avoiding assumptions about client/server clocks. */
export function createInterpolator() {
  const frames:{time:number;game:GameState}[]=[];let lastTick=-1,lastGame:GameState|null=null;
  return (state:ArenaState,received:number,now:number):GameState=>{
    if(state.game!==lastGame){if(state.game.tick<lastTick)frames.length=0;frames.push({time:received,game:state.game});lastTick=state.game.tick;lastGame=state.game;if(frames.length>12)frames.shift();}
    const target=now-80;
    while(frames.length>2&&frames[1].time<target)frames.shift();
    const a=frames[0],b=frames[1];
    if(!b)return a.game;
    if(a.game.phase!==b.game.phase||a.game.pointId!==b.game.pointId)return target<b.time?a.game:b.game;
    const t=Math.max(0,Math.min(1,(target-a.time)/Math.max(1,b.time-a.time)));
    const lerp=(x:number,y:number)=>x+(y-x)*t;
    return {...b.game,ball:{...b.game.ball,x:lerp(a.game.ball.x,b.game.ball.x),y:lerp(a.game.ball.y,b.game.ball.y)},paddles:{left:lerp(a.game.paddles.left,b.game.paddles.left),right:lerp(a.game.paddles.right,b.game.paddles.right)}};
  };
}
