import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubService, GitHubApiError } from '../src/services/github';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('reads empty text files and encodes refs in query strings', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(url.searchParams.get('ref'), 'feature/a&b');
    return json({ type: 'file', content: '', sha: 'empty', size: 0 });
  });
  const file = await new GitHubService().getFileContent('owner', 'repo', 'empty.txt', 'feature/a&b');
  assert.equal(file.isBinary, false);
  assert.equal(file.content, '');
});

test('truncated trees fail closed', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.match(url.pathname, /feature%2Ftest/);
    return json({ tree: [], truncated: true });
  });
  await assert.rejects(new GitHubService().getTree('o', 'r', 'feature/test'), /too large/);
});

test('loads all repository pages unless an explicit page is requested', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    calls++;
    return json(url.searchParams.get('page') === '1' ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }]);
  });
  assert.equal((await new GitHubService().getUserRepos({ per_page: 2 })).length, 3);
  assert.equal(calls, 2);
  calls = 0;
  assert.equal((await new GitHubService().getUserRepos({ page: 1, per_page: 2 })).length, 2);
  assert.equal(calls, 1);
});

test('API errors preserve status for authentication handling', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ message: 'Bad credentials' }, 401));
  await assert.rejects(new GitHubService().getAuthenticatedUser(), (error: unknown) => error instanceof GitHubApiError && error.status === 401);
});

test('branch read failure does not trigger any write or orphan root commit', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: URL, options: RequestInit) => {
    calls++;
    assert.equal(options.method, undefined);
    return json({ message: 'Forbidden' }, 403);
  });
  await assert.rejects(new GitHubService().batchCommitFiles('o', 'r', 'main', [{ path: 'a', content: 'a' }], 'test'), /Forbidden/);
  assert.equal(calls, 1);
});

function mockBatch(t: TestContext, conflict = false) {
  const requests: { path: string; method?: string; body: Record<string, any> }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    const body = options.body ? JSON.parse(String(options.body)) : {};
    requests.push({ path: url.pathname, method: options.method, body });
    if (url.pathname.includes('/git/ref/')) return json({ object: { sha: 'parent' } });
    if (url.pathname.endsWith('/git/commits/parent')) return json({ tree: { sha: 'base-tree' } });
    if (url.pathname.endsWith('/git/blobs')) return json({ sha: 'blob' });
    if (url.pathname.endsWith('/git/trees')) return json({ sha: 'new-tree' });
    if (url.pathname.endsWith('/git/commits')) return json({ sha: 'new-commit' });
    if (options.method === 'PATCH') return conflict ? json({ message: 'Update is not a fast forward' }, 422) : json({ object: { sha: 'new-commit' } });
    throw new Error(`Unexpected request ${url}`);
  });
  return requests;
}

test('batch commits preserve parent and base tree and never force-push', async (t) => {
  const requests = mockBatch(t);
  const result = await new GitHubService().batchCommitFiles('o', 'r', 'main', [{ path: 'src/app.ts', content: 'test' }], 'test', ['old.txt']);
  assert.equal(result.success, true);
  assert.equal(requests.find((r) => r.path.endsWith('/git/trees'))?.body.base_tree, 'base-tree');
  assert.deepEqual(requests.find((r) => r.path.endsWith('/git/commits'))?.body.parents, ['parent']);
  assert.deepEqual(requests.at(-1)?.body, { sha: 'new-commit', force: false });
});

test('concurrent branch update rejects without a force-push or ref creation fallback', async (t) => {
  const requests = mockBatch(t, true);
  await assert.rejects(new GitHubService().batchCommitFiles('o', 'r', 'main', [{ path: 'a', content: 'a' }], 'test'), /fast forward/);
  assert.equal(requests.filter((r) => r.method === 'PATCH').length, 1);
  assert.equal(requests.filter((r) => r.path.endsWith('/git/refs')).length, 0);
  assert.equal(requests.at(-1)?.body.force, false);
});

test('partial blob failure aborts before creating a tree, commit or deletion', async (t) => {
  const writes: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    if (options.method) writes.push(url.pathname);
    if (url.pathname.includes('/git/ref/')) return json({ object: { sha: 'parent' } });
    if (url.pathname.endsWith('/git/commits/parent')) return json({ tree: { sha: 'base-tree' } });
    if (url.pathname.endsWith('/git/blobs')) return json({ message: 'Upload failed' }, 403);
    throw new Error('Unexpected write');
  });
  await assert.rejects(new GitHubService().batchCommitFiles('o', 'r', 'main', [{ path: 'a', content: 'a' }], 'test', ['old.txt']), /Branch unchanged/);
  assert.ok(writes.every((path) => path.endsWith('/git/blobs')));
});

test('verified Gothwad account changes abort pending GitHub reads and clear the old PAT', async (t) => {
  const service = new GitHubService();
  service.bindAccount('alice');
  service.setToken('test-alice-token');
  let complete!: (res: Response) => void;
  let signal!: AbortSignal;
  t.mock.method(globalThis, 'fetch', async (_url: URL, options: RequestInit) => {
    signal = options.signal!;
    return new Promise<Response>((done) => { complete = done; });
  });
  const pending = service.getAuthenticatedUser();
  service.bindAccount('bob');
  assert.equal(signal.aborted, true);
  assert.equal(service.hasToken(), false);
  complete(json({ login: 'old-account' }));
  await assert.rejects(pending, { name: 'AbortError' });
  service.bindAccount(null);
});

test('a batch interrupted by Gothwad account switching cannot continue under the new GitHub token', async (t) => {
  const service = new GitHubService();
  service.bindAccount('alice');
  service.setToken('test-alice-token');
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    paths.push(url.pathname);
    if (url.pathname.includes('/git/ref/')) return json({ object: { sha: 'parent' } });
    if (url.pathname.endsWith('/git/commits/parent')) return json({ tree: { sha: 'base-tree' } });
    if (url.pathname.endsWith('/git/blobs')) {
      service.bindAccount('bob');
      service.setToken('test-bob-token');
      return json({ sha: 'blob' });
    }
    throw new Error('Unexpected post-switch write');
  });
  await assert.rejects(service.batchCommitFiles('o', 'r', 'main', [{ path: 'a', content: 'a' }], 'test'), { name: 'AbortError' });
  assert.ok(!paths.some((path) => path.endsWith('/git/trees') || path.endsWith('/git/refs/heads/main')));
  service.bindAccount(null);
});

test('temporary Accounts unavailability blocks requests but preserves the same-owner GitHub connection for retry', async (t) => {
  const service = new GitHubService();
  service.bindAccount('alice');
  service.setToken('test-alice-token');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json({ login: 'alice-github' }); });
  service.pauseAccess();
  await assert.rejects(service.getAuthenticatedUser(), { name: 'AbortError' });
  assert.equal(calls, 0);
  service.bindAccount('alice');
  assert.equal(service.hasToken(), true);
  await service.getAuthenticatedUser();
  assert.equal(calls, 1);
  service.bindAccount(null);
});
