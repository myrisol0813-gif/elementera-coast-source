# Source testing and Android APK guide

This document describes the **current** ways to inspect or test Elementera Coast Source.

Historical `0.2.2` Quick Tunnel and stable-demo experiments are no longer the recommended path. Their implementation notes are preserved in [SOURCE_RELEASE_HISTORY.md](SOURCE_RELEASE_HISTORY.md).

## 1. Inspect the current public Source Native build

Open the repository's **Latest Release** and download the current Source Native Visitor QA APK plus `SHA256SUMS.txt`.

The visitor build:

- uses `applicationId=com.elementeracoast.source`;
- currently comes from the `0.2.15-source` source tree (`versionCode=17`);
- accepts the local visiting code `123456`;
- keeps visitor mode **offline-only**;
- blocks account authorization, model calls and other cloud actions before network transmission;
- is compiled with the non-routable placeholder `https://elementera-coast-source.invalid`;
- uses a disposable Source-only QA signing certificate.

The public visitor APK is for interface inspection and local appearance testing. It cannot be repointed to a real backend after installation.

Because disposable QA certificates change, Android may refuse to install a new Source QA build over an older separately signed Source build. If that happens, uninstall **only** `com.elementeracoast.source` and install the new APK again.

Do not rename, unpack or install an APK from inside a ZIP preview. Download the actual `.apk` file and compare its SHA-256 with the matching release checksum.

## 2. Run a temporary live test with your own ChatGPT account

The fastest live path does not require a permanent Cloudflare project.

Fork or copy the repository, enable GitHub Actions, then run:

**Actions → Live ChatGPT Test → Run workflow**

The workflow creates:

```text
fresh local D1 + Coast backend
        ↓
Cloudflare Quick Tunnel
        ↓
Source Native Release build with visitor mode OFF
        ↓
disposable Source-only signing
        ↓
private Draft Release
```

The Draft Release contains:

- the temporary APK;
- the temporary Coast backend URL;
- a random one-run Coast login password;
- SHA-256 metadata.

Install the APK while the workflow is still in its test window, log in with the password from the Draft Release, then:

1. open the model picker;
2. choose the **ChatGPT plan** section;
3. select **Continue with ChatGPT**;
4. complete authorization in the browser;
5. return to the app;
6. refresh the account model list;
7. choose a model and send a test message.

The ChatGPT OAuth token remains on the Android device and is protected with Android Keystore. It is not sent through the temporary Coast backend.

The temporary backend and Quick Tunnel disappear when the workflow ends. The APK will no longer have a live Coast backend afterward.

### Current signing path

Live ChatGPT Test uses the same disposable signer contract as the public visitor publisher:

```text
assembleRelease
  → app/build/outputs/apk/release/app-release-unsigned.apk
  → scripts/sign-disposable-qa.sh <unsigned-apk> <signed-apk>
  → aapt / apksigner verification
```

The workflow never re-signs `app-debug.apk`.

`Source check` also exercises this Release-signing path in CI, so an incompatible signer change should fail before a manual live run.

## 3. Local or persistent self-hosting

For ordinary local development, a Debug build is still useful:

```bash
cd apps/android

gradle :app:testDebugUnitTest :app:assembleDebug --no-daemon --stacktrace \
  -PCOAST_API_BASE_URL="https://YOUR-BACKEND.example" \
  -PSOURCE_TOUR_ENABLED=false
```

For QA packaging that mirrors the repository workflows:

```bash
cd apps/android

gradle :app:assembleRelease --no-daemon --stacktrace \
  -PCOAST_API_BASE_URL="https://YOUR-BACKEND.example" \
  -PSOURCE_TOUR_ENABLED=false

bash scripts/sign-disposable-qa.sh \
  app/build/outputs/apk/release/app-release-unsigned.apk \
  /tmp/elementera-coast-source-qa.apk
```

The disposable signer is intended for temporary Source QA only.

For a persistent self-hosted installation, provide your own:

- Cloudflare Pages / Workers-style backend or compatible host;
- D1-compatible storage configuration;
- owner password hash and session secret;
- optional provider credentials;
- Android backend URL;
- **stable application signing setup**.

Do not reuse private production credentials or production signing material.

See [../README.md](../README.md), [ENVIRONMENT.md](ENVIRONMENT.md), and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## 4. Reality Context acceptance

When testing a live Native build, Reality Context is configured per conversation.

PWA Reality fields:

- date;
- local time;
- next seven days of Coast calendar entries.

Native keeps the fuller Reality set, including the manually configured weather city and these device fields:

- battery;
- optional coarse location;
- most-recent non-Coast foreground app;
- today's Top 5 app-usage durations;
- lightweight step-counter data.

The backend rechecks the canonical conversation settings before model assembly. A device snapshot cannot inject a field that the current conversation did not allow.

Missing Android permission or unavailable sensor data should remain visibly missing and must not block chat.

Short reply mode is independent of Reality Context. A valid acceptance check is to turn Reality fully off while leaving short reply mode on and confirm that the response mode still reaches the model.

## 5. PWA acceptance

The current Source PWA uses cache `coast-source-app-15`.

On mobile, verify:

- the top-right menu opens **「这个窗口」**;
- Reality, short reply mode, thought soil and the landing letter are reachable there;
- PWA Reality shows only date, local time, and the next-seven-days calendar; weather and Native-only device fields are absent;
- chat reading text uses the compact mobile reading size;
- the conversation drawer scrolls internally instead of freezing against the viewport;
- current-turn receipts show which context was delivered or unavailable.

The PWA does not fabricate Android-only device data.

## 6. Build evidence vs device evidence

Keep these evidence levels separate:

- a green Gradle build proves compilation;
- `Source check` disposable-signing success proves the release-unsigned → signer → final APK path works in CI;
- a GitHub Release proves an asset was published;
- server-side login probes prove the temporary backend responded during the workflow;
- only a real phone installation proves device/OEM installer compatibility and mobile interaction.

For phone-level checks, see [SOURCE_NATIVE_PHONE_ACCEPTANCE_2026-10-21.md](SOURCE_NATIVE_PHONE_ACCEPTANCE_2026-10-21.md).

## Historical flows

Old `0.2.2` Quick Tunnel packages, `source-v1v2-*` experiments and the first `v0.1-source` preview are historical evidence, not current installation instructions.

See [SOURCE_RELEASE_HISTORY.md](SOURCE_RELEASE_HISTORY.md) instead of copying those old commands into a new setup.
