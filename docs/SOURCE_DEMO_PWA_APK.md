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

- Verifies that the demo server actually accepts the configured password.
- Builds `applicationId=com.elementeracoast.source`, `versionCode=2`, `versionName=0.2.0-source`, using the verified Pages URL, not the private endpoint.
- Displays the configured demo password as a *hint* on the source login screen. The APK does not implement an offline password: authentication always happens at the PWA's server.
- Publishes the stable-signed APK **and its SHA-256** as GitHub **Releases prerelease assets**, never as Actions artifact.
- Refuses to publish without stable source signing and a real HTTPS Pages test backend.

The old `v0.1-source` APK was a debug preview; its temporary signing certificate may differ from the stable source key. In that case, uninstall only the **old source preview** before installing `0.2.0-source`; do **not** remove the private production app.

## 3. Device acceptance and teardown

After a new source prerelease exists, install it and enter `123456`; sign into the same source PWA in a browser. Create a **fake** calendar entry and fake TXT/EPUB book, add a note and a cover, then confirm they are shared between source APK and source PWA. Check the original layout and paging on the phone. Export the sample data in JSON/HTML and confirm it contains the expected test content. Test voice only after configuring your own voice provider; otherwise the honest provider-not-configured error is expected.

Keep the PWA up only while testing. When done, switch off GitHub demo/release variables, delete the **demo-only** Pages project and D1 database, and revoke its demo deployment token. Preserve the dedicated source signing keystore for any future source APK upgrade.

**Current status:** These GitHub workflows prepare reproducible deployment, but cannot automatically create an external Pages project, install Cloudflare/GitHub secrets, or produce an APK before the account owner supplies those prerequisites.
