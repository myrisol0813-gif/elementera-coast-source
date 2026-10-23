# Elementera Coast Native · Source Build

This directory contains the source-available Android client derived from the current Elementera Coast Native production tree, with private data and production delivery credentials removed.

## Source identity

- App: Elementera Coast Source
- `applicationId = com.elementeracoast.source`
- `versionCode = 8`
- `versionName = 0.2.6-source`
- Kotlin + Jetpack Compose
- JDK 17 / Android SDK 34 / Gradle 8.9

The Kotlin namespace remains the original internal namespace so the copied source tree does not need an unrelated package-layout rewrite. The installable application ID is the source-only ID above.

## Architecture

PWA and Native share the same canonical backend contracts. The source build keeps the real page structure, navigation, themes, repositories, HTTP/SSE transport, conversation flow, Daily surfaces, memory surfaces, visitor mailbox, model workspace, owner settings and diagnostic UI from the copied Native tree.

Source-local configuration uses `BuildConfig.COAST_API_BASE_URL`. The checked-in default is the non-routable placeholder `https://elementera-coast-source.invalid`; self-hosters should point their own build at their own backend.

## Native-only cloud paper

The source APK includes a fourth paper mode, **云朵浮雕边**, in Wolf Den > Appearance. Its Compose path adapts to bubble dimensions; it draws a theme-derived 0.75dp border at 70% of the selected message opacity plus a 2dp soft shadow. A default-on local switch can disable only the border. This implementation includes no private artwork, no proprietary fonts, and no changes to the source PWA.

## Optional Native-only visiting doorway

The unmodified Source Android pages are accessible for visual inspection with the public
**123456** visiting code at the existing Native entrance. This is an optional,
removable **entry adapter**, not a second app, a backend password, or real authentication.
The visit opens the **same** navigation/screens, locally, without creating an account
cookie. A small banner marks visiting mode. Browsing the existing rooms and changing
local appearance is allowed; server-dependent actions are visibly unavailable.
The shared Source HTTP client rejects requests **before network transmission** while
visiting. No private services, conversations, memory databases, or AI budgets are exposed.
The app does not promise functional cloud operations or keep a live shared server.

Builders can remove the visiting doorway without deleting source files:

```bash
gradle :app:assembleDebug -PSOURCE_TOUR_ENABLED=false
```

Rebuilding without this flag restores the original backend login only. A publicly
known visiting code is not suitable as authentication for a live backend.

## Source-build boundaries

The source build does not include private production credentials, production signing keys, production API origin, or private data. Its QA APK delivery is a separate, ephemeral-signed GitHub Release workflow, not the production APK updater. The existing “版本与更新” surface remains part of the copied UI, but does not download or install private production APKs.

No WebView, React Native, TypeScript, or embedded PWA source is used by the Native client.

## Public Native visitor QA prerelease

The public Android app has its own install ID, `com.elementeracoast.source`, and is
**not** the private production APK. When the main branch passes **Source check**,
`.github/workflows/source-native-prerelease.yml` automatically builds and publishes
a **0.2.6-source visitor QA APK** to GitHub Releases, with its SHA-256 file.

It uses the existing `scripts/sign-disposable-qa.sh` signer to generate a new,
temporary Source-only signing certificate in each CI runner, then deletes it.
**No signing Secrets, admin release switch, PWA deployment or Quick Tunnel are
needed.** The published APK uses the non-routable `.invalid` API placeholder.
Enter `123456` to tour the original Android UI and local appearance without
authenticating to or contacting a server.

Important: because every QA release uses a **different** certificate, APK updates
from older QA/debug Source builds normally **cannot install over** the older app.
Uninstall only `com.elementeracoast.source` before installing if Android reports a
signing conflict; deleting the Source app may erase its local settings/data.
The public visitor APK is a testing/inspection build, not stable application delivery.
Private production signing material must never be used here.

## Build

With Android SDK and Gradle 8.9 available:

```bash
gradle :app:testDebugUnitTest --no-daemon --stacktrace
gradle :app:assembleDebug --no-daemon --stacktrace
```

A local debug APK produced this way is a source inspection/test build, not an official production APK.

## Data and secret hygiene

Do not commit provider/API/session secrets, local databases, build outputs, APK/AAB artifacts, key material, production project identifiers, or private conversation/memory exports.

## License

Elementera Coast Source is distributed under the MIT License. See `LICENSE`. Third-party components retain their upstream licenses as documented in `THIRD_PARTY_NOTICES.md` and `third_party/`.
