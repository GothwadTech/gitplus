import { firstPartyOrigin, publicIdentity, record, type AccountSession } from '../../../shared/accounts';

const failure = (code: string, message: string): AccountSession => ({ status: 'unavailable', code, message });
export function createSessionClient(fetcher: typeof fetch = fetch) {
  type Pending = { controller: AbortController; subscribers: number; settled: boolean; promise: Promise<AccountSession> };
  const pending = new Map<string, Pending>();
  async function read(selector: string | null, controller: AbortController): Promise<AccountSession> {
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const query = selector === null ? '' : `?authuser=${encodeURIComponent(selector)}`;
      const response = await fetcher(`/api/session${query}`, {
        credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (!response.headers.get('Content-Type')?.includes('application/json')) return failure('session_not_json', 'GitPlus session endpoint returned HTML/non-JSON. Deploy Pages Functions, not only the static dist folder.');
      const body = record(await response.json());
      if (!body) return failure('session_invalid', 'GitPlus received an invalid session response.');
      if (response.ok && body.status === 'authenticated') {
        const user = record(body.user);
        const normalized = publicIdentity({ authenticated: true, user: { id: user?.id, username: user?.username, first_name: user?.name }, activeId: body.activeSlot, authuser: body.authuser,
          accounts: Array.isArray(body.accounts) ? body.accounts.map((a) => ({ ...record(a), id: record(a)?.slot })) : [] });
        return normalized || failure('session_invalid', 'GitPlus could not verify the returned account identity.');
      }
      if ((response.status === 401 || response.status === 409) && body.status === 'anonymous') return { status: 'anonymous', code: String(body.code || 'signed_out'), message: String(body.message || 'Sign in with Gothwad Accounts.') };
      if (response.ok && body.status === 'unsupported' && typeof body.productionOrigin === 'string' && firstPartyOrigin(body.productionOrigin)) return { status: 'unsupported', code: 'first_party_domain_required', message: String(body.message), productionOrigin: body.productionOrigin };
      return failure(typeof body.code === 'string' ? body.code : 'session_unavailable', typeof body.message === 'string' ? body.message : 'Gothwad Accounts could not be verified. Please retry.');
    } catch {
      return failure('session_network_error', 'Session verification failed or timed out. Check your connection and retry.');
    } finally { clearTimeout(timer); }
  }
  return {
    request(selector: string | null) {
      const key = selector ?? 'active';
      let entry = pending.get(key);
      if (!entry) {
        const controller = new AbortController();
        const created: Pending = { controller, subscribers: 0, settled: false, promise: undefined! };
        created.promise = read(selector, controller).finally(() => {
          created.settled = true;
          if (pending.get(key) === created) pending.delete(key);
        });
        pending.set(key, created);
        entry = created;
      }
      const shared = entry;
      shared.subscribers++;
      let released = false;
      return {
        promise: shared.promise,
        release() {
          if (released) return;
          released = true;
          shared.subscribers--;
          // StrictMode cleanup/re-mount can reacquire within the same microtask.
          queueMicrotask(() => {
            if (shared.subscribers || shared.settled) return;
            if (pending.get(key) === shared) pending.delete(key);
            shared.controller.abort();
          });
        },
      };
    },
    reset() {
      for (const entry of pending.values()) entry.controller.abort();
      pending.clear();
    },
  };
}
export const sessionClient = createSessionClient();
