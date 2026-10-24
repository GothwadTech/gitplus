import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleGitHubOAuth, TRANSACTION_COOKIE, type GitHubOAuthEnv } from '../server/githubOAuth';
import { handleAccountAction } from '../server/accountActions';
import { challengeFor, randomProof } from '../shared/githubOAuth';

const origin = 'https://gitplus.gothwadtech.com';
const env: GitHubOAuthEnv = { GITPLUS_ORIGIN: origin, GITHUB_CLIENT_ID: 'test-client-id', GITHUB_CLIENT_SECRET: 'test-only-secret-not-a-real-github-secret' };
const identity = (id = 'alice-id') => ({ authenticated: true, user: { id, username: 'alice', first_name: 'Alice' }, activeId: 'a', authuser: 0, accounts: [{ id: 'a', authuser: 0, username: 'alice', name: 'Alice' }, { id: 'b', authuser: 1, username: 'bobby', name: 'Bob' }] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const makeRequest = (path: string, body?: unknown, txnCookie = '', extraHeaders: Record<string, string> = {}) => new Request(origin + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Cookie: `gothwad_sess_a=account-cookie${txnCookie ? '; ' + txnCookie : ''}`, ...(body !== undefined ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...extraHeaders },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const readCookie = (res: Response) => res.headers.getSetCookie().find((v) => v.startsWith(TRANSACTION_COOKIE + '='))!.split(';')[0];
function provider(owner = 'alice-id') {
  let exchangeCount = 0;
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); requests.push({ url, init });
    if (url === 'https://api.gothwadtech.com/api/auth/me') {
      assert.ok(!new Headers(init?.headers).get('Cookie')?.includes(TRANSACTION_COOKIE));
      return json(identity(owner));
    }
    if (url === 'https://github.com/login/oauth/access_token') {
      exchangeCount++;
      return exchangeCount === 1 ? json({ access_token: 'gho_test_only_token', token_type: 'bearer', scope: 'repo,gist', refresh_token: 'never-return-or-persist-this' }) : json({ error: 'bad_verification_code' });
    }
    throw new Error('Unexpected external request');
  };
  return { fetcher, requests };
}
async function start(fetcher: typeof fetch = provider().fetcher, allowDelete = false) {
  const verifier = randomProof();
  const challenge = await challengeFor(verifier);
  const response = await handleGitHubOAuth(makeRequest('/api/github/start', { challenge, selector: 'a', allowDelete }), env, fetcher);
  assert.equal(response.status, 200);
  return { verifier, challenge, response, body: await response.json(), cookie: readCookie(response) };
}
async function callback(s: Awaited<ReturnType<typeof start>>, fetcher: typeof fetch) {
  return handleGitHubOAuth(makeRequest(`/api/github/callback?state=${s.body.state}&code=test-one-time-code`, undefined, s.cookie, { 'Sec-Fetch-Site': 'cross-site' }), env, fetcher);
}

test('unconfigured OAuth reports unavailable without exposing secrets or disabling PAT infrastructure', async () => {
  const config = await handleGitHubOAuth(makeRequest('/api/github/config'), {});
  assert.deepEqual(await config.json(), { enabled: false, scopes: ['repo', 'workflow', 'gist', 'read:user', 'user:email', 'read:org'] });
  assert.equal((await handleGitHubOAuth(makeRequest('/api/github/start', {}), {})).status, 503);
  assert.equal((await handleGitHubOAuth(new Request('https://gitplus.pages.dev/api/github/config'), env)).status, 403);
});

test('start is CSRF-protected, verifies Gothwad identity and requests explicit PKCE/scopes', async () => {
  for (const originHeader of ['', 'https://evil.example']) {
    const res = await handleGitHubOAuth(makeRequest('/api/github/start', {}, '', { Origin: originHeader }), env);
    assert.equal(res.status, 403);
  }
  const s = await start();
  const url = new URL(s.body.authorizeUrl);
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.searchParams.get('code_challenge'), s.challenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), origin + '/api/github/callback');
  assert.ok(!url.searchParams.get('scope')!.includes('delete_repo'));
  assert.ok(!url.searchParams.get('scope')!.includes('offline_access'));
  assert.ok(!JSON.stringify(s.body).includes(env.GITHUB_CLIENT_SECRET!));
  assert.ok(!s.cookie.includes('alice-id'));
  assert.match(s.response.headers.getSetCookie()[0], /Secure; HttpOnly; SameSite=Lax/);
  assert.match(s.response.headers.get('Cache-Control')!, /no-store/);
  const destructive = await start(undefined, true);
  assert.ok(new URL(destructive.body.authorizeUrl).searchParams.get('scope')!.includes('delete_repo'));
});

test('start rejects anonymous Accounts and oversized input before GitHub authorization', async () => {
  const anonymous: typeof fetch = async () => json({ authenticated: false }, 401);
  const response = await handleGitHubOAuth(makeRequest('/api/github/start', { challenge: randomProof(), selector: 'a' }), env, anonymous);
  assert.equal(response.status, 401);
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.equal((await handleGitHubOAuth(makeRequest('/api/github/start', { challenge: 'x'.repeat(5000) }), env, anonymous)).status, 400);
});

