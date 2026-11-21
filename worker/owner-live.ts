import type {Env} from './index';
import {verifyAccessOwner} from './access';
import {liveAvailable,livePairingAvailable} from './live-providers';
import {json,privateHeaders,readSmallBody} from './http';
import type {LiveStrategist} from '../src/race/strategy-events';
import {isMatchup} from '../src/race/matchup';
import {isCircuit} from '../src/race/track';
import {isLiveKey,isRoomId,liveInvitation,liveLabel,liveSpectatorURL,pairingChallenge,
 LIVE_CALL_LIMIT,LIVE_PAIR_PATH,LIVE_TIME_MS,OWNER_LIVE_PATH,type LiveInvitation,type LivePhase} from '../src/race/live';

export const roomStub = (env: Env, room: string) => env.ROOMS.get(env.ROOMS.idFromName(room));
export interface LiveControls extends LiveInvitation {phase:LivePhase}

export async function handlePairing(req: Request, env: Env) {
 const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
 const respond = (data:unknown,status:number) => Response.json(data,{status,headers:{...cors,...privateHeaders}});
 if (req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 if (req.method!=='POST') return respond({error:'Use POST.'},405);
 if (!livePairingAvailable(env)) return respond({error:'Private live racing is unavailable.'},503);
 const url = new URL(req.url), claim = url.pathname === `${LIVE_PAIR_PATH}/claim`;
 try {
  const raw = await readSmallBody(req);
  if (raw===null) return respond({error:'Pairing request too large.'},413);
  const {room,key,chat} = JSON.parse(raw) as {room?:unknown;key?:unknown;chat?:unknown};
  if (!isRoomId(room) || !isLiveKey(key)) return respond({error:'Invalid pairing.'},400);
  if (!claim && !(await env.ROOM_CREATION.limit({key:`live-pair:${req.headers.get('CF-Connecting-IP')??'local'}`})).success) {
   return respond({error:'Try again in a minute.'},429);
  }
  const response = await roomStub(env,room).fetch(new Request(`${url.origin}/internal-${claim?'claim':'pair'}?room=${room}`,{
   method:'POST',body:claim?await pairingChallenge(key):JSON.stringify({challenge:key,chat:chat===true}),
  }));
  return new Response(response.body,{status:response.status,headers:{...cors,...privateHeaders,'Content-Type':'application/json'}});
 } catch {
  return respond({error:'Unable to pair this view.'},400);
 }
}

function page(title: string, body: string, status = 200) {
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · MCP Grand Prix</title>
<style>body{margin:10vh auto;padding:0 20px;max-width:36rem;background:#121718;color:#eeeae1;font:1rem/1.6 system-ui}
h1{line-height:1.15}form{display:grid;justify-items:start;gap:1rem}select,button,input{font:inherit;padding:.45rem .65rem}input{width:100%;box-sizing:border-box}a{color:#d9ff92}
button{background:#d9ff92;color:#151c16;border:0;border-radius:.25rem;cursor:pointer}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`,{
  status,headers:{...privateHeaders,'Referrer-Policy':'same-origin','Content-Type':'text/html; charset=utf-8',
   'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"},
 });
}

function controls(origin:string, match:LiveControls) {
 const stop = match.phase==='running'
  ? `<form method="post" action="${OWNER_LIVE_PATH}?pair=${match.room}"><button name="confirm" value="stop">Stop live race</button></form>`
  : '';
 return page(match.phase==='running'?'Manage live race':liveLabel[match.phase],
  `<p>Race <strong>${match.room.slice(0,8)}</strong></p>${stop}
<p><label>Live spectator invitation <input readonly value="${liveInvitation(match)}"></label></p>
<p><a href="${liveSpectatorURL(origin,match)}" target="_blank" rel="noopener noreferrer">Open live spectator ↗</a></p>`);
}

export async function handleOwnerLive(req: Request, env: Env, fetchKeys: typeof fetch) {
 const url = new URL(req.url);
 if (req.method!=='GET' && req.method!=='POST') return page('Method unavailable','',405);
 if (req.method==='POST' && req.headers.get('Origin')!==url.origin) return page('Request rejected','<p>Submit the form from this page.</p>',403);
 if (!await verifyAccessOwner(req,env,fetchKeys)) return page('Owner sign-in required','<p>Sign in through Cloudflare Access to continue.</p>',403);
 const room = url.searchParams.get('pair');
 if (!isRoomId(room)) return page('Pair an MCP view first','<p>Open MCP Grand Prix in your MCP host and select Start live race.</p>',400);
 const stub = roomStub(env,room);
 const unavailable = (status = 410) => page('Pairing unavailable','<p>Return to MCP Grand Prix and request a new pairing.</p>',status);
 if (req.method==='GET') {
  const response = await stub.fetch(`${url.origin}/internal-live`);
  if (!response.ok) return unavailable(response.status);
  const state = await response.json() as {challenge:string;chat?:boolean}|LiveControls;
  if ('phase' in state) return controls(url.origin,state);
  const chat=state.chat&&liveAvailable(env,'jev-vs-jev','chatgpt');
  const provider=liveAvailable(env);
  if(!chat&&!provider)return page('Live racing unavailable','<p>Configure live driver credentials and connect a supported strategist.</p>',503);
  const luna = provider&&liveAvailable(env,'jev-vs-luna') ? '<option value="jev-vs-luna">Jev vs Luna</option>' : '';
  const minutes = LIVE_TIME_MS/60_000;
  return page('Confirm live race',`<p>Check that the MCP view shows pairing code <strong>${room.slice(0,8)}</strong>.</p>
<p>Live drivers and the optional provider strategist use your provider quota. One race can run for up to ${minutes} minutes and issue up to ${LIVE_CALL_LIMIT} provider requests.</p>
<form method="post" action="${OWNER_LIVE_PATH}?pair=${room}">
<input type="hidden" name="challenge" value="${state.challenge}">
<label>Circuit <select name="circuit"><option value="monza">Monza</option><option value="las-vegas">Las Vegas</option></select></label>
<label>Matchup for race server strategist <select name="matchup"><option value="jev-vs-jev">Jev vs Jev</option>${luna}</select></label>
<label>Strategist <select name="strategist">${provider?'<option value="provider">Race server strategist</option>':''}${chat?'<option value="chatgpt">ChatGPT Work via native MCP Events</option>':''}</select></label>
${chat?'<p>ChatGPT guides Ferrari in a solo race. After confirming, subscribe in the paired Work chat and click Start race in the widget.</p>':''}
<button name="confirm" value="start">Confirm and start live race</button></form>`);
 }
 if (req.headers.get('Content-Type')?.split(';')[0]!=='application/x-www-form-urlencoded') return page('Confirmation required','<p>Submit the confirmation form.</p>',400);
 const raw = await readSmallBody(req);
 if (raw===null) return page('Invalid confirmation','',413);
 const form = new URLSearchParams(raw);
 if (form.get('confirm')==='stop') {
  const response = await stub.fetch(new Request(`${url.origin}/internal-stop`,{method:'POST'}));
  return response.ok ? controls(url.origin,await response.json() as LiveControls) : unavailable(response.status);
 }
 const strategist:LiveStrategist|null=form.get('strategist')===null||form.get('strategist')==='provider'?'provider':form.get('strategist')==='chatgpt'?'chatgpt':null;
 const matchup=form.get('matchup'),circuit=form.get('circuit'),challenge=form.get('challenge');
 if(form.get('confirm')!=='start'||!strategist||!isMatchup(matchup)||!isCircuit(circuit)||!isLiveKey(challenge)) return page('Confirmation required','',400);
 const response = await stub.fetch(new Request(`${url.origin}/internal-start?room=${room}`,{
  method:'POST',body:JSON.stringify({matchup,circuit,challenge,strategist}),
 }));
 if (response.status===503) return page('Live racing unavailable','<p>Configure the selected driver and strategist credentials.</p>',503);
 return response.ok ? controls(url.origin,await response.json() as LiveControls) : unavailable(response.status);
}
