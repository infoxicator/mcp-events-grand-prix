import {resolve4,resolve6} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {CallbackTransportError} from './strategy-webhook';

export function httpsCallbackUrl(value:string){
 const url=URL.parse(value);
 return url?.protocol==='https:'&&!url.username&&!url.password&&!url.hash?url:null;
}

const blocked=new BlockList();
for(const [ip,bits] of [
 ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
 ['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],
 ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4],
] as const)blocked.addSubnet(ip,bits,'ipv4');
for(const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const)blocked.addSubnet(ip,bits,'ipv6');
const globalIPv6=new BlockList();
globalIPv6.addSubnet('2000::',3,'ipv6');

function isPublicCallbackAddress(address:string){
 const family=isIP(address);
 if(family===4)return !blocked.check(address,'ipv4');
 return family===6&&globalIPv6.check(address,'ipv6')&&!blocked.check(address,'ipv6');
}

export async function resolveSepCallback(hostname:string){
 const records=await Promise.allSettled([resolve4(hostname),resolve6(hostname)]);
 return records.flatMap(record=>{
  if(record.status==='fulfilled')return record.value;
  const code=(record.reason as NodeJS.ErrnoException)?.code;
  if(code==='ENODATA'||code==='ENOTFOUND')return [];
  throw new CallbackTransportError('connection_refused');
 });
}

export function sepCallbackTransport(outbound:typeof fetch,resolve=resolveSepCallback):typeof fetch{
 return async(input,init)=>{
  const url=httpsCallbackUrl(input instanceof Request?input.url:String(input));
  if(!url||isIP(url.hostname.replace(/^\[|\]$/g,'')))throw new CallbackTransportError('challenge_failed');
  const addresses=await resolve(url.hostname);
  if(addresses.length===0||addresses.some(address=>!isPublicCallbackAddress(address)))throw new CallbackTransportError('challenge_failed');
  init?.signal?.throwIfAborted();
  // The Worker enables global_fetch_strictly_public, so the connection itself is restricted to public destinations.
  try{return await outbound(url.href,{...init,redirect:'manual'});}
  catch(error){
   if(init?.signal?.aborted)throw error;
   throw new CallbackTransportError(error instanceof Error&&/tls|ssl|certificate/i.test(error.message)?'tls_error':'connection_refused');
  }
 };
}
