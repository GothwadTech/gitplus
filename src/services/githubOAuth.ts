import { oauthFailure, oauthResponseFailure } from '../../shared/githubOAuthErrors';
import { challengeFor, OAUTH_PENDING_KEY, OAUTH_RETURN_PARAM, OAUTH_TTL_SECONDS, randomProof, validProof } from '../../shared/githubOAuth';
import { record, type AuthenticatedSession } from '../../shared/accounts';
import { githubService } from './github';
import type { GitHubUser } from '../types/github';

interface Pending { verifier: string; state: string; ownerId: string; expires: number }
export function clearPendingOAuth() { try { sessionStorage.removeItem(OAUTH_PENDING_KEY); } catch { /* PAT memory fallback still works. */ } }
function currentAttempt(ownerId: string, generation: number) {
  if (githubService.getAccountId() !== ownerId || githubService.getGeneration() !== generation) throw new Error('Account connection changed. Start GitHub authorization again.');
}
async function api(path: string, data: unknown) {
  const stage = path.endsWith('/start') ? 'start' : 'complete';
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) });
  } catch { throw new Error(oauthFailure(stage, 'network_error')); }
  let result: Record<string, unknown> | null;
  try { result = record(await response.json()); }
  catch { throw new Error(oauthFailure(stage, 'response_not_json', response.status)); }
  if (!response.ok || !result) {
    // Session verification has its own sanitized messages, but keep OAuth diagnostics
    // allowlisted: never display arbitrary response bodies or unknown error strings.
    throw new Error(oauthResponseFailure(stage, result, response));
  }
  return result;
}
export async function startGitHubOAuth(session: AuthenticatedSession, allowDelete: boolean): Promise<string> {
  const epoch = githubService.getGeneration();
  const verifier = randomProof();
  const pending: Pending = { verifier, state: '', ownerId: session.user.id, expires: Date.now() + OAUTH_TTL_SECONDS * 1000 };
  // Test storage before starting an authorization we could not finish in this tab.
  try { sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify(pending)); }
  catch { throw new Error('OAuth needs session storage in this tab. Enable it or use the PAT option.'); }
  try {
    const response = await api('/api/github/start', { challenge: await challengeFor(verifier), selector: session.activeSlot || String(session.authuser), allowDelete });
    currentAttempt(session.user.id, epoch);
    if (!validProof(response.state) || response.ownerId !== session.user.id || typeof response.authorizeUrl !== 'string') throw new Error('Invalid OAuth start response.');
    const target = new URL(response.authorizeUrl);
    if (target.origin !== 'https://github.com' || target.pathname !== '/login/oauth/authorize' || target.searchParams.get('state') !== response.state) throw new Error('Invalid GitHub authorization destination.');
    sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({ ...pending, state: response.state }));
    return target.toString();
  } catch (error) { clearPendingOAuth(); throw error; }
}
export function oauthReturn(): { status: string; error: string | null } | null {
  const url = new URL(window.location.href);
  const status = url.searchParams.get(OAUTH_RETURN_PARAM);
  return status ? { status, error: url.searchParams.get('oauth_error') } : null;
}
function cleanReturnUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete(OAUTH_RETURN_PARAM);
  url.searchParams.delete('oauth_error');
  history.replaceState(null, '', url);
}
let completion: { owner: string; promise: Promise<GitHubUser> } | null = null;
export function completeGitHubOAuth(ownerId: string, returned: { status: string; error: string | null }): Promise<GitHubUser> {
  if (completion?.owner === ownerId) return completion.promise;
  cleanReturnUrl();
  const epoch = githubService.getGeneration();
  const run = async () => {
    if (returned.status !== 'complete') throw new Error(oauthFailure('callback', returned.error));
    let pending: Pending | null = null;
    try { pending = JSON.parse(sessionStorage.getItem(OAUTH_PENDING_KEY) || 'null'); } catch { /* Invalid/missing state is rejected. */ }
    if (!pending || pending.ownerId !== ownerId || pending.expires <= Date.now() || !validProof(pending.verifier) || !validProof(pending.state)) throw new Error('GitHub authorization must finish in the same tab and Gothwad account where it started. Please connect again.');
    currentAttempt(ownerId, epoch);
    const result = await api('/api/github/complete', { state: pending.state, verifier: pending.verifier });
    currentAttempt(ownerId, epoch);
    if (result.ownerId !== ownerId || typeof result.token !== 'string' || !result.token) throw new Error('GitHub returned an invalid connection.');
    githubService.setToken(result.token);
    const connectedEpoch = githubService.getGeneration();
    try { return await githubService.getAuthenticatedUser(); }
    catch (error) { if (githubService.getGeneration() === connectedEpoch) githubService.setToken(''); throw error; }
  };
  const task = { owner: ownerId, promise: undefined as unknown as Promise<GitHubUser> };
  task.promise = run().finally(() => {
    // Do not remove a new user's authorization attempt after an old request settles.
    try { if (JSON.parse(sessionStorage.getItem(OAUTH_PENDING_KEY) || 'null')?.ownerId === ownerId) clearPendingOAuth(); } catch { /* Ignore. */ }
    if (completion === task) completion = null;
  });
  completion = task;
  return task.promise;
}
