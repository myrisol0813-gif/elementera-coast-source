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

`COAST_CHAT_DB` is not a secret string. It is the D1 binding name expected by the source code.

## 2. Create a source D1 database

Create a new D1 database you control:

```bash
npx wrangler d1 create elementera-coast-source-local
```

Keep the resulting database id for your own deployment. Do not substitute a private production database.

## 3. Run locally

From the repository root:

```bash
npx wrangler pages dev apps/web \
  --env-file .dev.vars \
  --d1 COAST_CHAT_DB=<YOUR_D1_DATABASE_ID>
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

Configure a new D1 binding named `COAST_CHAT_DB`. Configure owner access secrets and optional OpenRouter values for the deployment.

Preview and production environments should use resources created for that self-hosted project.

Do not reuse private production credentials, database identifiers, domains or update infrastructure.

## Native

The Native project lives at `apps/android`. It is currently a source skeleton, not a packaged distribution.

See `docs/KNOWN_LIMITATIONS.md`.
