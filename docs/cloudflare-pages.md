# Deploy GitPlus on Cloudflare Pages

**GitPlus is a Gothwad Tech product.** Deploy **Pages plus the root `functions/` directory**. The earlier static-only instructions are superseded by Gothwad Accounts integration.

## 1. Build and check

Use Node 22.12+ at the repository root:

```sh
npm ci
npm run check
```

This runs regression tests, TypeScript, Vite (`dist/`) and Pages Functions compilation (`.wrangler/functions-build/`). Do not commit either output directory. npm is the only lockfile source of truth.

Current work is on `arena/9559f2f5-gitplus`. A Pages project building `main` will not receive these changes until they are merged/pushed to that release branch. No changes have been pushed or deployed by this implementation.

## 2. Pages Git integration

Create/connect a **Pages** project, not a plain Worker application:

| Setting | Value |
| --- | --- |
| Framework | Vite/React, or None with explicit settings |
| Root directory | Blank (repository root) |
| Build command | `npm run build` |
| Build output | `dist` |
| Node | `22` via `.nvmrc`; optionally `NODE_VERSION=22` |
| Functions directory | Root `functions/` (Pages detects it) |

`wrangler.jsonc` declares Pages output and non-secret runtime variables:

- `GITPLUS_ORIGIN=https://gitplus.gothwadtech.com`: exact trusted HTTPS origin for the app. It must be a subdomain of `gothwadtech.com` with no path/port. This is the **proposed/default host**, not proof of existing DNS.
- `ACCOUNTS_API_ORIGIN=https://api.gothwadtech.com`: dedicated API Worker origin for server-to-server requests. Do not accidentally point it at a static Accounts Pages frontend.

No new D1/R2 binding, `JWT_SECRET`, `MAIL_INTERNAL_TOKEN`, OAuth client secret or GitHub PAT is required. Do not copy another product's secrets into this project. Runtime origins are not `VITE_*` variables. In a Wrangler-configured Pages project, keep runtime settings in the config source; use separate reviewed configuration for a dedicated staging project/origin rather than relying on divergent dashboard overrides.

## 3. First-party custom domain (required for real SSO)

1. Add `gitplus.gothwadtech.com` (or your chosen first-party subdomain) through the Pages project's custom domain settings and follow Cloudflare's DNS/TLS instructions.
2. Set `GITPLUS_ORIGIN` to exactly that origin and redeploy with Functions included.
3. Confirm the existing Accounts API and web login are healthy at their configured domains. Accounts must issue `Secure; HttpOnly; SameSite=Lax; Domain=.gothwadtech.com; Path=/` cookies.
4. Sign in on Accounts, then visit GitPlus in a top-level browser tab. `/api/session` must recognize the shared cookies and return only public identity.
5. Complete the acceptance tests below before advertising the release.

A `pages.dev` deployment is useful for assets/setup feedback but **cannot silently reuse `.gothwadtech.com` cookies**. The same applies to Arena previews and localhost. Do not relax cookie domains, mint fake identity, use wildcard credentialed CORS, or copy Accounts tokens into JavaScript to work around this.

## 4. Optional CLI deployment

From the repository root on your own authenticated machine:

```sh
npm ci
npm run check
npx wrangler login
npx wrangler pages deploy dist --project-name YOUR_PAGES_PROJECT
```

Wrangler can compile the root `functions/` directory during this Pages deploy. Verify its output says Functions were compiled/uploaded. Uploading only `dist` with a static drag-and-drop flow is **not** equivalent and can omit the session API. `wrangler deploy` is not the Pages command.

## Local runtime and hot reload

```sh
npm run build
npm run pages:dev     # Pages + Functions at 0.0.0.0:8788
```

Optional second terminal:

```sh
npm run dev           # Vite at 0.0.0.0:3000, /api proxy -> localhost:8788 inside server
```

Browser code only calls relative `/api/session`; it never calls the user's browser `localhost` for a separate backend. Vite allows Arena `.e2b.app` preview hosts. Local SSO returns `unsupported` by design; unit/browser tests use mocked responses without a runtime bypass. Test real SSO on a first-party staging domain.

