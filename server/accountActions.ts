import { BRAND } from '../shared/brand';
import { firstPartyOrigin, record, validSelector } from '../shared/accounts';
import { rotationCookies, type SessionEnv } from './accountsSession';
import { clearOAuthCookie } from './githubOAuth';
import { appOrigin, jsonResponse, postGuard, smallJson, verifiedAccount } from './protectedRequest';

/** Narrow, explicit universal-menu mutations, never an arbitrary Accounts proxy. */
export async function handleAccountAction(request: Request, env: SessionEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const guard = postGuard(request, env);
  if (guard) return guard;
  const body = await smallJson(request);
  if (!body || !validSelector(body.selector)) return jsonResponse({ error: 'invalid_request' }, 400);
  const path = new URL(request.url).pathname;
  if (path !== '/api/accounts/signout' && path !== '/api/accounts/signout-all') return jsonResponse({ error: 'not_found' }, 404);
  if (path.endsWith('/signout') && (typeof body.slot !== 'string' || !/^[a-f]$/.test(body.slot))) return jsonResponse({ error: 'invalid_slot' }, 400);
  const account = await verifiedAccount(request, env, body.selector, fetcher);
  if (!account.ok) return account.response;
  if (path.endsWith('/signout') && !account.session.accounts.some((a) => a.slot === body.slot)) return jsonResponse({ error: 'account_not_available' }, 409, account.cookies);
  const api = firstPartyOrigin(env.ACCOUNTS_API_ORIGIN || BRAND.accountsApiOrigin)!;
  const endpoint = path.endsWith('/signout-all') ? '/api/auth/signout' : `/api/auth/accounts/${body.slot}/signout`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetcher(`${api}${endpoint}`, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Cookie: account.cookieHeader, Origin: appOrigin(env)! }, body: '{}' });
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json') || record(await response.json())?.ok !== true) return jsonResponse({ error: 'signout_failed', message: 'Accounts did not confirm sign-out. Please retry or manage your account on Accounts.' }, 502, account.cookies);
    // Explicit user-approved mutations may relay deletion cookies (unlike a read-only probe).
    return jsonResponse({ ok: true }, 200, [...account.cookies, ...rotationCookies(response.headers), clearOAuthCookie()]);
  } catch { return jsonResponse({ error: 'accounts_unavailable', message: 'Accounts sign-out could not be confirmed. Please retry.' }, 503, account.cookies); }
  finally { clearTimeout(timer); }
}
