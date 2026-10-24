import { handleSession, sessionJson, type SessionEnv } from '../../server/accountsSession';

// Pages Functions owns only /api/*; unknown API paths must be JSON 404s, never SPA HTML.
export function onRequest(context: { request: Request; env: SessionEnv }): Promise<Response> | Response {
  if (new URL(context.request.url).pathname !== '/api/session') return sessionJson({ error: 'not_found' }, 404);
  return handleSession(context.request, context.env);
}
