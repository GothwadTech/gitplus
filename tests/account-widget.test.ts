import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWidgetLoader, widgetState, WIDGET_URL } from '../src/services/accounts/accountWidget';

test('widget loader shares the real module import and validates the exported controller', async () => {
  let calls = 0;
  const menu = { open() {}, update() {}, close() {}, isOpen() { return false; } };
  const loader = createWidgetLoader(async () => { calls++; return { GothwadAccountMenu: menu }; });
  const [a, b] = await Promise.all([loader.load(), loader.load()]);
  assert.equal(a, menu); assert.equal(b, menu); assert.equal(calls, 1);
  assert.equal(await loader.load(), menu); assert.equal(calls, 1);
  assert.equal(WIDGET_URL, 'https://accounts.gothwadtech.com/widget/account-menu.js');
});

test('missing or broken widget fails safely and can be retried without a cloned fallback menu', async () => {
  let calls = 0;
  const loader = createWidgetLoader(async () => { calls++; throw new Error('offline'); });
  assert.equal(await loader.load(), null);
  assert.equal(await loader.load(), null);
  assert.equal(calls, 2);
  assert.equal(await createWidgetLoader(async () => ({ GothwadAccountMenu: { open: 'not-a-function' } })).load(), null);
});

test('widget data maps stable slot IDs and only sanitized public identity', () => {
  const session = { status: 'authenticated' as const, user: { id: 'user-id', username: 'alice', name: 'Alice', email: 'alice@gothwadtech.com' }, activeSlot: 'b', authuser: 0, accounts: [{ slot: 'b', authuser: 0, username: 'alice', name: 'Alice' }] };
  const result = widgetState(session);
  assert.equal(result.activeId, 'b');
  assert.equal(result.accounts[0].id, 'b');
  assert.equal(result.user.id, 'user-id');
});
