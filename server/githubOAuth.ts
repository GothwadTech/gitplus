import { OAUTH_ERRORS, type OAuthErrorCode } from '../shared/githubOAuthErrors';
import { record, validSelector } from '../shared/accounts';
import { base64url, challengeFor, OAUTH_PROTOCOL, OAUTH_PROTOCOL_HEADER, OAUTH_DEPLOYMENT_HEADER, GITHUB_SCOPES, OAUTH_TTL_SECONDS, randomProof, validProof } from '../shared/githubOAuth';
import type { SessionEnv } from './accountsSession';
import { appOrigin, jsonResponse, postGuard, smallJson, verifiedAccount } from './protectedRequest';

export interface GitHubOAuthEnv extends SessionEnv { GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; CF_PAGES_COMMIT_SHA?: string }
export const TRANSACTION_COOKIE = '__Host-gitplus_oauth';
interface Transaction { state: string; challenge: string; owner: string; selector: string; expires: number; clientId: string; code?: string }
const encoder = new TextEncoder();
function configured(env: GitHubOAuthEnv): boolean {
  return typeof env.GITHUB_CLIENT_ID === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(env.GITHUB_CLIENT_ID) && typeof env.GITHUB_CLIENT_SECRET === 'string' && env.GITHUB_CLIENT_SECRET.length >= 16;
}
function cookie(value: string, age = OAUTH_TTL_SECONDS): string {
  return `${TRANSACTION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
}
export const clearOAuthCookie = () => cookie('', 0);
async function key(env: GitHubOAuthEnv): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(env.GITHUB_CLIENT_SECRET!), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(appOrigin(env)!), info: encoder.encode('GitPlus OAuth transaction v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function seal(data: Transaction, env: GitHubOAuthEnv): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), encoder.encode(JSON.stringify(data)));
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}
async function transaction(request: Request, env: GitHubOAuthEnv): Promise<Transaction | null> {
  try {
    const values = (request.headers.get('Cookie') || '').split(';').map((p) => p.trim()).filter((p) => p.startsWith(`${TRANSACTION_COOKIE}=`));
    if (values.length !== 1 || values[0].length > 3000) return null;
    const [iv, body, extra] = values[0].slice(TRANSACTION_COOKIE.length + 1).split('.');
    if (!iv || !body || extra) return null;
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, await key(env), decode(body));
    const data = record(JSON.parse(new TextDecoder().decode(decrypted)));
    if (!data || !validProof(data.state) || !validProof(data.challenge) || typeof data.owner !== 'string' || !validSelector(data.selector) || typeof data.expires !== 'number' || data.expires <= Date.now() || data.expires > Date.now() + OAUTH_TTL_SECONDS * 1000 || data.clientId !== env.GITHUB_CLIENT_ID) return null;
    if (data.code !== undefined && (typeof data.code !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(data.code))) return null;
    return data as unknown as Transaction;
  } catch { return null; }
}
function callbackRedirect(env: GitHubOAuthEnv, status: 'complete' | 'error', reason?: string, cookies: string[] = [], selector?: string): Response {
  const target = new URL('/', appOrigin(env)!);
  target.searchParams.set('github_oauth', status);
  if (reason) target.searchParams.set('oauth_error', reason);
  if (selector) target.searchParams.set('authuser', selector);
  const headers = jsonResponse({}, 200, cookies).headers;
  headers.set('Location', target.toString());
  return new Response(null, { status: 303, headers });
}
export async function handleGitHubOAuth(request: Request, env: GitHubOAuthEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  let response: Response;
  try { response = await oauthRequest(request, env, fetcher); }
  catch {
    // Do not leak runtime exception messages (which can contain credentials/URLs).
    response = jsonResponse({ error: 'github_internal_error', message: OAUTH_ERRORS.github_internal_error }, 500, [clearOAuthCookie()]);
  }
  response.headers.set(OAUTH_PROTOCOL_HEADER, OAUTH_PROTOCOL);
  const deployment = deploymentRevision(env);
  if (deployment) response.headers.set(OAUTH_DEPLOYMENT_HEADER, deployment);
  return response;
}
function deploymentRevision(env: GitHubOAuthEnv): string | null {
  const value = env.CF_PAGES_COMMIT_SHA;
  return typeof value === 'string' && /^[a-f0-9]{7,40}$/.test(value) ? value.slice(0, 12) : null;
}
async function oauthRequest(request: Request, env: GitHubOAuthEnv, fetcher: typeof fetch): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== appOrigin(env)) return jsonResponse({ error: 'first_party_domain_required' }, 403);
  if (url.pathname === '/api/github/config' && request.method === 'GET') return jsonResponse({ enabled: configured(env), scopes: GITHUB_SCOPES, protocol: OAUTH_PROTOCOL, deployment: deploymentRevision(env) });
  if (!configured(env)) return jsonResponse({ error: 'oauth_not_configured', message: 'Connect with GitHub is not configured yet. Use a PAT or ask the administrator to configure the OAuth App.' }, 503);

  if (url.pathname === '/api/github/callback') {
    if (request.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
    const txn = await transaction(request, env);
    const fail = (reason: string, cookies: string[] = []) => callbackRedirect(env, 'error', reason, [...cookies, clearOAuthCookie()]);
    if (!txn || txn.code || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== txn.state) return fail('invalid_state');
    if (url.searchParams.has('error')) return fail('denied');
    const code = url.searchParams.get('code');
    if (url.searchParams.getAll('code').length !== 1 || !code || !/^[A-Za-z0-9_-]{1,256}$/.test(code)) return fail('invalid_callback');
    const account = await verifiedAccount(request, env, txn.selector, fetcher);
    if (!account.ok) return fail('account_unavailable', account.response.headers.getSetCookie());
    if (account.session.user.id !== txn.owner) return fail('account_changed', account.cookies);
    // Code stays in a short-lived encrypted HttpOnly cookie. No token/code is copied into
    // the frontend URL, HTML or a redirect fragment. The originating tab must prove PKCE.
    const sealed = await seal({ ...txn, code }, env);
    return callbackRedirect(env, 'complete', undefined, [...account.cookies, cookie(sealed, Math.max(1, Math.floor((txn.expires - Date.now()) / 1000)))], txn.selector);
  }

  const guard = postGuard(request, env);
  if (guard) return guard;
  const body = await smallJson(request);
  if (!body) return jsonResponse({ error: 'invalid_request' }, 400);
  if (url.pathname === '/api/github/start') {
    if (!validProof(body.challenge) || !validSelector(body.selector) || (body.allowDelete !== undefined && typeof body.allowDelete !== 'boolean')) return jsonResponse({ error: 'invalid_request' }, 400);
    const account = await verifiedAccount(request, env, body.selector, fetcher);
    if (!account.ok) return account.response;
    const txn: Transaction = { state: randomProof(), challenge: body.challenge, owner: account.session.user.id, selector: account.session.activeSlot || String(account.session.authuser), expires: Date.now() + OAUTH_TTL_SECONDS * 1000, clientId: env.GITHUB_CLIENT_ID! };
    const target = new URL('https://github.com/login/oauth/authorize');
    target.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID!, redirect_uri: `${appOrigin(env)}/api/github/callback`, state: txn.state, scope: [...GITHUB_SCOPES, ...(body.allowDelete ? ['delete_repo'] : [])].join(' '), code_challenge: txn.challenge, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    return jsonResponse({ authorizeUrl: target.toString(), state: txn.state, ownerId: txn.owner }, 200, [...account.cookies, cookie(await seal(txn, env))]);
  }
  if (url.pathname !== '/api/github/complete') return jsonResponse({ error: 'not_found' }, 404);
  const txn = await transaction(request, env);
  const cleared = [clearOAuthCookie()];
  if (!txn?.code || !validProof(body.state) || body.state !== txn.state || !validProof(body.verifier) || await challengeFor(body.verifier) !== txn.challenge) return jsonResponse({ error: 'invalid_transaction', message: 'This GitHub connection attempt expired or belongs to another tab. Start again.' }, 400, cleared);
  const account = await verifiedAccount(request, env, txn.selector, fetcher);
  if (!account.ok) { account.response.headers.append('Set-Cookie', clearOAuthCookie()); return account.response; }
  const cookies = [...account.cookies, ...cleared];
  if (account.session.user.id !== txn.owner) return jsonResponse({ error: 'account_changed', message: 'Your Gothwad account changed. Start the GitHub connection again.' }, 409, cookies);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: txn.code, redirect_uri: `${appOrigin(env)}/api/github/callback`, code_verifier: body.verifier }),
    });
    const failed = (error: OAuthErrorCode, status = 502) => jsonResponse({ error, message: OAUTH_ERRORS[error], providerStatus: response.status }, status, cookies);
    // GitHub can report OAuth errors as JSON even with non-2xx statuses. Retain
    // only known error categories; never relay its description, body or URLs.
    let result: Record<string, unknown> | null = null;
    if (response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
      try { result = record(await response.json()); } catch { /* Report a safe category below. */ }
    }
    const providerErrors: Record<string, OAuthErrorCode> = {
      incorrect_client_credentials: 'github_client_credentials',
      redirect_uri_mismatch: 'github_redirect_mismatch',
      bad_verification_code: 'github_bad_code',
      incorrect_code_verifier: 'github_pkce_rejected',
      unverified_user_email: 'github_email_unverified',
    };
    const providerError = result?.error;
    if (typeof providerError === 'string' && Object.prototype.hasOwnProperty.call(providerErrors, providerError)) return failed(providerErrors[providerError], 400);
    if (!response.ok) return failed('github_http_error');
    if (providerError) return failed('github_exchange_rejected', 400);
    if (!result || typeof result.access_token !== 'string' || !/^[A-Za-z0-9_-]{10,1024}$/.test(result.access_token) || String(result.token_type).toLowerCase() !== 'bearer') return failed('github_invalid_response');
    // Deliberately no offline_access, refresh-token persistence, database or token vault.
    // GitHub itself consumes the code once; frontend single-flight prevents duplicate exchanges.
    return jsonResponse({ token: result.access_token, ownerId: txn.owner, scope: typeof result.scope === 'string' ? result.scope : '' }, 200, cookies);
  } catch {
    const error = controller.signal.aborted ? 'github_timeout' : 'github_unavailable';
    return jsonResponse({ error, message: OAUTH_ERRORS[error] }, 502, cookies);
  }
  finally { clearTimeout(timer); }
}
