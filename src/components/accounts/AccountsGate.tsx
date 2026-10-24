import React from 'react';
import { ArrowRight, GitBranch, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { BRAND } from '../../../shared/brand';
import { firstPartyOrigin, signInUrl } from '../../../shared/accounts';
import { useAccounts } from '../../context/AccountsContext';

export function AccountsGate({ children }: React.PropsWithChildren) {
  const { state, selector, returned, retry } = useAccounts();
  if (state.status === 'authenticated') return children;
  const supportedOrigin = firstPartyOrigin(window.location.origin);
  const loading = state.status === 'loading';
  const paused = state.status === 'paused';
  const anonymous = state.status === 'anonymous';
  const title = loading ? 'Checking your Gothwad Account' : paused ? 'Signed out of GitPlus' : anonymous ? 'Your account. Your workspace.' : state.status === 'unsupported' ? 'Use your GitPlus custom domain' : 'Account verification unavailable';
  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-12 bg-[#f8f9fa] dark:bg-[#202124] text-[#202124] dark:text-[#e8eaed]">
      <section className="w-full max-w-lg space-y-7">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[#0494f4] p-3 text-white"><GitBranch size={28} /></div>
          <div><h1 className="text-3xl font-bold tracking-tight">{BRAND.name}</h1><p className="text-sm text-[#5f6368] dark:text-[#9aa0a6]">A {BRAND.company} product</p></div>
        </div>
        <div className="rounded-3xl border border-[#dadce0] dark:border-[#3c4043] bg-white dark:bg-[#292a2d] p-6 sm:p-8 space-y-5 shadow-sm">
          <div className="text-[#0494f4]">{loading ? <RefreshCw className="animate-spin" /> : <ShieldCheck size={28} />}</div>
          <h2 className="text-xl font-bold">{title}</h2>
          <p role={loading ? 'status' : 'alert'} className="text-sm leading-6 text-[#5f6368] dark:text-[#9aa0a6]">
            {loading ? 'Already signed in to Gothwad Accounts? GitPlus will securely recognize your existing session.'
              : paused ? 'Your GitHub connection has been cleared from this tab. Other Gothwad products remain signed in. Continue to verify your account again.'
              : 'message' in state ? state.message : ''}
          </p>
          {anonymous && returned && <p className="text-sm rounded-xl bg-amber-500/10 p-3">Accounts returned without a usable session. Check shared cookies and the custom domain, then retry. GitPlus will not redirect you in a loop.</p>}
          {anonymous && supportedOrigin && <a id="gothwad-signin-link" href={signInUrl(supportedOrigin, selector)} className="flex items-center justify-center gap-2 rounded-xl bg-[#0494f4] px-4 py-3 text-sm font-semibold text-white"><UserRound size={18} />Continue with Gothwad Accounts<ArrowRight size={16} /></a>}
          {!loading && <button type="button" id="accounts-retry" onClick={retry} className="w-full rounded-xl border border-[#dadce0] dark:border-[#3c4043] px-4 py-3 text-sm font-semibold">{paused ? 'Continue to GitPlus' : 'Retry session check'}</button>}
          {state.status === 'unsupported' && state.productionOrigin && <a className="block text-center text-sm text-[#0494f4] underline break-all" href={state.productionOrigin}>Open {state.productionOrigin}</a>}
          {anonymous && supportedOrigin && <a className="block text-center text-sm text-[#0494f4] underline" href={signInUrl(supportedOrigin, null, true)}>Choose another Gothwad account</a>}
        </div>
        <p className="text-xs leading-5 text-[#5f6368] dark:text-[#9aa0a6]">Sign in with Gothwad Accounts first, then connect GitHub separately. GitPlus never asks for your Gothwad password or copies your Accounts tokens into browser storage.</p>
      </section>
    </main>
  );
}

export function AccountsBar() {
  const { state, switchAccount, signOut } = useAccounts();
  if (state.status !== 'authenticated') return null;
  return (
    <div id="gothwad-account-bar" className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs bg-[#f1f3f4] dark:bg-[#303134] text-[#202124] dark:text-[#e8eaed] border-b border-[#dadce0] dark:border-[#3c4043]">
      <span className="text-[#5f6368] dark:text-[#9aa0a6]">GitPlus <span aria-hidden="true">·</span> Gothwad Tech</span>
      <details className="relative">
        <summary className="cursor-pointer font-semibold py-1 max-w-[240px] truncate">{state.user.email}</summary>
        <div className="absolute right-0 top-full z-[70] mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-[#dadce0] dark:border-[#3c4043] bg-white dark:bg-[#292a2d] p-4 shadow-xl space-y-3">
          <div><p className="font-bold truncate">{state.user.name}</p><p className="text-[#5f6368] dark:text-[#9aa0a6]">Signed in with Gothwad Accounts</p></div>
          {state.accounts.length > 1 && <label className="block space-y-1"><span>Switch Gothwad account</span>
            <select id="gothwad-account-select" className="w-full rounded-lg border border-[#dadce0] dark:border-[#3c4043] bg-transparent p-2" value={state.activeSlot || ''} onChange={(event) => {
              if (confirm('Switch Gothwad account? GitPlus will disconnect GitHub and discard unsaved work in this tab.')) switchAccount(event.target.value);
            }}>{state.accounts.map((account) => <option className="bg-white dark:bg-[#292a2d]" key={account.slot} value={account.slot}>{account.username}@gothwadtech.com</option>)}</select>
          </label>}
          <a className="block text-[#0494f4] underline" href={`${BRAND.accountsWebOrigin}/u/${state.authuser}/me`} target="_blank" rel="noreferrer">Manage Gothwad Account / global sign-out</a>
          <a className="block text-[#0494f4] underline" href={signInUrl(window.location.origin, null, true)}>Choose or add an account</a>
          <button type="button" id="gitplus-signout" className="block w-full rounded-lg border border-[#dadce0] dark:border-[#3c4043] p-2 text-left" onClick={() => { if (confirm('Sign out of GitPlus in this tab and discard unsaved work? Other Gothwad apps will stay signed in.')) signOut(); }}>Sign out of GitPlus (this tab)</button>
          <p className="text-[11px] leading-4 text-[#5f6368] dark:text-[#9aa0a6]">GitHub disconnect only removes the GitHub connection. Signing out here also pauses automatic sign-in for this tab.</p>
        </div>
      </details>
    </div>
  );
}
