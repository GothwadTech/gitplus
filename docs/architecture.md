# GitPlus architecture

GitPlus is a Gothwad Tech product. Its identity provider is Gothwad Accounts; GitHub is a separately authorized integration.

## Runtime

```text
Cloudflare Pages: dist/ static React app
  /api/* -> root Pages Function
    /api/session -> verified Accounts cookie session -> public identity only
    other paths -> JSON 404

Browser after verified Accounts identity
  -> GitHub REST API using the separately connected GitHub PAT
  -> JSZip + Web Crypto for local ZIP comparison
  -> sessionStorage: owner-bound GitHub PAT, account selector, local sign-out marker
  -> localStorage: non-secret appearance/editor preferences only
```

No new database, AI backend, Express server or self-issued Gothwad login token exists. GitPlus's Function is a small identity adapter, not a generic proxy or GitHub credential vault.

## Ownership

| Module | Responsibility |
| --- | --- |
| `shared/brand.ts` | GitPlus / Gothwad Tech public identity and default first-party domains |
| `shared/accounts.ts` | Public identity types, schema normalization, safe return URL and selectors |
| `functions/api/[[path]].ts` | Pages route dispatch; no accidental SPA fallback for API requests |
| `server/accountsSession.ts` | Trusted upstream request, cookie filtering, timeout, public-profile projection, no-store responses |
| `src/services/accounts/sessionClient.ts` | Single-flight, selector-keyed, abortable session requests; explicit error states |
| `src/context/AccountsContext.tsx` | Automatic session boot/revalidation, account switching, local sign-out pause, generation isolation |
| `src/components/accounts/AccountsGate.tsx` | Product sign-in/setup/error screens and Gothwad account menu |
| `src/App.tsx` | Verified user's GitHub workspace; lazy-loaded tabs and overlays |
| `src/components/AuthScreen.tsx` | **Connect GitHub**, not the product identity login |
| `src/services/github.ts` | GitHub REST API, cancellable request generations, live trees, pagination, batch commits |
| `src/utils/tokenStorage.ts` | Session-only PAT with verified Gothwad user ID ownership; unbound legacy tokens removed |
| `src/utils/zipParser.ts`, `paths.ts`, `encoding.ts` | ZIP byte budgets, path safety and byte-exact Git SHA/Base64 |
| `src/components/ErrorBoundary.tsx` | Reload recovery on render failure |

## Batch sync

1. Validate/deduplicate paths and capture the current GitHub connection generation.
2. Read existing branch HEAD and base tree; fail closed on access/network errors.
3. Upload blobs with bounded concurrency. Abort on any failed file or account-generation change.
4. Create a tree based on the original tree, including only explicitly selected deletions.
5. Create a commit with the captured HEAD as parent.
6. Recheck the generation and update the branch with `force: false`.

This protects against concurrent pushes during upload and against continuing work under another connection. It cannot undo a request already accepted by GitHub and is not a three-way merge between an old ZIP comparison and a later branch version.

## State and storage

No local profile/cookie decoding is considered proof of authentication. The UI holds the latest verified profile only in memory. Persisted selectors are navigation hints; the Function verifies them. Stable slots avoid list-index movement; stable user IDs, not slots, own GitHub credentials.

A temporary identity-service outage blocks the workspace and invalidates pending GitHub calls without deliberately deleting the same-owner PAT. Successful revalidation can restore that connection. An identity change or local sign-out deletes the old connection. Unsaved UI/draft state is not durable and can reset when the gate closes.

The implementation does not introduce a global account-menu script or widen CSP to external scripts: its local account menu uses Accounts-derived, sanitized metadata. Global account management stays on Accounts.

## Tooling

`npm run check` runs tests, TypeScript, Vite build and Pages Functions compilation. TypeScript includes `src`, `shared`, `server`, `functions`, tests and Vite config. `npm run pages:dev` exercises the real local Pages runtime. Vite dev proxies relative `/api` requests to it; browser code never points at a remote service through browser-local localhost.

See [integration research](gothwad-accounts.md) and [product roadmap](product-roadmap.md) for exact source references and planned next phases.
