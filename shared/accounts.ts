import { BRAND } from './brand';

export interface GothwadUser {
  id: string;
  username: string;
  name: string;
  email: string;
}
export interface GothwadAccount {
  slot: string;
  authuser: number;
  username: string;
  name: string;
}
export interface AuthenticatedSession {
  status: 'authenticated';
  user: GothwadUser;
  activeSlot: string | null;
  authuser: number;
  accounts: GothwadAccount[];
}
export type AccountSession = AuthenticatedSession | {
  status: 'anonymous' | 'unavailable' | 'unsupported';
  code: string;
  message: string;
  productionOrigin?: string;
};

export const RETURN_MARKER = '__gitplus_auth_return';
export function validSelector(value: unknown): value is string {
  return typeof value === 'string' && /^[0-5a-f]$/.test(value);
}
export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function username(value: unknown): string {
  const name = text(value).toLowerCase();
  return /^[a-z0-9._-]{3,24}$/.test(name) ? name : '';
}

/** Allowlist public identity fields. NEVER spread an Accounts response into browser JSON. */
export function publicIdentity(raw: unknown): AuthenticatedSession | null {
  const body = record(raw);
  const user = record(body?.user);
  if (!body || body.authenticated !== true || !user) return null;
  const id = text(user.id);
  const handle = username(user.username);
  if (!id || id.length > 200 || !handle || !Number.isInteger(body.authuser) || Number(body.authuser) < 0 || Number(body.authuser) > 5) return null;
  const activeSlot = typeof body.activeId === 'string' && /^[a-f]$/.test(body.activeId) ? body.activeId : null;
  const accounts: GothwadAccount[] = [];
  if (Array.isArray(body.accounts)) {
    for (const item of body.accounts.slice(0, 6)) {
      const entry = record(item);
      if (!entry || typeof entry.id !== 'string' || !/^[a-f]$/.test(entry.id) || !username(entry.username) || !Number.isInteger(entry.authuser) || Number(entry.authuser) < 0 || Number(entry.authuser) > 5) return null;
      accounts.push({ slot: entry.id, authuser: Number(entry.authuser), username: username(entry.username), name: text(entry.name).slice(0, 120) || username(entry.username) });
    }
  }
  if (new Set(accounts.map((a) => a.slot)).size !== accounts.length || new Set(accounts.map((a) => a.authuser)).size !== accounts.length) return null;
  if (activeSlot && !accounts.some((a) => a.slot === activeSlot && a.authuser === body.authuser && a.username === handle)) return null;
  return {
    status: 'authenticated',
    user: { id, username: handle, name: `${text(user.first_name)} ${text(user.last_name)}`.trim().slice(0, 120) || handle, email: `${handle}@${BRAND.domain}` },
    activeSlot,
    authuser: Number(body.authuser),
    accounts,
  };
}

/** Only a known first-party origin can be a return destination. No user-supplied next URL. */
export function firstPartyOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.hostname.endsWith(`.${BRAND.domain}`)) return null;
    return url.origin;
  } catch { return null; }
}
export function signInUrl(origin: string, selector: string | null = null, choose = false): string {
  const safeOrigin = firstPartyOrigin(origin);
  if (!safeOrigin) throw new Error('Gothwad SSO requires a configured Gothwad Tech HTTPS domain.');
  const next = new URL('/', safeOrigin);
  next.searchParams.set(RETURN_MARKER, '1');
  if (selector && validSelector(selector)) next.searchParams.set('authuser', selector);
  const url = new URL('/signin', BRAND.accountsWebOrigin);
  url.searchParams.set('next', next.toString());
  if (choose) url.searchParams.set('choose', '1');
  if (selector && validSelector(selector)) url.searchParams.set('authuser', selector);
  return url.toString();
}
