# Shared Accounts widget test fixture

Unmodified browser module/template/styles from GothwadTech/accounts commit
`507eb25b24b2a9fd3d4e99a76579026057a4e761`, `web/widget/`.

These fixtures let Playwright exercise the real universal menu contract without network access.
They are **not** bundled or served by the production app. Production imports the canonical
`https://accounts.gothwadtech.com/widget/account-menu.js` ES module.

Update these fixtures only alongside review of the Accounts widget contract.
