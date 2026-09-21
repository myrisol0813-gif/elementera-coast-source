# Elementera Coast module map

This is the current ownership map after the APK-preparation cleanup splits. It describes responsibility boundaries, not a second architecture layer.

## Web / PWA owners

- `public/app.js` — boots the Web/PWA shell and mounts the native owners.
- `public/features/chat.js` — Chat runtime/state owner.
- `public/features/memory.js` — Memory UI runtime/state owner.
- `public/features/models.js` — model catalog/search/selection state owner.
- `public/features/daily.js` — Daily cache/profile/feed runtime/state owner.
- `public/features/desk.js`, `tools.js`, `toolroom.js`, `settings.js`, `shell.js`, `letters.js`, `dogtalk.js` — their named surfaces only.
- `service-worker.js` — PWA shell cache contract. Front-end runtime modules added below an owner must be precached.
- `public/core/model-format.js` — shared front-end model short-name formatter used by Chat, Daily, Memory and Settings.

## Chat

Entry: `public/features/chat.js`

- `chat/chat-profile.js` — profile/model cleanup and reply token budget.
- `chat/chat-stream.js` — SSE parser and transport.
- `chat/chat-context.js` — recent-turn chat context and `official_mcp` source annotation.
- `chat/chat-request-context.js` — run settings → request settings and memory cooldown ids.
- `chat/chat-stream-flow.js` — stream event state machine: desk slip, meta, delta, usage, done, error.
- `chat/chat-generation.js` — generation controller, save/finalize, lighthouse no-generation guard, landing letter and auto-title lifecycle.
- `chat/chat-conversations.js` — conversation/history persistence and room-type lifecycle.
- `chat/chat-render.js` — full conversation/message rendering plus throttled local streaming assistant-text patching.
- `chat/chat-actions.js` — composer and message action dispatch.

`chat.js` owns the single runtime object. Submodules receive that state by reference and do not create a second store.

## Memory UI

Entry: `public/features/memory.js`

- `memory/memory-constants.js` — routes, tags and filter dimensions.
- `memory/memory-format.js` — pure display/parse helpers.
- `memory/memory-client.js` — Memory HTTP requests only.
- `memory/memory-soil-view.js` — thought-soil display/edit and hand-seed / pocket-candidate text formats.
- `memory/memory-pocket-view.js` — pending-pocket UI.
- `memory/memory-library-view.js` — memory/seed libraries, filters, entry editor and vector-status view.
- `memory/memory-custom-view.js` — custom-instructions UI.
- `memory/memory-actions.js` — Memory UI event dispatch.

`memory.js` remains the only UI state owner and owns conversation/reply lifecycle hooks.

## Memory backend

HTTP entry: `functions/memory-router.js`

- `functions/memory/memory-request.js` — request/body/path helpers.
- `functions/memory/memory-soil-organizer.js` — soil prompt, bounded context, strict JSON/retry/fallback, pocket candidate/provenance workflow.
- `functions/memory/memory-soil-route.js` — soil HTTP endpoints.
- `functions/memory/memory-pocket-route.js` — pending-pocket HTTP endpoints.
- `functions/memory/memory-entry-route.js` — memory/seed HTTP endpoints.
- `functions/memory/memory-search-route.js` — search/recall/vector-status HTTP endpoints.
- `functions/memory/memory-custom-instructions-route.js` — custom-instructions HTTP endpoints.

Persistence compatibility entry: `functions/memory-store.js`

- `memory-store/memory-db.js` — store error and SQL helpers.
- `memory-store/memory-schema.js` — existing Memory schema initialization only.
- `memory-store/memory-normalize.js` — canonical normalization/mapping helpers.
- `memory-store/memory-soil-store.js` — soil persistence.
- `memory-store/memory-pocket-store.js` — pending-pocket persistence and resolution.
- `memory-store/memory-entry-store.js` — memory/seed persistence.
- `memory-store/memory-custom-store.js` — custom-instructions persistence.
- `memory-store/memory-index.js` — organized-range, search facets, embedding and recall index helpers.

The old `memory-store.js` path is a thin barrel so callers keep one stable import path.

## Models backend

Compatibility entry: `functions/models.js`

- `models/model-constants.js` — provider/model constants.
- `models/model-catalog.js` — OpenRouter catalog/cache and model grouping.
- `models/model-validation.js` — request validation and provider error mapping.
- `models/model-payload.js` — formal request payload capability handling.
- `models/model-formal-chat.js` — formal non-streaming, streaming and tool-call rounds through one gateway.
- `models/model-sandbox.js` — sandbox request policy using the same provider primitives.
- `models/model-route.js` — HTTP route wrappers and model error response.

