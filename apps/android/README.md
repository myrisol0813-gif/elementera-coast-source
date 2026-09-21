# Elementera Coast Native · Source Build

This directory contains the source-available Android client derived from the current Elementera Coast Native production tree, with private data and production delivery credentials removed.

## Source identity

- App: Elementera Coast Source
- `applicationId = com.elementeracoast.source`
- `versionCode = 1`
- `versionName = 0.1.0-source`
- Kotlin + Jetpack Compose
- JDK 17 / Android SDK 34 / Gradle 8.9

The Kotlin namespace remains the original internal namespace so the copied source tree does not need an unrelated package-layout rewrite. The installable application ID is the source-only ID above.

## Architecture

PWA and Native share the same canonical backend contracts. The source build keeps the real page structure, navigation, themes, repositories, HTTP/SSE transport, conversation flow, Daily surfaces, memory surfaces, visitor mailbox, model workspace, owner settings and diagnostic UI from the copied Native tree.

Source-local configuration uses `BuildConfig.COAST_API_BASE_URL`. The checked-in default is the non-routable placeholder `https://elementera-coast-source.invalid`; self-hosters should point their own build at their own backend.

### Local source demo

While the build still uses the checked-in `.invalid` backend, the public preview password `123456` opens one deterministic local sample turn. It is only a UI fixture; it does not send messages, upload attachments, call tools, invoke a model, or write remote data.

Connecting a real backend is enough to disable this demo. You do not need to delete the fixture before using real data.

The sample content is isolated from normal backend behavior. Connecting a real backend is the recommended way to disable it.

If a fork wants to remove the preview fixture from source entirely, remove these pieces together:

- `app/src/main/kotlin/com/elementeracoast/app/feature/shell/SourcePreviewDemo.kt`
- the `sourcePreviewMode` / `loadSourcePreviewDemo` branches in `CoastShellViewModel.kt`
- the `source-preview-demo` local metadata branch in `ModelMetadataRemoteDataSource.kt`

Once `COAST_API_BASE_URL` points away from the default `.invalid` placeholder, normal backend authentication and data loading take over automatically.

## Source-build boundaries

The source build does not include production credentials or distribution machinery. In particular, it ships without production signing configuration, the production APK updater, release publishing, production API origin, or private data. The existing “版本与更新” surface remains part of the copied UI, but only reports source-build metadata and does not download or install production APKs.

No WebView, React Native, TypeScript, or embedded PWA source is used by the Native client.

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
