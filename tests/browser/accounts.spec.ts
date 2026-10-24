import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

const ORIGIN = 'https://gitplus.gothwadtech.com';
const account = (which: 'alice' | 'bob') => ({
  status: 'authenticated',
  user: { id: `${which}-id`, username: which, name: which === 'alice' ? 'Alice Example' : 'Bob Example', email: `${which}@gothwadtech.com` },
  activeSlot: which === 'alice' ? 'a' : 'b', authuser: which === 'alice' ? 0 : 1,
  accounts: [{ slot: 'a', authuser: 0, username: 'alice', name: 'Alice' }, { slot: 'b', authuser: 1, username: 'bob', name: 'Bob' }],
});

async function mockApp(page: Page, session: (url: URL) => { status: number; body: unknown }) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.route('https://accounts.gothwadtech.com/widget/**', async (route) => {
    const filename = new URL(route.request().url()).pathname.split('/').pop()!;
    if (!['account-menu.js', 'account-menu-template.js', 'account-menu-styles.js'].includes(filename)) return route.abort();
    await route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(`tests/fixtures/account-widget/${filename}`, 'utf8') });
  });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/github/config') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true }) });
    } else if (url.pathname === '/api/session') {
      const response = session(url);
      await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
    } else {
      // Real built Pages assets; only identity/GitHub are mocked. No remote login or writes.
      const response = await route.fetch({ url: `http://127.0.0.1:8788${url.pathname}${url.search}` });
      await route.fulfill({ response });
    }
  });
  await page.route('https://api.github.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/user' ? { id: 1, login: 'test-github', name: 'Test GitHub', avatar_url: '', html_url: 'https://github.com/test', public_repos: 0, followers: 0, following: 0, created_at: '2024-01-01T00:00:00Z' }
      : path === '/rate_limit' ? { resources: { core: { limit: 5000, remaining: 4999, reset: 1800000000, used: 1 } } }
      : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return errors;
}

test('existing Accounts session automatically opens Connect GitHub, isolates switching, and pauses local sign-out', async ({ page }) => {
  let checks = 0;
  const errors = await mockApp(page, (url) => { checks++; return { status: 200, body: account(url.searchParams.get('authuser') === 'b' ? 'bob' : 'alice') }; });
  await page.goto(ORIGIN);
  await expect(page.locator('#pat-input')).toBeVisible();
  await expect(page.locator('#gothwad-account-bar')).toContainText('alice@gothwadtech.com');
  await expect(page).toHaveTitle('GitPlus');
  expect(checks).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem('gothwad_github_pat'))).toBeNull();
  await page.locator('#pat-input').fill('dummy-github-token-for-browser-test');
  await page.locator('#connect-github-btn').click();
  await expect(page.locator('#mobile-bottom-navigation')).toBeVisible();
  expect(JSON.parse((await page.evaluate(() => sessionStorage.getItem('gitplus_github_connection')))!).ownerId).toBe('alice-id');
  await page.locator('#gothwad-account-menu').click();
  await page.locator('[data-gw-switch="b"]').click();
  await expect(page.locator('#gothwad-account-bar')).toContainText('bob@gothwadtech.com');
  await expect(page.locator('#pat-input')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('gitplus_github_connection'))).toBeNull();
  await page.locator('#gothwad-account-menu').click();
  await page.getByRole('button', { name: 'Sign out of GitPlus (this tab)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Signed out of GitPlus' })).toBeVisible();
  const beforeReload = checks;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Signed out of GitPlus' })).toBeVisible();
  expect(checks).toBe(beforeReload);
  await page.locator('#accounts-retry').click();
  await expect(page.locator('#pat-input')).toBeVisible();
  expect(errors).toEqual([]);
});

