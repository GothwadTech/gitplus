import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionClient } from '../src/services/accounts/sessionClient';

const session = (id = 'alice-id') => ({ status: 'authenticated', user: { id, username: 'alice', name: 'Alice', email: 'alice@gothwadtech.com' }, activeSlot: 'a', authuser: 0, accounts: [{ slot: 'a', authuser: 0, username: 'alice', name: 'Alice' }] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('session checks share in-flight work by selector and do not persist a completed identity', async () => {
  let calls = 0;
  let resolve!: (res: Response) => void;
  const client = createSessionClient((async (url, options) => {
    calls++;
    assert.equal(url, '/api/session?authuser=a');
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(options?.cache, 'no-store');
    return new Promise<Response>((done) => { resolve = done; });
  }) as typeof fetch);
  const first = client.request('a');
  const second = client.request('a');
  assert.equal(calls, 1);
  resolve(json(session()));
  assert.equal((await first.promise).status, 'authenticated');
  assert.equal((await second.promise).status, 'authenticated');
  first.release(); second.release();
  const third = client.request('a');
  assert.equal(calls, 2);
  resolve(json(session()));
  await third.promise; third.release();
});

test('different account selectors never share a request or result', async () => {
  const urls: string[] = [];
  const client = createSessionClient((async (url) => { urls.push(String(url)); return json({ status: 'anonymous', code: 'signed_out', message: 'Signed out' }, 401); }) as typeof fetch);
  const a = client.request('a'); const b = client.request('b');
  await Promise.all([a.promise, b.promise]);
  assert.deepEqual(urls, ['/api/session?authuser=a', '/api/session?authuser=b']);
  a.release(); b.release();
});

test('StrictMode release/reacquire shares one call; last subscriber aborts abandoned work', async () => {
  let calls = 0;
  let signal!: AbortSignal;
  const client = createSessionClient((async (_url, options) => {
    calls++;
    signal = options!.signal!;
    return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  }) as typeof fetch);
  const a = client.request(null); a.release();
  const b = client.request(null);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(signal.aborted, false);
  b.release();
  await Promise.resolve();
  assert.equal(signal.aborted, true);
  assert.equal((await b.promise).status, 'unavailable');
});

test('malformed JSON, SPA HTML, malformed identity and forbidden responses are errors, not login redirects', async () => {
  for (const response of [new Response('<html>SPA</html>', { headers: { 'Content-Type': 'text/html' } }), new Response('{broken', { headers: { 'Content-Type': 'application/json' } }), json({ status: 'authenticated', user: {} }), json({ error: 'forbidden' }, 403)]) {
    const client = createSessionClient((async () => response) as typeof fetch);
    const request = client.request(null);
    assert.equal((await request.promise).status, 'unavailable');
    request.release();
  }
});

test('anonymous and unsupported are explicit states; foreign production links are rejected', async () => {
  const cases: [Response, string][] = [
    [json({ status: 'anonymous', code: 'signed_out', message: 'Sign in' }, 401), 'anonymous'],
    [json({ status: 'unsupported', productionOrigin: 'https://gitplus.gothwadtech.com', message: 'Custom domain required' }), 'unsupported'],
    [json({ status: 'unsupported', productionOrigin: 'https://evil.example', message: 'Go here' }), 'unavailable'],
    [json({ status: 'unavailable', code: 'accounts_rate_limited', message: 'Wait' }, 429), 'unavailable'],
  ];
  for (const [response, status] of cases) {
    const client = createSessionClient((async () => response) as typeof fetch);
    const request = client.request(null);
    assert.equal((await request.promise).status, status);
    request.release();
  }
});
