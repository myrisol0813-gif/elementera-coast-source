# Elementera Coast Source

Elementera Coast Source is the source-available, non-commercial edition of Elementera Coast, derived from the current PWA and Native application trees and sanitized for public distribution.

The goal of this repository is to preserve the real application structure and user-facing interface while removing private data and production-only credentials or distribution machinery. It is not a generic reimplementation.

## Repository layout

- `apps/web` — the copied PWA/Cloudflare Pages application and backend functions.
- `apps/android` — the copied Native Android/Jetpack Compose application.
- `docs` — source-build environment, sanitization and verification notes.

## What is preserved

The source edition keeps the original PWA and Native page structure, navigation, theme system, CSS, ordinary icons, component hierarchy, storage/schema logic, API routes, conversation flow, memory/context surfaces, visitor mailbox, owner settings, model workspace and tool surfaces, except where a production-only updater/release path had to be removed.

Fixed UI copy is neutralized for public distribution. Real conversations, visitor letters, memory bodies, private onboarding prose and private seed data are not rewritten; they are absent from the source edition.

## Approved visual substitutions

Only the explicitly approved private visual identity was changed:

- private home/app logo family → neutral sage placeholder assets;
- home opening mark → a hand-written vector house-and-sea mark;
- former wolf/serpent utility marks → the same neutral three-slider settings glyph;
- mailbox private snake illustration → removed while preserving its surrounding UI structure.

Ordinary icons, CSS, theme colors and unrelated SVG/drawable assets are not redesigned.

## Android source identity

- `applicationId = com.elementeracoast.source`
- `versionCode = 1`
- `versionName = 0.1.0-source`

The production signing chain, APK updater, production release publishing and production API origin are not included. A CI-built debug artifact is for source inspection and device testing only; it is not an official production APK.

## Configuration

See `docs/ENVIRONMENT.md`. No credentials, tokens, production database IDs, production project IDs or private data are included.

## Verification status

See `docs/SANITIZATION_REPORT.md` and `docs/KNOWN_LIMITATIONS.md`. Tagging or release publication must wait until PWA and Android real-device acceptance are complete.

## License

PolyForm Noncommercial License 1.0.0. See `LICENSE`.
