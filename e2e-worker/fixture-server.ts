import {createServer} from 'node:http';
import {createHmac,generateKeyPairSync,sign} from 'node:crypto';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const kid='grand-prix-fixture',issuer='https://grand-prix-test.cloudflareaccess.com';
const owner='owner@example.test',audience='grand-prix-fixture';
const base64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
const choices={line:'hold',pace:'normal',brake:'normal',ers:'no',drs:'yes',reply:'copy'};
const answer=(choice:string)=>({type:'choice',choice,confidence:1,probabilities:{[choice]:1}});
const calls={jev:0,luna:0,engineer:0,keys:0};
const webhooks=new Map<string,{id:string;verifications:number;events:unknown[]}>();
const sepWebhooks=new Map<string,{verifications:number;attempts:{id:string;signatures:number;value:Record<string,unknown>;status:number}[]}>();
let badKeys=false,badEngineer=false;
createServer(async(req,res)=>{
 const url=new URL(req.url!,'http://127.0.0.1:8798');
 const send=(value:unknown,status=200)=>{
  res.writeHead(status,{'Content-Type':'application/json'});
  res.end(JSON.stringify(value));
 };
 if(url.pathname==='/fixture'){
  if(req.method==='POST'){
   badKeys=url.searchParams.get('keys')==='redirect';
   badEngineer=url.searchParams.get('engineer')==='fail';
  }
  return send(calls);
 }
 if(url.pathname==='/token'){
  const now=Math.floor(Date.now()/1000);
  const header=base64({alg:'RS256',kid});
  const body=base64({
   iss:url.searchParams.get('iss')??issuer,aud:[url.searchParams.get('aud')??audience],
   email:url.searchParams.get('email')??owner,exp:now+(url.searchParams.has('expired')?-10:300),
   nbf:now+(url.searchParams.has('future')?120:-10),
  });
  const signed=`${header}.${body}`;
  const signature=sign('sha256',Buffer.from(signed),privateKey);
  if(url.searchParams.has('tampered'))signature[0]^=255;
  return send({token:`${signed}.${signature.toString('base64url')}`});
 }
 if(url.pathname.startsWith('/sep-callback/')&&req.method==='POST'){
  let body='';
  for await(const chunk of req)body+=chunk;
  const headers=req.headers;
  const id=headers['webhook-id'],timestamp=headers['webhook-timestamp'],subscription=headers['x-mcp-subscription-id'];
  const signatures=[7,9].map(byte=>'v1,'+createHmac('sha256',Buffer.alloc(32,byte)).update(`${id}.${timestamp}.${body}`).digest('base64'));
  const signatureHeader=headers['webhook-signature'];
  const provided=typeof signatureHeader==='string'?signatureHeader.split(' '):undefined;
  const verified=provided?.filter(value=>signatures.includes(value)).length??0;
  if(typeof id!=='string'||!timestamp||!subscription||!provided?.length||verified!==provided.length)return send({error:'Invalid signature'},401);
  const value=JSON.parse(body);
  const received=sepWebhooks.get(url.pathname)??{verifications:0,attempts:[]};
  sepWebhooks.set(url.pathname,received);
  if(value.type==='verification'){
   received.verifications++;
   const reply={challenge:url.pathname.endsWith('-reject')?'incorrect':value.challenge};
   return send(url.pathname.endsWith('-oversize')?{...reply,padding:'x'.repeat(9000)}:reply);
  }
  const status=value.type==='terminated'?200:url.pathname.endsWith('-gone')?410:received.attempts.length===0?503:200;
  received.attempts.push({id,signatures:verified,value,status});
  return send({},status);
 }
 if(url.pathname.startsWith('/sep-callback/')&&req.method==='GET')return send(sepWebhooks.get(url.pathname)??{verifications:0,attempts:[]});
 if(url.pathname.startsWith('/webhook/mcp-events/')){
  if(req.method==='GET')return send(webhooks.get(url.pathname)??{verifications:0,events:[]});
  if(req.method!=='POST')return send({error:'Expected POST'},405);
  let body='';
  for await(const chunk of req)body+=chunk;
  const id=req.headers['webhook-id'],timestamp=req.headers['webhook-timestamp'],subscription=req.headers['x-mcp-subscription-id'];
  const signature='v1,'+createHmac('sha256',Buffer.alloc(32,7)).update(`${id}.${timestamp}.${body}`).digest('base64');
  if(typeof subscription!=='string'||!id||!timestamp||req.headers['webhook-signature']!==signature)return send({error:'Invalid signature'},401);
  const value=JSON.parse(body);
  const received=webhooks.get(url.pathname)??{id:subscription,verifications:0,events:[]};
  webhooks.set(url.pathname,received);
  if(received.id!==subscription)return send({error:'Unexpected subscription'},401);
  if(value.type==='verification'){
   received.verifications++;
   return send({challenge:url.pathname.endsWith('-reject')?'incorrect':value.challenge});
  }
  if(value.eventId!==id)return send({error:'Unexpected event ID'},400);
  received.events.push(value);
  return send({});
 }
 if(url.pathname==='/cdn-cgi/access/certs'){
  calls.keys++;
  if(badKeys){res.writeHead(302,{Location:'/keys'});return res.end();}
 }
 if(url.pathname==='/cdn-cgi/access/certs'||url.pathname==='/keys'){
  return send({keys:[{...publicKey.export({format:'jwk'}),kid,alg:'RS256'}]});
 }
 if(req.method!=='POST')return send({error:'Unknown fixture request'},404);
 let raw='';
 for await(const chunk of req)raw+=chunk;
 if(req.headers.authorization!=='Bearer fixture-only')return send({error:'Incorrect fixture credential'},401);
 const body=JSON.parse(raw);
 if(url.pathname.endsWith('/systemone')&&body.state&&body.questions){
  calls.jev++;
  return send({model:'jev-latest',answers:Object.fromEntries(Object.entries(choices).map(([key,choice])=>[key,answer(choice)])),usage:{input_tokens:100,output_tokens:10}});
 }
 if(url.pathname.endsWith('/decisions')&&body.model==='gpt-6-luna'){
  calls.luna++;
  return send({model:body.model,answers:Object.entries(choices).map(([name,choice])=>({name,...answer(choice)})),usage:{input_tokens:100,output_tokens:0}});
 }
 if(url.pathname.endsWith('/chat/completions')&&body.messages){
  calls.engineer++;
  if(badEngineer)return send({error:'Strategist fixture unavailable'},503);
  const instruction={pace:'balanced',ers:'balanced',box:false,tyre:'hard',tactic:'hold',line:'Fixture strategist on the pit wall.'};
  return send({choices:[{message:{content:JSON.stringify(instruction)}}]});
 }
 return send({error:'Unexpected provider request'},501);
}).listen(8798,'127.0.0.1');
