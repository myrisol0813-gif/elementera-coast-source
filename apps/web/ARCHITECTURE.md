# Elementera Coast application contract

Status: canonical Cloudflare Pages application contract  
Conversation baseline: COAST-PRE-APK-HARD-CLEANUP-16

This contract covers the Pages document and browser runtime, root `functions/` API, D1 persistence, service worker, and the Streamable HTTP MCP porch at `/mcp`.

The canonical runtime is `elementera-mcp/deploy-pages/` plus root `functions/`. Historical data, archived docs, Native planning documents, and construction-only scripts are not runtime contracts.

## Non-negotiable construction rules

1. `elementera-mcp/deploy-pages/index.html` is the only app document and loads one module entry, `public/app.js`.
2. Every feature has one controller and one state owner. No feature reclaims another feature's DOM.
3. Runtime ownership never depends on compatibility loaders, bridges, fallback readers, global guard flags, or a second implementation kept alive “just in case”.
4. D1 is canonical for conversations, memories, friend mailboxes, Daily records, Worldbook, and tool-run summaries.
5. A failed request is visible. The app never silently changes data owner or resurrects deleted data.
6. Every schema change is idempotent and recorded in `schema_migrations`.
7. A retired subsystem is removed from imports, routes, UI, tests, and runtime reads. Historical migration code may name retired tables only to consume or delete them safely.
8. APK preparation starts from this Web/PWA baseline. Native/APK code is a separate construction phase.

## Runtime ownership

| Area | Canonical owner | Responsibility |
|---|---|---|
| Bootstrap and dispatch | `public/app.js` | Construct controllers once and route namespaced events |
| Shell and sidebar | `public/features/shell.js` | Navigation and app chrome |
| Owner conversations | `public/features/chat.js` | Main/radio/lighthouse windows, branches, generation, message actions, window list |
| Memory and thinking soil UI | `public/features/memory.js` | Current conversation soil, pending bag, Memory v2 library, seeds, custom instructions |
| This-turn desk | `public/features/desk.js` | Actual paper receipt, Chinese tool groups, Worldbook editor |
| Coast Daily | `public/features/daily.js` | Moments, Diary, Pets placeholder, future widgets |
| Workbench UI | `public/features/toolroom.js` | Furniture catalog and redacted execution records |
| Friend mailbox UI | `public/mailbox.js` | Visitor-only slow mail, visitor soil, pending bag, notebook, account deletion |
| Clean context assembly | `functions/context-assemble-clean.js` | Sole owner chat/API paper assembly path |
| Surface access | `functions/surface-access-rules.js` | Owner/visitor binding, `backendTools`, and `modelVisibleTools` |
| Tool Registry | `functions/tool-registry.js` | Canonical backend tools, model schemas, ordinary official-MCP descriptors, access checks, execution |
| MCP adapter | `functions/mcp-tools.js` | OAuth/status + friend-mailbox special tools, registry-derived ordinary MCP discovery, input adaptation |
| Thinking soil | `functions/thinking-soil.js`, `functions/memory-store.js` | Per-conversation rolling work context |
| Memory recall | `functions/memory-recall.js`, `functions/memory-store.js` | Relevant confirmed Memory v2 records |
| Coast Worldbook | `functions/worldbook.js`, `functions/worldbook-schema.js` | Keyword terminology and visitor-safe filtering |
| Conversation persistence/API | `functions/chat-router.js`, `functions/chat-store.js`, `functions/chat-schema.js` | Typed D1 conversations and formal chat |
| Radio/Lighthouse MCP bridge | `functions/room-conversation-service.js` | Official MCP messages through the same conversations |
| Daily | `functions/daily-schema.js`, `functions/daily-store.js`, `functions/daily-api.js`, `functions/daily-model-tools.js` | Moments/Diary persistence and direct formal writes |
| Mailbox persistence | `functions/mailbox-schema.js`, `functions/mailbox-repository.js`, `functions/mailbox-service.js` | Visitor-ID-bound records and hard account deletion |

