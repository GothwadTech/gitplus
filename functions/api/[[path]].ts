import { handleSession, sessionJson } from '../../server/accountsSession';
import { handleGitHubOAuth, type GitHubOAuthEnv } from '../../server/githubOAuth';
import { handleAccountAction } from '../../server/accountActions';

export function onRequest(context: { request: Request; env: GitHubOAuthEnv }): Promise<Response> | Response {
  const path = new URL(context.request.url).pathname;
  if (path === '/api/session') return handleSession(context.request, context.env);
  if (['/api/github/config', '/api/github/start', '/api/github/callback', '/api/github/complete'].includes(path)) return handleGitHubOAuth(context.request, context.env);
  if (['/api/accounts/signout', '/api/accounts/signout-all'].includes(path)) return handleAccountAction(context.request, context.env);
  return sessionJson({ error: 'not_found' }, 404);
}
