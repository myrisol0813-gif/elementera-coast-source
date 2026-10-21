# Source-only temporary PWA and Android APK

This guide prepares an independent, disposable test deployment of **Elementera Coast Source**, not a private production service. The temporary login password requested for validation is `123456`.

**Security warning:** This is a publicly known weak password. Anyone who discovers the demo URL can log in as its owner. The demo **must use its own empty database**, no private information, and no model-provider keys/paid API quotas. Shut it down after testing.

## 1. Empty Cloudflare Pages demo

In your own Cloudflare account:

1. Create a **separate Direct Upload Pages project**, with a name ending in `-demo`. It must not be the private Coast project.
2. Create a **new empty D1 database**. On the demo Pages project, open Settings → Bindings, add a D1 binding named exactly `COAST_CHAT_DB`, and select the new database. Never attach any existing private database.
3. On the demo Pages project's Settings → Variables and Secrets, configure:

| Name | Test value |
| --- | --- |
| `COAST_PASSWORD_HASH` | `8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92` |
| `COAST_SESSION_SECRET` | A newly generated random secret of at least 32 characters, saved privately. Example command: `openssl rand -hex 32`. Do **not** reuse your private Coast secret. |
| `COAST_PREVIEW_PASSWORD_HINT` | `123456` |

The hash above is the SHA-256 of the test password, not a production secret. Do not add these values to the private production project.

In the public source GitHub repository's **Settings → Secrets and variables → Actions**, configure:

| Kind | Key | Value |
| --- | --- | --- |
| Variable | `COAST_SOURCE_DEMO_ENABLED` | `true` |
| Variable | `COAST_SOURCE_DEMO_PROJECT` | The independent Pages project name ending in `-demo` |
| Variable | `COAST_SOURCE_PREVIEW_PASSWORD_HINT` | `123456` |
| Secret | `COAST_SOURCE_DEMO_CF_ACCOUNT_ID` | Cloudflare account ID of the test project |
| Secret | `COAST_SOURCE_DEMO_CF_API_TOKEN` | A narrowly scoped Cloudflare Pages deployment token for this independent setup |

Never paste any API token or session secret into the repository or a chat.

Open **Actions → Deploy isolated source preview PWA → Run workflow**. The workflow deploys the existing original UI and Functions, then tests **real login** and authenticated calendar/book APIs. Read the resulting `https://…pages.dev` URL from its job summary. No green result means no confirmed usable preview.

A demo without `OPENROUTER_API_KEY` or `ELEVENLABS_API_KEY` can be used for UI/calendar/library checks, but model calls and generated voice will correctly report that providers are not configured.

## 2. Source APK pointing to the same test URL

Only after the demo workflow has succeeded, configure in the **public source GitHub repository**:

| Kind | Key | Value |
| --- | --- | --- |
| Variable | `COAST_SOURCE_RELEASE_ENABLED` | `true` |
| Variable | `COAST_SOURCE_API_BASE_URL` | The exact verified HTTPS Pages URL, without a trailing slash |
| Secret | `COAST_SOURCE_KEYSTORE_BASE64` | Your independently generated *source-only* Android signing keystore, base64-encoded |
| Secret | `COAST_SOURCE_STORE_PASSWORD` | Keystore password |
| Secret | `COAST_SOURCE_KEY_ALIAS` | Source key alias |
| Secret | `COAST_SOURCE_KEY_PASSWORD` | Alias password |

The signing key belongs to the public **source** app only. Do not reuse production Android signing keys or upload signing files to GitHub source.

Open **Actions → Publish source Native prerelease → Run workflow**. The release workflow:

- Verifies that the demo server actually accepts the configured password and that authenticated calendar and book APIs respond successfully.
- Builds `applicationId=com.elementeracoast.source`, `versionCode=4`, `versionName=0.2.2-source`, using the verified independent `-demo.pages.dev` origin, not the private endpoint or an expiring Quick Tunnel.
- Displays the configured demo password as a *hint* on the source login screen. The APK does not implement an offline password: authentication always happens at the PWA's server.
- Checks the compiled APK package/version and signature with Android SDK tools, then publishes the stable-signed APK **and its SHA-256** as GitHub **Releases prerelease assets**, never as an Actions artifact. The run summary exposes a direct Android download URL, artifact SHA-256 and certificate fingerprint.
- Refuses to publish without stable source signing and a real HTTPS Pages test backend.

The old `v0.1-source` APK was a debug preview; its temporary signing certificate may differ from the stable source key. In that case, uninstall only the **old source preview** before installing `0.2.2-source`; do **not** remove the private production app.

## 3. Device acceptance and teardown

After a new source prerelease exists, install it and enter `123456`; sign into the same source PWA in a browser. Create a **fake** calendar entry and fake TXT/EPUB book, add a note and a cover, then confirm they are shared between source APK and source PWA. Check the original layout and paging on the phone. Export the sample data in JSON/HTML and confirm it contains the expected test content. Test voice only after configuring your own voice provider; otherwise the honest provider-not-configured error is expected.

Keep the PWA up only while testing. When done, switch off GitHub demo/release variables, delete the **demo-only** Pages project and D1 database, and revoke its demo deployment token. Preserve the dedicated source signing keystore for any future source APK upgrade.

**Current status:** The optional stable source-signed flow still requires a separately configured persistent Pages/D1 demo and independent signing secrets. An **independent temporary alternative has already published 0.2.2-source**: 0.2.2 temporary APK + ZIP, release tag `source-v1v2-39625851494` (open this repository's Releases tab). Its original Quick Tunnel has expired; rerun [Source Native V1 V2 Diagnostic QA](../.github/workflows/source-native-v1v2-diagnostic.yml) for a fresh approximately 30-minute empty-data backend and matching signed APK/ZIP. These temporary signatures change per run, so updates over an older test install may be rejected.

## 4. Installing on a phone

Open the direct APK asset shown in the **Publish source Native prerelease** run summary in Chrome or a normal external browser, not an in-app webview. Alternatively open the prerelease page and expand **Assets**. Android may ask for permission to install this APK from that specific browser or Files app. Verify the downloaded file size and SHA-256 against the matching Release asset before installing. If GitHub cannot deliver its asset CDN to the phone, a new build will not solve that network problem; try a different browser/network or a trusted personal transfer of the exact same checksum-verified APK. Avoid third-party APK mirrors.

The historical `source-qa-39588697045` package and the newer `source-v1v2-*` temporary QA packages are **not** lasting demos. Each test backend is an isolated Quick Tunnel shut down with its workflow runner. The old packages remain inspectable release artifacts, not permanently authenticated clients.

Do not mistake these evidence levels: a Gradle green build proves source compilation; a signed Release proves a downloadable asset was published; a successful server-side login probe proves the demo backend responded **during publishing**; only real phone use proves install, navigation, settings persistence and freedom from Compose lifecycle crashes. See [Native phone acceptance](SOURCE_NATIVE_PHONE_ACCEPTANCE_2026-10-21.md) for the device checks.
