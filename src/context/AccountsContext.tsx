import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { type AccountSession, RETURN_MARKER, validSelector } from '../../shared/accounts';
import { sessionClient } from '../services/accounts/sessionClient';
import { clearPendingOAuth } from '../services/githubOAuth';
import { githubService } from '../services/github';

const SELECTOR_KEY = 'gitplus_account_selector';
const PAUSED_KEY = 'gitplus_signed_out';
type State = AccountSession | { status: 'loading' | 'paused' };
interface AccountsContextValue {
  state: State;
  selector: string | null;
  returned: boolean;
  retry: () => void;
  switchAccount: (selector: string) => void;
  signOut: () => void;
}
const Context = createContext<AccountsContextValue | null>(null);
function stored(key: string) { try { return sessionStorage.getItem(key); } catch { return null; } }
function store(key: string, value: string | null) { try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch { /* Memory state still works. */ } }
function initialSelector() {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('authuser');
  if (url.searchParams.get(RETURN_MARKER) === '1' && fromUrl === null) return null;
  const value = fromUrl ?? stored(SELECTOR_KEY);
  return validSelector(value) ? value : null;
}

export function AccountsProvider({ children }: React.PropsWithChildren) {
  const [selector, setSelector] = useState<string | null>(initialSelector);
  const [revision, setRevision] = useState(0);
  const [returned, setReturned] = useState(() => new URL(window.location.href).searchParams.get(RETURN_MARKER) === '1');
  const [paused, setPaused] = useState(() => stored(PAUSED_KEY) === '1' && new URL(window.location.href).searchParams.get(RETURN_MARKER) !== '1');
  const [state, setState] = useState<State>({ status: paused ? 'paused' : 'loading' });
  const generation = useRef(0);
  const lastCheck = useRef(0);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has(RETURN_MARKER)) {
      url.searchParams.delete(RETURN_MARKER);
      history.replaceState(null, '', url);
      store(PAUSED_KEY, null);
    }
  }, []);

  useEffect(() => {
    if (paused) return;
    const epoch = ++generation.current;
    let disposed = false;
    let running = false;
    let verifiedSelector = selector;
    const releases = new Set<() => void>();
    const check = () => {
      if (running || disposed) return;
      running = true;
      lastCheck.current = Date.now();
      const request = sessionClient.request(verifiedSelector);
      releases.add(request.release);
      request.promise.then((result) => {
        if (disposed || epoch !== generation.current) return;
        if (result.status === 'authenticated') {
          setReturned(false);
          githubService.bindAccount(result.user.id);
          // Pin the verified stable slot, not the shifting position in the Accounts list.
          store(SELECTOR_KEY, result.activeSlot);
          verifiedSelector = result.activeSlot ?? selector;
          if (result.activeSlot) {
            const url = new URL(window.location.href);
            url.searchParams.set('authuser', result.activeSlot);
            history.replaceState(null, '', url);
          }
        } else if (result.status === 'anonymous' || result.status === 'unsupported') {
          githubService.bindAccount(null);
        } else {
          // Fail closed without destroying a valid GitHub PAT on a temporary outage.
          githubService.pauseAccess();
        }
        setState(result);
      }).finally(() => { running = false; request.release(); releases.delete(request.release); });
    };
    check();
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > 30_000) check(); };
    const interval = window.setInterval(onVisible, 60_000);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      for (const release of releases) release();
      clearInterval(interval);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selector, paused, revision]);

  const retry = useCallback(() => {
    store(PAUSED_KEY, null);
    setPaused(false);
    setState({ status: 'loading' });
    setRevision((n) => n + 1);
  }, []);
  const switchAccount = useCallback((value: string) => {
    if (!validSelector(value)) return;
    generation.current++;
    clearPendingOAuth();
    sessionClient.reset();
    githubService.bindAccount(null);
    store(SELECTOR_KEY, value);
    const url = new URL(window.location.href);
    url.searchParams.set('authuser', value);
    history.replaceState(null, '', url);
    setState({ status: 'loading' });
    setSelector(value);
    setRevision((n) => n + 1);
  }, []);
  const signOut = useCallback(() => {
    generation.current++;
    clearPendingOAuth();
    sessionClient.reset();
    githubService.bindAccount(null);
    store(PAUSED_KEY, '1');
    setPaused(true);
    setState({ status: 'paused' });
  }, []);
  return <Context.Provider value={{ state, selector, returned, retry, switchAccount, signOut }}>{children}</Context.Provider>;
}
export function useAccounts() {
  const context = useContext(Context);
  if (!context) throw new Error('AccountsProvider is required');
  return context;
}
