import React, { useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { BRAND } from '../../../shared/brand';
import { signInUrl } from '../../../shared/accounts';
import { useAccounts } from '../../context/AccountsContext';
import { useTheme } from '../../context/ThemeContext';
import { accountWidget, widgetState, type MenuOptions } from '../../services/accounts/accountWidget';
import { clearPendingOAuth } from '../../services/githubOAuth';

export function AccountsBar() {
  const { state, switchAccount, signOut, retry } = useAccounts();
  const { isDark } = useTheme();
  const anchor = useRef<HTMLButtonElement>(null);
  const alive = useRef(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    alive.current = true;
    void accountWidget.load();
    return () => { alive.current = false; accountWidget.peek()?.close(); };
  }, []);
  const latestOwner = useRef<string | null>(null);
  const session = state.status === 'authenticated' ? state : null;
  latestOwner.current = session?.user.id ?? null;
  useEffect(() => { accountWidget.peek()?.close(); setLoading(false); setNotice(''); }, [session?.user.id]);
  const manageHref = `${BRAND.accountsWebOrigin}/u/${session?.authuser ?? 0}/me`;
  const mutate = async (slot?: string) => {
    if (!session) return;
    const label = slot ? 'this Gothwad account' : 'all Gothwad accounts in this browser';
    if (!confirm(`Sign out of ${label} across Gothwad products? Unsaved work may be lost.`)) return;
    try {
      const response = await fetch(slot ? '/api/accounts/signout' : '/api/accounts/signout-all', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ selector: session.activeSlot || String(session.authuser), ...(slot ? { slot } : {}) }),
      });
      const body = await response.json();
      if (!response.ok || body.ok !== true) throw new Error(body.message || 'Could not confirm Accounts sign-out.');
      if (!alive.current || latestOwner.current !== session.user.id) return;
      clearPendingOAuth();
      if (!slot || slot === session.activeSlot) signOut();
      else retry();
    } catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : 'Accounts is unavailable.'); }
  };
  const options: MenuOptions = {
    appDomain: BRAND.domain, accountsWebOrigin: BRAND.accountsWebOrigin,
    // All widget mutations are overridden below. A future default action cannot call raw /auth/me.
    accountsApiOrigin: `${window.location.origin}/api/accounts`, ecosystemName: 'Gothwad',
    theme: isDark ? 'dark' : 'light', anchorEl: anchor.current,
    nextUrl: new URL(signInUrl(window.location.origin, null, true)).searchParams.get('next')!,
    manageAccountHref: manageHref,
    accountHref: (account) => `/?authuser=${encodeURIComponent(account.id)}`,
    onSwitchAccount: (account) => { if (confirm('Switch Gothwad account? GitPlus will disconnect GitHub and discard unsaved work in this tab.')) switchAccount(account.id); },
    onSignOutAccount: (slot) => mutate(slot), onSignOutAll: () => mutate(),
    onManageAccount: () => { window.location.assign(manageHref); },
    onClose: () => anchor.current?.focus(), onError: (message) => setNotice(message),
    extraActions: [{ label: 'Sign out of GitPlus (this tab)', onClick: () => { if (confirm('Sign out of GitPlus in this tab? Other Gothwad products will stay signed in.')) signOut(); } }],
  };
  // Keep the same shared sheet in sync with theme/account changes, without using auto-sso.
  useEffect(() => {
    if (session && accountWidget.peek()?.isOpen()) accountWidget.peek()?.update(widgetState(session), options);
  });
  if (!session) return null;
  const open = async () => {
    setLoading(true); setNotice('');
    const widget = await accountWidget.load();
    if (!alive.current || latestOwner.current !== session.user.id) return;
    setLoading(false);
    if (!widget) { setNotice('The universal Accounts menu could not load. Retry, or manage your account on Gothwad Accounts.'); return; }
    try { widget.open(widgetState(session), { ...options, anchorEl: anchor.current }); }
    catch { setNotice('The Accounts menu is temporarily unavailable. Use the account management link.'); }
  };
  return <div id="gothwad-account-bar" className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs bg-[#f1f3f4] dark:bg-[#303134] text-[#202124] dark:text-[#e8eaed] border-b border-[#dadce0] dark:border-[#3c4043]">
    <span className="text-[#5f6368] dark:text-[#9aa0a6]">GitPlus · Gothwad Tech</span>
    <button ref={anchor} id="gothwad-account-menu" type="button" aria-label={`Gothwad account menu for ${session.user.email}`} disabled={loading} onClick={open} className="flex items-center gap-2 rounded-full px-2 py-1 font-semibold hover:bg-black/5 dark:hover:bg-white/5"><UserRound size={20} /><span className="max-w-[210px] truncate">{loading ? 'Loading account menu…' : session.user.email}</span></button>
    {notice && <div role="alert" className="w-full rounded-lg border border-amber-500 p-3 space-y-2"><p>{notice}</p><a className="underline mr-4" href={manageHref}>Manage Gothwad Account</a><button type="button" className="underline" onClick={signOut}>Sign out of GitPlus (this tab)</button></div>}
  </div>;
}
