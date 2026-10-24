# GitPlus security and permissions

## Gothwad Accounts identity

GitPlus is a Gothwad Tech product. Product sign-in uses the existing first-party Accounts session, verified by a same-origin Pages Function; see [the integration contract](gothwad-accounts.md).

- HttpOnly, Secure Accounts cookies are sent only to the configured first-party Accounts API. Only explicitly recognized cookie names are forwarded; incoming GitHub Authorization headers and unrelated cookies are not.
- The raw Accounts response can contain access/refresh tokens and private profile data. GitPlus returns only a small public identity projection; tokens, recovery email, phone and date of birth never enter the browser response.
- Only validated secure shared-domain cookie rotations are relayed. Redirects are not followed. No wildcard CORS, dynamic upstream URL, Accounts password form, fake dev user or local identity JWT is provided.
- Shared-domain cookie SSO assumes Gothwad Tech controls and trusts its sibling subdomains. Do not host untrusted executable tenant content under this cookie-sharing parent domain.
- Unknown API paths return JSON 404, and all identity responses are private/no-store. Static `_headers` do not apply to Pages Functions, so the Function supplies its own headers.
- Explicit account selectors are verified, not assumed. A provider fallback to another slot is rejected. Stable Gothwad user IDs own GitHub connections, not email/name/index.
- Client rechecks are periodic, not instantaneous revocation. New protected product APIs must enforce Accounts authorization server-side per request; a browser UI gate alone is not server-side access control.

## GitHub credentials (separate connection)

GitHub repository permissions still use a separately supplied PAT. Gothwad login does not authorize a GitHub account or derive a GitHub credential.

- PATs are sent in Authorization headers only to GitHub's API. The request helper refuses other origins.
- The current connection is stored in memory and tab `sessionStorage` under `gitplus_github_connection`, with the verified Gothwad user ID. It is never deliberately written to permanent `localStorage`.
- Legacy unbound PAT copies in local/session storage are removed, not assigned to whichever Gothwad user logs in first.
- Switching Gothwad users or locally signing out clears the old connection, aborts pending GitHub requests and invalidates multi-step batch generations. Already accepted upstream writes cannot be undone by aborting.
- Temporary identity-service errors gate the app and invalidate requests, but preserve the same-owner PAT for successful revalidation. Unsaved UI state may reset.
- Session storage is **not encrypted** and remains accessible to same-origin JavaScript. XSS, extensions or a compromised deployment can steal the PAT. The owner tag prevents accidental credential reuse, not malicious storage tampering or exfiltration.
- Browser session restore and duplicated tabs may preserve session storage. Local sign-out affects this tab; it does not revoke the PAT or globally sign out Gothwad. Revoke compromised credentials with their provider.
- Never put PATs/Accounts tokens in source, Pages environment variables, `VITE_*`, screenshots or logs. Origin configuration is public; credentials are not.
- Global Accounts logout remains an explicit action in Accounts. A failed GitPlus identity read does not propagate Accounts' sign-out-all cookie deletions to Mail/Store/Drive.

## Least privilege

The login screen links to fine-grained token creation, not a preselected classic token with organization-admin, key-admin or deletion scopes. Set a short expiry and select only needed repositories.

Typical fine-grained repository permissions:

| Feature | Permission to consider |
| --- | --- |
| Browse private code/commits | Contents: read; repository metadata |
| Edit/upload/delete files | Contents: read/write |
| Modify workflow files | Workflows: write as well as relevant content access |
| Read/manage issues | Issues: read or read/write |
| Read/manage PRs | Pull requests: read or read/write; merging also depends on repo policy/content permissions |
| Read/dispatch/rerun Actions | Actions: read or read/write |
| Create releases | Contents: read/write |
| Delete a repository | Administration: write, where supported; use only deliberately |

Token support varies by endpoint and organization policy. Organization tokens may require owner approval or SSO. Some account-level, gist, organization and repository-creation flows have limitations with fine-grained tokens. If a classic token is necessary, choose only required scopes (for example `repo`, `gist`, `workflow`; `delete_repo` only for deliberate deletion). Do not grant unrelated admin scopes just to dismiss an error.

## ZIP and write safety

- ZIP upload limit: 25 MiB compressed; at most 5,000 accepted files.
- Expansion limits: 25 MiB per file and 100 MiB total. Decompression stops when the byte budget is exceeded. Mobile devices may still struggle with large archives.
- Traversal, absolute paths and nested `.git` paths are rejected or excluded; JSZip's original entry name is checked before using sanitized names.
- Generated/dependency folders are ignored by default. **Other sensitive files such as `.env`, private keys and credentials are not automatically excluded. Review the file list.** This is not a full `.gitignore` interpreter or secret scanner.
- Invalid UTF-8 is treated as binary; UTF-8 BOM bytes are preserved for consistent hashes.
- Wrapper removal is explicit and limited to one outer directory.
- Repo-only files are not selected for deletion by default; selected deletions require confirmation.
- Truncated GitHub trees are rejected. Batch sync requires an initialized branch, uses no force push and aborts on partial upload failures.
- Review branch/repository selection and use a disposable repo for your first write. This app can modify and delete real GitHub data.

## Hosting defenses

`public/_headers` defines a restrictive CSP, `nosniff`, no-referrer, disabled camera/microphone/geolocation and caching rules. Production pages cannot be embedded. Inline styles remain allowed for React layout/progress styles; inline scripts and `eval` are not allowed. External script CDNs are not used. Google Fonts and GitHub images/API are narrowly allowed.

Headers are defense-in-depth, not proof that the app is immune to XSS or dependency attacks. Run `npm audit`, review dependency updates, restrict who can deploy, use HTTPS and test the real Pages headers. Do not cache private API responses in a service worker or add an unauthenticated proxy to work around CORS.
