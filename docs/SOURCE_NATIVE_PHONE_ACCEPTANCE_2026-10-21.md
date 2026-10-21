# Elementera Coast Source · Native 0.2.1 phone acceptance

This is a checklist for the **public source Android app only**, application ID `com.elementeracoast.source` (`versionCode=3`, `versionName=0.2.1-source`, minimum Android API 26). It does not modify or validate the personal production app or its updater. The previously accepted PWA needs no additional dedicated test.

## Required build provenance

1. Confirm the release is a GitHub **prerelease asset**, not an Actions artifact; record release URL, commit, APK filename, size and asset SHA-256.
2. Confirm the release workflow first verified a **separate, persistent** `*-demo.pages.dev` origin, the real test password `123456`, and authenticated calendar + book API responses. A `trycloudflare.com` Quick Tunnel cannot be treated as an enduring APK backend.
3. Confirm the release build used a **source-only stable keystore** and `apksigner verify` succeeded. Compare certificate fingerprint with the previously accepted stable source release if one exists. Do not use production signing material.
4. Confirm `aapt dump badging` reports `com.elementeracoast.source`, version code `3`, version name `0.2.1-source`. Compare the file SHA-256 with the matching Release `SHA256SUMS.txt` and GitHub asset digest.
5. Record whether device installation was actually tested. Build success or upload success alone is **not** a phone acceptance.

## Download and install

From the Android phone, open the exact APK asset link reported in the prerelease workflow summary using external Chrome. If it does not download, try the Release page → **Assets** → APK in an external browser, inspect the browser's Downloads list, and check whether the download is blocked by the GitHub asset CDN or system download permission. Do not assume a new APK repairs a browser/network download problem. A trustworthy manual transfer is possible only after checksum comparison. Do not use unknown mirrors.

An older ephemeral debug-signed source package may not share the stable source release signing certificate. If Android reports an incompatible update or different signature, uninstall **only Elementera Coast Source**, not the personal production app, after exporting any source-only sample data you need. Uninstalling clears local source fonts/backgrounds/settings. Package identity alone is not enough for an in-place signing match.

## Device checks (use fake sample data only)

- [ ] APK downloads completely, file digest matches, Android accepts install, launcher opens; report phone model, Android version, installation result and error if any.
- [ ] Real login with `123456` succeeds against the independent live demo backend; a deliberately wrong password is rejected. This must be checked **on device**, not inferred from CI.
- [ ] Open 小组件: **碳硅圈** says **前端默认朋友圈**. Its entry, **日历**, and **书房** show the original rounded-card hierarchy, not ad-hoc square/gray substitutes.
- [ ] Calendar creates/edits one fictional event; library imports a tiny fictional TXT/EPUB, pages through it, adds a note and retains its state after reopening. Do not upload personal works.
- [ ] Open 屋主设置 → 外观: change theme, bubble color and accent, then return to chat and observe correct propagation.
- [ ] Choose/replace/remove a **synthetic** PNG/JPG/WEBP chat background; adjust dimming and check crop/legibility. No image is uploaded to a backend.
- [ ] Change opacity for **both** user and assistant message surfaces; neither side becomes illegible.
- [ ] Cycle 朱雀仿宋、纳米老宋、寒蝉活宋 and, optionally, import/remove a personally licensed `.ttf`/`.otf`. Check fallback behavior: bundled proprietary typefaces are intentionally absent in the public source tree.
- [ ] Select normal, medium and bold reading weight. Check both user's and assistant's messages. Toggle snow-letter shallow-relief vs rounded frameless paper mode.
- [ ] Kill/reopen the app and verify theme, reading preferences, dimming and locally imported assets persisted.
- [ ] If test voice clips are available, confirm existing playback/generate controls. Without provider keys, an honest not-configured response is expected; do not treat it as successful voice generation.
- [ ] Repeatedly enter/leave chat, settings, calendar and book room, including during an ongoing refresh or navigation; check for freezes, error toasts or **`The coroutine scope left the composition`**. If reproduced, capture exact tap sequence, screen and Android logcat stack trace before making a targeted lifecycle fix.
- [ ] Confirm the private application remains separate and unaffected; do not test its production database, accounts, voice IDs or updater here.

## Evidence status and acceptance rule

Source review can confirm implementation exists, not pixel-level visual correctness or lifecycle stability. CI confirms only automated checks. Mark final acceptance **passed** only when a phone has installed the exact checksum-matched APK, logged into a live independent backend, completed the settings/data checks and provided screen evidence. Otherwise report **pending** with the failing step, rather than calling compilation a successful release acceptance.