test('return without a session never redirects in a loop; service errors offer retry, not false login', async ({ page }) => {
  let unavailable = false;
  const errors = await mockApp(page, () => unavailable ? { status: 503, body: { status: 'unavailable', code: 'accounts_not_json', message: 'Accounts routing error. Please retry.' } } : { status: 401, body: { status: 'anonymous', code: 'signed_out', message: 'Sign in with Gothwad Accounts.' } });
  await page.goto(`${ORIGIN}/?__gitplus_auth_return=1`);
  await expect(page.getByText('Accounts returned without a usable session.', { exact: false })).toBeVisible();
  await expect(page.locator('#gothwad-signin-link')).toBeVisible();
  expect(page.url()).not.toContain('__gitplus_auth_return');
  expect(page.url()).toContain(ORIGIN);
  const link = new URL((await page.locator('#gothwad-signin-link').getAttribute('href'))!);
  expect(link.origin).toBe('https://accounts.gothwadtech.com');
  unavailable = true;
  await page.locator('#accounts-retry').click();
  await expect(page.getByRole('heading', { name: 'Account verification unavailable' })).toBeVisible();
  await expect(page.locator('#gothwad-signin-link')).toHaveCount(0);
  await expect(page.locator('#pat-input')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('actual local Pages Function refuses preview SSO and unknown API routes are JSON 404', async ({ page }) => {
  const response = await page.request.get('http://127.0.0.1:8788/api/session');
  expect((await response.json()).status).toBe('unsupported');
  expect(response.headers()['cache-control']).toContain('no-store');
  const missing = await page.request.get('http://127.0.0.1:8788/api/unknown');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('application/json');
  await page.goto('http://127.0.0.1:8788');
  await expect(page.getByRole('heading', { name: 'Use your GitPlus custom domain' })).toBeVisible();
  await expect(page.locator('#pat-input')).toHaveCount(0);
});


test('OAuth connect survives the same-tab redirect, saves only an owner-bound local token, and preserves PAT as an alternative', async ({ page }) => {
  const errors = await mockApp(page, () => ({ status: 200, body: account('alice') }));
  const state = 'a'.repeat(43);
  let challenge = '';
  let completions = 0;
  await page.route(`${ORIGIN}/api/github/start`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body.allowDelete).toBe(true);
    expect(body.selector).toBe('a');
    challenge = body.challenge;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ownerId: 'alice-id', state, authorizeUrl: `https://github.com/login/oauth/authorize?state=${state}` }) });
  });
  // A mocked consent document starts a fresh routed navigation; Playwright only intercepts
  // the first request in a server redirect chain. Backend callback/303 behavior is unit-tested.
  await page.route('https://github.com/login/oauth/authorize?**', (route) => route.fulfill({ contentType: 'text/html', body: `<a href="${ORIGIN}/?github_oauth=complete&amp;authuser=a">Approve test app</a>` }));
  await page.route(`${ORIGIN}/api/github/complete`, async (route) => {
    completions++;
    const body = route.request().postDataJSON();
    expect(body.state).toBe(state);
    expect(createHash('sha256').update(body.verifier).digest('base64url')).toBe(challenge);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ownerId: 'alice-id', token: 'gho_mocked_browser_token', scope: 'repo' }) });
  });
  await page.goto(ORIGIN);
  await expect(page.locator('#pat-input')).toBeVisible();
  await expect(page.locator('#github-oauth-connect')).toBeEnabled();
  await page.locator('#oauth-allow-delete').check();
  await page.locator('#github-oauth-connect').click();
  await page.getByRole('link', { name: 'Approve test app' }).click();
  await expect(page.locator('#mobile-bottom-navigation')).toBeVisible();
  expect(completions).toBe(1);
  expect(page.url()).not.toContain('github_oauth');
  expect(page.url()).not.toContain('gho_');
  expect(await page.evaluate(() => localStorage.getItem('gitplus_github_connection'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('gitplus_github_oauth_pending'))).toBeNull();
  expect(JSON.parse((await page.evaluate(() => sessionStorage.getItem('gitplus_github_connection')))!).ownerId).toBe('alice-id');
  await page.reload();
  await expect(page.locator('#mobile-bottom-navigation')).toBeVisible();
  expect(completions).toBe(1);
  await page.locator('#header-logout-btn').click();
  await expect(page.locator('#pat-input')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('gitplus_github_connection'))).toBeNull();
  expect(errors).toEqual([]);
});

test('missing OAuth runtime credentials leaves PAT usable; denied callback does not connect or leak data', async ({ page }) => {
  const errors = await mockApp(page, () => ({ status: 200, body: account('alice') }));
  await page.route(`${ORIGIN}/api/github/config`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.goto(`${ORIGIN}/?github_oauth=error&oauth_error=denied`);
  await expect(page.locator('#github-oauth-connect')).toBeDisabled();
  await expect(page.locator('#oauth-configuration-note')).toContainText('administrator');
  await expect(page.getByText('GitHub authorization was cancelled.', { exact: false })).toBeVisible();
  await expect(page.locator('#pat-input')).toBeEnabled();
  expect(page.url()).not.toContain('github_oauth');
  expect(errors).toEqual([]);
});

test('universal widget sign-out uses the same-origin protected action, while load failure has an honest fallback', async ({ page }) => {
  const errors = await mockApp(page, () => ({ status: 200, body: account('alice') }));
  let called = false;
  await page.route(`${ORIGIN}/api/accounts/signout`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ selector: 'a', slot: 'a' });
    called = true;
    await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto(ORIGIN);
  await page.locator('#gothwad-account-menu').click();
  await page.locator('[data-gw-signout-slot="a"]').click();
  await expect(page.getByRole('heading', { name: 'Signed out of GitPlus' })).toBeVisible();
  expect(called).toBe(true);
  expect(errors).toEqual([]);
});

