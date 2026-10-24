# GitPlus

**GitPlus is a Gothwad Tech product.** The application name is **GitPlus** everywhere: UI, page title, package metadata and documentation. Gothwad Tech is the product owner; Gothwad Accounts is the identity provider, not an alternative app name.

A mobile-first GitHub workspace built with React, TypeScript, Vite and Tailwind. Browse repositories, edit files, manage issues/PRs, inspect Actions/releases, and compare/upload ZIP codebases.

## Two separate connections

1. **Sign in to GitPlus with Gothwad Accounts.** Existing first-party Accounts sessions are recognized automatically. A same-origin Cloudflare Pages Function verifies HttpOnly cookies with the Accounts API and returns only a public profile.
2. **Connect GitHub separately.** Gothwad login does not grant GitHub repository permissions. Use **Connect with GitHub** (OAuth App) or a manually supplied PAT. Either connection is bound to the verified Gothwad user ID and stored only in this tab session. No D1 or cross-device token sync is used.

No Gothwad password, Accounts access token or refresh token is stored by the browser app. GitHub PATs still need careful handling: session storage is not an encrypted vault.

## Cloudflare architecture

This is now **Pages + a small Pages Function**, not a static-only deployment:

```text
Browser -> /api/session (Pages Function) -> Gothwad Accounts /api/auth/me
        -> /api/github/* (Pages Functions: OAuth state/callback/code exchange)
        -> GitHub REST API (local OAuth token or PAT)
```

No new D1/R2 database or Accounts JWT secret is required. Accounts continues owning sessions. GitHub OAuth requires runtime `GITHUB_CLIENT_ID` and encrypted `GITHUB_CLIENT_SECRET`; PAT works without these. See [OAuth setup and CLI fallback](docs/github-oauth.md) if Pages dashboard runtime editing is disabled.

**Silent SSO requires a first-party HTTPS custom domain.** The proposed/default origin is `https://gitplus.gothwadtech.com`; configure that domain in Pages before production use. `pages.dev`, localhost and Arena preview domains cannot receive `.gothwadtech.com` cookies. They deliberately show a setup message, not fake authentication. The custom domain is configured in source but has **not** been provisioned or deployed by this repair.

## Development

Node.js **22.12+**, npm, one checked-in `package-lock.json`.

```sh
npm ci
npm run check       # unit/regression tests + TypeScript + Vite + Pages Functions compile
npm run pages:dev   # built app + real local Pages runtime at http://localhost:8788
```

For Vite hot reload, keep the Pages runtime running, then in another terminal:

```sh
npm run dev        # port 3000; /api is proxied server-side to port 8788
```

Local production preview intentionally reports that a first-party domain is required. There is **no development authentication bypass**. Automated tests supply mocked Accounts/GitHub responses. Use a dedicated `*.gothwadtech.com` staging origin to test real cookie SSO.

```sh
npm run test        # focused data, SSO, isolation and GitHub tests
npm run typecheck   # source + server + tests
npm run build       # production assets -> dist/
npm run pages:check # compile functions without deploying
npm run preview     # assets only; NOT a complete SSO integration preview
```

Optional browser regression tests (mocked identity/GitHub, real built Pages assets):

```sh
npx playwright install chromium
npm run build
npm run test:browser
```

CI has a separate browser job that installs Chromium and runs these checks. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can point at an existing compatible Chromium binary in a restricted sandbox.

`npm run lint` remains a type-check alias, not an ESLint scan. The patched `undici` override is for Wrangler's development dependency; see the deployment guide.

## Pages settings

| Setting | Value |
| --- | --- |
| Root | Repository root (leave blank) |
| Build command | `npm run build` |
| Output | `dist` |
| Node | `22` |
| Runtime `GITPLUS_ORIGIN` | `https://gitplus.gothwadtech.com` (change if using another first-party subdomain) |
| Runtime `ACCOUNTS_API_ORIGIN` | `https://api.gothwadtech.com` |
| Functions | Root `functions/` must be deployed with the app |
| OAuth runtime credentials | `GITHUB_CLIENT_ID`, encrypted `GITHUB_CLIENT_SECRET`; never `VITE_*` |
| New database | None |

The two origins are non-secret runtime variables already declared in `wrangler.jsonc`. OAuth credentials must be configured separately; no real secret is checked in. Do not upload only the static `dist` directory through a method that omits Functions. See [deployment instructions](docs/cloudflare-pages.md).

## Project layout

```text
functions/api/[[path]].ts   Session, OAuth and explicit sign-out routes + JSON API 404s
server/accountsSession.ts  Accounts verification and cookie/public-profile filtering
shared/                    Product identity and shared Accounts contract
src/
  context/AccountsContext.tsx   Session lifecycle, retry, account switching
  components/accounts/         Gothwad login gate and account menu
  services/accounts/           Abortable single-flight session client
  services/github.ts           GitHub API and non-forced batch sync
  utils/                       Owner-bound GitHub token, ZIP, encoding and storage helpers
public/                    _headers, _routes.json, favicon, robots.txt
docs/                      Product plan, integration research and operations
tests/                     Regression tests with mocked upstream services
.github/workflows/ci.yml    Automated checks
wrangler.jsonc             Pages output and non-secret runtime config
```

Generated `dist/`, `.wrangler/`, dependencies, `.env*` and `.dev.vars*` are not tracked. `public/` contains assets copied into `dist`; docs are repository documentation, not deployed web pages.

## Safety and current scope

- Signed-in Accounts identity is rechecked on startup, on visible-tab intervals and focus; no persistent profile acts as authentication.
- Switching Gothwad users clears the GitHub connection and invalidates in-flight operations. A late response cannot sign a new user in as the previous one.
- “Disconnect GitHub” and “Sign out of GitPlus (this tab)” are distinct. The **actual hosted universal Accounts menu** supports explicitly confirmed ecosystem sign-out and local-only sign-out. Read-only checks never silently sign Mail/Drive/Store out.
- ZIP paths are preserved by default; optional wrapper removal strips one outer directory only. Review all paths/deletions before syncing.
- Batch sync requires an initialized branch, never force-pushes and aborts on partial upload failures. Start with a disposable repository.

## Documentation

- [Product identity and phased roadmap](docs/product-roadmap.md)
- [Accounts research, contract and implementation](docs/gothwad-accounts.md)
- [Cloudflare deployment and rollout checklist](docs/cloudflare-pages.md)
- [GitHub OAuth App, scopes and runtime secrets](docs/github-oauth.md)
- [Architecture](docs/architecture.md)
- [Security and permissions](docs/security.md)
- [Audit and remaining limitations](docs/audit.md)

Source integration is implemented and locally testable. Real first-party cookie SSO and live GitHub writes must still be verified on your deployed staging domain. Other Gothwad repositories were inspected read-only; no changes were pushed to them.
