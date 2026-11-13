/** Adapted from Jev Pong's OpenAI Decisions driver. Keys and HTTP stay server-side. */
import {mockDriver} from '../src/race/brains';
import {other} from '../src/race/physics';
import type {Race,Team,Decision} from '../src/race/types';
export const LUNA_MODEL='gpt-6-luna';
export interface LunaConfig{mock:boolean;apiKey?:string;baseURL:string;model:typeof LUNA_MODEL;intervalMs:number;tokensPerMinute:number}
export function lunaConfig(env:Record<string,string|undefined>):LunaConfig{
 const mock=env.JEV_MOCK==='1'||env.LUNA_MOCK==='1'||!env.OPENAI_API_KEY;
 if(env.JEV_MOCK!=='1'&&env.LUNA_MOCK==='0'&&!env.OPENAI_API_KEY)throw new Error('LUNA_MOCK=0 requires OPENAI_API_KEY');
 const intervalMs=Number(env.LUNA_INTERVAL_MS??600),tokensPerMinute=Number(env.LUNA_TPM_BUDGET??60000);
 if(!Number.isFinite(intervalMs)||intervalMs<200||intervalMs>60000)throw new Error('LUNA_INTERVAL_MS must be 200–60000');
 if(!Number.isFinite(tokensPerMinute)||tokensPerMinute<1)throw new Error('LUNA_TPM_BUDGET must be positive');
 return {mock,apiKey:env.OPENAI_API_KEY,baseURL:'https://api.openai.com/v1',model:LUNA_MODEL,intervalMs,tokensPerMinute};
}
export function lunaRequest(s:Race,team:Team){
 const c=s.cars[team],r=s.cars[other(team)],fallback=mockDriver(s,team);
 const question=(name:string,instructions:string,choices:Record<string,string>)=>({type:'choice' as const,name,instructions,choices:Object.entries(choices).map(([value,description])=>({value,description}))});
 return {model:LUNA_MODEL,input:[{role:'user' as const,content:[
  {type:'input_text' as const,text:`F1 at Monza. Follow engineer strategy; local control handles corners and smooths intent. Team ${team}: ${team==='a'?'calm Vector':'aggressive Chaos'}. Pick independent driving choices.`},
  {type:'input_json' as const,data:{team,tick:s.tick,metres:Math.round(c.distance),speedKmh:Math.round(c.speed*3.6),gapMetres:Math.round(r.distance-c.distance),rivalOffset:Math.round(r.offset*10)/10,wear:Number(c.wear.toFixed(2)),battery:Math.round(c.ers),instruction:{...c.instruction}}},
 ]}],questions:[
  question('line','Racing line. Pass beside, not through the rival.',{left:'Offset -3m',hold:'Racing line',right:'Offset +3m'}),
  question('pace','Speed bias in addition to safe cornering.',{cautious:'-2m/s',normal:'0m/s',attack:'+2m/s'}),
  question('brake','Brake point aggression.',{early:'Conserve tyres',normal:'Balanced',late:'Late braking'}),
  question('ers','Deploy battery now?',{yes:'Deploy',no:'Harvest or hold'}),
  question('drs','Request DRS if eligible?',{yes:'Use eligible DRS zone',no:'Keep closed'}),
  question('reply','Reply over team radio.',{copy:fallback.reply,attack:team==='a'?'Copy. Setting up the pass.':'I’m sending it. Watch this.',tyres:'The rears are going. Need a new set.'}),
 ]};
}
function answer(answers:unknown,name:string,allowed:string[]):string{
 if(!Array.isArray(answers))throw new Error('Missing answers');
 const matches=answers.filter(a=>a&&typeof a==='object'&&a.name===name),a=matches[0];
 if(matches.length!==1||a.type!=='choice'||!allowed.includes(a.choice)||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)throw new Error('Invalid or refused answer');
 return a.choice;
}
const retryDelay=(header:string|null,now:number)=>header===null?0:/^\d+(?:\.\d+)?$/.test(header)?Number(header)*1000:Math.max(0,Date.parse(header)-now)||0;
export function createLunaDriver(config:LunaConfig,transport:typeof fetch=fetch,clock:()=>number=Date.now){
 let failures=0,nextAllowedAt=0,last:Decision|null=null;
 return async(s:Race,team:Team,sequence:number):Promise<Decision>=>{
  const start=performance.now(),fallback=mockDriver(s,team);
  const done=(source:Decision['source'],intent=fallback):Decision=>({engine:'luna',source,sequence,intent,responseMs:Math.max(1,Math.round(performance.now()-start)),attempted:false});
  if(config.mock)return done('mock');
  if(last&&clock()<nextAllowedAt)return {...last,sequence,attempted:false,cached:true,retryAfterMs:Number.isFinite(nextAllowedAt)?Math.max(1,nextAllowedAt-clock()):60000};
  let api:NonNullable<Decision['api']>={provider:'openai',model:LUNA_MODEL},warning='Luna invalid response · local fallback',retryAfterMs=Math.max(config.intervalMs,2000);
  let permanent=false;
  try{
   const request=lunaRequest(s,team);
   const response=await transport(`${config.baseURL.replace(/\/$/,'')}/decisions`,{method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(1500)});
   const requestId=response.headers.get('x-request-id');api.status=response.status;if(requestId&&/^[a-zA-Z0-9._:-]{1,160}$/.test(requestId)&&(!config.apiKey||!requestId.includes(config.apiKey)))api.requestId=requestId;
   if(!response.ok){
    const body=await response.json().catch(()=>null) as {error?:{message?:string}}|null;failures++;
    retryAfterMs=Math.max(config.intervalMs,Math.min(60000,1000*2**Math.min(failures,6)),retryDelay(response.headers.get('retry-after'),clock()));
    api.code=response.status===401?'authentication':response.status===403?'permission':response.status===429?'rate-limit':'provider';
    permanent=response.status===401||response.status===403;
    const quota=String(body?.error?.message??'').match(/on (tokens per min|requests per min|requests per day) \((TPM|RPM|RPD)\): Limit (\d+(?:,\d+)*)/);
    const limit=quota?`${quota[3]} ${quota[2]==='TPM'?'tokens/min':quota[2]==='RPD'?'requests/day':'requests/min'}`:'rate limit';
    warning=response.status===429?`Luna HTTP 429 · ${limit} · retry in ${Math.ceil(retryAfterMs/1000)}s · local fallback`:permanent?`Luna HTTP ${response.status} · check the OpenAI key and access, then restart the server.`:`Luna HTTP ${response.status} · local fallback`;
    throw new Error('Decisions HTTP failure');
   }
   const result=await response.json() as {model?:unknown;answers?:unknown;usage?:{input_tokens?:unknown}};
   if(typeof result.model!=='string'||!/^gpt-6-luna(?:-|$)/.test(result.model))throw new Error('Wrong model');
   const choices=Object.fromEntries(request.questions.map(q=>[q.name,answer(result.answers,q.name,q.choices.map(c=>c.value))]));
   if(typeof result.usage?.input_tokens==='number'&&Number.isFinite(result.usage.input_tokens)&&result.usage.input_tokens>=0)api.inputTokens=result.usage.input_tokens;
   const limits=[config.tokensPerMinute,...['x-ratelimit-limit-tokens','x-ratelimit-limit-project-tokens'].map(h=>Number(response.headers.get(h)))].filter(n=>n>0&&Number.isFinite(n));
   retryAfterMs=Math.max(config.intervalMs,Math.ceil((api.inputTokens??0)*60000/(Math.min(...limits)*.8)));
   const rpm=Number(response.headers.get('x-ratelimit-limit-requests'));if(rpm>0&&Number.isFinite(rpm))retryAfterMs=Math.max(retryAfterMs,Math.ceil(60000/(rpm*.8)));
   const reply=request.questions.find(q=>q.name==='reply')!.choices.find(c=>c.value===choices.reply)!.description;
   last={...done('luna',{offset:choices.line==='left'?-3:choices.line==='right'?3:0,side:choices.line as 'left'|'right'|'hold',speedBias:choices.pace==='attack'?2:choices.pace==='cautious'?-2:0,brakeAggression:choices.brake==='late'?.9:choices.brake==='early'?.2:.55,ers:choices.ers==='yes',drs:choices.drs==='yes',reply}),attempted:true,retryAfterMs,api};failures=0;
  }catch(error){
   if(error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError')){warning='Luna request timed out · local fallback';api.code='timeout';}
   else if(api.status===200){api.code='invalid-response';warning='Luna invalid response · local fallback';}
   else if(!api.status){api.code='connection';warning='Cannot reach Luna Decisions · local fallback';}
   last={...done('fallback'),attempted:true,warning,retryAfterMs,api};
  }
  nextAllowedAt=permanent?Infinity:clock()+retryAfterMs;return last;
 };
}
