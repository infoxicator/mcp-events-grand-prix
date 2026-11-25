import {z} from 'zod';
import {strategyFilter} from '../server/strategy-events';
import {STRATEGY_EVENT,type StrategyEventNotice} from '../src/race/strategy-events';

const callbackURL=z.string().max(1024).refine(value=>{
 const url=URL.parse(value);
 // Use the ChatGPT connector's callback service. It is the only outbound
 // destination for this public endpoint. Never follow callback redirects.
 return url?.origin==='https://connectors.api.openai.com'&&!url.username&&!url.password&&!url.hash&&
  /^\/webhook\/mcp-events\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname);
});
function signingBytes(secret:string){
 if(!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))return null;
 try{
  const bytes=Uint8Array.from(atob(secret.slice(6)),character=>character.charCodeAt(0));
  return bytes.length>=24&&bytes.length<=64?bytes:null;
 }catch{return null;}
}
const requestInput=z.object({name:z.literal(STRATEGY_EVENT),arguments:strategyFilter});
const destination=z.object({mode:z.literal('webhook').optional(),url:callbackURL});
export const webhookSecret=z.string().max(96).refine(value=>signingBytes(value)!==null);
export const subscribeInput=requestInput.extend({
 delivery:destination.extend({mode:z.literal('webhook'),secret:webhookSecret}),
 ttlMs:z.number().int().positive().safe().nullable().optional(),
});
export const unsubscribeInput=requestInput.extend({delivery:destination});
export interface StrategyWebhook {
 id:string;
 url:string;
 secret:string;
 expiresAt:number;
}

export interface SepStrategyWebhook extends StrategyWebhook {
 previousSecret?:{value:string;expiresAt:number};
}

export type CallbackFailure='connection_refused'|'timeout'|'tls_error'|'http_4xx'|'http_5xx'|'challenge_failed';
export class CallbackTransportError extends Error {
 constructor(readonly reason:CallbackFailure){super(reason);}
}

export async function subscriptionId(key:unknown[]){
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(key)));
 return 'sub_'+Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
}

export function webhookId(room:string,url:string,team:string){
 return subscriptionId([room,STRATEGY_EVENT,url,team]);
}

async function signedPost(fetcher:typeof fetch,subscription:SepStrategyWebhook,id:string,value:object,signal:AbortSignal,sep=false){
 const body=JSON.stringify(value),timestamp=Math.floor(Date.now()/1000).toString();
 if(!sep&&!callbackURL.safeParse(subscription.url).success)throw new Error('Invalid webhook');
 const secrets=[subscription.secret];
 if(subscription.previousSecret&&subscription.previousSecret.expiresAt>Date.now())secrets.push(subscription.previousSecret.value);
 const message=new TextEncoder().encode(`${id}.${timestamp}.${body}`);
 const signatures=await Promise.all(secrets.map(async secret=>{
  const bytes=signingBytes(secret);
  if(!bytes)throw new Error('Invalid webhook secret');
  const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,message));
  return 'v1,'+btoa(String.fromCharCode(...signature));
 }));
 return fetcher(subscription.url,{
  method:'POST',redirect:'manual',signal,body,headers:{
   'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,
   'webhook-signature':signatures.join(' '),'X-MCP-Subscription-Id':subscription.id,
  },
 });
}

async function readSepChallenge(response:Response):Promise<{challenge?:unknown}|null>{
 const reader=response.body?.getReader();
 if(!reader)return null;
 const body=new Uint8Array(8192);
 let offset=0;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)return JSON.parse(new TextDecoder().decode(body.subarray(0,offset)));
   if(offset+value.byteLength>body.length){await reader.cancel();return null;}
   body.set(value,offset);
   offset+=value.byteLength;
  }
 }finally{reader.releaseLock();}
}

export async function verifyStrategyWebhook(fetcher:typeof fetch,subscription:StrategyWebhook,sep=false):Promise<CallbackFailure|null>{
 const challenge=crypto.randomUUID(),signal=AbortSignal.timeout(6000);
 try{
  const id=(sep?'msg_verification_':'msg_')+crypto.randomUUID();
  const response=await signedPost(fetcher,subscription,id,{type:'verification',challenge},signal,sep);
  if(!response.ok){await response.body?.cancel();return sep?(response.status>=500?'http_5xx':'http_4xx'):'challenge_failed';}
  const reply=sep?await readSepChallenge(response):await response.json() as {challenge?:unknown}|null;
  const echo=reply?.challenge;
  if(typeof echo!=='string'||echo.length!==challenge.length)return 'challenge_failed';
  let difference=0;
  for(let i=0;i<challenge.length;i++)difference|=echo.charCodeAt(i)^challenge.charCodeAt(i);
  return difference===0?null:'challenge_failed';
 }catch(error){return signal.aborted?'timeout':sep&&error instanceof CallbackTransportError?error.reason:'challenge_failed';}
}

export async function postStrategyEvent(fetcher:typeof fetch,subscription:StrategyWebhook,event:StrategyEventNotice&{event_id:string},signal:AbortSignal){
 const value={
  eventId:event.event_id,name:STRATEGY_EVENT,timestamp:new Date().toISOString(),data:event,cursor:null,
 };
 for(let attempt=0;attempt<3&&!signal.aborted&&Date.now()<Math.min(event.expiresAt,subscription.expiresAt);attempt++){
  let status:number|undefined;
  try{
   const response=await signedPost(fetcher,subscription,event.event_id,value,AbortSignal.any([signal,AbortSignal.timeout(6000)]));
   status=response.status;
   await response.body?.cancel().catch(()=>{});
   if(response.ok)return 'delivered';
  }catch{/* Retry transient connection failures while the event remains useful. */}
  if(status===410)return 'gone';
  if(status!==undefined&&status!==429&&status<500)break;
  if(attempt<2&&!signal.aborted)await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
 }
 return 'failed';
}

export async function postSepStrategyEvent(fetcher:typeof fetch,subscription:SepStrategyWebhook,event:StrategyEventNotice&{event_id:string},issuedAt:number,signal:AbortSignal){
 const id='msg_'+crypto.randomUUID();
 const value={eventId:event.event_id,name:STRATEGY_EVENT,timestamp:new Date(issuedAt).toISOString(),data:event,cursor:null};
 for(let attempt=0;attempt<3&&!signal.aborted&&Date.now()<Math.min(event.expiresAt,subscription.expiresAt);attempt++){
  try{
   const response=await signedPost(fetcher,subscription,id,value,AbortSignal.any([signal,AbortSignal.timeout(6000)]),true);
   await response.body?.cancel().catch(()=>{});
   if(response.ok)return true;
   if(response.status===410||response.status===413)return false;
  }catch{/* Retry bounded delivery failures while the strategy call is still relevant. */}
  if(attempt<2&&!signal.aborted)await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
 }
 return false;
}

export async function postSepTermination(fetcher:typeof fetch,subscription:SepStrategyWebhook){
 try{
  const response=await signedPost(fetcher,subscription,'msg_terminated_'+crypto.randomUUID(),
   {type:'terminated',error:{code:-32024,message:'This race seat is no longer active.'}},AbortSignal.timeout(6000),true);
  await response.body?.cancel();
 }catch{/* The subscription has ended even when the callback is unavailable. */}
}
