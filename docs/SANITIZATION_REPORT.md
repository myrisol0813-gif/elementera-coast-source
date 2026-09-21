# Sanitization report

This report compares the source candidate against the two ZIP snapshots supplied as the rebuild baseline.

## PWA

- Original files: 295
- Candidate files: 291
- Changed in place: 150
- Removed: 6
- Added: 2

- CSS byte changes: **0**

### File-level changes

| Path | Change | Category |
|---|---|---|
| `.github/workflows/coast-ci.yml` | modified | production URL / identity / signing / updater / release-chain removal |
| `ARCHITECTURE.md` | modified | public documentation sanitization / obsolete private-history removal |
| `LICENSE` | modified | public documentation sanitization / obsolete private-history removal |
| `docs/COAST-DEV-HANDS-OWNER-INTENT-CLARIFICATION.md` | modified | public documentation sanitization / obsolete private-history removal |
| `docs/direct-dev-hands-refactor.md` | modified | public documentation sanitization / obsolete private-history removal |
| `docs/future-vision-images.md` | modified | public documentation sanitization / obsolete private-history removal |
| `docs/module-map.md` | modified | public documentation sanitization / obsolete private-history removal |
| `docs/p5-mcp-porch-auth0.md` | modified | public documentation sanitization / obsolete private-history removal |
| `elementera-mcp/CHANGELOG.md` | modified | public documentation sanitization / obsolete private-history removal |
| `elementera-mcp/data/memories.json` | modified | private data / private seed removal (schema/store retained) |
| `elementera-mcp/data/memory-drafts.json` | modified | private data / private seed removal (schema/store retained) |
| `elementera-mcp/data/releases.json` | modified | private data / private seed removal (schema/store retained) |
| `elementera-mcp/deploy-pages/index.html` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/content/island-letter.js` | modified | private data / private seed removal (schema/store retained) |
| `elementera-mcp/deploy-pages/public/core/api.js` | modified | production URL / identity / signing / updater / release-chain removal |
| `elementera-mcp/deploy-pages/public/core/danger.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/core/icons.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/core/storage.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/chat.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/chat/chat-actions.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/chat/chat-furniture.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/chat/chat-generation.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/chat/chat-model-metadata.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/chat/chat-render.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/chat/chat-tool-status.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/daily-client.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/daily.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/daily/daily-actions.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/daily/daily-format.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/daily/daily-moments-view.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/daily/daily-profile.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/desk.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/dev-hands.js` | modified | production URL / identity / signing / updater / release-chain removal |
| `elementera-mcp/deploy-pages/public/features/dogtalk.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/letters.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/memory/memory-actions.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/memory/memory-custom-view.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/memory/memory-global-excerpt-view.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/memory/memory-library-view.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/memory/memory-pocket-view.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/memory/memory-soil-view.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/settings.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/toolroom.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/features/tools.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/icons/apple-touch-icon.png` | modified | approved visual substitution/removal |
| `elementera-mcp/deploy-pages/public/icons/icon-16.png` | modified | approved visual substitution/removal |
| `elementera-mcp/deploy-pages/public/icons/icon-192.png` | modified | approved visual substitution/removal |
| `elementera-mcp/deploy-pages/public/icons/icon-32.png` | modified | approved visual substitution/removal |
| `elementera-mcp/deploy-pages/public/icons/icon-512.png` | modified | approved visual substitution/removal |
| `elementera-mcp/deploy-pages/public/icons/icon-maskable-512.png` | modified | approved visual substitution/removal |
| `elementera-mcp/deploy-pages/public/mailbox-entry.js` | modified | fixed UI copy / private identifier/default sanitization |
| `elementera-mcp/deploy-pages/public/mailbox.js` | modified | approved visual substitution/removal |
| `elementera-mcp/deploy-pages/public/media/model-partner-default-avatar.jpg` | modified | approved visual substitution/removal |
| `elementera-mcp/deploy-pages/service-worker.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/_middleware.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/api-router.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/auth.js` | modified | approved visual substitution/removal |
| `functions/authorized-memory.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/chat-router.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/coast-identity.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/context-assemble-clean.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/context-comfort-range.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/cross-window-model-tool.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/cross-window-service.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/daily-api.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/daily-model-tools.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/daily-moment-comment.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/daily-profile-store.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/daily-schema.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/daily-store.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/desk-slip.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/dev-hand-model-tools.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/dev-hands-update.js` | modified | production URL / identity / signing / updater / release-chain removal |
| `functions/dev-hands-version.js` | modified | production URL / identity / signing / updater / release-chain removal |
| `functions/dogtalk-api.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/dogtalk-model-tool.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/dogtalk-store.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/mailbox-api.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/mailbox-page.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/mailbox-repository/mailbox-pocket-store.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/mailbox-service.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/mcp-auth.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/mcp-tools.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/memory-store/global-excerpt-store.js` | modified | private data / private seed removal (schema/store retained) |
| `functions/memory-store/memory-custom-store.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/memory-store/memory-pocket-store.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/memory-store/memory-schema.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/memory-store/memory-soil-store.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/memory/memory-soil-organizer.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/model-metadata-api.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/model-metadata-store.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/models/model-constants.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/rikkahub-import-store.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/room-conversation-migration.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/room-conversation-service.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/thinking-soil.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/tool-furniture-summary.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/tool-registry-core.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/tool-registry.js` | modified | fixed UI copy / private identifier/default sanitization |
| `functions/workbench-api.js` | modified | production URL / identity / signing / updater / release-chain removal |
| `functions/worldbook.js` | modified | fixed UI copy / private identifier/default sanitization |
| `tests/architecture.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/avatar-owner.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/backend.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/bugfix-polish.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/chat-furniture-ui.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/chat-state.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/clean-context.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/construction-agent-contract.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/context-contract.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/daily-comment-stream.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/daily-owner.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/daily-tools.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/daily.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/danger.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/desk-dom.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/dev-hands-log-redaction.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/dev-hands.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/dogtalk-dom.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/dogtalk.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/dom-split.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/dom/dom-chat-flow.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/dom/dom-daily-flow.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/dom/dom-desk-flow.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/dom/dom-harness.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/dom/dom-memory-flow.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/global-excerpt.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/letters-retirement.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/mailbox-dom.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/mailbox.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/mcp-porch.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/mcp-room-turn-receipt.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/memory-revision.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/memory-router-split.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/memory-ui-split.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/memory-v2.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/memory.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/o3-reply-card-route.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/pre-apk-hard-cleanup.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/pwa-profile-furniture-clean.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/rikkahub-import.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/room-access.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/room-migration.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/shared-state-fixes.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/soil-incremental.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/storage.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/tool-furniture-summary.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/tool-registry.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/turn-desk-details.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `tests/worldbook.test.mjs` | modified | test contract / synthetic fixture sanitization |
| `docs/archive/2026-07-08-p3-struct-01-v106-daily-module-plan.md` | removed | public documentation sanitization / obsolete private-history removal |
| `docs/archive/2026-07-08-p3-struct-map.md` | removed | public documentation sanitization / obsolete private-history removal |
| `docs/native/UI_ACTION_TREE.md` | removed | public documentation sanitization / obsolete private-history removal |
| `elementera-mcp/deploy-pages/public/icons/gptlike-icon.svg` | removed | approved visual substitution/removal |
| `elementera-mcp/deploy-pages/public/media/mailbox-snake.png` | removed | approved visual substitution/removal |
| `functions/friend-elementera-model-prompt.js` | removed | fixed UI copy / private identifier/default sanitization |
| `.env.example` | added | empty self-host configuration template |
| `functions/visitor-model-partner-prompt.js` | added | fixed UI copy / private identifier/default sanitization |

