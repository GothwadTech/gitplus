import { BRAND } from '../../../shared/brand';
import type { AuthenticatedSession } from '../../../shared/accounts';

export interface MenuAccount { id: string; authuser: number; username: string; name: string; email: string }
export interface MenuState { user: AuthenticatedSession['user']; accounts: MenuAccount[]; activeId: string | null; authuser: number }
export interface MenuOptions {
  appDomain: string; accountsWebOrigin: string; accountsApiOrigin: string; ecosystemName: string;
  theme: 'light' | 'dark'; anchorEl: HTMLElement | null; nextUrl: string; manageAccountHref: string;
  accountHref: (account: MenuAccount) => string;
  onSwitchAccount: (account: MenuAccount) => void;
  onSignOutAccount: (slot: string) => Promise<void>;
  onSignOutAll: () => Promise<void>;
  onManageAccount: () => void;
  onClose: () => void;
  onError: (message: string) => void;
  extraActions: { label: string; onClick: () => void }[];
}
export interface AccountWidget { open(state: MenuState, options: MenuOptions): void; update(state: MenuState, options: MenuOptions): void; close(): void; isOpen(): boolean }
export const WIDGET_URL = `${BRAND.accountsWebOrigin}/widget/account-menu.js`;
export function widgetState(session: AuthenticatedSession): MenuState {
  return { user: session.user, activeId: session.activeSlot, authuser: session.authuser,
    accounts: session.accounts.map((a) => ({ id: a.slot, authuser: a.authuser, username: a.username, name: a.name, email: `${a.username}@${BRAND.domain}` })) };
}
function usable(value: unknown): value is AccountWidget {
  if (!value || typeof value !== 'object') return false;
  return ['open', 'update', 'close', 'isOpen'].every((key) => typeof (value as Record<string, unknown>)[key] === 'function');
}
export function createWidgetLoader(importer: () => Promise<unknown>, timeoutMs = 5000) {
  let loaded: AccountWidget | null = null;
  let pending: Promise<AccountWidget | null> | null = null;
  return {
    peek: () => loaded,
    load(): Promise<AccountWidget | null> {
      if (loaded) return Promise.resolve(loaded);
      if (pending) return pending;
      pending = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Widget timed out')), timeoutMs);
        Promise.resolve().then(importer).then((module) => { clearTimeout(timer); resolve(module); }, (error) => { clearTimeout(timer); reject(error); });
      }).then((module) => {
        const widget = (module as { GothwadAccountMenu?: unknown } | null)?.GothwadAccountMenu;
        if (!usable(widget)) return null;
        loaded = widget;
        return widget;
      }).catch(() => null).finally(() => { pending = null; });
      return pending;
    },
  };
}
// Use the real Accounts ES module (including its relative template/style modules), not a fork.
export const accountWidget = createWidgetLoader(() => import(/* @vite-ignore */ WIDGET_URL));