test('blocked universal widget shows a management link instead of a duplicate menu', async ({ page }) => {
  const errors = await mockApp(page, () => ({ status: 200, body: account('alice') }));
  await page.route('https://accounts.gothwadtech.com/widget/**', (route) => route.abort());
  await page.goto(ORIGIN);
  await page.locator('#gothwad-account-menu').click();
  await expect(page.getByText('The universal Accounts menu could not load.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage Gothwad Account', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('late OAuth completion cannot replace a newly selected Gothwad user connection', async ({ page }) => {
  const errors = await mockApp(page, (url) => ({ status: 200, body: account(url.searchParams.get('authuser') === 'b' ? 'bob' : 'alice') }));
  await page.addInitScript(() => sessionStorage.setItem('gitplus_github_oauth_pending', JSON.stringify({ ownerId: 'alice-id', state: 'a'.repeat(43), verifier: 'b'.repeat(43), expires: Date.now() + 600000 })));
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const requested = page.waitForRequest(`${ORIGIN}/api/github/complete`);
  await page.route(`${ORIGIN}/api/github/complete`, async (route) => {
    await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ownerId: 'alice-id', token: 'gho_late_alice_token', scope: 'repo' }) });
  });
  await page.goto(`${ORIGIN}/?github_oauth=complete&authuser=a`);
  await requested;
  await page.locator('#gothwad-account-menu').click();
  await page.locator('[data-gw-switch="b"]').click();
  await expect(page.locator('#gothwad-account-bar')).toContainText('bob@gothwadtech.com');
  await page.locator('#pat-input').fill('bob-test-only-token');
  await page.locator('#connect-github-btn').click();
  await expect(page.locator('#mobile-bottom-navigation')).toBeVisible();
  const completed = page.waitForResponse(`${ORIGIN}/api/github/complete`);
  release();
  await (await completed).finished();
  await expect(page.locator('#mobile-bottom-navigation')).toBeVisible();
  expect(JSON.parse((await page.evaluate(() => sessionStorage.getItem('gitplus_github_connection')))!).ownerId).toBe('bob-id');
  expect(await page.evaluate(() => sessionStorage.getItem('gitplus_github_connection'))).not.toContain('gho_late_alice_token');
  expect(errors).toEqual([]);
});

for (const failure of ['provider', 'html', 'guard'] as const) {
  test(`OAuth ${failure} failure shows a focused safe diagnostic instead of a generic or hidden error`, async ({ page }) => {
    const errors = await mockApp(page, () => ({ status: 200, body: account('alice') }));
    await page.addInitScript(() => sessionStorage.setItem('gitplus_github_oauth_pending', JSON.stringify({ ownerId: 'alice-id', state: 'a'.repeat(43), verifier: 'b'.repeat(43), expires: Date.now() + 600000 })));
    await page.route(`${ORIGIN}/api/github/complete`, (route) => route.fulfill(failure === 'html'
      ? { status: 502, contentType: 'text/html', body: '<h1>private-body-must-not-display</h1>' }
      : { status: failure === 'guard' ? 403 : 400, contentType: 'application/json', body: JSON.stringify({ error: failure === 'guard' ? 'origin_not_allowed' : 'github_client_credentials', providerStatus: failure === 'guard' ? undefined : 401, message: 'private-body-must-not-display' }) }));
    await page.goto(`${ORIGIN}/?github_oauth=complete&authuser=a`);
    const alert = page.locator('#github-connection-error');
    const code = failure === 'provider' ? 'github_client_credentials' : failure === 'html' ? 'response_not_json' : 'origin_not_allowed';
    await expect(alert).toContainText(`[complete:${code}; HTTP `);
    await expect(alert).toBeFocused();
    await expect(alert).toBeInViewport();
    await expect(alert).not.toContainText('private-body-must-not-display');
    await expect(page.locator('#pat-input')).toBeEnabled();
    expect(await page.evaluate(() => sessionStorage.getItem('gitplus_github_connection'))).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem('gitplus_github_oauth_pending'))).toBeNull();
    expect(page.url()).not.toContain('github_oauth');
    expect(errors).toEqual([]);
  });
}

for (const legacy of [true, false]) {
  test(`${legacy ? 'legacy' : 'unidentified'} backend 502 is actionable and never claims the OAuth secret is wrong`, async ({ page }) => {
    const errors = await mockApp(page, () => ({ status: 200, body: account('alice') }));
    await page.addInitScript(() => sessionStorage.setItem('gitplus_github_oauth_pending', JSON.stringify({ ownerId: 'alice-id', state: 'a'.repeat(43), verifier: 'b'.repeat(43), expires: Date.now() + 600000 })));
    await page.route(`${ORIGIN}/api/github/complete`, (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: legacy ? 'github_exchange_failed' : 'private-error-must-not-display', message: 'private-message-must-not-display' }) }));
    await page.goto(`${ORIGIN}/?github_oauth=complete&authuser=a`);
    const alert = page.locator('#github-connection-error');
    await expect(alert).toContainText(`[complete:${legacy ? 'github_exchange_failed' : 'oauth_response_unrecognized'}; HTTP 502]`);
    await expect(alert).toContainText('[backend:unmarked; deployment:unavailable]');
    await expect(alert).not.toContainText('private-');
    await expect(alert).not.toContainText('unknown_error');
    await expect(alert).toBeInViewport();
    await expect(page.locator('#pat-input')).toBeEnabled();
    expect(await page.evaluate(() => sessionStorage.getItem('gitplus_github_connection'))).toBeNull();
    expect(errors).toEqual([]);
  });
}