There is no separate runtime owner for Radio or Lighthouse. Calendar, Today Coast, Daily summaries, Daily drafts, Daily albums, cross-window touch, official-soil, lighthouse-room soil, legacy room stores, and old context subsystems are retired.

## Unified conversation contract

Owner chat windows are one entity:

```text
conversation
  id
  title
  room_type = main | radio | lighthouse
  conversation_state
  conversation soil
  Memory v2 access
  Worldbook access
  Workbench access
```

`room_type` changes entrance/source/reply policy, not storage architecture.

- Main, Radio, and Lighthouse all use `soil: conversation` and `memory: conversation_and_global`.
- All three share the same `backendTools` and `modelVisibleTools` surface-access contract.
- Soil remains isolated by `conversation_id`.
- Radio accepts web and official-MCP user-side messages; Coast API Model Partner replies in that same conversation.
- Lighthouse official-MCP writes become user-side turns and do not force an API reply.
- No room-memory block or independent lighthouse thought soil exists.

## Clean model-context contract

The owner model may receive only the short technical prompt, applicable custom instructions, current conversation thinking soil, selected Memory v2 records, keyword-matched Worldbook entries, low-frequency dogtalk when selected, an optional workbench note, recent conversation flow/current input, and provider tool schemas.

There is no cross-window touch block, Today Coast block, room-memory block, hidden room profile, or automatic raw-chat dump. Empty blocks are omitted. Pending candidates never enter as confirmed memory.

## Memory contract

User-facing Memory v2 entrances are:

- 记忆库
- 种子库
- 世界书
- 自定义指令

Thinking soil belongs to the current `conversation_id`. Pending candidates do not count as confirmed long-term memory. Confirmed memories and seeds retain provenance and revision history.

## Workbench and surface-access contract

`functions/tool-registry.js` is the single tool fact source. Surface access uses explicit names:

```text
backendTools        = 后端可用工具
modelVisibleTools   = 模型可见工具
```

The owner desk displays exactly these conceptual groups:

- 后端可用工具
- 模型可见工具
- 常用工具
- 小工具

The former ambiguous internal pair `tools` / `modelTools` is not part of the surface-access or desk receipt contract. The provider-facing chat request may still use the protocol field named `tools`, because that name belongs to the model provider API rather than Coast surface access.

For owner conversations the current model-visible furniture is:

- 常用工具: `read_mystic_dogtalk`, `memory_search`, `memory_write_candidate`
- 小工具: `create_moment`, `create_diary`, `moment_comment`, `moment_like`

Successful calls add their friendly furniture name to the turn receipt. Tool-run logs remain compact/redacted.

## Official MCP contract

`/mcp` exposes OAuth-scoped tools. Ordinary Coast tools are described in Tool Registry and surfaced through `listRegisteredMcpTools()`; `mcp-tools.js` does not maintain a second full copy of those schemas.

Only these MCP categories remain hand-authored outside ordinary registry descriptors:

- `get_coast_status`
- friend-mailbox patrol/reply/pocket/report tools, because they assemble special isolated visitor context packages
- `render_thinking_block`, which remains in its established independent thinking-block MCP path and is not part of the Coast Tool Registry cleanup

The Coast catalog keeps the current names for radio, lighthouse, authorized memory, dogtalk, Moments, Diaries, status, and friend mailbox. No compatibility map exists for retired tool names. Calling an old or unknown name returns the ordinary unavailable/unknown-tool response and never routes to a retired handler.

No MCP tool named `write_official_soil`, `write_lighthouse_room_soil`, Daily draft/album/summary tool, or `calendar.*` exists.

## Daily contract

Daily is intentionally small:

- 碳硅圈 / Moments
- 日记 / Diaries
- 宠物系统（占位）
- 未来小组件（占位）

There is no Daily summary, generated-content draft bag, album wall, Calendar entrance, or Today Coast integration. Model/MCP Daily writes create formal Moments or Diaries directly.

Fresh D1 databases create:

