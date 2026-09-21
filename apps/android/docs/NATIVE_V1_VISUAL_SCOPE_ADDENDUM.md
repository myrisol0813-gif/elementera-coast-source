# COAST-NATIVE-V1-VISUAL-AND-SCOPE-ADDENDUM-00

Implementation note for the Native v1 visual/scope pass.

## Visual source of truth

The supplied current PWA screenshots are the composition reference for:

- Gate empty/input states
- Main chat body
- mobile sidebar drawer
- Daily landing/card rhythm
- one-day summary
- carbon-circle feed
- diary page

Screenshots are **not** used to trace or invent the Coast identity mark.

## Original Gate identity source

The actual Gate SVG is embedded inline in the Elementera Coast PWA at:

`elementera-coast/functions/auth.js`

PWA baseline inspected for this pass:

`b6b8267e413c64569541730a69f98ba6c46400e4`

The native `CoastBrandMark.kt` ports the source coordinates for:

- gold left/right horn paths
- three ellipses centered at `(195, 260)`, rotations `0 / +60 / -60`
- paper separator stroke and black visible stroke
- cream wolf body
- gold ear, eye, nose and mouth geometry
- source colors `#24252b`, `#f2b84b`, `#fff0d8`, `#9c8872`

High-resolution PWA icons were also confirmed under:

- `elementera-mcp/deploy-pages/public/icons/icon-192.png`
- `elementera-mcp/deploy-pages/public/icons/icon-512.png`
- `elementera-mcp/deploy-pages/public/icons/icon-maskable-512.png`
- `elementera-mcp/deploy-pages/public/icons/apple-touch-icon.png`

`gptlike-icon.svg` exists but is not the Gate tangle and therefore is not substituted for the Gate identity.

## Three chat scopes, one body

Native v1 treats Main / Radio / Lighthouse as `ChatScope` values, not separate chat products.

All three routes render through the same:

- `ChatWindow`
- `CoastTimeline`
- `CoastComposer`
- `ConversationList`
- `ModelQuickPicker`
- Dogtalk row

Scope changes title/list identity only. It does not select a different message UI.

New window title contract:

- Main: `新聊天 N`
- Radio: `【电波】新聊天 N`
- Lighthouse: `【灯塔】新聊天 N`

Old Radio/Lighthouse API semantics are explicitly deferred rather than forcing three different UI bodies.

## Native v1 theme contract

Three modes only for this pass:

- Light / 浅色
- Dark / 深色
- Gold / 黑金

The mode feeds Gate, MainShell, Drawer, TopBar, ChatWindow, Composer, ModelQuickPicker, FeatureLanding and Snackbar through the same Material theme boundary.

## Current placeholder boundaries

This pass intentionally does **not** add network wiring. The repository remains without Android `INTERNET` permission.

Deferred:

- real `/login` session cookie flow
- real model/profile fetch and PUT
- conversation/history/SSE repositories
- old Radio/Lighthouse APIs
- Dogtalk persistence
- rename/delete
- feature editors/deep data
- image/mic/call

Unimplemented actions explain themselves via Snackbar or landing text instead of reporting fake success.

## Repository boundary

This pass changes only `coast-native-android`.

It does not modify:

- Elementera Coast PWA
- backend/API handlers
- PWA data files
- secrets
- signing configuration
- keystores
- APK/AAB artifacts

No GPL/AGPL implementation is introduced.
