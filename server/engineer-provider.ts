type Environment = Record<string,string|undefined>;

export function engineerProvider(env: Environment, transport: typeof fetch = fetch) {
 const provider = env.ENGINEER_PROVIDER ?? (env.OPENROUTER_API_KEY ? 'openrouter' : 'vercel');
 const key = provider === 'openrouter' ? env.OPENROUTER_API_KEY : env.AI_GATEWAY_API_KEY;
 const endpoint = provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://ai-gateway.vercel.sh/v1/chat/completions';
 const model = env.ENGINEER_MODEL ?? 'openai/gpt-4.1';
 if (!key || env.ENGINEER_MOCK === '1' || env.JEV_MOCK === '1') return null;
 return {
  model,
  async complete(prompt: string, observation: unknown, signal: AbortSignal, temperature = 0) {
   const res = await transport(endpoint,{
    method:'POST',
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),
    body:JSON.stringify({
     model,temperature,response_format:{type:'json_object'},max_tokens:220,
     messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(observation)}],
    }),
   });
   if (!res.ok) throw new Error('Engineer HTTP failure');
   const data = await res.json() as {choices?:{message?:{content?:string}}[]};
   return JSON.parse(data.choices?.[0]?.message?.content ?? '') as unknown;
  },
 };
}