`npm run preview` serves only Vite assets and cannot alone validate Functions. `_headers` are interpreted by Pages/Wrangler, not Vite. The local runtime may warn when blocked sandbox internet prevents fetching Cloudflare's optional `Request.cf` placeholder; this does not replace live deployment testing.

## Routing, cookies and caching

- `public/_routes.json` invokes Functions only for `/api/*`. Unknown API paths return JSON 404s, never the HTML login app.
- Pages default SPA fallback serves unmatched frontend paths when no top-level `404.html` exists. Tabs still live in React state rather than URL routes.
- `public/_headers` handles static security/caching headers. Session responses set their own private/no-store, no-referrer, nosniff and restrictive CSP headers in code.
- Do not cache `/api/*` or HTML with an external “Cache Everything” rule. Hashed assets can remain immutable.
- Secure Accounts cookie rotations must remain separate `Set-Cookie` headers, not comma-split strings. Never log their values.
- Production CSP blocks iframe embedding; use a top-level tab for the deployed app. The Vite development UI is for embedded Arena preview.
- No service worker/offline login is provided.

## Release smoke checklist

### Identity

- [ ] Root, favicon and static assets load; title/header/login/settings say **GitPlus**, attributed to **Gothwad Tech**.
- [ ] `/api/session` is JSON/no-store and unknown `/api/not-found` is JSON 404.
- [ ] Signed-out session shows Accounts sign-in, not a PAT-only product login.
- [ ] Existing Accounts login automatically opens GitPlus; GitHub connection remains a separate step.
- [ ] Response JSON/storage contain no Accounts access token, refresh token, recovery email, phone or date of birth.
- [ ] Rotated HttpOnly cookies survive reload; Mail/Store/Drive remain signed in.
- [ ] Two signed-in users/tabs stay isolated; account switch, removed slot and reused slot never reuse another user's GitHub PAT.
- [ ] 503/HTML/redirect/429/timeout show errors without a login loop. A return without cookies shows a diagnostic.
- [ ] Disconnect GitHub, local GitPlus sign-out and explicit global Accounts sign-out behave differently and as labeled.
- [ ] `pages.dev` and preview hosts show the domain requirement; they cannot authenticate from forged UI storage.

### GitHub and UI

- [ ] Use a disposable repository and an expiring least-privilege PAT. Browse/edit an empty file and refresh the live tree.
- [ ] Compare a ZIP containing `README.md`, `docs/`, `public/` and nested `src/`. Paths are preserved; wrapper stripping is opt-in.
- [ ] Confirm selected deletions, protected-branch rejection and non-fast-forward errors; do not force overwrite the branch.
- [ ] Switch Accounts during a pending request/upload: no subsequent commit/ref request continues with the new user's token.
- [ ] Check mobile zoom, themes, account menu, keyboard focus, reload and logout on real browsers.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `/api/session` is HTML | Deploy Functions from repository root; do not publish only static assets. |
| Custom-domain requirement | Request must use exact `GITPLUS_ORIGIN`, not `pages.dev`/Arena/local. |
| `accounts_not_json` / `accounts_redirect` | API origin/Worker routing is incorrect; Accounts login frontend is not the API backend. |
| Anonymous after Accounts handoff | Inspect cookie domain/Secure/path, chosen slot, exact app origin and provider availability; do not retry by automatic redirects. |
| Account no longer available | Provider fell back from a missing selector; GitPlus rejected it. Choose an account again. |
| GitHub 401 / 403 / 404 | Separate from Gothwad login: check PAT expiry, repo access, organization SSO/approval, branch and rate limits. |
| Empty-repo ZIP sync fails | Add an initial README commit first. |
| Actions logs/raw files fail | Browser CORS or GitHub authorization limitation; use the resource on GitHub. |

Wrangler currently pins a vulnerable `undici` transitively; this repository overrides it to patched `^7.30.1`. Keep `npm audit` and Functions/runtime tests in the upgrade workflow rather than downgrading the whole deployment tool blindly.

No Cloudflare account deployment, DNS provisioning, real Accounts login or live GitHub write was performed by the source implementation.
