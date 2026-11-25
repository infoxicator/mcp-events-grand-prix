import {timingSafeEqual} from 'node:crypto';
import {ProtocolError, type McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {strategyEventDefinition} from '../server/strategy-events';
import {httpsCallbackUrl} from './sep-webhook';
import {STRATEGY_EVENT} from '../src/race/strategy-events';
import {isLiveKey} from '../src/race/live';
import {webhookSecret} from './strategy-webhook';

export const SEP_EVENTS_PATH='/mcp/sep-events';
export const SEP_EVENTS_PRINCIPAL='configured-client';
export const SEP_AUTH_REQUIRED='The SEP server bearer token is required.';
const extension='io.modelcontextprotocol/events';
const deliveryMethods=new Set(['events/subscribe','events/unsubscribe','events/poll','events/stream']);
const complete={resultType:'complete'} as const;

const filter=z.strictObject({room:z.uuid(),team:z.enum(['a','b'])});
const event=z.object({name:z.string().min(1),arguments:filter});
const destination=z.object({url:z.string().max(1024).refine(value=>Boolean(httpsCallbackUrl(value)))});
const subscribe=event.extend({
 delivery:destination.extend({mode:z.string(),secret:webhookSecret}),
 ttlMs:z.number().int().positive().nullable().optional(),
 maxAgeMs:z.number().int().nonnegative().optional(),
 cursor:z.string().nullable().optional(),
});
const unsubscribe=event.extend({delivery:destination});
export type SepSubscribe=z.infer<typeof subscribe>;
export type SepUnsubscribe=z.infer<typeof unsubscribe>;

export interface SepEventsBindings {
 SEP_EVENTS_AUTH_TOKEN?:string;
}

export function sepEventsEnabled(env:SepEventsBindings){
 return isLiveKey(env.SEP_EVENTS_AUTH_TOKEN);
}

export function sepRequestAuthorized(request:Request,env:SepEventsBindings){
 const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
 const expected=env.SEP_EVENTS_AUTH_TOKEN;
 if(!isLiveKey(token)||!isLiveKey(expected))return false;
 const encoder=new TextEncoder();
 return timingSafeEqual(encoder.encode(token),encoder.encode(expected));
}

type RoomReply={result?:Record<string,unknown>;error?:{code:number;message:string;data?:unknown}};

export function registerSepEvents(server:McpServer,authenticated:boolean,roomRequest:(input:SepSubscribe|SepUnsubscribe,method:'subscribe'|'unsubscribe')=>Promise<RoomReply>){
 server.server.registerCapabilities({extensions:{[extension]:{}}});
 server.server.setRequestHandler('events/list',{params:z.object({cursor:z.string().optional()}).optional()},async()=>({
  ...complete,events:[{...strategyEventDefinition,inputSchema:z.toJSONSchema(filter),description:'Live race telemetry requiring a strategy radio decision. Open a strategy seat and subscribe using its room and team.'}],
 }));
 for(const [method,schema] of [['subscribe',subscribe],['unsubscribe',unsubscribe]] as const){
  server.server.setRequestHandler(`events/${method}`,{params:schema},async input=>{
   if(!authenticated)throw new ProtocolError(-32024,SEP_AUTH_REQUIRED);
   if(input.name!==STRATEGY_EVENT)throw new ProtocolError(-32023,'Unknown event type.',{kind:'event'});
   if('mode' in input.delivery&&input.delivery.mode!=='webhook')throw unsupported(input.delivery.mode);
   const {result,error}=await roomRequest(input,method);
   if(error)throw new ProtocolError(error.code,error.message,error.data);
   return {...result,...complete};
  });
 }
 for(const [method,mode] of [['poll','poll'],['stream','push']] as const){
  server.server.setRequestHandler(`events/${method}`,{params:event},async({name})=>{
   if(name!==STRATEGY_EVENT)throw new ProtocolError(-32023,'Unknown event type.',{kind:'event'});
   throw unsupported(mode);
  });
 }
}

function unsupported(value:string){
 return new ProtocolError(-32026,'This event supports webhook delivery.',{feature:'deliveryMode',value});
}

export function sepEventHeaderError(request:Request,rpc:{id?:unknown;method?:string;params?:{name?:unknown}}|null){
 if(!rpc?.method||!deliveryMethods.has(rpc.method)||typeof rpc.params?.name!=='string'||
   (typeof rpc.id!=='string'&&typeof rpc.id!=='number'))return;
 const header=request.headers.get('Mcp-Name');
 const sentinel=header?.match(/^=\?base64\?([A-Za-z0-9+/]+={0,2})\?=$/);
 let name=header;
 if(sentinel){
  try{
   const decoded=atob(sentinel[1]);
   name=btoa(decoded)===sentinel[1]?new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(decoded,c=>c.charCodeAt(0))):null;
  }
  catch{name=null;}
 }
 if(name!==rpc.params.name)return Response.json({jsonrpc:'2.0',id:rpc.id,error:{code:-32020,message:'Mcp-Name must match params.name.'}},{status:400});
}
