# Source release history and feature scope

Only the tagged source revision and the matching Release assets describe what was shipped. Current README features are **not** retroactively part of the first tagged build.

## First public source release — v0.1-source (2026-09-21)

- MIT-licensed source reference, with PWA, backend/API, early native Android and experimental memory/context/MCP-related surfaces.
- Debug APK: `elementera-coast-source-v0.1-debug.apk`, package `com.elementeracoast.source`, `versionCode=1`, `versionName=0.1.0-source`.
- Verified Release asset SHA-256: `04c21d8f88f9786ef6caa7c5adaf1838f748f817389cea87337a34444eba7702`.
- Historical artifact only. The original APK did **not** include all of the later Native calendar, book reader and voice functionality.

## Temporary Native parity releases (2026-10-21)

- Source PWA + backend and native Android gained matching owner calendar, Tidal Library shelf/reader, TXT/EPUB import, reading annotations and voice-clip controls. Owner-only tool routes and source exports were synchronized.
- Early `0.2.0` / `0.2.1` testing releases used short-lived isolated Cloudflare Quick Tunnels. Their backend addresses expired with the GitHub runners.
- Some early release *titles* lagged behind their APK filenames; consult the actual asset and package metadata for historical build identity.

## Current source Native QA — 0.2.2-source (2026-10-21)

- GitHub Release tag: `source-v1v2-39625851494`; prerelease/test, **not** stable production.
- Native identity: `com.elementeracoast.source`, `versionCode=4`, `versionName=0.2.2-source`.
- Highlights: owner calendar, book import/shelf/reading/annotations, chat/appearance settings, voice clip UI. Speech generation is not functional unless the host configures its own provider.
- 0.2.2 changes: reading position retained across highlight/note refresh, distinct system-font substitutes for missing proprietary presets, and explicit local font import.
- Distributed as APK and ZIP-wrapped APK; the build checks V1/V2 signatures, ZIP CRC, SHA-256 equality of wrapped content and package identity.
- APK SHA-256: `4319dcca4bfe7424e5e27ff9181c0b87d8508795ba227ecab4cf58b7ab763abf`.
- Live login depends on the original temporary test backend, which has expired. For self-hosting, supply an independent server and rebuild; for short phone QA, run the dedicated isolated test workflow.

## Current source Native QA — 0.2.13-source (2026-11-13)

- Restores the previously unmerged public Native **奶油纸牌 / Cream Paper** theme on top of the current 0.2.12 source tree.
- Adds the theme back to the Native wardrobe and appearance screen, with cream/blush surfaces, cocoa outlines and hard offset shadows across chat chrome, drawer/navigation, feature headers, common settings controls and Snow Letter surfaces.
- Restores the reusable `CreamPaperStyle` visual primitives plus regression tests and theme contract coverage.
- Does not revert or replace 0.2.12 Reality Context, independent short reply mode, thought-soil behavior, current-turn receipts, timestamps, visitor/offline boundaries or any PWA behavior.
- Source PWA remains `coast-source-app-10`; this revision is Native-only.
- Public Native identity remains `com.elementeracoast.source`; versionCode 14 → 15 and versionName 0.2.12-source → 0.2.13-source.

## Current source Native QA — 0.2.12-source (2026-11-13)

- Adds generalized per-conversation Reality Context parity across the source backend/PWA and Native Android app.
- Supported opt-in fields: date, time, battery, manually configured weather city, optional coarse location, most-recent non-app foreground app, today's Top 5 app-usage durations, next-seven-days calendar events, and lightweight step-counter data.
- Short reply mode is stored independently from the Reality master switch; turning Reality off does not disable short reply mode.
- Android device data is collected locally at send time and only for selected fields. The backend rereads canonical conversation settings before assembling context, so unselected client fields are not injected.
- Current-turn receipts show delivered and selected-but-unavailable Reality fields plus the response mode. PWA and Native add message HH:mm/cross-day markers; diaries expose creation time.
- Thought-soil organization reduces mechanical copying of the just-delivered turn while preserving missed-turn cursor recovery. The existing do-not-repeat/avoid fields remain in this source revision; schema simplification is not part of 0.2.12.
- Source PWA cache advances `coast-source-app-09 → coast-source-app-10`.
- Public Native identity remains `com.elementeracoast.source`; versionCode 13 → 14 and versionName 0.2.11-source → 0.2.12-source. Visitor QA remains disposable-signed and separate from the private production updater/signing chain.

## Current source Native QA — 0.2.11-source (2026-10-24)

