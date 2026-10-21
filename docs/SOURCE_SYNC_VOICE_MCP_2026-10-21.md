# Voice & owner tools source sync · 2026-10-21

## Scope
- Original message-level voice dialogue, playback UI, CSS and voice persistence; no substitute redesign.
- Voice provider identity moved from personal hardcoded ID to self-hosted `ELEVENLABS_VOICE_ID`, alongside required `ELEVENLABS_API_KEY` secret.
- Original unified registry descriptors for calendar, voice, library reads and assistant-authored notes, under owner permission and MCP scopes.
- Source PWA cache: `coast-source-app-03` → `coast-source-app-04`.
- JSON snapshot and global HTML include voice clip metadata; authenticated full JSON archive includes audio bytes as base64.
- The source Native APK and production app remain unchanged.

## Privacy boundary
No personal voice ID, actual audio, chat, keys, provider account identifiers, private OAuth tenant or production endpoint is included. No mock success, no alternate API bridge. The same owner-only API and original tool registry handle all operations.

## Verify
1. Run `npm test` in `apps/web`, including voice and authorized registry tests.
2. In a self-hosted PWA without voice env vars, press the voice button on a message; it must explain what is missing, and must not contact the paid provider.
3. In a private test environment configured with your own provider account and voice ID, select paragraphs, generate a short clip, play it back, reopen the conversation, and verify persistence.
4. Export full JSON and V1 JSON/HTML. Only full JSON should include audio binary payloads. Keep personal exports private.
5. Verify owner-enabled model/MCP tools appear under the correct permissions and guest mailbox sessions cannot list or call them.
6. Mobile visual check: original rounded voice dialogue and inline player, usable keyboard/scrolling.

## Excluded
No publishing private voice assets, no production secret or token values, no Native changes, no public deployment of owner's personal data.
