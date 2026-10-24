import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenStorage } from '../src/utils/tokenStorage';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}

test('tokens are session-only, Gothwad-owner bound, and legacy copies are deleted', () => {
  const localStorage = storage();
  const sessionStorage = storage();
  Object.defineProperty(globalThis, 'window', { value: { localStorage, sessionStorage }, configurable: true });
  try {
    localStorage.setItem('gothwad_github_pat', 'legacy-test-value');
    sessionStorage.setItem('gothwad_github_pat', 'unbound-legacy-value');
    tokenStorage.bindOwner('alice-id');
    assert.equal(tokenStorage.get(), '');
    assert.equal(localStorage.getItem('gothwad_github_pat'), null);
    assert.equal(sessionStorage.getItem('gothwad_github_pat'), null);
    tokenStorage.set('session-test-value');
    assert.equal(localStorage.getItem('gitplus_github_connection'), null);
    assert.deepEqual(JSON.parse(sessionStorage.getItem('gitplus_github_connection')!), { ownerId: 'alice-id', token: 'session-test-value' });
    tokenStorage.bindOwner('bob-id');
    assert.equal(tokenStorage.get(), '');
    assert.equal(sessionStorage.getItem('gitplus_github_connection'), null);
    tokenStorage.set('bob-test-value');
    tokenStorage.bindOwner(null);
    assert.equal(tokenStorage.get(), '');
    assert.equal(sessionStorage.getItem('gitplus_github_connection'), null);
  } finally {
    tokenStorage.bindOwner(null);
    Reflect.deleteProperty(globalThis, 'window');
  }
});

test('blocked storage uses memory and owner changes wipe it', () => {
  tokenStorage.bindOwner('alice');
  tokenStorage.set('memory-test-value');
  assert.equal(tokenStorage.get(), 'memory-test-value');
  tokenStorage.bindOwner('bob');
  assert.equal(tokenStorage.get(), '');
  tokenStorage.bindOwner(null);
  assert.throws(() => tokenStorage.set('no-owner-token'), /Verify your Gothwad/);
});
