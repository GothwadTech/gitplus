# GitPlus · product identity and phased implementation

## Non-negotiable identity

- **Product/application name: GitPlus.** Do not brand the app as GoGit, Gothwad GoGit, PlusGit or GitHub Studio.
- **Product owner: Gothwad Tech.** Use “GitPlus — a Gothwad Tech product” where attribution is appropriate.
- **Product sign-in: Gothwad Accounts.** GitHub authorization is a separate connection, never an equivalent account login.
- Canonical source: `shared/brand.ts`; HTML/package metadata are checked-in public surfaces that must stay consistent with it.
- Proposed first-party web address: `https://gitplus.gothwadtech.com`. This is a configuration default, **not a claim that DNS/Pages has already been deployed**.
- Old internal preference keys may remain solely for backward compatibility; old unbound PAT copies are deleted rather than silently attached to an Accounts user.

## Phase plan and status

| Phase | Deliverables | Status |
| --- | --- | --- |
| 0. Existing app repair | Root/docs/public structure, Pages assets, ZIP/path/encoding safety, no force-push, tests | Implemented in the initial repair |
| 1. Identity and research | GitPlus naming; Gothwad Tech ownership; inspect Accounts, Mail, Store, Drive | Implemented; pinned sources in [integration notes](gothwad-accounts.md) |
| 2. First-party Accounts SSO | Read-only Pages session adapter; HttpOnly cookie verification; public-profile projection; automatic existing-session recognition | Implemented; local unit/runtime tests, live deployment still pending |
| 3. Account isolation and lifecycle | Stable slot selector, user-ID-bound GitHub connection, abort/epoch guards, retry and separate local/global sign-out | Implemented; regression-tested |
| 4. Deployment verification | Functions bundle, no-store API, visible preview restriction, regression/browser tests | Local checks implemented; operator acceptance on a real staging domain remains required |
| 5. GitHub authorization + universal menu | OAuth App + PAT, broad scopes and optional deletion, state/S256 PKCE, local owner-bound token; actual Accounts-hosted menu | Implemented and tested; runtime OAuth credentials/live operator acceptance remain required |
| 6. Workspace reliability | All-endpoint pagination, stale-diff conflict detection, executable/symlink handling, drafts scoped by account/repo, coherent editor preferences | Planned; see current limitations in audit |
| 7. Product quality | Keyboard/dialog accessibility, responsive end-to-end coverage, observability without secrets, recovery UX, release checks | Planned |

The accepted design deliberately adds **no D1/token vault or cross-device sync**. GitHub App installation/selected-repository selection was rejected in favor of an OAuth App with broad consent. Local session storage remains the connection model; reconnect on each device. PAT remains an alternative.

## Live release acceptance

1. Connect a first-party staging domain to this Pages project and set `GITPLUS_ORIGIN` to that exact origin.
2. Verify sign-in once on Accounts automatically opens GitPlus's GitHub connection screen; no Accounts token appears in JavaScript-readable storage or JSON.
3. Validate two Gothwad users in two tabs. Switch/expire/remove one slot and confirm no GitHub credential transfers to another user.
4. Verify silent session refresh keeps Accounts cookies working across Mail, Store and Drive. Rejected selectors must not log those products out.
5. Exercise timeout, HTML routing error, 429, expired login and a return without cookies. None may become an automatic redirect loop.
6. Check local sign-out, GitHub-only disconnect, and explicit global Accounts sign-out independently.
7. Configure OAuth runtime credentials using [the CLI fallback](github-oauth.md) if needed, and verify real consent/cancellation plus the hosted universal menu.
8. Complete the disposable-repository write tests in the Pages guide before important repositories are used.

No external deployment, DNS change, Accounts migration or GitHub App registration was performed as part of this source implementation.