## Native

- Original files: 195
- Candidate files: 191
- Changed in place: 87
- Removed: 4
- Added: 0

- CSS byte changes: **0**
- Theme palette color literals: **unchanged** (verified against baseline).

### File-level changes

| Path | Change | Category |
|---|---|---|
| `.github/workflows/android-debug.yml` | modified | production URL / identity / signing / updater / release-chain removal |
| `LICENSE` | modified | public documentation sanitization / obsolete private-history removal |
| `README.md` | modified | public documentation sanitization / obsolete private-history removal |
| `app/build.gradle.kts` | modified | production URL / identity / signing / updater / release-chain removal |
| `app/src/main/AndroidManifest.xml` | modified | production URL / identity / signing / updater / release-chain removal |
| `app/src/main/kotlin/com/elementeracoast/app/MainActivity.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/core/auth/AuthRepository.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/core/model/FeatureDestination.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/core/model/RoomType.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/core/network/CoastApiClient.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/core/remote/RemoteDaily.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/core/remote/RemoteDevHands.kt` | modified | production URL / identity / signing / updater / release-chain removal |
| `app/src/main/kotlin/com/elementeracoast/app/core/remote/RemoteMemory.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/core/remote/RemoteModels.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/core/remote/RemoteTurnContext.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/actionlog/ActionLogScreen.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/AvatarPickerDialog.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/ChatHistoryMutations.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/ChatScreen.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/ChatSyncMapper.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/FurnitureBubble.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/ModelMetadataRemoteDataSource.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/ModelMetadataTraceCard.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/SoilSheet.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/ThoughtSoilEntry.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/ToolActivityNotice.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/TurnDeskMapper.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/chat/TurnDeskSheet.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/daily/DailyCanonicalModels.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/daily/DailyLanding.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/daily/DailyRepository.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/daily/DailySurface.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/daily/DiaryScreen.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/daily/MomentActions.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/daily/MomentScreen.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/dogtalk/CrossWindowRepository.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/dogtalk/DogtalkCard.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/dogtalk/DogtalkReadMode.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/dogtalk/DogtalkRepository.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/gate/GatePasswordField.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/gate/GateScreen.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/gate/MailboxNativeSurface.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/gate/MailboxRepository.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/letters/IslandLetterContent.kt` | modified | private data / private seed removal (schema/store retained) |
| `app/src/main/kotlin/com/elementeracoast/app/feature/letters/IslandLetterScreen.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/memory/MemoryCanonicalModels.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/memory/MemoryLanding.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/memory/MemorySurface.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/memory/PendingPocketsScreen.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/serpentdesk/DevHandsRepository.kt` | modified | production URL / identity / signing / updater / release-chain removal |
| `app/src/main/kotlin/com/elementeracoast/app/feature/serpentdesk/DevHandsScreen.kt` | modified | production URL / identity / signing / updater / release-chain removal |
| `app/src/main/kotlin/com/elementeracoast/app/feature/serpentdesk/SerpentDeskScreen.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/shell/CoastDrawer.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/shell/CoastShellViewModel.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/shell/FeatureLandingScreen.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/shell/MainShell.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/wolf/ChatArchive.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/wolf/GlobalArchiveRepository.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/wolf/WolfModels.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/wolf/WolfProfileAppearance.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/wolf/WolfRecordsSettings.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/feature/wolf/WolfScreen.kt` | modified | production URL / identity / signing / updater / release-chain removal |
| `app/src/main/kotlin/com/elementeracoast/app/feature/wolf/WolfStore.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/kotlin/com/elementeracoast/app/ui/brand/CoastBrandMark.kt` | modified | approved visual substitution/removal |
| `app/src/main/kotlin/com/elementeracoast/app/ui/theme/CoastThemePresets.kt` | modified | fixed UI copy / private identifier/default sanitization |
| `app/src/main/res/drawable/ic_coast_serpent.xml` | modified | approved visual substitution/removal |
| `app/src/main/res/drawable/ic_coast_wolf.xml` | modified | approved visual substitution/removal |
| `app/src/main/res/mipmap-nodpi/ic_launcher_coast.png` | modified | approved visual substitution/removal |
| `app/src/test/kotlin/com/elementeracoast/app/core/auth/AuthRepositoryTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/core/network/CoastApiClientTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/FeatureParityTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/chat/TurnDeskMapperTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/dogtalk/CrossWindowContractTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/dogtalk/CrossWindowRepositoryTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/dogtalk/DogtalkContractTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/dogtalk/DogtalkRepositoryTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/memory/MemoryRemoteDataSourceTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/serpentdesk/DevHandsRepositoryTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/serpentdesk/SerpentDeskSurfaceTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/shell/CoastShellViewModelTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/shell/ConversationTitleRemoteDataSourceTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/wolf/ChatArchiveTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/wolf/GlobalArchiveTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/feature/wolf/WolfLocalParityTest.kt` | modified | test contract / synthetic fixture sanitization |
| `app/src/test/kotlin/com/elementeracoast/app/ui/theme/CoastThemePresetTest.kt` | modified | test contract / synthetic fixture sanitization |
| `docs/NATIVE_APP60_SURFACE_PARITY_MAP.md` | modified | public documentation sanitization / obsolete private-history removal |
| `docs/SNOW_LETTER_THEME_V01.md` | modified | public documentation sanitization / obsolete private-history removal |
| `.github/workflows/pr-apk-acceptance.yml` | removed | production URL / identity / signing / updater / release-chain removal |
| `app/src/main/kotlin/com/elementeracoast/app/feature/serpentdesk/NativeApkInstaller.kt` | removed | production URL / identity / signing / updater / release-chain removal |
| `app/src/main/res/xml/coast_file_paths.xml` | removed | fixed UI copy / private identifier/default sanitization |
| `docs/NATIVE_V1_BUILD_PLAN.md` | removed | public documentation sanitization / obsolete private-history removal |

## Verification

- All PWA CSS files are byte-identical to the supplied baseline.
- Ordinary icon paths in `public/core/icons.js` are unchanged; only a private attribution comment changed.
- Native theme palette colors are unchanged; only a private preset identifier/display label was neutralized.
- Approved visual changes are limited to the home mark, private logo/avatar family, mailbox private illustration removal, and the former wolf/serpent utility marks.
- Public documentation has no remaining private proper-name/relationship-name matches from the agreed scan list.
- PWA JavaScript syntax check: 248 files, 0 failures.
- PWA executable tests in the current container: 54 passed, 0 failed; 19 DOM tests are blocked because `happy-dom` cannot be installed in this network-restricted environment.
- Native XML parse: 6 files, 0 failures.
- Native APK build is not claimed in this container because Gradle/Android SDK are unavailable.
- Production signing, production APK updater and release-publishing workflows are absent from the source candidate.

## Compatibility note

Private actor/profile identifiers and private repository examples are rewritten to neutral public-source names across runtime code, schemas, fixtures, tests, and documentation. The source edition is intended to initialize its own public-demo data rather than preserve private-instance naming.
