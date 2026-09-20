# Self-hosting

This guide describes a **new source deployment**. Do not attach it to private or production resources.

## Requirements

- Node.js with `npx`
- a current Wrangler CLI
- a Cloudflare account for Pages + D1 when deploying remotely
- optionally, an OpenRouter account/key for model generation

There is no root `package.json` and no Web build command in the current source baseline. `apps/web` is served directly as static assets plus Pages Functions.

## 1. Local variables

From the repository root:

```bash
cp .env.example .dev.vars
```

Set your own:

- `SOURCE_ACCESS_PASSWORD` (minimum 8 characters)
- `COAST_SESSION_SECRET` (minimum 32 characters)
- optional `OPENROUTER_API_KEY`
- optional `OPENROUTER_MODEL`

Do not commit `.dev.vars`.

## 2. Local-only D1

The repository includes:

```text
apps/web/wrangler.local.jsonc
```

It binds `COAST_CHAT_DB` to a local D1 simulation using a placeholder id. It exists only for local preview and smoke testing.

Do not replace it with, or point it at, a private/production database. Do not deploy it as the real Pages project configuration.

## 3. Run locally

From the repository root:

```bash
npx wrangler pages dev apps/web \
  --config apps/web/wrangler.local.jsonc \
  --env-file .dev.vars
```

Wrangler normally serves the Pages project at `http://localhost:8788`.

The source stores initialize their own tables lazily. No old production migration is required.

## 4. First smoke test

Check:

1. unauthenticated root redirects to owner login
2. configured owner password creates a session and opens the shell
3. main chat can create an empty source conversation
4. Visitor Mailbox loads its source module
5. Human Thought Chain, Turn Context Preview, Conversation Note, Active Threads, Memory Library, Review Queue, Worldbook/Dictionary, Widgets, Owner Settings, Model Desk, Tool Call Log, Dev Hands and external-entry surfaces open without module errors
6. snapshot export returns a source-only JSON download
7. with no OpenRouter key, model generation returns a clear configuration error instead of pretending to succeed
8. with a valid OpenRouter key, a supported chat model can return a response

## 5. Deploy a new Pages project

Use `apps/web` as the Pages static + Functions root.

Create a new D1 database for the self-hosted deployment and bind it as `COAST_CHAT_DB` in the Cloudflare Pages project. Configure owner access secrets and optional OpenRouter values for that deployment.

Preview and production environments should use resources created for that self-hosted project.

Do not reuse private production credentials, database identifiers, domains or update infrastructure.

## Native

The Native project lives at `apps/android`. It is currently a source skeleton, not a packaged distribution.

See `docs/KNOWN_LIMITATIONS.md`.
