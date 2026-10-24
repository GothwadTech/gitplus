# GitPlus repository audit and repair

Reviewed: 2026-10-24. This is a targeted structure/deployment/data-safety repair, not a certification that every GitHub feature is production-complete.

## Follow-up: product identity and Accounts SSO

GitPlus is a Gothwad Tech product. The initial static-only/PAT-login architecture below was superseded by a Pages Function and Gothwad Accounts product sign-in. See [the phased roadmap](product-roadmap.md) and [source-pinned integration analysis](gothwad-accounts.md).

Implemented in this follow-up:

- GitPlus branding in title, login, header, settings, package and metadata; Gothwad Tech attribution.
- First-party Accounts verification via `/api/session`, sanitized identity only, secure cookie rotations and explicit domain requirements.
- Single-flight session checks, timeout/error/anonymous separation, no redirect loops, stable account selectors and missing-selector fallback rejection.
- Owner-bound GitHub PATs, account-switch request cancellation and batch generation guards.
- Local GitPlus sign-out versus GitHub disconnect versus global Accounts management, clearly labeled.
- Root Pages Functions, API JSON fallback, runtime deployment config and expanded safety tests.

## Initial findings addressed

| Finding | Repair |
| --- | --- |
| No README, docs, public assets, ignore rules or CI | Added root setup, dedicated docs, static assets, `.gitignore`, `.editorconfig`, Node version and CI. |
| Unclear Pages deployment | Added `wrangler.jsonc`, static response headers and exact build/output instructions. |
| Generic package metadata, duplicate Vite entry, unused server/AI dependencies | Named the package, removed unused dependencies and AI capability claim, standardized on npm with a lockfile. |
| Build did not type-check | Production build now runs TypeScript first; tests and Vite config are included. |
| ZIP recursively stripped every shared path segment | Default is preserve paths; explicit option removes only one outer folder. |
| Non-UTF-8 content could be silently changed | Decode strictly and preserve binary/BOM bytes; test uploaded content against Git hashes. |
| Archive traversal and unbounded expansion risk | Validate original paths; add compressed-size, file-count and streaming expansion budgets. |
| Sync force-pushed branch references | Use only non-forced updates; preserve parent/base tree and surface conflicts. |
| Branch read errors treated as empty repositories | Fail closed; initialize with a README before batch sync. |
| Failed files could be skipped while deletions were committed | Abort the batch before tree/commit creation if any blob fails. |
| Truncated GitHub trees appeared complete | Reject truncated trees, show errors and block comparison on tree errors. |
| File refresh used stale branch SHAs | Resolve live branch names when refreshing; clear old comparisons on tree reload. |
| Repository list stopped at 100 | Fetch additional repository pages unless a specific page is requested. |
| Repository dropdowns matched only short names | Code/issue selectors use full owner/repository names, avoiding collisions across owners. |
| Empty files appeared binary; branch refs not query-encoded | Correct empty-text handling and encode refs. |
| Broad admin-scoped token creation link and permanent PAT storage | Prefer fine-grained tokens; session-only storage and legacy persistent-copy cleanup. |
| Initial API/refresh errors hidden in console | User-visible error/retry feedback; only invalid-token HTTP 401 clears startup credentials. |
| Cache button wiped all origin storage, despite no persisted tree cache | Reset only known editor preferences; relabel the UI honestly. |
| Mobile zoom disabled and all scrollbars/text selection suppressed | Restore zoom, selection and normal scrollbars; keep explicit no-scrollbar utilities. |
| Large eager app bundle / blank render failure | Lazy-load heavy tabs/overlays and add a root reload error boundary. |

## Initial-repair verification (historical)

Run `npm ci && npm run check`. Regression tests cover empty files, encoded refs, repo pagination, API status errors, truncated trees, branch-read failures, non-forced commits, concurrent update rejection, partial upload abort, token storage, ZIP layouts, traversal, binary/BOM fidelity, expansion limits and known Git blob hashes.

Verification performed during this repair:

- Clean `npm ci`, all **20 regression tests**, TypeScript and production build passed.
- `npm audit --audit-level=moderate` reported **0 known vulnerabilities** at review time (not a future security guarantee).
- A headless Chromium mobile-viewport smoke check against the production preview passed login UI, theme switching, token visibility, mocked GitHub authentication, session storage, lazy Code tab, empty-file viewing, settings, reload and logout without page errors. GitHub responses were intercepted; this was not real account authentication.
- Preview root, favicon and Arena preview-host requests returned HTTP 200. SPA fallback was checked locally, not on a deployed Pages domain.

No real GitHub write/delete/merge operations or Cloudflare account deployment are part of these tests. The Pages smoke checklist is in [the deployment guide](cloudflare-pages.md).

## Current known limitations / next work

