export interface ProviderConfig { mock: boolean; provider: 'typesafe'|'openrouter'|'vercel'|'mock'; apiKey?: string; baseURL?: string; model: string }
export function providerConfig(env: Record<string,string|undefined> = (globalThis as {process?:{env:Record<string,string|undefined>}}).process?.env ?? {}): ProviderConfig {
  const provider=env.JEV_PROVIDER ?? (env.TYPESAFE_API_KEY?'typesafe':env.OPENROUTER_API_KEY?'openrouter':env.AI_GATEWAY_API_KEY?'vercel':'mock');
  if (!['typesafe','openrouter','vercel','mock'].includes(provider)) throw new Error('JEV_PROVIDER must be typesafe, openrouter, vercel, or mock');
  const apiKey=provider==='typesafe'?env.TYPESAFE_API_KEY:provider==='vercel'?env.AI_GATEWAY_API_KEY:provider==='openrouter'?env.OPENROUTER_API_KEY:undefined;
  const mock=env.JEV_MOCK==='1'||provider==='mock'||!apiKey;
  if(env.JEV_MOCK==='0'&&mock)throw new Error('JEV_MOCK=0 requires a key for the selected TypeSafe, OpenRouter, or AI Gateway provider');
  return { mock, provider:mock?'mock':provider as 'typesafe'|'openrouter'|'vercel', apiKey, baseURL:provider==='typesafe'?'https://api.typesafe.ai':provider==='vercel'?'https://ai-gateway.vercel.sh/typesafe':'https://openrouter.ai/api', model:env.JEV_MODEL??(provider==='typesafe'?'jev-latest':provider==='vercel'?'typesafe-ai/jev':'jev-1.13') };
}
