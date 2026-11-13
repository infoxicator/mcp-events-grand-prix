import { choice, TypeSafeClient, type TypeSafeClientConfig } from '@typesafe-ai/sdk';
import { H, PADDLE_H, clamp } from '../src/physics';
import { mockBrain, intercept, PERSONAS, type Action, type Decision, type Snapshot } from '../src/agents';
export interface ProviderConfig { mock: boolean; provider: 'typesafe'|'openrouter'|'vercel'|'mock'; apiKey?: string; baseURL?: string; model: string }
export function providerConfig(env: Record<string,string|undefined> = (globalThis as {process?:{env:Record<string,string|undefined>}}).process?.env ?? {}): ProviderConfig {
  const provider=env.JEV_PROVIDER ?? (env.TYPESAFE_API_KEY?'typesafe':env.OPENROUTER_API_KEY?'openrouter':env.AI_GATEWAY_API_KEY?'vercel':'mock');
  if (!['typesafe','openrouter','vercel','mock'].includes(provider)) throw new Error('JEV_PROVIDER must be typesafe, openrouter, vercel, or mock');
  const apiKey=provider==='typesafe'?env.TYPESAFE_API_KEY:provider==='vercel'?env.AI_GATEWAY_API_KEY:provider==='openrouter'?env.OPENROUTER_API_KEY:undefined;
  const mock=env.JEV_MOCK==='1'||provider==='mock'||!apiKey;
  if(env.JEV_MOCK==='0'&&mock)throw new Error('JEV_MOCK=0 requires a key for the selected TypeSafe, OpenRouter, or AI Gateway provider');
  return { mock, provider:mock?'mock':provider as 'typesafe'|'openrouter'|'vercel', apiKey, baseURL:provider==='typesafe'?'https://api.typesafe.ai':provider==='vercel'?'https://ai-gateway.vercel.sh/typesafe':'https://openrouter.ai/api', model:env.JEV_MODEL??(provider==='typesafe'?'jev-latest':provider==='vercel'?'typesafe-ai/jev':'jev-1.13') };
}
export function createBrain(config: ProviderConfig, transport?: TypeSafeClientConfig['fetch']) {
  const client=config.mock?null:new TypeSafeClient({ apiKey:config.apiKey, baseURL:config.baseURL, compression:false, timeout:1500, retry:{maxRetries:0}, logLevel:'off', ...(transport?{fetch:transport}:{}) });
  return async (s:Snapshot,sequence:number):Promise<Decision>=>{
    const start=performance.now();
    if(!client) { await new Promise(resolve=>setTimeout(resolve,45+(s.tick%47)));return {action:mockBrain(s),source:'mock',responseMs:Math.round(performance.now()-start),sequence}; }
    try {
      const persona=PERSONAS[s.side];
      const lanes=Object.fromEntries(Array.from({length:17},(_,i)=>[`lane_${i}`,`Paddle center y=${Math.round(PADDLE_H/2+i*(H-PADDLE_H)/16)} pixels`]));
      const taunts=Object.fromEntries(persona.taunts.map((text,i)=>[`line_${i}`,text]));
      const { answers }=await client.systemOne({ model:config.model, state:{ game:'Pong. Arena 1000x560. y increases downward. Ball reflects at y=7 and 553. Paddle height 86, speed 470px/s. Predict ball arrival at your paddle x=53 (left) or 947 (right).', persona:`You are ${persona.name}: ${persona.subtitle}. ${persona.motto}`, ...s, projected_intercept_y:Math.round(intercept(s)) }, questions:{ target:choice('Choose the paddle center lane that intercepts the approaching ball; recover toward center when it travels away.',lanes), move:choice('Which direction should your paddle move now?',{up:'toward y=0',down:'toward y=560',stay:'hold position'}), taunt:choice('Pick a short in-character line for this moment.',taunts) } },{signal:AbortSignal.timeout(1600)});
      const index=Number(answers.target.choice.replace('lane_',''));
      if(!Number.isInteger(index)||index<0||index>16)throw new Error('Invalid lane');
      const move=answers.move.choice;
      if(!['up','down','stay'].includes(move))throw new Error('Invalid move');
      const tauntIndex=Number(answers.taunt.choice.replace('line_',''));
      const action:Action={target_y:clamp(PADDLE_H/2+index*(H-PADDLE_H)/16,PADDLE_H/2,H-PADDLE_H/2),move,taunt:persona.taunts[tauntIndex]??persona.motto,confidence:answers.target.confidence};
      return {action,source:'jev',responseMs:Math.round(performance.now()-start),sequence};
    } catch {
      return {action:mockBrain(s),source:'fallback',responseMs:Math.round(performance.now()-start),sequence,warning:'Provider unavailable · heuristic fallback'};
    }
  };
}
