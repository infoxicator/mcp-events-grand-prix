import type {HostedRoom,Team,RaceState,ClientMessage,ServerMessage,Race} from './types';
export interface Connection{state:RaceState|null;team:Team|null;canReset:boolean;status:string;latency:number;received:number;onReplay:(frames:Race[])=>void;send:(msg:ClientMessage)=>void;close:()=>void;}
export function connect(team:Team|null,room:HostedRoom):Connection{
 let ws:WebSocket|null=null,closed=false,retry=300,awaiting=false,lastRequest=0,lastDecide=0,nextDecisionAt=0,reconnect:ReturnType<typeof setTimeout>|undefined;
 const c:Connection={state:null,team:null,canReset:false,status:'CONNECTING',latency:0,received:0,onReplay:()=>{},send:m=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(m));},close:()=>{closed=true;clearTimeout(reconnect);clearInterval(agent);clearInterval(ping);removeEventListener('pagehide',c.close);ws?.close();}};
 function open(){if(closed)return;const u=new URL(`/api/rooms/${room.room}/ws`,room.origin??location.origin);u.protocol=u.protocol==='https:'?'wss:':'ws:';if(room.mcpToken)u.searchParams.set('mcp_token',room.mcpToken);ws=new WebSocket(u);
  ws.onopen=()=>{retry=300;c.status='CONNECTED';c.send({type:'join',team,token:room.token});};ws.onmessage=e=>{const m=JSON.parse(e.data) as ServerMessage;if(m.type==='joined'){c.team=m.team;c.canReset=m.canReset;c.status=m.reason??'CONNECTED';}if(m.type==='state'){if(c.state&&(c.state.matchup!==m.matchup||c.state.race.circuit!==m.race.circuit)){awaiting=false;lastDecide=0;nextDecisionAt=0;}c.state=m;c.received=performance.now();}if(m.type==='decision'){awaiting=false;nextDecisionAt=performance.now()+(m.decision.retryAfterMs??0);c.send({type:'intent',sequence:m.decision.sequence});}if(m.type==='pong')c.latency=Math.round(performance.now()-m.sent);if(m.type==='replay')c.onReplay(m.frames);if(m.type==='error')c.status=m.message;};
  ws.onclose=()=>{c.team=null;awaiting=false;c.status=closed?'DISCONNECTED':'RECONNECTING';if(!closed){reconnect=setTimeout(open,retry);retry=Math.min(3000,retry*1.5);}};ws.onerror=()=>ws?.close();
 }
 const agent=setInterval(()=>{const now=performance.now();if(c.team&&c.state?.race.phase==='racing'&&now>=nextDecisionAt&&now-lastDecide>=200&&(!awaiting||now-lastRequest>2000)){awaiting=true;lastRequest=now;lastDecide=now;c.send({type:'decide'});}},25);
 const ping=setInterval(()=>c.send({type:'ping',sent:performance.now()}),1000);open();addEventListener('pagehide',c.close,{once:true});return c;
}
/** Arrival-time buffer; interpolate unwrapped distance, so lap/finish and reconnect stay coherent. */
export function createInterpolator(){const frames:{time:number;race:Race}[]=[];let latest:Race|null=null;return (s:RaceState,received:number,now:number):Race=>{
 if(latest!==s.race){if(latest&&(s.race.tick<latest.tick||s.race.circuit!==latest.circuit))frames.length=0;frames.push({time:received,race:s.race});latest=s.race;if(frames.length>12)frames.shift();}
 const target=now-80;while(frames.length>2&&frames[1].time<target)frames.shift();const a=frames[0],b=frames[1];if(!b)return a.race;if(a.race.phase!==b.race.phase)return target<b.time?a.race:b.race;const t=Math.max(0,Math.min(1,(target-a.time)/Math.max(1,b.time-a.time)));const race={...b.race,cars:{...b.race.cars}};for(const id of ['a','b'] as const){const x=a.race.cars[id],y=b.race.cars[id];race.cars[id]={...y,pit:t<1?x.pit:y.pit,pitTime:x.pit===y.pit?x.pitTime+(y.pitTime-x.pitTime)*t:t<1?x.pitTime:y.pitTime,distance:x.distance+(y.distance-x.distance)*t,offset:x.offset+(y.offset-x.offset)*t,speed:x.speed+(y.speed-x.speed)*t,heading:(x.heading??0)+((y.heading??0)-(x.heading??0))*t,steering:x.steering+(y.steering-x.steering)*t};}
 if(a.race.field&&b.race.field)race.field=b.race.field.map((y,i)=>{
  const x=a.race.field[i]??y;
  return {...y,distance:x.distance+(y.distance-x.distance)*t,offset:x.offset+(y.offset-x.offset)*t,speed:x.speed+(y.speed-x.speed)*t};
 });
 return race;
 };}
export async function prepareRoom():Promise<HostedRoom>{
 const q=new URLSearchParams(location.search),id=q.get('room');let token=new URLSearchParams(location.hash.slice(1)).get('token')??'',links=null;
 if(!id){links=await fetch('/api/default').then(r=>r.json());const route=q.get('team')==='a'?'a':q.get('team')==='b'?'b':'owner';token=new URLSearchParams(new URL(links[route]).hash.slice(1)).get('token')!;return {room:links.room,token,links};}
 const res=await fetch(`/api/rooms/${id}/info`);if(!res.ok)throw new Error('This race has expired. Open a fresh race.');if(token){const owner=await fetch(`/api/rooms/${id}/links`,{headers:{Authorization:`Bearer ${token}`}});if(owner.ok)links=await owner.json();}return {room:id,token,links};
}
