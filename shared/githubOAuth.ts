export const GITHUB_SCOPES = ['repo', 'workflow', 'gist', 'read:user', 'user:email', 'read:org'] as const;
export const OAUTH_TTL_SECONDS = 600;
export const OAUTH_PENDING_KEY = 'gitplus_github_oauth_pending';
export const OAUTH_RETURN_PARAM = 'github_oauth';
export function base64url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomProof(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function challengeFor(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
export function validProof(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value); }
