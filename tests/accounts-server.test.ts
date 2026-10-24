import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSession, accountCookies, rotationCookies } from '../server/accountsSession';
import { onRequest } from '../functions/api/[[path]]';
import { firstPartyOrigin, publicIdentity, signInUrl, RETURN_MARKER } from '../shared/accounts';

const base = 'https://gitplus.gothwadtech.com';
const request = (query = '', headers: HeadersInit = { Cookie: 'gothwad_sess_a=test-session' }) => new Request(`${base}/api/session${query}`, { headers });
const identity = () => ({ authenticated: true, activeId: 'a', authuser: 0, user: { id: 'user-alice', username: 'alice', first_name: 'Alice', last_name: 'Example', recovery_email: 'private@example.test', phone_number: 'private-phone' }, accounts: [{ id: 'a', authuser: 0, username: 'alice', name: 'Alice Example' }], access_token: 'do-not-expose-access', refresh_token: 'do-not-expose-refresh' });
const json = (data: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const fetchResult = (response: Response) => (async () => response) as typeof fetch;
const cookie = 'gothwad_sess_a=rotated; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.gothwadtech.com';

test('anonymous requests do not call Accounts or forward unrelated cookies', async () => {
  let calls = 0;
  const res = await handleSession(request('', { Cookie: 'analytics=private' }), {}, (async () => { calls++; throw new Error(); }) as typeof fetch);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).status, 'anonymous');
  assert.equal(calls, 0);
});

test('verified SSO response projects public identity, forwards only Accounts cookies, and relays secure rotations', async () => {
  const res = await handleSession(request('?authuser=a', { Cookie: 'gothwad_sess_a=valid; analytics=private; gothwad_evil=no', Authorization: 'Bearer github-pat-must-not-forward' }), {}, (async (url, init) => {
    assert.equal(url, 'https://api.gothwadtech.com/api/auth/me');
    assert.equal(init?.redirect, 'manual');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Cookie'), 'gothwad_sess_a=valid');
    assert.equal(headers.get('Authorization'), null);
    assert.equal(headers.get('X-Gothwad-Authuser'), 'a');
    const res = json(identity());
    res.headers.append('Set-Cookie', cookie);
    res.headers.append('Set-Cookie', 'other=bad; HttpOnly');
    return res;
  }) as typeof fetch);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.deepEqual(res.headers.getSetCookie(), [cookie]);
  const body = await res.json();
  assert.equal(body.user.id, 'user-alice');
  assert.equal(body.user.email, 'alice@gothwadtech.com');
  const serialized = JSON.stringify(body);
  for (const secret of ['access_token', 'refresh_token', 'recovery_email', 'phone_number', 'do-not-expose', 'private-phone']) assert.ok(!serialized.includes(secret));
});

test('Accounts missing-selector fallback is rejected rather than silently selecting another account', async () => {
  for (const selector of ['b', '1']) {
    const res = await handleSession(request(`?authuser=${selector}`), {}, fetchResult(json(identity())));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'account_selection_changed');
  }
});

test('HTML, redirects, invalid profiles and 5xx remain service failures, not signed-out users', async () => {
  const responses = [new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } }), new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }), json({}), json({ ...identity(), user: { username: 'alice' } }), json({ error: 'internal' }, 500)];
  for (const upstream of responses) {
    const result = await handleSession(request(), {}, fetchResult(upstream));
    assert.equal(result.status, 503);
    assert.equal((await result.json()).status, 'unavailable');
  }
});

test('unavailable network does not clear cookies and a rate limit remains a 429', async () => {
  const failed = await handleSession(request(), {}, (async () => { throw new Error('network'); }) as typeof fetch);
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('Set-Cookie'), null);
  const limited = await handleSession(request(), {}, fetchResult(json({}, 429, { 'Retry-After': '60' })));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
});

test('Accounts 401 is anonymous but never globally logs out other Gothwad products', async () => {
  const upstream = json({ authenticated: false }, 401, { 'Set-Cookie': 'gothwad_sess_b=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.gothwadtech.com' });
  const response = await handleSession(request(), {}, fetchResult(upstream));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Set-Cookie'), null);
});

test('unrelated preview hosts cannot forward Gothwad credentials; no fake login bypass', async () => {
  let calls = 0;
  const res = await handleSession(new Request('https://gitplus.pages.dev/api/session', { headers: { Cookie: 'gothwad_sess_a=fake' } }), {}, (async () => { calls++; return json(identity()); }) as typeof fetch);
  assert.equal((await res.json()).status, 'unsupported');
  assert.equal(calls, 0);
});

test('untrusted origins, invalid selectors and methods fail before upstream calls', async () => {
  const fetcher = (async () => { throw new Error('Must not fetch'); }) as typeof fetch;
  assert.equal((await handleSession(request('', { Origin: 'https://evil.example' }), {}, fetcher)).status, 403);
  assert.equal((await handleSession(request('?authuser=evil'), {}, fetcher)).status, 400);
  assert.equal((await handleSession(new Request(`${base}/api/session`, { method: 'POST' }), {}, fetcher)).status, 405);
  assert.equal((await handleSession(request(), { ACCOUNTS_API_ORIGIN: 'https://evil.example' }, fetcher)).status, 503);
});

test('API catchall returns no-store JSON 404, not the SPA', async () => {
  const res = await onRequest({ request: new Request(`${base}/api/not-a-route`), env: {} });
  assert.equal(res.status, 404);
  assert.match(res.headers.get('Content-Type')!, /application\/json/);
});

test('cookie filtering rejects insecure, foreign-domain and unrelated rotations', () => {
  assert.equal(accountCookies('gothwad_at=at; other=secret; gothwad_sess_f=f; gothwad_sess_z=z'), 'gothwad_at=at; gothwad_sess_f=f');
  const headers = new Headers();
  for (const value of [cookie, cookie.replace('Secure;', ''), cookie.replace('HttpOnly;', ''), cookie.replace('.gothwadtech.com', '.evil.example'), cookie.replace('gothwad_sess_a', 'arbitrary')]) headers.append('Set-Cookie', value);
  assert.deepEqual(rotationCookies(headers), [cookie]);
});

test('login URLs use validated return origins, encode selectors and mark a one-time handoff', () => {
  const url = new URL(signInUrl(base, 'a', true));
  assert.equal(url.origin, 'https://accounts.gothwadtech.com');
  assert.equal(url.searchParams.get('choose'), '1');
  const next = new URL(url.searchParams.get('next')!);
  assert.equal(next.origin, base);
  assert.equal(next.searchParams.get(RETURN_MARKER), '1');
  assert.equal(next.searchParams.get('authuser'), 'a');
  for (const unsafe of ['https://gothwadtech.com.evil.example', '//evil.example', 'javascript:alert(1)', 'https://user:pass@gitplus.gothwadtech.com', 'http://gitplus.gothwadtech.com', 'https://gitplus.gothwadtech.com/redirect']) {
    assert.equal(firstPartyOrigin(unsafe), null);
    assert.throws(() => signInUrl(unsafe));
  }
});

test('inconsistent slot identity and duplicate account entries fail validation', () => {
  assert.equal(publicIdentity({ ...identity(), activeId: 'b' }), null);
  assert.equal(publicIdentity({ ...identity(), accounts: [...identity().accounts, ...identity().accounts] }), null);
});
