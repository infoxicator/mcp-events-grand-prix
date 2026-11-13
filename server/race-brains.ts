import {choice,TypeSafeClient,type TypeSafeClientConfig} from '@typesafe-ai/sdk';
import {z} from 'zod';
import {providerConfig,type ProviderConfig} from './jev';
import {mockDriver,mockEngineer} from '../src/race/brains';
import {other} from '../src/race/physics';
import {type Race,type Team,type DriverIntent,type Instruction,type Decision} from '../src/race/types';
export {providerConfig};
const instructionSchema=z.object({pace:z.enum(['push','balanced','manage']),ers:z.enum(['deploy','balanced','harvest']),box:z.boolean(),tyre:z.enum(['soft','medium','hard']),tactic:z.enum(['attack','defend','hold']),line:z.string().min(1).max(180)});
export function createRaceDriver(config:ProviderConfig,transport?:TypeSafeClientConfig['fetch']){
 const client=config.mock?null:new TypeSafeClient({apiKey:config.apiKey,baseURL:config.baseURL,compression:false,timeout:1200,retry:{maxRetries:0},logLevel:'off',...(transport?{fetch:transport}:{})});
 return async(s:Race,team:Team,sequence:number):Promise<Decision>=>{
  const start=performance.now(),fallback=mockDriver(s,team),done=(intent:DriverIntent,source:Decision['source']):Decision=>({sequence,intent,source,responseMs:Math.max(1,Math.round(performance.now()-start))});
  if(!client)return done(fallback,'mock');
  try{const c=s.cars[team],r=s.cars[other(team)];
   const {answers}=await client.systemOne({model:config.model,state:{game:'F1 at Monza. Follow engineer strategy; the local controller brakes for corners. a=calm Vector; b=aggressive Chaos.',team,tick:s.tick,metres:Math.round(c.distance),speedKmh:Math.round(c.speed*3.6),gapMetres:Math.round(r.distance-c.distance),rivalOffset:r.offset,wear:Number(c.wear.toFixed(2)),battery:Math.round(c.ers),instruction:{...c.instruction}},questions:{line:choice('Choose racing line; pass beside, not through the rival.',{left:'Offset -3m',hold:'Racing line',right:'Offset +3m'}),pace:choice('Target speed bias in addition to safe local cornering.',{cautious:'-2m/s',normal:'0m/s',attack:'+2m/s'}),brake:choice('Brake point aggression.',{early:'Conserve tyres',normal:'Balanced',late:'Late braking'}),ers:choice('Deploy battery now?',{yes:'Deploy',no:'Harvest or hold'}),drs:choice('Request DRS if eligible?',{yes:'Use eligible DRS zone',no:'Keep closed'}),reply:choice('Reply over team radio.',{copy:fallback.reply,attack:team==='a'?'Copy. Setting up the pass.':'I’m sending it. Watch this.',tyres:'The rears are going. Need a new set.'})}},{signal:AbortSignal.timeout(1400)});
   const line=answers.line.choice,pace=answers.pace.choice,brake=answers.brake.choice,reply=answers.reply.choice;
   if(!['left','hold','right'].includes(line)||!['cautious','normal','attack'].includes(pace)||!['early','normal','late'].includes(brake)||!['copy','attack','tyres'].includes(reply)||!['yes','no'].includes(answers.ers.choice)||!['yes','no'].includes(answers.drs.choice))throw new Error('Invalid Jev choice');
   return done({offset:line==='left'?-3:line==='right'?3:0,side:line,speedBias:pace==='attack'?2:pace==='cautious'?-2:0,brakeAggression:brake==='late'?.9:brake==='early'?.2:.55,ers:answers.ers.choice==='yes',drs:answers.drs.choice==='yes',reply:reply==='copy'?fallback.reply:reply==='attack'?(team==='a'?'Copy. Setting up the pass.':'I’m sending it. Watch this.'):'The rears are going. Need a new set.'},'jev');
  }catch{return done(fallback,'fallback');}
 };
}
export function createRaceEngineer(env:Record<string,string|undefined>,transport:typeof fetch=fetch){
 const mock=env.JEV_MOCK==='1'||env.ENGINEER_MOCK==='1',provider=env.ENGINEER_PROVIDER??(env.OPENROUTER_API_KEY?'openrouter':'vercel'),key=provider==='openrouter'?env.OPENROUTER_API_KEY:env.AI_GATEWAY_API_KEY;
 return async(s:Race,team:Team):Promise<{instruction:Instruction;source:'mock'|'live'|'fallback';responseMs:number}>=>{
  const start=performance.now(),rule=mockEngineer(s,team);if(mock||!key)return {instruction:rule,source:'mock',responseMs:1};
  try{const res=await transport(provider==='openrouter'?'https://openrouter.ai/api/v1/chat/completions':'https://ai-gateway.vercel.sh/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(5000),body:JSON.stringify({model:env.ENGINEER_MODEL??(provider==='openrouter'?'openai/gpt-4.1':'openai/gpt-4.1'),temperature:.4,response_format:{type:'json_object'},max_tokens:220,messages:[{role:'system',content:'You are an F1 race engineer. Three-lap Monza demo; accelerated tyre wear. Think strategically: undercut, battery, gaps, compound. Output JSON only: {pace:push|balanced|manage,ers:deploy|balanced|harvest,box:boolean,tyre:soft|medium|hard,tactic:attack|defend|hold,line:short authentic radio line}. Box early when soft wear is high. Do not box repeatedly after one stop.'},{role:'user',content:JSON.stringify({team,elapsed:s.time,laps:s.laps,car:s.cars[team],rival:s.cars[other(team)]})}]})});
   if(!res.ok)throw new Error('Engineer HTTP failure');const data=await res.json() as {choices?:{message?:{content?:string}}[]};const instruction=instructionSchema.parse(JSON.parse(data.choices?.[0]?.message?.content??''));return {instruction,source:'live',responseMs:Math.round(performance.now()-start)};
  }catch{return {instruction:rule,source:'fallback',responseMs:Math.round(performance.now()-start)};}
 };
}
