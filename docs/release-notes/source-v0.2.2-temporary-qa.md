# Elementera Coast Source · Android 0.2.2-source (temporary QA)

**Status:** public source prerelease / disposable phone-testing build. This is not a stable, continuously hosted release and is not the private production application.

## Features in this source build

- Native Jetpack Compose chat and owner workspace with themes, message styles, adjustable reading weight and local chat background.
- Owner calendar with authenticated create/edit/delete, entries and recurring dates.
- Tidal Library with TXT/EPUB import, shelves, cover selection, chapters, page navigation, reading progress, highlights and annotations.
- PWA and Native clients share the same self-hosted owner calendar and book API contracts.
- Message-anchored voice clip playback and speech generation controls. Generating speech requires the self-hoster to configure ElevenLabs credentials and voice ID on the server; none are included.
- Memory, world-book, context-inspection, visitor and tool surfaces from the sanitized source project.

## Native 0.2.2 changes

- Fixes reading-position resets after marking passages or editing annotations by retaining the active paragraph and intra-paragraph offset.
- Makes font-mode switching visible without bundling unlicensed proprietary fonts: system serif / sans-serif / monospace fallbacks, plus optional locally imported TTF/OTF.
- Continues the source-only package identity `com.elementeracoast.source` (`versionCode=4`, `versionName=0.2.2-source`).

## Test artifacts and verification

- `elementera-coast-source-v0.2.2-signed-qa.apk` — SHA-256 `4319dcca4bfe7424e5e27ff9181c0b87d8508795ba227ecab4cf58b7ab763abf`.
- `elementera-coast-source-v0.2.2-signed-qa.zip` — includes the same APK bytes; ZIP envelope recommended for phones whose direct `.apk` downloads are modified.
- `SHA256SUMS.txt` — matching checksum record.
- CI checked Android tests and APK identity, V1/V2 signatures, embedded JAR signature files, archive CRC and extracted ZIP-to-APK checksum parity. Real phone installation and basic navigation were separately checked by the project maintainer.

## Important: the backend is temporary

This package was built against a **short-lived Cloudflare Quick Tunnel** with a fresh isolated sample-only database and a demonstration login password. The tunnel is shut down when the GitHub Actions test completes, so **the saved APK can still be inspected or installed, but it cannot log in through that expired backend**. No private production backend, data or credentials are included. Run the separate 30-minute QA workflow again for a fresh matched PWA and APK, or rebuild against your own backend for lasting use.

Because each temporary test run creates a new independent signing certificate, Android may refuse in-place updates over a previous source QA installation. Never uninstall or replace the private production application.

For current setup instructions and later builds, consult this repository's README and Releases list.
