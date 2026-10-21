# Source Native parity & release acceptance · 2026-10-21

## Scope

This selective public-source update carries the original Native Compose calendar, Tidal Library shelf, pagination, text-only EPUB/TXT import, notes, cover rendering and voice selection/playback. Native shares the owner-authenticated API with the PWA; no standalone demo database or fake source API has been introduced.

The original Compose page implementations are retained, with only public identity labels changed. **Do not** merge the original private Android repository history or assets into the public repository.

## Version

- PWA: unchanged at `coast-source-app-04`. No PWA UI changes.
- Public Native: `versionCode 1` → `2`; `versionName 0.1.0-source` → `0.2.0-source`.
- `applicationId=com.elementeracoast.source` preserved. Private Android production app remains unchanged.
- Distribution: a separate opt-in workflow publishes **stable source-signed** APK and SHA-256 as GitHub Releases prerelease assets, only when source-specific signing and endpoint configuration are available.
- The old seven-day Actions APK artifact upload has been retired from normal CI to conserve Actions storage.
- Without independent source signing secrets and public source backend URL, the workflow deliberately does not publish an APK; it must not fall back to ephemeral debug signing or private credentials.

## Privacy and data

- Source Android uses its existing placeholder `https://elementera-coast-source.invalid` until a self-hoster provides the source backend.
- Private ChatGPT OAuth sessions, production API origin, keystore, updater endpoints, personal names and images are **not** copied.
- The newly copied Native UI uses source instances' owner-only calendar, library and audio records; no personal data is seeded.
- A source-wide text guard runs in CI and reports only file names and categories, without outputting suspect secret values. The original historical sanitization report is retained separately as an audited baseline, not rewritten.

## Manual Android acceptance

1. Install a **source-only**, independently signed prerelease APK if publishing is enabled. Confirm it is a separate app, not the private production app.
2. Connect your own HTTPS source API and log in as the owner.
3. Open 小组件 → 日历, create an event, edit and delete it; verify the same event appears in source PWA.
4. Open 小组件 → 潮中书房; import a synthetic TXT/EPUB; page, bookmark, highlight, annotate, cover, reopen and check persistence from the PWA.
5. Open chat, choose a stored assistant reply → 生成语音; select paragraphs, generate, then play the attached clip. With no ElevenLabs configuration, verify a real error is shown and no fake audio appears.
6. Export the source web full JSON/HTML archive and confirm calendar, book and recorded audio records are included.
7. Verify all existing chat, memory, mailbox, owner options and Native navigation still open; verify no production credentials or personal names are present.

## Final publication gating

The GitHub source-check CI must pass web tests, source safety guard, Native unit tests, and Native debug build. An actual Release asset and SHA-256 must be verified separately. Do not claim a phone visual pass before it happens.

## Deliberately not synchronized

Private ChatGPT account linking, private signing/update machinery, personal artwork/audio data, private settings, and protected account configuration. They are **private functionality**, not required for a useful public source edition.
