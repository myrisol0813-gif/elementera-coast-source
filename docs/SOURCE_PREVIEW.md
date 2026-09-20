# Source preview setup

This source baseline is isolated from the private production Elementera Coast instance.

## Web / PWA

Use `apps/web` as the static + Cloudflare Pages Functions project root.

There is no root JavaScript build step. For local development, use a current Wrangler CLI.

Required source-owned configuration:

- D1 binding: `COAST_CHAT_DB`
- secret: `COAST_SESSION_SECRET` — at least 32 characters
- secret: `SOURCE_ACCESS_PASSWORD` — at least 8 characters

Optional model provider configuration:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`

The repository includes `apps/web/wrangler.jsonc` for a local-only D1 simulation. It contains no real database id and must not be used as deployment configuration.

Example from the repository root:

```bash
cp .env.example .dev.vars

npx wrangler pages dev apps/web \
  --config apps/web/wrangler.jsonc \
  --env-file .dev.vars
```

Without an OpenRouter key, the PWA shell and source-backed UI/storage surfaces can still be inspected; model generation returns an explicit configuration error.

The source repository does not include private production URLs, database identifiers, secrets, signing material, private assets or an updater/release chain.

See `SELF_HOSTING.md` and `ENVIRONMENT.md`.

## Native source shell

Open `apps/android` as the Android project.

Source identity:

- applicationId: `com.elementeracoast.source`
- versionCode: `1`
- versionName: `0.1.0-source`

The Native project is intentionally a minimal Compose shell. It does not contain production signing configuration, updater wiring, release configuration or private launcher assets.

The repository does not commit a Gradle Wrapper. Source CI installs a fixed Gradle version to verify the debug build without introducing a release chain.
