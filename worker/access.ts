export interface AccessConfig {
 ACCESS_ISSUER?: string;
 ACCESS_AUD?: string;
 ACCESS_OWNER_EMAIL?: string;
}

export function accessConfigured(env: AccessConfig) {
 return Boolean(env.ACCESS_ISSUER && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER)
  && env.ACCESS_AUD?.trim() && env.ACCESS_OWNER_EMAIL && /^[^\s@]+@[^\s@]+$/.test(env.ACCESS_OWNER_EMAIL));
}

function decode(segment: string): Uint8Array<ArrayBuffer> {
 if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('Invalid JWT encoding');
 return Uint8Array.from(atob(segment.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

export async function verifyAccessOwner(req: Request, env: AccessConfig, fetchKeys: typeof fetch = fetch) {
 if (!accessConfigured(env)) return false;
 const token = req.headers.get('Cf-Access-Jwt-Assertion')
  ?? req.headers.get('Cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1].trim();
 if (!token || token.length > 8192) return false;
 try {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [header, body, signature] = parts;
  const parse = (segment: string) => JSON.parse(new TextDecoder().decode(decode(segment)));
  const {alg,kid} = parse(header);
  if (alg !== 'RS256' || typeof kid !== 'string' || !kid) return false;
  const {iss,aud,exp,nbf,email} = parse(body);
  const now = Date.now() / 1000;
  if (iss !== env.ACCESS_ISSUER || !Array.isArray(aud) || !aud.includes(env.ACCESS_AUD) || email !== env.ACCESS_OWNER_EMAIL) return false;
  if (!Number.isFinite(exp) || exp <= now || (nbf !== undefined && (!Number.isFinite(nbf) || nbf > now))) return false;
  // Workerd supports manual redirects. Reject every response outside 2xx.
  const response = await fetchKeys(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`, {
   redirect:'manual',signal:AbortSignal.timeout(5000),
  });
  if (!response.ok) return false;
  const {keys} = await response.json() as {keys: (JsonWebKey & {kid?: string})[]};
  const jwk = keys.find(key => key.kid === kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256'));
  if (!jwk) return false;
  const algorithm = {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
  const key = await crypto.subtle.importKey('jwk',jwk,algorithm,false,['verify']);
  return await crypto.subtle.verify(algorithm,key,decode(signature),new TextEncoder().encode(`${header}.${body}`))
   && exp > Date.now() / 1000;
 } catch {
  return false;
 }
}
