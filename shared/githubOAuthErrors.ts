import { OAUTH_PROTOCOL, OAUTH_PROTOCOL_HEADER, OAUTH_DEPLOYMENT_HEADER } from './githubOAuth';

// Only fixed, public diagnostic messages may reach the UI. Never reflect provider
// error_description, URLs, response bodies, cookies, codes, verifiers or credentials.
export const OAUTH_ERRORS = {
  github_exchange_failed: 'An older GitPlus backend reported a GitHub token-exchange failure without a specific reason. Check that the custom domain is serving the latest Pages Functions deployment; do not assume the secret is wrong.',
  oauth_response_unrecognized: 'The OAuth endpoint returned JSON that does not match the expected GitPlus error contract. Check the API deployment and any proxy/Worker route on this domain. This response does not establish that the OAuth credentials are wrong.',
  oauth_not_configured: 'The deployed Pages Function is missing OAuth configuration. Set the two credentials in Pages Settings → Variables and secrets, then redeploy.',
  first_party_domain_required: 'Open GitPlus on its configured Gothwad Tech custom domain before connecting GitHub.',
  origin_not_allowed: 'GitPlus rejected the request origin. Open the custom domain directly in the same browser tab and start again.',
  method_not_allowed: 'The OAuth request reached an endpoint with an unsupported method. Check the deployed Functions routing.',
  json_required: 'The OAuth endpoint did not receive the expected JSON request.',
  invalid_request: 'The OAuth request was incomplete or malformed. Start a new connection attempt.',
  invalid_transaction: 'The OAuth transaction cookie or same-tab verification could not be validated. Start again in the same tab; do not run concurrent connection attempts.',
  invalid_state: 'The GitHub callback cookie/state could not be validated. The attempt may have expired or been replaced. Start again in the same browser tab.',
  invalid_callback: 'GitHub returned without a usable authorization code. Start a new connection attempt.',
  denied: 'GitHub authorization was cancelled. Try again or connect with a PAT.',
  account_changed: 'Your Gothwad account changed during GitHub authorization. Start again.',
  account_unavailable: 'Your Gothwad session could not be verified during authorization. Retry your connection.',
  github_client_credentials: 'GitHub rejected the OAuth App Client ID / Client Secret pair. Check that the deployed Pages secrets belong to the same OAuth App, then redeploy.',
  github_redirect_mismatch: 'GitHub rejected the callback URL. The OAuth App callback must exactly match the GitPlus custom-domain /api/github/callback URL.',
  github_bad_code: 'GitHub rejected an expired, already-used or invalid authorization code. Start a fresh connection; do not reload the callback.',
  github_pkce_rejected: 'GitHub rejected the PKCE verifier. Start again in the same tab and finish only one connection attempt at a time.',
  github_email_unverified: 'GitHub requires a verified primary email address before completing authorization. Verify it on GitHub, then reconnect.',
  github_exchange_rejected: 'GitHub rejected the token exchange with an unrecognized error. No GitHub connection was saved.',
  github_http_error: 'GitHub returned an unsuccessful HTTP response during token exchange. No GitHub connection was saved.',
  github_invalid_response: 'GitHub returned an unexpected token-exchange response. No GitHub connection was saved.',
  github_timeout: 'The Pages Function timed out while exchanging the authorization code with GitHub. Start a new connection attempt.',
  github_unavailable: 'The Pages Function could not reach GitHub for the token exchange. Start again or use a PAT.',
  github_internal_error: 'The Pages Function could not finish the OAuth request because of an internal error. The deployment needs investigation.',
  network_error: 'The browser could not reach the OAuth endpoint. Check connectivity and start a new connection attempt.',
  response_not_json: 'The OAuth endpoint returned a non-JSON or unreadable response. Check Pages Functions deployment/routing; this is not a completed connection.',
  unknown_error: 'GitHub authorization could not be completed. No usable failure code was returned.',
} as const;
export type OAuthErrorCode = keyof typeof OAUTH_ERRORS;
export function knownOAuthError(value: unknown): OAuthErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(OAUTH_ERRORS, value) ? value as OAuthErrorCode : 'unknown_error';
}
export function oauthFailure(stage: 'start' | 'complete' | 'callback', code: unknown, status?: number, providerStatus?: unknown): string {
  const safe = knownOAuthError(code);
  const upstream = typeof providerStatus === 'number' && Number.isInteger(providerStatus) && providerStatus >= 100 && providerStatus <= 599 ? `; GitHub HTTP ${providerStatus}` : '';
  return `${OAUTH_ERRORS[safe]} [${stage}:${safe}${status ? `; HTTP ${status}` : ''}${upstream}]`;
}

export function oauthResponseFailure(stage: 'start' | 'complete', result: Record<string, unknown> | null, response: Response): string {
  const candidate = result?.error ?? (result?.status === 'anonymous' || result?.status === 'unavailable' ? 'account_unavailable' : 'unknown_error');
  const code = knownOAuthError(candidate) === 'unknown_error' ? 'oauth_response_unrecognized' : candidate;
  const protocol = response.headers.get(OAUTH_PROTOCOL_HEADER);
  const contract = protocol === OAUTH_PROTOCOL ? 'current' : protocol ? 'different' : 'unmarked';
  const revision = response.headers.get(OAUTH_DEPLOYMENT_HEADER);
  // Never render arbitrary headers or unknown JSON fields in a diagnostic.
  const deployment = revision && /^[a-f0-9]{7,40}$/.test(revision) ? revision.slice(0, 12) : 'unavailable';
  return `${oauthFailure(stage, code, response.status, result?.providerStatus)} [backend:${contract}; deployment:${deployment}]`;
}
