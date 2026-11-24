import {timingSafeEqual} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {createServer, type IncomingMessage} from 'node:http';
import {request} from 'node:https';
import {BlockList, isIP} from 'node:net';
import {pathToFileURL} from 'node:url';
import {httpsCallbackUrl} from './sep-webhook-policy';

const blocked=new BlockList();
for(const [ip,bits] of [
 ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
 ['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],
 ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4],
] as const)blocked.addSubnet(ip,bits,'ipv4');
for(const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const)blocked.addSubnet(ip,bits,'ipv6');
const globalIPv6=new BlockList();
globalIPv6.addSubnet('2000::',3,'ipv6');

export function isPublicCallbackAddress(address:string){
 const family=isIP(address);
 if(family===4)return !blocked.check(address,'ipv4');
 return family===6&&globalIPv6.check(address,'ipv6')&&!blocked.check(address,'ipv6');
}

const deliveryHeaders=['webhook-id','webhook-timestamp','webhook-signature','x-mcp-subscription-id'] as const;
const maxPayloadBytes=256*1024;

async function readBody(input:IncomingMessage,limit:number){
 const chunks:Buffer[]=[];
 let size=0;
 for await(const chunk of input){
  const bytes:Buffer=chunk;
  size+=bytes.length;
  if(size>limit)throw new Error('Body too large');
  chunks.push(bytes);
 }
 return Buffer.concat(chunks,size);
}

function deliver(url:URL,address:string,headers:Record<string,string>,body:string){
 return new Promise<{status:number;body:Buffer}>((resolve,reject)=>{
  // Use the checked address directly. SNI and certificate verification use the original hostname.
  const outgoing=request({hostname:address,port:url.port||443,servername:url.hostname,rejectUnauthorized:true,agent:false,method:'POST',
   path:url.pathname+url.search,signal:AbortSignal.timeout(4500),
   headers:{...headers,Host:url.host,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},
  },async response=>{
   const status=response.statusCode!;
   if(!headers['webhook-id'].startsWith('msg_verification_')||status<200||status>=300){
    resolve({status,body:Buffer.alloc(0)});
    response.destroy();
    return;
   }
   try{resolve({status,body:await readBody(response,8192)});}
   catch(error){reject(error);}
  });
  outgoing.on('error',reject);
  outgoing.end(body);
 });
}

export function createSepWebhookEgress(token:string){
 if(!/^[a-f0-9]{64}$/.test(token))throw new Error('SEP webhook egress requires a token.');
 const expected=Buffer.from(`Bearer ${token}`);
 return createServer({requestTimeout:7000},async(req,res)=>{
  const fail=(status:number,reason?:string)=>{
   res.writeHead(status,reason?{'X-SEP-Callback-Error':reason}:{});
   res.end();
  };
  if(req.method!=='POST'||req.url!=='/deliver')return fail(404);
  const auth=Buffer.from(req.headers.authorization??'');
  if(auth.length!==expected.length||!timingSafeEqual(auth,expected))return fail(403);
  let input:{url?:unknown;headers?:Record<string,unknown>;body?:unknown}|null;
  try{input=JSON.parse((await readBody(req,2*maxPayloadBytes+8192)).toString());}
  catch{return fail(400,'challenge_failed');}
  const url=typeof input?.url==='string'&&httpsCallbackUrl(input.url);
  if(!url||isIP(url.hostname.replace(/^\[|\]$/g,''))||typeof input?.body!=='string'||Buffer.byteLength(input.body)>maxPayloadBytes){
   return fail(400,'challenge_failed');
  }
  const headers:Record<string,string>={};
  for(const key of deliveryHeaders){
   const value=input.headers?.[key];
   if(typeof value!=='string'||!value||value.length>512||!/^[ -~]+$/.test(value))return fail(400,'challenge_failed');
   headers[key]=value;
  }
  try{
   const addresses=await lookup(url.hostname,{all:true});
   if(!addresses.length||addresses.some(({address})=>!isPublicCallbackAddress(address)))return fail(400,'challenge_failed');
   const response=await deliver(url,addresses[0].address,headers,input.body);
   res.writeHead(200,{'X-SEP-Callback-Status':response.status,'Cache-Control':'no-store'});
   res.end(response.body);
  }catch(error){
   const code=(error as NodeJS.ErrnoException).code??'';
   const reason=code==='ABORT_ERR'||code==='ETIMEDOUT'?'timeout':/TLS|CERT|SSL/.test(code)?'tls_error':'connection_refused';
   fail(502,reason);
  }
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 createSepWebhookEgress(process.env.SEP_EVENTS_EGRESS_TOKEN??'')
  .listen(Number(process.env.SEP_EVENTS_EGRESS_PORT??8788),'127.0.0.1');
}
