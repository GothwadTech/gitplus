import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownOAuthError, oauthFailure } from '../shared/githubOAuthErrors';

test('OAuth diagnostics include stage and numeric status but never arbitrary provider/query data', () => {
  assert.match(oauthFailure('complete', 'github_client_credentials', 400, 401), /\[complete:github_client_credentials; HTTP 400; GitHub HTTP 401\]/);
  assert.match(oauthFailure('callback', 'invalid_state'), /\[callback:invalid_state\]/);
  for (const input of ['toString', '__proto__', 'private-credential', null, {}]) {
    assert.equal(knownOAuthError(input), 'unknown_error');
    assert.match(oauthFailure('complete', input, 502, 'private-provider-data'), /\[complete:unknown_error; HTTP 502\]/);
    assert.ok(!oauthFailure('callback', input).includes('private-'));
  }
  assert.ok(!oauthFailure('complete', 'github_http_error', 502, Infinity).includes('Infinity'));
});

test('legacy 502 exchange failure is recognized rather than being collapsed to unknown_error', async () => {
  const { oauthResponseFailure } = await import('../shared/githubOAuthErrors');
  const response = new Response(null, { status: 502 });
  const message = oauthResponseFailure('complete', { error: 'github_exchange_failed', message: 'never-display-provider-body' }, response);
  assert.match(message, /\[complete:github_exchange_failed; HTTP 502\]/);
  assert.match(message, /backend:unmarked; deployment:unavailable/);
  assert.ok(!message.includes('unknown_error'));
  assert.ok(!message.includes('never-display-provider-body'));
});

test('unrecognized 502 JSON identifies the response contract without echoing private JSON or arbitrary headers', async () => {
  const { oauthResponseFailure } = await import('../shared/githubOAuthErrors');
  const { OAUTH_PROTOCOL, OAUTH_PROTOCOL_HEADER, OAUTH_DEPLOYMENT_HEADER } = await import('../shared/githubOAuth');
  for (const protocol of [undefined, OAUTH_PROTOCOL, 'private-header']) {
    const response = new Response(null, { status: 502, headers: {
      ...(protocol ? { [OAUTH_PROTOCOL_HEADER]: protocol } : {}),
      [OAUTH_DEPLOYMENT_HEADER]: protocol === OAUTH_PROTOCOL ? 'b1506461ef205d2ef2629047664aaade6fd51399' : 'private-header',
    } });
    for (const data of [null, { error: 'private-token' }, { errors: [{ message: 'private-message' }] }]) {
      const text = oauthResponseFailure('complete', data, response);
      assert.match(text, /complete:oauth_response_unrecognized; HTTP 502/);
      assert.ok(text.includes(`backend:${protocol === undefined ? 'unmarked' : protocol === OAUTH_PROTOCOL ? 'current' : 'different'}`));
      assert.ok(!text.includes('private-'));
      if (protocol === OAUTH_PROTOCOL) assert.match(text, /deployment:b1506461ef20/);
    }
  }
});
