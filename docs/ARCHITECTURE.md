# Architecture

Elementera Coast Source is a source-available long-term conversation workspace with two deliberately separated surfaces: a Web/PWA source application and a Native Android source skeleton.

## Web / PWA

`apps/web` is a static Cloudflare Pages project with Pages Functions.

The browser shell lives under `apps/web/public`. It contains routing, state, chat rendering, memory views, widgets, owner settings, model selection, Model Desk, Tool Call Log, Dev Hands and external-entry surfaces.

The server-side source layer lives under `apps/web/functions`.

```text
Pages middleware
  -> owner / visitor authentication boundary
  -> API router
  -> source stores and service modules
  -> D1 (COAST_CHAT_DB)
  -> optional OpenRouter provider calls
```

## Formal chat context

Before provider delivery, the source chat path can assemble:

- recent messages
- custom instructions
- global excerpt
- Conversation Note
- Active Threads
- recalled Memory Library entries
- Worldbook / Dictionary matches
- Human Thought Chain when its read mode permits it

The resulting Turn Context Preview is source-owned state, not private production state.

## Storage

The source deployment uses its own D1 tables. Stores create source tables lazily with `CREATE TABLE IF NOT EXISTS`.

The public repository does not restore a private production database or old production migrations.

Attachment bytes are stored by the source attachment store in D1 chunks. Snapshot export includes attachment metadata rather than embedding attachment bytes.

## Provider boundary

OpenRouter is optional. Without a provider key, provider-backed model generation is unavailable with an explicit configuration error, while source-backed UI and storage remain inspectable.

Provider-backed web search is exposed only to tool-capable models. Search is not a permanent composer button; the model decides whether to use the exposed capability.

## External integrations

GitHub and Notion are represented by generic adapter contracts and source UI.

Dev Hands is a safe skeleton. Private authorization, credentials, remote-write chains and update infrastructure are outside this repository.

The Common Room and MCP Room are source contracts for external ingress / official MCP-style exchange; they are not a copy of private production OAuth or transport infrastructure.

## Native

`apps/android` uses a separate source application id: `com.elementeracoast.source`.

It is intentionally isolated from private Android application ids and release/update chains.

## PWA cache

The service worker caches the static source shell and public JavaScript/CSS modules. API requests are excluded from static caching.
