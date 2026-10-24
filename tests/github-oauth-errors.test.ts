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
