# GitHub OAuth App + local connection

GitPlus is a Gothwad Tech product. **Gothwad Accounts sign-in is mandatory.** GitHub authorization is a separate connection: use **Connect with GitHub** or the existing PAT form. This is an **OAuth App**, not a GitHub App installation/selected-repository flow.

## Administrator setup on Cloudflare Pages

1. In GitHub developer settings, register an **OAuth App**:
   - Application name: `GitPlus by Gothwad Tech`
   - Homepage URL: `https://gitplus.gothwadtech.com`
   - Authorization callback URL: **`https://gitplus.gothwadtech.com/api/github/callback`**
   - No device flow or webhook is needed.
2. Record the Client ID and generate a Client Secret privately. Do not paste the secret into chat, source, logs or screenshots.
3. Configure **Pages Functions runtime** bindings `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. The ID is public configuration; the secret must be an encrypted secret. Neither uses a `VITE_` prefix.
4. Deploy/redeploy Pages **with Functions included**, then check the custom domain's `/api/github/config`. It should return `enabled: true` and public scopes, never credentials. This only checks that configuration is present and well-formed; it does not validate credentials against GitHub.
5. Test real authorization/cancellation, account switching and disconnect on the first-party custom domain. A separate staging origin requires its own reviewed configuration and matching OAuth App callback.

### Where to enter these in the Pages dashboard

Use **Workers & Pages → gitplus → Settings → Variables and secrets** in the intended production environment. Add the Client ID as Text or Secret and the Client Secret as Secret/encrypted. This is the Pages Functions binding location; there is no separate “runtime secrets” form to find. The separate **Runtime** panel controls compatibility/placement, not secret values. An explicitly build-only variable is not a substitute for a Function binding. Save before deploying/redeploying.

If the GitPlus button successfully starts authorization, the `/api/github/start` Function already found both values in its environment. This does **not** prove GitHub accepts the credential pair, but missing bindings should not be assumed to explain a later callback failure. Do not move or regenerate working secrets merely because the dashboard does not label them “runtime”.

### If dashboard runtime editing is disabled

A Wrangler-managed Pages project may lock parts of dashboard configuration. A screen saying “Variables and secrets” / “Bindings” does not by itself establish that all variables are build-only. Keep non-secret origins in `wrangler.jsonc`; do not work around the UI by exposing credentials in the Vite bundle.

From this checkout on your own Cloudflare-authenticated machine:

```sh
npm ci
npx wrangler login
npx wrangler pages secret put GITHUB_CLIENT_ID --project-name gitplus
npx wrangler pages secret put GITHUB_CLIENT_SECRET --project-name gitplus
npx wrangler pages secret list --project-name gitplus
```

Replace `gitplus` if your actual Pages project name differs. Each `put` prompts for the value locally; do **not** append it as a shell argument. Setting the public Client ID using the secret command is supported and avoids dashboard-editing restrictions. The pinned Wrangler command supports `--project-name`; do not copy a Workers-specific `--env` flag into these Pages commands.

Redeploy the intended production branch through Pages Git integration after merge (or use the Pages deploy procedure in [the hosting guide](cloudflare-pages.md)). Verify the deployed custom-domain endpoint, not just the build log. Check production/preview scope in your project's configuration; avoid distributing production credentials to untrusted preview code. If Cloudflare reports a permission error, fix your Cloudflare project/account permissions rather than placing the secret in build-time JavaScript.

Missing runtime credentials disable the OAuth button with an explanation. **PAT remains usable after Gothwad login.** No real OAuth App credentials were configured as part of this implementation.

## Access and consent

Requested base scopes:

```text
repo workflow gist read:user user:email read:org
```

The separate, unchecked-by-default deletion checkbox adds `delete_repo`. These are deliberately broad OAuth scopes, as requested; they are not limited to selected repositories. They still cannot bypass repository roles, protected branches, organization OAuth restrictions, SAML SSO, rate limits or unsupported browser API behavior. No unrelated organization/key/admin scopes are requested.

GitHub may retain previously granted permissions. **Unchecking deletion is not revocation or a guaranteed scope downgrade.** Review/revoke the app under GitHub Settings → Applications → Authorized OAuth Apps, then reconnect if you need to remove an older grant. A fine-grained, expiring PAT remains the narrower-access alternative.

## Local persistence and revocation

- OAuth tokens and PATs share the existing owner-bound `gitplus_github_connection` storage: memory plus this tab's `sessionStorage`, never deliberately permanent `localStorage`.
- There is **no D1, central token vault, cross-device connection sync or refresh-token persistence**. Connect separately on another device. If a token expires or is revoked, reconnect.
- Disconnect GitHub removes the local connection; it does not revoke the OAuth App grant or PAT at GitHub. Local GitPlus sign-out and Gothwad ecosystem sign-out are separate actions.
- Browser session restore/duplicated tabs can retain session storage. This is not an encrypted vault. XSS, a compromised deployment or a trusted script can read these tokens; see [security](security.md).
- The access token passes through the Pages completion response once, with private/no-store headers. It is not persisted server-side. Never enable request/response-body logging on these routes.

## Protocol and security checks

1. The browser generates a random same-tab verifier and S256 challenge. `POST /api/github/start` requires exact same-origin JSON and a verified Gothwad account. It returns only the authorization URL/state/owner ID.
2. A random state, challenge, stable account ID/slot, client ID and ten-minute expiry are sealed into `__Host-gitplus_oauth` with AES-GCM. Its encryption key is HKDF-derived from the runtime client secret, app origin and a purpose-specific label. The cookie is Secure, HttpOnly, SameSite=Lax, host-only and Path=/.
3. GitHub's callback must match the sealed state and reverified owner. The code is sealed into the short-lived cookie; the 303 redirect uses a fixed frontend origin and status marker, **not an access token or code in the frontend URL**. The incoming provider callback necessarily contains the one-use code; avoid logging callback query strings.
4. The originating tab POSTs its verifier/state to `/api/github/complete`. The Function verifies PKCE, expiry and owner again, then exchanges the code only at GitHub's fixed token endpoint, with a timeout and redirects disabled. GitHub's single-use code is the replay barrier; no database is introduced.
5. The browser validates the response owner and current connection generation before saving the token. Concurrent completion calls are shared; switching/signing out invalidates old results. Callback status parameters and pending verifier state are removed.

One OAuth transaction cookie exists per browser origin: simultaneous connection attempts in multiple tabs can supersede each other. Finish one at a time; retries are safe. Secret rotation invalidates pending transactions, requiring a new attempt. Blocked session storage prevents OAuth from starting; PAT can still use the existing memory fallback.

## Verification limits

Unit tests cover state/PKCE/owner/origin checks, tampering, expiry, secret rotation, exchange failure and replay rejection. Browser tests mock GitHub consent/completion and Accounts responses, using real built assets and pinned real universal-menu fixtures. They do not prove live GitHub authorization, Cloudflare runtime-secret configuration or cross-product cookie behavior. Complete the deployment checklist before declaring the live integration ready.

## Diagnosing a return that does not connect

GitHub consent is only one step; the callback must still validate state/Accounts identity and exchange the code for a token. A reported production failure after consent is **not yet reproduced or attributed to a specific cause**. Tests below are not a live credential/provider validation.

The earlier implementation discarded GitHub's specific error categories and placed the message below the PAT form. It now displays a focused alert above both connection options, with a safe stage/error/status such as `[complete:github_client_credentials; HTTP 400; GitHub HTTP 401]`. `start`, `callback` and `complete` identify the failing step; HTTP is the Pages response and “GitHub HTTP” is the upstream exchange response when available.

| Diagnostic code | Meaning / next investigation |
| --- | --- |
| `github_client_credentials` | GitHub explicitly rejected the client credential pair; verify the deployed pair belongs to one OAuth App. |
| `github_redirect_mismatch` | GitHub explicitly rejected the callback URI. |
| `github_bad_code` | GitHub rejected an invalid, expired or already-used code; begin a fresh attempt. |
| `github_pkce_rejected` | GitHub rejected the verifier; investigate same-tab attempt handling. |
| `github_email_unverified` | GitHub requires primary-email verification. |
| `invalid_state` / `invalid_transaction` | Callback cookie/state or completion proof could not be validated; investigate expiry, lost cookies, multiple attempts/tabs. |
| `origin_not_allowed` | The protected request origin check failed; investigate the actual browser origin, without weakening CSRF checks. |
| `account_unavailable` / `account_changed` | Accounts verification did not permit completion. |
| `github_http_error` / `github_invalid_response` | Upstream failed or did not provide a valid token response; not enough evidence to blame credentials. |
| `response_not_json` / `github_internal_error` | Investigate Pages routing/runtime, rather than asking the user to repeatedly change secrets. |

Only fixed allowlisted categories and numeric HTTP statuses are displayed. Provider descriptions, exception text and unknown error strings are not reflected. No diagnostic endpoint exposes secret values, token responses, cookie contents or callback codes, and no request/response logging was added. Share only the visible diagnostic—not a HAR, full callback URL or network response containing credentials. Existing origin/owner/state/PKCE validation remains unchanged.
