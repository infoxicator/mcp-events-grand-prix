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
export const subscribeInput=requestInput.extend({
 delivery:destination.extend({mode:z.literal('webhook'),secret:z.string().max(96).refine(value=>signingBytes(value)!==null)}),
 ttlMs:z.number().int().positive().safe().nullable().optional(),
});
export const unsubscribeInput=requestInput.extend({delivery:destination});
export interface StrategyWebhook {
 id:string;
 url:string;
 secret:string;
 expiresAt:number;
}

export async function webhookId(room:string,url:string,team:string){
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([room,STRATEGY_EVENT,url,team])));
 return 'sub_'+Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
}

async function signedPost(fetcher:typeof fetch,subscription:StrategyWebhook,id:string,value:object,signal:AbortSignal){
 const body=JSON.stringify(value),timestamp=Math.floor(Date.now()/1000).toString();
 const bytes=signingBytes(subscription.secret);
 if(!bytes||!callbackURL.safeParse(subscription.url).success)throw new Error('Invalid webhook');
 const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
 return fetcher(subscription.url,{
  method:'POST',redirect:'manual',signal,body,headers:{
   'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,
   'webhook-signature':'v1,'+btoa(String.fromCharCode(...signature)),'X-MCP-Subscription-Id':subscription.id,
  },
 });
}

export async function verifyStrategyWebhook(fetcher:typeof fetch,subscription:StrategyWebhook){
 const challenge=crypto.randomUUID(),signal=AbortSignal.timeout(6000);
 try{
  const response=await signedPost(fetcher,subscription,'msg_'+crypto.randomUUID(),{type:'verification',challenge},signal);
  if(!response.ok){await response.body?.cancel();return 'challenge_failed';}
  const reply=await response.json() as {challenge?:unknown}|null;
  const echo=reply?.challenge;
  if(typeof echo!=='string'||echo.length!==challenge.length)return 'challenge_failed';
  let difference=0;
  for(let i=0;i<challenge.length;i++)difference|=echo.charCodeAt(i)^challenge.charCodeAt(i);
  return difference===0?null:'challenge_failed';
 }catch{return signal.aborted?'timeout':'challenge_failed';}
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