The old `models.js` path remains the stable exported API.

## Models UI

Entry: `public/features/models.js`

- `models/models-constants.js` — UI series/defaults/event names.
- `models/models-format.js` — pure names/kinds/sorting/pricing/tags.
- `models/models-client.js` — model catalog request only.
- `models/models-view.js` — full model-box page.
- `models/models-quick-picker.js` — top quick picker and current-model label.
- `models/models-actions.js` — add/remove/select/search/refresh/open event dispatch.

`models.js` is the single catalog/search/profile-selection state owner.

## Mailbox repository

Compatibility entry: `functions/mailbox-repository.js`

- `mailbox-repository/mailbox-db.js` — repository SQL/time/limit helpers and repository error.
- `mailbox-repository/mailbox-mappers.js` — row → visitor/message/notebook/soil/pocket objects.
- `mailbox-repository/mailbox-visitor-store.js` — visitor identity/account lifecycle.
- `mailbox-repository/mailbox-message-store.js` — visitor message/edit/delete/queue maintenance.
- `mailbox-repository/mailbox-notebook-store.js` — visitor notebook reads/archives.
- `mailbox-repository/mailbox-soil-store.js` — visitor thought-soil read and prepared write statement.
- `mailbox-repository/mailbox-pocket-store.js` — visitor pending-pocket read/resolve and prepared write statements.
- `mailbox-repository/mailbox-owner-store.js` — owner patrol, atomic reply transaction, patrol completion and owner summaries.

Visitor data remains scoped by `visitor_id`. The owner reply path keeps the cross-message/soil/pocket update in one `db.batch` transaction.

## Daily

Entry: `public/features/daily.js`

- `daily-client.js` — the single Daily HTTP client.
- `daily/daily-constants.js` — Daily route names.
- `daily/daily-format.js` — pure date/model/tag/author display helpers.
- `daily/daily-profile.js` — avatar/cover rendering, compression and server persistence helper.
- `daily/daily-moments-view.js` — carbon-silicon feed, comments, fold state and moment composer.
- `daily/daily-diaries-view.js` — diary list and composer.
- `daily/daily-actions.js` — create/edit/delete/like/comment/profile/reload event dispatch.

`daily.js` owns the single Daily state/cache/load lifecycle. Summary, Draft, Album and URL/image-ref body-image systems remain retired.

## Integration DOM tests

Entry: `tests/dom.test.mjs`

- `tests/dom/dom-harness.mjs` — one shared happy-dom browser, mock backend and async/danger helpers.
- `tests/dom/dom-chat-flow.test.mjs` — main Chat plus landing/radio/lighthouse flow.
- `tests/dom/dom-memory-flow.test.mjs` — Memory UI and pending-pocket/library flow.
- `tests/dom/dom-desk-flow.test.mjs` — run-control, vector status, Desk/toolroom and Models flow.
- `tests/dom/dom-daily-flow.test.mjs` — Daily diary/moment/comments/like/delete flow.

The aggregator executes these flows sequentially in one browser session so cross-feature state coverage is preserved.


## Clean-27 · Profile / Furniture transparency

- **屋主设置 / 屋主设置** owns Human Owner-side display profile, appearance, chat import/export, model box, Basic Settings, and local About & Diagnostics. Display profile metadata is local UI/export data and is not injected into model context. Long-term instructions still belong to Custom Instructions or Memory.
- **Serpent Action Log / 工具调用记录** is the tool-transparency surface backed by existing `coast_tool_runs`. It is not a settings drawer.
- **Per-message furniture bubble** stores only safe `furniture_runs` metadata on the assistant variant inside the existing conversation state JSON. It binds explicit tool run ids from the generation controller; the UI never guesses by timestamp.
- Retired in Clean-27: API free sandbox, System Prompt draft UI, construction-status UI, developer-tools drawer, Model Partner portrait/bubble/note pseudo-settings.
- Human Owner avatar is not duplicated in 屋主设置. The intended source remains the Carbon-Silicon Circle / Daily profile avatar path; 屋主设置 currently shows explanatory text instead of creating another avatar store.
- Furniture summaries are redacted: Dogtalk/Mailbox bodies are never copied into assistant metadata; Memory search exposes at most five title + tag/category pairs.