- Copy-only Native QA refresh: the empty-chat placeholder changes from “潮水退到纸页外。” to “文字退到页边外。”; the second line remains unchanged.
- Public application ID stays `com.elementeracoast.source`; versionCode 12 → 13 and versionName 0.2.10-source → 0.2.11-source so GitHub publishes a distinct test APK.
- No chat behavior, backend contract, PWA code/cache, account flow, memory/tool logic or appearance behavior changes. Source PWA remains `coast-source-app-09`.

## Current source Native QA — 0.2.10-source (2026-10-24)

- The prior 0.2.9 published QA APK was rejected by a phone installer as missing a signature file, despite v1/v2 signatures verified on the build runner; its published Release was subsequently deleted. The definitive device-specific cause is not established.
- This revision produces an **unsigned Release APK** before ZIP alignment and a **single** v1/v2/v3 signing pass with conventional CERT names. It checks the final package and downloads the GitHub Release APK back for a SHA-256 and signature recheck, failing publication checks on a mismatch.
- Public application ID stays `com.elementeracoast.source`; versionCode 11 → 12 and versionName 0.2.9-source → 0.2.10-source. PWA code/cache remains unchanged (`coast-source-app-09`).
- Installation on the affected handset is still a required acceptance check; CI cannot confirm success for that OEM package installer.

## Current source Native QA — 0.2.9-source (2026-10-24)

- Moved the Native model metadata trace button into each assistant message action row, with an abbreviated label on narrower phones. Full reasoning, provider, request, cache, and tool trace details remain available directly beneath the relevant reply.
- Generalized remaining public-visible “潮中书房” labels to “书房” and updated the related book tool names/descriptions. Renamed Native cross-window tabs to “跨窗口选取” and “历史消息搜索”; internal model tool IDs, database keys, and archived data remain stable.
- Source PWA cache: `coast-source-app-08` → `coast-source-app-09`. Public Native: versionCode 10 → 11, versionName 0.2.8-source → 0.2.9-source.
- Does not include Starry Coast private artwork, personal prompts, or stable private production signing. Device-specific layout verification remains required.

## Current source Native QA — 0.2.8-source (2026-10-24)

- Public Native conversation geometry now matches the private version's general layout: assistant avatar in its own header row above the reply paper, full-width reply cards, closer message spacing, body line-height and horizontal padding.
- Public Native also unifies the private-draft / cross-window panel and current-turn desk in one collapsible composer-adjacent drawer, replacing the nonfunctional microphone placeholder and standalone turn desk strip. The full desk bottom sheet remains available within the drawer.
- The private Starry Coast bundled artwork, overlay frames, and frame-specific scroll clearance remain intentionally excluded; custom public backgrounds continue to work independently.
- Preserves public-only UI semantics such as the generalized model identity, like button, neutral voice caption, visitor doorway and public background/skin assets; no private imagery, identity or secrets are imported.
- The Source backend ChatGPT image-delivery fix was merged separately in PR #30. Source Native builds from main include it only when paired with that updated backend.
- No private updater/signing chain changes; visitor QA continues to be disposable-signed. Confirm the visual result on a real device.

## Current source Native QA — 0.2.7-source (2026-10-23)

- Native identity: `com.elementeracoast.source`, `versionCode=9`, `versionName=0.2.7-source`.
- Adds optional device-local ChatGPT account authorization, account model discovery and direct Responses inference while keeping tokens in Android Keystore.
- Reuses the existing source backend for context assembly, owner-authorized tools, attachments and sanitized model receipts; no second conversation store is introduced.
- Adds same-provider thought-soil prepare/commit after ChatGPT-plan turns, provider-advertised reasoning effort controls, prompt-cache read/write receipts, inline sent-image rendering, output/finalization locking and revision-safe global excerpt clearing.
- Source visitor mode remains offline-only and blocks cloud/account actions before network transmission.
- PWA cache advances to `coast-source-app-08`; backend model/cache contracts are synchronized with Native.
- Public QA APKs are still disposable-signed inspection builds, not the private production updater/signing chain.

## Scope and limitations

- These releases are inspectable open-source evidence, not promises of an enduring hosted service.
- Public source excludes private conversations, production credentials, signing keys, proprietary fonts and production backend details.
- Historical feature scope and commit records are retained for reproducibility; older QA Release binaries may be deleted after they are superseded or proven unusable.
- Future updates should revise the current README feature matrix and current release description, without overwriting historical release capabilities.
