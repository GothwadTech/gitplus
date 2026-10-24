# GitPlus documentation

**GitPlus — a Gothwad Tech product.** Start with the [root README](../README.md).

| Document | Purpose |
| --- | --- |
| [Product roadmap](product-roadmap.md) | Canonical naming, phases, completed implementation and remaining work |
| [Gothwad Accounts](gothwad-accounts.md) | Source-pinned Accounts/Mail/Store/Drive findings, SSO decisions and API contract |
| [Cloudflare Pages](cloudflare-pages.md) | Functions, runtime variables, first-party domain and deployment acceptance tests |
| [GitHub OAuth](github-oauth.md) | OAuth App registration, runtime-secret CLI fallback, local storage, scopes and callback security |
| [Architecture](architecture.md) | Runtime boundaries and code ownership |
| [Security](security.md) | Accounts cookies versus GitHub OAuth/PATs, scopes, ZIP safety and hosting defenses |
| [Audit](audit.md) | Initial repository repair, current verification and known limitations |

Deployment is **Pages + Functions**, not static-only. No new database or login secret is needed for first-party Accounts-cookie SSO. GitHub OAuth separately requires its runtime client credentials (PAT remains available without them). Runtime origins are public configuration; never expose credentials through `VITE_*` variables.
