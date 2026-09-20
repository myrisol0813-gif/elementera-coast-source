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
- create/bind a database belonging to the self-hosted source deployment

The `.env.example` line documents the required name; the actual database must be attached through Wrangler or Cloudflare Pages bindings.

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

Attach D1 separately when starting the local Pages runtime:

```bash
npx wrangler pages dev apps/web \
  --env-file .dev.vars \
  --d1 COAST_CHAT_DB=<YOUR_D1_DATABASE_ID>
```

## Not provided by this repository

The public source does not provide private deployment domains, private database ids, provider credentials, OAuth credentials, release signing material or updater configuration.
