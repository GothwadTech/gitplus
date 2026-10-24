# Gothwad Accounts integration for GitPlus

GitPlus is a **Gothwad Tech product**. The Accounts service is the only source of truth for Gothwad identity. This document records the actual upstream contracts inspected before implementation; it is not a generic OAuth proposal.

## Source research (read-only)

Inspected `main` snapshots on 2026-10-24:

| Repository / pinned commit | Relevant implementation | Decision for GitPlus |
| --- | --- | --- |
| [Accounts · 507eb25](https://github.com/GothwadTech/accounts/tree/507eb25b24b2a9fd3d4e99a76579026057a4e761) | [`docs/OAUTH.md`](https://github.com/GothwadTech/accounts/blob/507eb25b24b2a9fd3d4e99a76579026057a4e761/docs/OAUTH.md), `cloudflare-worker/src/routes/auth-accounts.ts`, `sessions.ts`, `cookies.ts`, `browser-slots.ts` | First-party web apps use `.gothwadtech.com` HttpOnly-cookie SSO; OAuth + PKCE is for external/native clients. |
| [Mail · 7764dce](https://github.com/GothwadTech/mail/tree/7764dcea7eadab1cb1d1e7beef977f3700664f81) | `worker/src/session.ts`, `src/services/sessionClient.ts`, `src/services/authRedirect.ts` | Separate verified-anonymous from upstream failure; preserve rotated cookies; share in-flight requests; mark returns instead of looping sign-in. |
| [Store · c41d95a](https://github.com/GothwadTech/store/tree/c41d95ae2a6c11c40f697852c5ef3d30cfbec300) | `src/lib/auth.ts`, `src/lib/sessionClient.ts`, `worker/src/auth.ts` | Per-tab account selection and auth-generation checks; keep product-specific permissions separate from identity. |
| [Drive · 4c3bf36](https://github.com/GothwadTech/drive/tree/4c3bf3671cebdc04278ae1d5280ccd20b1cbf7e1) | `src/lib/gothwadSso.ts`, `worker/src/auth.ts`, `worker/src/http.ts` | Bounded identity requests; explicit network/HTML/redirect/429 states; cookie relaying. Identity and a product's external credentials are separate layers. |

No files in those repositories were edited or pushed. GitPlus does not need their databases, vault encryption keys, Telegram credentials or Mail internal token.

## Important details found in Accounts source

1. `GET /api/auth/me` returns `authenticated`, `user`, `activeId`, `authuser`, `accounts`. **It may also return raw Accounts access/refresh tokens.** GitPlus must never transparently proxy its JSON body to the browser. Our adapter emits only allowlisted identity fields (ID, username, display name, derived email, public account slots).
2. The API can rotate session credentials during a read. Dropping valid `Set-Cookie` headers can break subsequent login. GitPlus relays only recognized `gothwad_*` cookies with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and the exact shared domain.
3. The current `resolveSession` falls back to the first live slot if an explicit selector is missing. **GitPlus rejects a mismatched requested slot/index** rather than silently logging into a different account. After verification it pins stable slot `a`–`f`, not a shifting list index.
4. Accounts' anonymous `/auth/me` path can clear all browser slot cookies. A read-only GitPlus check must not unexpectedly sign out Mail/Store/Drive; those anonymous deletion headers are not propagated. Explicit global logout remains on Accounts.
5. Server-to-server calls use the actual Accounts API Worker custom domain, default `https://api.gothwadtech.com/api/auth/me`, not a static frontend URL that could answer HTML. Redirects are not followed.

## Chosen architecture

```text
GitPlus browser on https://gitplus.gothwadtech.com
  GET /api/session[?authuser=a]       credentials: same-origin, cache: no-store
    Pages Function
      filter incoming cookie names (no unrelated site cookies)
      GET https://api.gothwadtech.com/api/auth/me
          Cookie: allowed Gothwad cookies
          X-Gothwad-Authuser: a       (if explicitly selected)
          redirect: manual, timeout: 5 seconds
      validate authenticated user + selected slot
      return sanitized identity + allowlisted HttpOnly cookie rotations

  Verified Gothwad user ID -> separate owner-bound GitHub PAT -> api.github.com
```

Using a first-party Pages Function avoids browser third-party-cookie/CORS dependencies and avoids exposing the raw Accounts response. It adds **no** new identity database or locally minted login token.

## Browser behavior

- Startup is a silent verification, not an automatic redirect. An existing Accounts session opens GitPlus immediately; without a GitHub connection it shows **Connect GitHub**.
- A genuine anonymous session shows **Continue with Gothwad Accounts**. Sign-in is a top-level navigation with a validated first-party return URL and a one-time `__gitplus_auth_return=1` marker. No arbitrary `next` from a query string is trusted.
- A return without usable cookies shows a diagnostic and retry/choose-account actions; it never bounces back automatically.
- API failures, invalid identity, 429 and HTML/routing mistakes show retry states and block the workspace. A temporary outage does not erase an owner-bound GitHub PAT.
- The client shares only in-flight checks per selector. StrictMode's immediate remount can reacquire the same request; the last real subscriber aborts abandoned work. Completed identities are not cached in local/session storage.
- Visible tabs recheck at roughly one-minute intervals; focus/visibility rechecks are throttled to 30 seconds. This is not instantaneous global revocation. Session failures can reset unsaved view state; do not use the editor as durable draft storage.
- Explicit account switches cancel pending checks, invalidate GitHub request generations, clear the old connection and remount the workspace. A stable Gothwad **user ID**, not email, index or slot alone, owns a saved GitHub connection.

## Sign-out semantics

| Action | Effect |
| --- | --- |
| Disconnect GitHub | Clear the current PAT and GitHub UI; remain signed in to Gothwad Accounts. |
| Sign out of GitPlus (this tab) | Clear GitHub connection, gate workspace, persist a tab-local pause marker; no Accounts mutation. “Continue to GitPlus” re-verifies Accounts. |
| Switch Gothwad account | Confirm loss of unsaved work, clear GitHub connection, verify the selected stable slot. |
| Manage Gothwad Account / global sign-out | Open Accounts' own account UI. Global logout is explicit and controlled there. Other GitPlus tabs notice on a subsequent session check. |

The local pause is not provider revocation. No automatic sign-out-all POST is implemented or disguised as a local action.

## `/api/session` contract

Success (200):

```json
{
  "status": "authenticated",
  "user": { "id": "stable-accounts-id", "username": "alice", "name": "Alice", "email": "alice@gothwadtech.com" },
  "activeSlot": "a",
  "authuser": 0,
  "accounts": [{ "slot": "a", "authuser": 0, "username": "alice", "name": "Alice" }]
}
```

Other states:

| HTTP / state | Meaning |
| --- | --- |
| 401 `anonymous` | No usable verified Accounts session. |
| 409 `anonymous`, `account_selection_changed` | Accounts returned a different slot/index than explicitly requested. Choose again. |
| 429 `unavailable` | Upstream rate limit; numeric `Retry-After` is preserved, no auto retry storm. |
| 503 `unavailable` | Timeout/network, HTML, redirect, invalid profile or API failure. Not evidence of logout. |
| 200 `unsupported` | Request is not on configured first-party `GITPLUS_ORIGIN`; includes the configured public origin. No cookies are forwarded upstream. |
| 400 / 403 / 405 | Invalid selector, foreign origin, or unsupported HTTP method. |
| 404 JSON | Unknown `/api/*` route; never SPA HTML. |

All Function responses explicitly set private/no-store caching and restrictive JSON response headers. `_headers` alone does not protect Pages Function responses.

## Security boundaries / what this does not do

- Gothwad authentication is not GitHub authorization. Connecting GitHub still requires consent/permissions from GitHub; no token can be derived from a Gothwad cookie or email.
- The UI gate is not server-side authorization for GitHub writes: those go directly to GitHub and are authorized by GitHub's PAT. Anyone holding a valid PAT can call GitHub independently. Future product APIs must verify Accounts server-side on **every** protected request.
- GitHub PATs remain JavaScript-readable session credentials. The owner tag prevents accidental cross-account reuse; it is not cryptographic proof of ownership or protection against same-origin XSS.
- Aborting a request cannot undo a write GitHub already accepted. Epoch checks stop later steps/retries from continuing under a newly bound account.
- Cross-tab refresh races are ultimately owned by Accounts. GitPlus deduplicates its own requests and relays rotations; it cannot guarantee upstream refresh behavior across every ecosystem tab.
- `pages.dev`, Arena and localhost do not support this shared-domain cookie flow. An external-domain/native product would need separately registered OAuth + S256 PKCE, exact redirects and a reviewed server session flow. No placeholder OAuth client was invented here.
