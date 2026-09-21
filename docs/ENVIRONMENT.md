# Environment

## PWA

The copied PWA expects Cloudflare Pages/Workers-style bindings.

Source preview:

- With no auth configuration and no `COAST_CHAT_DB` binding, the source PWA exposes its shell behind the public preview password `123456`.
- This fallback turns off automatically once real auth configuration or a real data binding is present.
- The login page labels this password as preview-only. Before connecting real data or deploying a real service, configure your own password hash and session secret.

Required for a real/self-hosted deployment:

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

With the checked-in non-routable placeholder backend, the source debug APK accepts `123456` locally and opens a deterministic one-turn demo window for inspection. The demo contains local sample chat, attachments, tool traces, model-echo metadata and thought-soil data. It does not call a real model or backend.

The demo is enabled only while the Android build still points at:

`https://elementera-coast-source.invalid`

As soon as `COAST_API_BASE_URL` is set to a real backend, the local demo path is bypassed and authentication/data loading use that backend instead. No demo file needs to be deleted.

For maintainers who want to remove the preview fixture entirely rather than simply disable it, remove these preview-only pieces together:

- `apps/android/app/src/main/kotlin/com/elementeracoast/app/feature/shell/SourcePreviewDemo.kt`
- the `sourcePreviewMode` / `loadSourcePreviewDemo` branches in `CoastShellViewModel.kt`
- the `source-preview-demo` local metadata branch in `ModelMetadataRemoteDataSource.kt`

This cleanup is optional; setting a real backend already bypasses them.

Self-hosters should set their own source-build backend endpoint at build time and change the password before connecting real data. Production signing material and production updater/release configuration are intentionally absent.