test('callback rejects state tampering, modified cookie, denied consent and changed Gothwad owner', async () => {
  const s = await start();
  for (const query of [`state=${randomProof()}&code=abc`, `state=${s.body.state}&state=${s.body.state}&code=abc`, `state=${s.body.state}&error=access_denied`]) {
    const res = await handleGitHubOAuth(makeRequest('/api/github/callback?' + query, undefined, s.cookie), env, provider().fetcher);
    assert.equal(res.status, 303);
    assert.equal(new URL(res.headers.get('Location')!).searchParams.get('github_oauth'), 'error');
    assert.match(res.headers.getSetCookie().at(-1)!, /Max-Age=0/);
  }
  const tampered = { ...s, cookie: s.cookie.replace(/=./, (value) => value === '=X' ? '=Y' : '=X') };
  assert.match((await callback(tampered, provider().fetcher)).headers.get('Location')!, /invalid_state/);
  const changed = await callback(s, provider('bob-id').fetcher);
  assert.match(changed.headers.get('Location')!, /account_changed/);
});

test('expired transaction and rotated client secret cannot complete callback', async (t) => {
  const s = await start();
  assert.match((await handleGitHubOAuth(makeRequest(`/api/github/callback?state=${s.body.state}&code=abc`, undefined, s.cookie), { ...env, GITHUB_CLIENT_SECRET: 'different-test-only-secret' }, provider().fetcher)).headers.get('Location')!, /invalid_state/);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 601_000);
  assert.match((await callback(s, provider().fetcher)).headers.get('Location')!, /invalid_state/);
});

test('completion requires originating tab PKCE and same verified owner; token never enters redirect URLs', async () => {
  const p = provider();
  const s = await start(p.fetcher);
  const returned = await callback(s, p.fetcher);
  const location = returned.headers.get('Location')!;
  assert.equal(new URL(location).searchParams.get('github_oauth'), 'complete');
  assert.ok(!location.includes('test-one-time-code'));
  const returnedCookie = readCookie(returned);
  const invalid = await handleGitHubOAuth(makeRequest('/api/github/complete', { state: s.body.state, verifier: randomProof() }, returnedCookie), env, p.fetcher);
  assert.equal(invalid.status, 400);
  assert.equal(p.requests.filter((r) => r.url.includes('github.com/login')).length, 0);
  const changed = await handleGitHubOAuth(makeRequest('/api/github/complete', { state: s.body.state, verifier: s.verifier }, returnedCookie), env, provider('other-id').fetcher);
  assert.equal(changed.status, 409);
  const complete = () => handleGitHubOAuth(makeRequest('/api/github/complete', { state: s.body.state, verifier: s.verifier }, returnedCookie), env, p.fetcher);
  const response = await complete();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { token: 'gho_test_only_token', ownerId: 'alice-id', scope: 'repo,gist' });
  const exchange = p.requests.find((r) => r.url.includes('github.com/login'))!;
  assert.equal(JSON.parse(exchange.init!.body as string).code_verifier, s.verifier);
  assert.equal(JSON.parse(exchange.init!.body as string).client_secret, env.GITHUB_CLIENT_SECRET);
  assert.equal(exchange.init?.redirect, 'error');
  assert.match(response.headers.getSetCookie().at(-1)!, /Max-Age=0/);
  assert.match(response.headers.get('Cache-Control')!, /no-store/);
  assert.equal((await complete()).status, 400); // GitHub's one-use code is the replay barrier, no D1 required.
});

test('failed exchange is generic, clears the transaction and never reflects provider secrets/errors', async () => {
  const p = provider(); const s = await start(p.fetcher); const cb = await callback(s, p.fetcher);
  const failure: typeof fetch = async (url, options) => String(url).includes('api.gothwadtech.com') ? p.fetcher(url, options) : json({ error: 'bad_code', error_description: env.GITHUB_CLIENT_SECRET }, 500);
  const response = await handleGitHubOAuth(makeRequest('/api/github/complete', { state: s.body.state, verifier: s.verifier }, readCookie(cb)), env, failure);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(env.GITHUB_CLIENT_SECRET!));
  assert.match(response.headers.getSetCookie().at(-1)!, /Max-Age=0/);
});

test('universal-menu sign-out validates origin/slot and relays only approved cookie deletions', async () => {
  assert.equal((await handleAccountAction(makeRequest('/api/accounts/signout-all', { selector: 'a' }, '', { Origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await handleAccountAction(makeRequest('/api/accounts/signout', { selector: 'a', slot: 'z' }), env)).status, 400);
  const p = provider();
  const response = await handleAccountAction(makeRequest('/api/accounts/signout', { selector: 'a', slot: 'b' }), env, async (url, init) => {
    if (String(url).endsWith('/api/auth/me')) return p.fetcher(url, init);
    assert.equal(url, 'https://api.gothwadtech.com/api/auth/accounts/b/signout');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Origin'), origin);
    const res = json({ ok: true, access_token: 'must-not-expose' });
    res.headers.append('Set-Cookie', 'gothwad_sess_b=; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.gothwadtech.com; Max-Age=0');
    return res;
  });
  assert.deepEqual(await response.json(), { ok: true });
  assert.ok(response.headers.getSetCookie().some((c) => c.startsWith('gothwad_sess_b=')));
});

test('global sign-out uses only the fixed Accounts endpoint; failed mutations do not claim logout', async () => {
  const p = provider();
  for (const success of [true, false]) {
    const response = await handleAccountAction(makeRequest('/api/accounts/signout-all', { selector: 'a' }), env, async (url, init) => {
      if (String(url).endsWith('/api/auth/me')) return p.fetcher(url, init);
      assert.equal(url, 'https://api.gothwadtech.com/api/auth/signout');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.body, '{}');
      return json({ ok: success });
    });
    assert.equal(response.status, success ? 200 : 502);
    assert.equal((await response.json()).ok === true, success);
  }
});
