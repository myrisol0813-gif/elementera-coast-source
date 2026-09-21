# Environment

## PWA

The copied PWA expects Cloudflare Pages/Workers-style bindings.

Required configuration:

- `COAST_PASSWORD_HASH` — SHA-256 hex digest of the owner access password.
- `COAST_SESSION_SECRET` — local/self-hosted session signing secret.
- `COAST_CHAT_DB` — D1-compatible database binding named exactly `COAST_CHAT_DB` (a platform binding, not a checked-in string value).

Optional configuration:

- `OPENROUTER_API_KEY`
- `COAST_GITHUB_ALLOWED_REPOS`
- `COAST_GITHUB_TOKEN`
- `COAST_NOTION_ROOT_PAGE_ID`
- `COAST_NOTION_TOKEN`
- MCP/OIDC variables documented by the code in `apps/web/functions/mcp-auth.js`
- optional vector/AI platform bindings when those features are used.

`apps/web/.env.example` contains empty values only. Local secret files and platform state must remain untracked.

## Android

The checked-in default API base is the non-routable placeholder:

`https://elementera-coast-source.invalid`

Self-hosters should set their own source-build backend endpoint at build time. Production signing material and production updater/release configuration are intentionally absent.
