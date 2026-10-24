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
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/session') {
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
  await page.locator('#gothwad-account-bar summary').click();
  await page.locator('#gothwad-account-select').selectOption('b');
  await expect(page.locator('#gothwad-account-bar')).toContainText('bob@gothwadtech.com');
  await expect(page.locator('#pat-input')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('gitplus_github_connection'))).toBeNull();
  await page.locator('#gothwad-account-bar summary').click();
  await page.locator('#gitplus-signout').click();
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
