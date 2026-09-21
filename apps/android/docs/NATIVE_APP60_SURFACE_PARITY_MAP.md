# Native ↔ PWA surface parity map

Baseline product mother: PWA app-60 (`elementera-coast@0b9ca38d50738d0c367637ccd06579a4f5feacfe`).

Reviewed deltas:
- app-62 `settings.js`: `模型工作台 / 另一位屋主的工作台` with `工具调用记录` as the current tool shelf item.
- Native phone review: Radio / Lighthouse room entries are transient landings; a persistent conversation is created only on first send or explicit New.
- current PWA Daily moments surface: a model-comment action exists beside normal moment actions. Native exposes it as a separate second-row `让另一位屋主评论` chip, but keeps model comment generation explicitly unwired until backend integration.

PWA source remains read-only reference. Web/PWA code and assets are not copied into this repository.

## Current surface map

| Surface | Native local implementation |
| --- | --- |
| Gate | existing source-faithful Coast mark / password entrance |
| MainShell / Drawer | tuned Native shell and conversation layout |
| Main | opens an existing concrete Main conversation |
| Radio / Lighthouse entry | opens an empty transient room landing with no conversation id |
| First send in Radio / Lighthouse | creates a fresh persistent conversation, then writes user + assistant messages into that exact thread |
| Explicit New in Radio / Lighthouse | immediately creates a fresh persistent conversation |
| Room history | created Radio / Lighthouse conversations remain ordinary sidebar windows and retain their local thread when revisited |
| ChatWindow | Main / Radio / Lighthouse still share one `ChatWindow` / `RoomType` implementation |
| Chat More | opens local `登岛信` for current conversation + model |
| Assistant actions | copy / like / favorite / local regenerate / delete / footprint |
| User actions / variants | edit + copy; edit branches paired user/assistant local variants |
| 本轮工具 | explicit action ids bound to assistant message; no timestamp guessing |
| Dogtalk | existing four-field local drawer |
| 屋主设置 | 个人资料 / 外观 / 聊天记录 / 模型箱 / 基本设置 / 关于与诊断 |
| 模型箱当前模型 | one compact solid `surfaceVariant` bubble with thin outline |
| 模型目录 | unselected models grouped inside one catalog card by o / GPT-4 / GPT-5 / other OpenAI Chat / Free Test / image |
| Model refresh | visible offline action; real OpenRouter retrieval still deferred |
| 模型工作台 | visible desk home (`模型工作台 / 另一位屋主的工作台`) with an extensible tool shelf |
| 工具调用记录 | current only desk tool; persistent redacted local records with filters |
| Furniture → log | opens the Action Log tool inside 模型工作台 using exact action ids |
| Daily | 碳硅圈 / 日记 / blank Pet surface |
| 碳硅圈 normal actions | local like / comment / delete remain on the first action row |
| 碳硅圈 Model Partner comment | separate second-row `让另一位屋主评论` chip; records the local request and clearly reports that real model commenting waits for backend wiring; it does not manufacture a fake Model Partner comment |
| Memory | 记忆库 / 种子库 / 世界书 / 自定义指令 in one 2×2 surface |
| Network | no `INTERNET` permission, no base URL, no real API/OpenRouter/SSE call |

## Room-entry rules

1. `initialConversations()` contains Main history only; there are no hidden `radio-1` / `lighthouse-1` fixture windows.
2. Tapping Radio or Lighthouse does not steal/open an old history thread. It enters a blank room landing (`activeConversationId == ""`).
3. Leaving that landing without sending creates nothing.
4. First send calls the chat owner to create `新聊天 n` for the active room type before any furniture/action/message write occurs.
5. The newly created id becomes active and is immediately present in the sidebar conversation list.
6. Selecting another window and returning through that history item restores the same local thread.
7. Tapping the room entry again intentionally starts a new blank landing; the next first send creates another conversation.
8. The explicit New button still creates a conversation immediately.

## Daily Model Partner-comment rule

1. Normal user actions stay on the first row; `让另一位屋主评论` is visually separated onto a small second-row chip.
2. The chip belongs to `feature/daily/MomentActions.kt`; `MomentScreen.kt` only supplies callbacks.
3. Native does not alter the current string-only local comment schema merely to predict the PWA backend comment schema while it is still changing.
4. Until backend wiring exists, tapping the chip records a redacted local action and shows `真实模型伙伴评论将在后端接线后启用。`.
5. No fake Model Partner-authored comment is inserted into the feed.

## Ownership

```text
feature/chat         LocalChatStore + message/furniture UI
feature/wolf         Wolf settings + ModelCatalog + ModelBoxScreen
feature/letters      Island Letter local content/store/screen
feature/serpentdesk  visible desk home + tool-shelf navigation
feature/actionlog    Action Log data/store/tool screen
feature/daily        Carbon Circle / MomentActions / Diary / blank Pet
feature/memory       Memory / Seed / Worldbook / Custom Instructions
feature/shell        navigation and coordination; transient room landing + materialization orchestration
core/local           local persistence boundary
core/model           stable shared shell/chat models
```

The room landing is not a hidden conversation and has no parallel thread store. On first send the shell asks the existing `LocalChatStore` to create one real conversation, then all messages continue through that same store.

## Model-box rules

1. Current model stands alone above the catalog as a compact bubble sized to content.
2. It is excluded from the unselected catalog.
3. Unselected models live inside one large grouped catalog surface.
4. Each model starts compact and expands in place for id/family/source and `设为当前`.
5. Empty groups display `暂无目录项`; Native does not manufacture extra placeholder models.
6. Refresh remains explicitly offline until backend wiring can retrieve the OpenRouter directory.

## 模型工作台 rules

1. Sidebar opens `模型工作台 / 模型工作台`.
2. Desk home shows `模型工作台` with subtitle `另一位屋主的工作台`.
3. Tool list uses `SerpentDeskItem(tool, title, subtitle)`.
4. Current only tool: `工具调用记录` — `工具调用成功 / 失败 · 房间 · 脱敏摘要`.
5. Furniture focus ids enter that tool directly inside the desk surface.

## Hard boundaries

There is no Calendar / Today Coast / Summary / Album restoration, no old desk pseudo-settings, no hidden legacy route, no WebView/React Native/TypeScript, no `legacy` / `compat` / `bridge` / `temp` / `misc` source layer, and no real network wiring.
