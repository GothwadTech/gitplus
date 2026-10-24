import { BRAND } from '../shared/brand';
import { firstPartyOrigin, record, type AuthenticatedSession } from '../shared/accounts';
import { accountCookies, handleSession, sessionJson, type SessionEnv } from './accountsSession';

export function appOrigin(env: SessionEnv): string | null {
  return firstPartyOrigin(env.GITPLUS_ORIGIN || BRAND.productionOrigin);
}
export function jsonResponse(body: unknown, status = 200, cookies: string[] = []): Response {
  // Same no-store/security policy as identity responses, including secrets returned by OAuth completion.
  const response = sessionJson({ error: '' }, status, cookies);
  return new Response(JSON.stringify(body), { status, headers: response.headers });
}
export function postGuard(request: Request, env: SessionEnv): Response | null {
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const origin = appOrigin(env);
  if (!origin || new URL(request.url).origin !== origin || request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return jsonResponse({ error: 'origin_not_allowed' }, 403);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return jsonResponse({ error: 'json_required' }, 415);
  return null;
}
export async function smallJson(request: Request): Promise<Record<string, unknown> | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 4096) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return record(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { return null; }
}
export async function verifiedAccount(request: Request, env: SessionEnv, selector: string, fetcher: typeof fetch) {
  // Only called after route-specific CSRF/state checks. Cross-site OAuth callback navigation
  // must not be mistaken for a cross-site session API call.
  const url = new URL('/api/session', request.url);
  url.searchParams.set('authuser', selector);
  const response = await handleSession(new Request(url, { headers: { Cookie: request.headers.get('Cookie') || '' } }), env, fetcher);
  const data = await response.clone().json();
  if (!response.ok || data.status !== 'authenticated') return { ok: false as const, response };
  const cookies = response.headers.getSetCookie();
  // /auth/me can rotate credentials. Use the rotated values for any following provider mutation.
  const pairs = new Map(accountCookies(request.headers.get('Cookie') || '').split('; ').filter(Boolean).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
  for (const cookie of cookies) {
    const pair = cookie.split(';')[0];
    const name = pair.slice(0, pair.indexOf('='));
    if (/;\s*max-age=0(?:;|$)/i.test(cookie)) pairs.delete(name);
    else pairs.set(name, pair.slice(pair.indexOf('=') + 1));
  }
  return { ok: true as const, session: data as AuthenticatedSession, cookies, cookieHeader: Array.from(pairs, ([k, v]) => `${k}=${v}`).join('; ') };
}