- `daily_moments`
- `daily_moment_comments`
- `daily_moment_likes`
- `daily_diaries`
- `daily_profile`

### Daily images

Moment and Diary bodies do not accept, store, return, render, or expose `image_refs`, image URLs, or `image_refs_json` in current runtime/schema contracts. Fresh Daily tables do not create `image_refs_json`.

An upgraded existing D1 database may physically retain an old `image_refs_json` column because this cleanup intentionally avoids risky table rebuilds solely to drop a dead column. Such a column is inert: current runtime never reads it, writes it, returns it in API responses, or exposes it to model/MCP schemas.

Decorative profile persistence remains intentionally separate and active:

- the human-owner avatar wire field
- the model-partner avatar wire field
- `moment_cover_dataurl`

Future body images must use attachment/file objects and enter a model vision-input path. They must not return as URL-shaped pseudo-vision fields. See `docs/future-vision-images.md`.

## UI contract

- `#chatWindow` is the only owner chat surface; there is no `#roomWindow`.
- Conversation rows visibly identify main/radio/lighthouse type.
- Official MCP messages retain provenance and are not rendered as Human Owner-authored editable messages.
- The latest completed turn may expose thinking-soil hand seeds for that conversation.
- The compact status opens `本轮上下文预览`.
- Owner-visible desk labels are Chinese while storage/API/internal field names stay stable.
- Visitor pages never render owner desk, owner Worldbook, workbench records, owner memories, Radio, or Lighthouse.

## Retired systems

The following must not regrow:

- Calendar / Today Coast
- Daily Summary / Draft / Album
- Cross-window Touch
- official_soil / lighthouse room soil
- old radio/lighthouse room stores
- old context manifest/ambient/mode/facet machinery

Legacy migrations may mention historical names solely to migrate/drop old storage. Runtime code must not expose them as live features.

## PWA and cache contract

The Web/PWA shell uses a single explicit application cache version. Frontend cleanup that changes user-visible runtime must bump it so service workers cannot resurrect removed UI. Network-only API/MCP/auth/mailbox routes are not served from the application cache.

## API contract

- `/api/conversations*`, `/api/history`, `/api/profile`: typed conversation/profile persistence.
- `/api/chat` and `/api/chat/landing-letter`: formal generation through clean assembly.
- `/api/memory/*`: conversation soil, pending bag, confirmed Memory v2, revisions, custom instructions, explicit search.
- `/api/worldbook[/:id]`, `/api/worldbook/test-match`: owner-only dictionary CRUD and matching.
- `/api/workbench/tools`, `/api/workbench/runs`: owner furniture catalog and redacted records.
- `/api/daily/moments*`, `/api/daily/diaries*`, `/api/daily/profile`: complete Daily API surface.
- `/api/mailbox/*` and `/api/owner/mailbox/*`: isolated visitor/owner mailbox surfaces.
- `/mcp`: OAuth-scoped MCP porch.

There is no Calendar/Today Coast API, Daily summary/draft/album API, or separate legacy radio/lighthouse CRUD API.

## Verification gates

1. Static architecture tests enforce one app entry, one chat owner, clean retired-system boundaries, and synchronized cache versions.
2. Context tests prove current input and clean non-empty paper survive comfort trimming.
3. Room tests prove main/radio/lighthouse share `backendTools` and `modelVisibleTools` while soil stays isolated by conversation.
4. Daily tests prove only formal Moments/Diaries/profile survive and body-image URL/reference fields do not.
5. MCP tests prove tools/list contains only current tools, old names return ordinary unknown/unavailable, and ordinary schemas are registry-derived.
6. Mailbox tests keep visitor namespaces sealed from main Coast data.
7. DOM tests prove removed image-reference inputs/renderers and Chinese owner-facing desk labels stay gone.
8. `npm run test:core`, `test:daily`, `test:mcp`, `test:memory`, `test:mailbox`, and `test:ui` are available; `npm test` remains the full gate and `test:all` aliases it.
9. Cloudflare Pages build and full tests must pass before the APK/native phase treats this baseline as stable.
