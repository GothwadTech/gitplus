// Only the GitHub connection lives here. Gothwad identity is always verified by Accounts.
const KEY = 'gitplus_github_connection';
const LEGACY = 'gothwad_github_pat';
let owner: string | null = null;
let memoryToken = '';

function discardLegacy() {
  try { window.localStorage.removeItem(LEGACY); window.localStorage.removeItem(KEY); } catch { /* Storage may be blocked. */ }
  try { window.sessionStorage.removeItem(LEGACY); } catch { /* Ignore. */ }
}
export const tokenStorage = {
  bindOwner(userId: string | null) {
    discardLegacy();
    if (owner !== userId) memoryToken = '';
    owner = userId;
    if (!owner) {
      try { window.sessionStorage.removeItem(KEY); } catch { /* Ignore. */ }
    }
  },
  get(): string {
    discardLegacy();
    if (!owner) return '';
    try {
      const raw = window.sessionStorage.getItem(KEY);
      if (!raw) return memoryToken;
      const value = JSON.parse(raw);
      if (value.ownerId !== owner || typeof value.token !== 'string') {
        window.sessionStorage.removeItem(KEY);
        return '';
      }
      return value.token;
    } catch { return memoryToken; }
  },
  set(token: string) {
    discardLegacy();
    if (token && !owner) throw new Error('Verify your Gothwad account before connecting GitHub.');
    memoryToken = token;
    try {
      if (token) window.sessionStorage.setItem(KEY, JSON.stringify({ ownerId: owner, token }));
      else window.sessionStorage.removeItem(KEY);
    } catch { /* Memory fallback; never use permanent localStorage for a PAT. */ }
  },
};
