import { H, PADDLE_H, clamp } from '../src/physics';
import { intercept, mockBrain, PERSONAS, type Decision, type Snapshot } from '../src/agents';
export const LUNA_MODEL = 'gpt-6-luna';
export interface LunaConfig { mock: boolean; apiKey?: string; baseURL: string; model: typeof LUNA_MODEL; intervalMs: number; tokensPerMinute: number }
export function lunaConfig(env: Record<string, string | undefined>): LunaConfig {
  const mock = env.JEV_MOCK === '1' || env.LUNA_MOCK === '1' || !env.OPENAI_API_KEY;
  if (env.JEV_MOCK !== '1' && env.LUNA_MOCK === '0' && !env.OPENAI_API_KEY) throw new Error('LUNA_MOCK=0 requires OPENAI_API_KEY');
  const intervalMs=Number(env.LUNA_INTERVAL_MS??600),tokensPerMinute=Number(env.LUNA_TPM_BUDGET??60000);
  if(!Number.isFinite(intervalMs)||intervalMs<200||intervalMs>60000)throw new Error('LUNA_INTERVAL_MS must be 200–60000');
  if(!Number.isFinite(tokensPerMinute)||tokensPerMinute<1)throw new Error('LUNA_TPM_BUDGET must be positive');
  return { mock, apiKey: env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1', model: LUNA_MODEL, intervalMs, tokensPerMinute };
}
interface ChoiceAnswer { type: 'choice'; name: string; choice: string; confidence: number }
function choiceAnswer(answers: unknown, name: string, allowed: string[]): ChoiceAnswer {
  if (!Array.isArray(answers)) throw new Error('Missing Decisions answers');
  const matches = answers.filter((a: unknown): a is ChoiceAnswer => !!a && typeof a === 'object' && (a as ChoiceAnswer).name === name);
  const a = matches[0];
  if (matches.length !== 1 || a.type !== 'choice' || !allowed.includes(a.choice) || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) throw new Error('Invalid or refused Decisions answer');
  return a;
}
export function lunaRequest(s: Snapshot) {
  const persona = PERSONAS[s.side];
  return {
    model: LUNA_MODEL,
    input: [{ role: 'user' as const, content: [
      { type: 'input_text' as const, text: `Pong 1000x560; y down; walls y=7,553; paddle height 86, speed 470. You are ${persona.name}: ${persona.subtitle}. Choose paddle center using projected_intercept_y.` },
      { type: 'input_json' as const, data: { side:s.side, ball:Object.fromEntries(Object.entries(s.ball).map(([k,v])=>[k,Math.round(v*10)/10])), paddle:Math.round(s.paddle), opponent:Math.round(s.opponent), score:s.score, rally:s.rally, projected_intercept_y:Math.round(intercept(s)) } },
    ] }],
    questions: [
      { type: 'choice' as const, name: 'target', instructions: 'Choose paddle center y.', choices: Array.from({ length: 17 }, (_, i) => ({ value: `lane_${i}`, description: String(Math.round(PADDLE_H / 2 + i * (H - PADDLE_H) / 16)) })) },
      { type: 'choice' as const, name: 'move', instructions: 'Paddle direction?', choices: [{ value: 'up' }, { value: 'down' }, { value: 'stay' }] },
      { type: 'choice' as const, name: 'taunt', instructions: 'Pick an in-character taunt.', choices: persona.taunts.map((description, i) => ({ value: `line_${i}`, description })) },
    ],
  };
}
/** OpenAI Decisions REST API, using Web-standard fetch so Node and Workers share the adapter. */
export function createLunaBrain(config: LunaConfig, transport: typeof fetch = fetch) {
  let failures=0;
  return async (s: Snapshot, sequence: number): Promise<Decision> => {
    const start = performance.now();
    if (config.mock) {
      await new Promise(resolve => setTimeout(resolve, 45 + s.tick % 47));
      return { action: mockBrain(s), source: 'mock', responseMs: Math.round(performance.now() - start), sequence };
    }
    let api:Decision['api'],retryAfterMs=config.intervalMs,warning='Luna Decisions unavailable · heuristic fallback';
    try {
      if (!config.apiKey) throw new Error('Missing OpenAI key');
      const request = lunaRequest(s);
      const response = await transport(`${config.baseURL.replace(/\/$/, '')}/decisions`, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(1500) });
      api={status:response.status,requestId:response.headers.get('x-request-id')??undefined};
      if (!response.ok) {
        const error=await response.json().catch(()=>null) as {error?:{message?:string}}|null;
        failures++;
        retryAfterMs=Math.min(60000,1000*2**Math.min(failures,6));
        if(response.status===429){
          // Expose only recognized quota units and numeric limits, never upstream messages/credentials.
          const quota=String(error?.error?.message??'').match(/on (tokens per min|requests per min|requests per day) \((TPM|RPM|RPD)\): Limit (\d+(?:,\d+)*)/);
          const limit=quota?`${quota[3]} ${quota[2]==='TPM'?'tokens/min':quota[2]==='RPD'?'requests/day':'requests/min'}`:'rate limit';
          const header=response.headers.get('retry-after');
          const delay=header===null?NaN:Number.isFinite(Number(header))?Number(header)*1000:Date.parse(header)-Date.now();
          if(Number.isFinite(delay)&&delay>0)retryAfterMs=Math.max(retryAfterMs,Math.ceil(delay));
          warning=`Luna HTTP 429 · ${limit} · retry in ${Math.ceil(retryAfterMs/1000)}s · heuristic fallback`;
        }else warning=`Luna HTTP ${response.status} · heuristic fallback`;
        throw new Error('Decisions HTTP error');
      }
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || !('answers' in result) || !('model' in result) || typeof result.model !== 'string' || !/^gpt-6-luna(?:-|$)/.test(result.model)) throw new Error('Unexpected Decisions response');
      const target = choiceAnswer(result.answers, 'target', request.questions[0].choices.map(c => c.value));
      const move = choiceAnswer(result.answers, 'move', ['up', 'down', 'stay']);
      const taunt = choiceAnswer(result.answers, 'taunt', ['line_0', 'line_1', 'line_2', 'line_3']);
      const usage='usage' in result?result.usage as {input_tokens?:unknown}:undefined;
      if(typeof usage?.input_tokens==='number'&&Number.isFinite(usage.input_tokens)&&usage.input_tokens>=0)api.inputTokens=usage.input_tokens;
      // Reserve 20% headroom. Use the tighter configured/provider TPM budget when available.
      const limits=[config.tokensPerMinute,...['x-ratelimit-limit-tokens','x-ratelimit-limit-project-tokens'].map(h=>Number(response.headers.get(h)))].filter(n=>n>0&&Number.isFinite(n));
      retryAfterMs=Math.max(config.intervalMs,Math.ceil((api.inputTokens??0)*60000/(Math.min(...limits)*.8)));
      const rpm=Number(response.headers.get('x-ratelimit-limit-requests'));
      if(rpm>0)retryAfterMs=Math.max(retryAfterMs,Math.ceil(60000/(rpm*.8)));
      failures=0;
      const index = Number(target.choice.replace('lane_', ''));
      return { source: 'luna', sequence, responseMs: Math.round(performance.now() - start), retryAfterMs, api, action: { target_y: clamp(PADDLE_H / 2 + index * (H - PADDLE_H) / 16, PADDLE_H / 2, H - PADDLE_H / 2), move: move.choice as 'up' | 'down' | 'stay', taunt: PERSONAS[s.side].taunts[Number(taunt.choice.replace('line_', ''))], confidence: target.confidence } };
    } catch(error) {
      if(error instanceof Error&&error.name==='TimeoutError'){warning='Luna timeout · heuristic fallback';retryAfterMs=Math.max(retryAfterMs,2000);}
      else if(api?.status===200){warning='Luna invalid response · heuristic fallback';retryAfterMs=Math.max(retryAfterMs,2000);}
      return { action: mockBrain(s), source: 'fallback', responseMs: Math.round(performance.now() - start), sequence, warning, retryAfterMs, api };
    }
  };
}
