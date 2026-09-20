# Environment and bindings

## Required

### `SOURCE_ACCESS_PASSWORD`

Owner password for the source deployment.

- type: secret/string
- minimum accepted length: 8 characters
- never commit a real value

### `COAST_SESSION_SECRET`

HMAC secret used to sign owner sessions.

- type: secret/string
- minimum accepted length: 32 characters
- never commit a real value

### `COAST_CHAT_DB`

Cloudflare D1 binding used by source-backed stores.

- type: D1 binding
- expected binding name: `COAST_CHAT_DB`
- it is **not** a normal string environment variable

For local preview, `apps/web/wrangler.jsonc` binds this name to a local-only D1 simulation.

For a real self-hosted deployment, create a D1 database owned by that deployment and bind it as `COAST_CHAT_DB` through Cloudflare Pages configuration. Do not reuse a private/production database.

## Optional

### `OPENROUTER_API_KEY`

OpenRouter provider key.

If absent, provider-backed model generation fails explicitly with `OpenRouter key 未配置。`. Source-backed UI/storage surfaces can still be inspected.

### `OPENROUTER_MODEL`

Optional default model id. It is used when a chat request does not explicitly choose a model. The id still has to be accepted by the source model catalog.

## Local file

Copy the root template:

```bash
cp .env.example .dev.vars
```

Do not commit `.dev.vars`, `.env`, keys, database identifiers or other deployment credentials.

Start the local Pages runtime with the tracked local-only Wrangler configuration:

```bash
npx wrangler pages dev apps/web \
  --config apps/web/wrangler.jsonc \
  --env-file .dev.vars
```

## Not provided by this repository

The public source does not provide private deployment domains, private database ids, provider credentials, OAuth credentials, release signing material or updater configuration.
