import { BRAND } from '../shared/brand';
import { firstPartyOrigin, publicIdentity, record, validSelector, type AccountSession } from '../shared/accounts';

export interface SessionEnv { GITPLUS_ORIGIN?: string; ACCOUNTS_API_ORIGIN?: string }
const COOKIE_NAME = /^gothwad_(?:at|rt|sid|active|accounts|sess_[a-f])$/;

export function accountCookies(header: string): string {
  return header.split(';').map((pair) => pair.trim()).filter((pair) => COOKIE_NAME.test(pair.split('=')[0])).join('; ');
}
export function rotationCookies(headers: Headers): string[] {
  // Cloudflare and modern Node expose separate Set-Cookie values; never split on commas (Expires).
  const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
  return values.filter((cookie) => {
    const parts = cookie.split(';').map((part) => part.trim());
    const domain = parts.find((p) => /^domain=/i.test(p))?.slice(7).replace(/^\./, '').toLowerCase();
    return COOKIE_NAME.test(parts[0].split('=')[0]) && domain === BRAND.domain
      && parts.some((p) => /^httponly$/i.test(p)) && parts.some((p) => /^secure$/i.test(p))
      && parts.some((p) => /^path=\/$/i.test(p)) && parts.some((p) => /^samesite=lax$/i.test(p));
  });
}

export function sessionJson(body: AccountSession | { error: string }, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'Vary': 'Cookie, X-Gothwad-Authuser',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}
const unavailable = (code: string, message: string, status = 503, cookies: string[] = []) => sessionJson({ status: 'unavailable', code, message }, status, cookies);

export async function handleSession(request: Request, env: SessionEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'GET') return sessionJson({ error: 'method_not_allowed' }, 405);
  const url = new URL(request.url);
  const origin = firstPartyOrigin(env.GITPLUS_ORIGIN || BRAND.productionOrigin);
  const apiOrigin = firstPartyOrigin(env.ACCOUNTS_API_ORIGIN || BRAND.accountsApiOrigin);
  if (!origin || !apiOrigin || apiOrigin === origin) return unavailable('invalid_configuration', 'Configure distinct HTTPS GitPlus and Accounts API origins under gothwadtech.com.');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin)) {
    return sessionJson({ error: 'origin_not_allowed' }, 403);
  }
  if (url.origin !== origin) return sessionJson({ status: 'unsupported', code: 'first_party_domain_required', message: 'Automatic Gothwad Accounts sign-in requires the configured Gothwad Tech custom domain. Shared cookies are not available on pages.dev, localhost or Arena previews.', productionOrigin: origin });
  const selector = url.searchParams.get('authuser');
  if (selector !== null && !validSelector(selector)) return sessionJson({ error: 'invalid_authuser' }, 400);
  const cookie = accountCookies(request.headers.get('Cookie') || '');
  if (!cookie) return sessionJson({ status: 'anonymous', code: 'signed_out', message: 'Sign in with Gothwad Accounts to continue to GitPlus.' }, 401);
  const headers = new Headers({ Accept: 'application/json', Cookie: cookie });
  if (selector !== null) headers.set('X-Gothwad-Authuser', selector);
  // No incoming Authorization header, arbitrary URL, password, or GitHub token is forwarded.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let cookies: string[] = [];
  try {
    const response = await fetcher(`${apiOrigin}/api/auth/me`, { headers, redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) return unavailable('accounts_redirect', 'Accounts API returned a redirect. Check its Worker custom domain; this is not a signed-out session.');
    if (response.status === 401 || response.status === 403) {
      // Accounts currently clears every slot on a failed /me. Do not propagate global sign-out
      // from a read-only GitPlus probe (especially when a selected slot disappears).
      return sessionJson({ status: 'anonymous', code: 'signed_out', message: 'The selected Gothwad session has expired. Sign in again.' }, 401);
    }
    if (response.status === 429) {
      const reply = unavailable('accounts_rate_limited', 'Accounts is rate-limited. Wait before retrying.', 429);
      const retry = response.headers.get('Retry-After');
      if (retry && /^\d{1,5}$/.test(retry)) reply.headers.set('Retry-After', retry);
      return reply;
    }
    if (!response.ok) return unavailable('accounts_unavailable', 'Gothwad Accounts is temporarily unavailable. Retry without signing out.');
    if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) return unavailable('accounts_not_json', 'Accounts returned a non-JSON page. Verify the API Worker route.');
    const raw: unknown = await response.json();
    // Only secure allowlisted cookies from the fixed Accounts endpoint can reach the browser.
    cookies = rotationCookies(response.headers);
    if (record(raw)?.authenticated === false) return sessionJson({ status: 'anonymous', code: 'signed_out', message: 'Sign in with Gothwad Accounts to continue.' }, 401);
    const identity = publicIdentity(raw);
    if (!identity) return unavailable('accounts_invalid_identity', 'Accounts returned an incomplete identity. Retry or contact Gothwad Tech support.', 503, cookies);
    // Accounts currently falls back to slots[0] for a missing explicit selector. Reject that
    // fallback rather than silently attaching another person's GitHub credentials.
    if (selector !== null && (/^[a-f]$/.test(selector) ? identity.activeSlot !== selector : identity.authuser !== Number(selector))) {
      return sessionJson({ status: 'anonymous', code: 'account_selection_changed', message: 'The selected account is no longer available. Choose a Gothwad account again.' }, 409, cookies);
    }
    return sessionJson(identity, 200, cookies);
  } catch {
    return unavailable('accounts_network_error', 'Could not verify Gothwad Accounts within the time limit. Check the connection and retry.', 503, cookies);
  } finally { clearTimeout(timer); }
}
