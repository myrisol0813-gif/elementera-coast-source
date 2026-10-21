# 2026-10-21 · Public source acceptance fixes (0.2.1-source)

The PWA menu now lists Calendar and Book Room inside 小组件, not as separate sidebar buttons. The original Daily card layout is reused, with two matching outline icons. No feature APIs or book records were changed. PWA cache: coast-source-app-04 → coast-source-app-05.

Native UI: Daily subtitles use 前端默认朋友圈; the calendar and book-room tabs use 日历 and 书房. Existing backend identifiers remain untouched. The original Native appearance UI and local persistence have been restored: chat wallpaper picker/removal/dimming, user+assistant bubble opacity, body font selection, local .ttf/.otf imports, font weight and paper treatment. The appearance selections now propagate from WolfStore to CoastTheme and message text. No private background or font file is bundled or committed; when licensed bundled fonts are absent, the app uses its system-serif fallback and a user may select their own local font.

The public source APK maintains its separate com.elementeracoast.source identity. Version becomes versionCode 3, versionName 0.2.1-source. Native release/prerelease workflows and the one-time empty-data Quick Tunnel QA package follow the same version. The temporary tunnel password is 123456 and is safe only for synthetic demo data.

Acceptance on Android: open 小组件 to verify labels; enter 屋主设置 → 外观 and select theme, transparency, import/delete a **non-private sample image**, change background dimming, choose system or imported font and weight, switch paper style; return to chat and check both sides, and restart app to check persistence. Confirm original voice clip controls remain. Without bundled commercial fonts the mode labels may fall back to default serif; this is intentional.

Acceptance on PWA: confirm sidebar has only 小组件 entry, then open it and use 日历 and 书房 cards; import synthetic EPUB, update reading progress and check server persistence. Do not use private books or real records on a 123456 demo.

Check Web and Native CI, repo safety audit, Release QA APK and SHA256SUMS, and mobile appearance screenshot before considering visual acceptance completed.