- Accounts SSO, OAuth App + PAT and the actual shared account menu are implemented. No token vault/D1 is intended. Runtime OAuth credentials and live first-party/provider acceptance remain operator work; see [setup](github-oauth.md).
- GitHub Actions log redirects and private raw-file/image downloads may fail in a browser because of CORS or authorization. Opening the resource on GitHub is the safe fallback; do not paste tokens into raw URLs.
- Empty repositories need an initial commit before batch ZIP sync. Large/truncated recursive trees are blocked instead of partially compared. A full subtree traversal workflow is future work.
- Repository lists paginate; several other endpoint lists (branches, releases, issues, PR files, jobs, etc.) still return a limited page. Full pagination/UI for all endpoints remains to be implemented.
- ZIP upload creates ordinary `100644` file entries. It is not a Git clone and does not preserve symlink, submodule or executable-bit semantics. Use Git CLI for those repositories.
- Sync is not a three-way merge. Changes between comparison and starting sync can affect what you overwrite; refresh/recompare first. Changes during upload are protected by non-forced HEAD updates.
- Some settings are stored but not wired to every editor/new-repository flow. They are not evidence that tab size/font/default-branch behavior is implemented everywhere.
- Tabs and selection live in component state, not persistent URL routes. No offline/PWA guarantees or service worker are supplied.
- The UI still contains some legacy broad feature descriptions; feature availability depends on GitHub token type, permissions and organization policies.
- Automated coverage is focused on the safety/data layer, not every UI interaction, screen reader flow or live API endpoint. Test on real mobile browsers and a disposable repository before using write features on important code.

## Follow-up verification

Run `npm ci && npm run check` for current results. The expanded suite checks the initial ZIP/GitHub behaviors plus Accounts cookie filtering, token redaction, selector mismatches, no-store API responses, malformed/HTML/redirect/upstream error handling, first-party domain enforcement, safe sign-in URLs, client single-flight/abort behavior and GitHub credential isolation. Pages Functions compilation is part of `check`.

The initial 20-test count above describes the earlier repair, not the expanded suite. Real Accounts cookie acceptance across products, DNS/custom-domain provisioning and live GitHub writes still require the operator's staging checklist. No deployment or modification to Accounts/Mail/Store/Drive was made here.

Previous SSO-only follow-up checks: **40 regression tests passed**, **3 Playwright browser tests passed**, TypeScript and production build passed, Pages Functions compiled, and `npm audit --audit-level=moderate` reported **0 known vulnerabilities**. Browser checks cover automatic existing-session recognition, GitHub owner isolation on account switch, local sign-out across reload, return/error behavior without redirect loops, and the real local Functions unsupported-domain/JSON-404 responses. Upstream identity/GitHub responses are mocked in the authenticated browser cases; this does not claim live Accounts SSO is deployed.

## OAuth App + universal menu verification (2026-10-24)

- Implemented the accepted OAuth App + PAT design: mandatory Accounts identity, base scopes plus explicit optional `delete_repo`, same-tab S256 PKCE, encrypted ten-minute transaction cookie, verified-owner callback/completion and local owner-bound session storage. No D1, refresh-token persistence, GitHub App installation flow or cross-device sync.
- Replaced the local menu with the actual Accounts-hosted universal module. Explicit slot/global sign-out uses narrowly routed, origin-checked, verified mutations; local GitPlus sign-out stays local. CSP and the trusted-script supply-chain boundary are documented.
- **52 unit/regression tests passed**, including state/PKCE/owner rejection, expiry/tampering, secret rotation, one-use exchange failure, sign-out and widget loader contracts.
- **8 Playwright browser tests passed** with real built Pages assets, pinned actual widget modules and mocked Accounts/GitHub: OAuth completion/reload/disconnect, PAT fallback, denial, widget mutation/failure and stale completion after a Gothwad account switch, plus existing SSO/isolation tests.
- TypeScript, production Vite build and Pages Functions compilation passed. `npm audit --audit-level=moderate` reported **0 known vulnerabilities**; `git diff --check` passed.
- The browser mock uses a consent document and fresh navigation because Playwright only intercepts the first request of a server redirect chain. Real callback 303 behavior is covered by server tests. This is not a live OAuth provider test.
- [Administrator documentation](github-oauth.md) includes exact OAuth App URLs, runtime-secret CLI prompts for dashboard-restricted Pages projects, redeploy/config verification, scope limits and revocation. No real credentials were supplied/configured. Live OAuth/SSO/custom-domain and hosted-module acceptance remain required.

## Follow-up: post-consent failure diagnostics (2026-10-24)

A user reported that GitHub consent succeeded but GitPlus did not connect after returning. The live failure's exact cause remains unconfirmed; no production logs, cookies or real credentials were accessed. Code review confirmed that token-exchange failures lost their provider error categories, and the alert was below the PAT form.

- Preserve only allowlisted GitHub failure categories, including JSON errors on non-2xx responses; distinguish malformed responses, transport failures and safe internal runtime failures.
- Show stage and numeric HTTP status in a focused alert above the OAuth/PAT choices. Never reflect provider descriptions/URLs, arbitrary error strings or exception text.
- Correct Pages dashboard guidance: **Settings → Variables and secrets** is the binding entry point; the separate Runtime panel is not where secrets are entered. No build-time secret injection or relaxed OAuth security checks.
- Local validation: **56 unit tests, 11 browser tests**, TypeScript, production build and Functions compilation passed; dependency audit reported zero known vulnerabilities.
- This repairs failure reporting/visibility; it is **not evidence that the reported live authorization problem has been resolved**. A fresh attempt on the diagnostic deployment is needed to identify the actual failing stage/reason.
