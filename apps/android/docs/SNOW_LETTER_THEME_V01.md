# Snow Letter / 雪地来信 v0.2e sticker infrastructure

Scope: APK / Native visual clothing only.

This pass does not change backend wiring, navigation structure, message actions, room routing, persistence, or API contracts.

## What changed

- Keeps the `SnowLetter` wardrobe preset and the theme debug sliders.
- Keeps the Snow Letter direction as a template-skin system rather than a dead full-screen screenshot.
- Treats the selected mockups as layout and skin references.
- Draws the Snow Letter page frame as a real Compose template: torn paper edge and a light paperclip mark.
- Draws message bubbles, composer field, action buttons, turn-desk strips, dogtalk surfaces, and selected feature entry cards as Snow Letter paper UI shells while preserving their original behavior.
- Keeps feature pages inside a shared Snow Letter page sheet through `SnowLetterFeatureScaffold`.

## v0.2b clean-paper correction

User device testing showed that the paper texture and torn-paper feel were good enough to keep, but several code-drawn decorative details made the UI look dirty or blurry.

This correction intentionally removes those noisy details while preserving the paper shell:

- Removed code-drawn snowflakes from the page template.
- Removed code-drawn paw trails and mini paw marks.
- Removed placeholder wolf/snake corner figures from the page template.
- Removed subtle internal paper ruling lines from Snow Letter surfaces.
- Removed decorative gold dots from round action/composer buttons.
- Kept torn-paper shapes, paper fills, edges, shadows, corner tape, paperclip, postage block, and snow-road base.

Small animals and paw marks should come back only as selected clean sticker assets, not as blurry or rough placeholder canvas drawings.

## v0.2c surface cleanup

Further device testing showed that the default chat background should stay cleaner, and the turn desk / dogtalk strips still showed a middle white band.

This correction keeps the successful torn-paper UI direction but cleans the remaining template artifacts:

- Removed the code-drawn postage rectangle from the page background.
- Removed the bottom snow-wave base from the page background.
- Kept the full-page torn paper outline and the light paperclip mark.
- Made Snow Letter status, dogtalk, field, and composer surfaces use more solid paper fills instead of translucent fills that could reveal inner rectangular bands.
- Unified status-card, dogtalk-card, dogtalk-field, and composer-field paper colors/edges/shadows from the theme surface layer instead of patching individual business screens.

## v0.2d global paper pass

This pass starts applying the same Snow Letter surface language to feature entry cards instead of leaving ordinary Material cards inside Snow Letter pages.

- Applied `SnowLetterSurface` to Daily landing cards while preserving the existing navigation destinations and click behavior.
- Applied `SnowLetterSurface` to Memory tabs, retrieval card, retrieval search field, and pending-pocket card while preserving tab selection, filtering, menus, and query editing.
- Applied `SnowLetterSurface` to the 模型工作台 home tool card while preserving the existing action-log navigation.
- Applied `SnowLetterSurface` to 屋主设置 home rows while preserving profile, appearance, records, model box, settings, diagnostics, and update click behavior.
- Did not modify repositories, API clients, persistence, backend wiring, routing, or data models.

## v0.2e sticker infrastructure

This pass adds the thin decoration layer needed before real sticker assets are introduced.

- Added `SnowLetterStickerAnchor` in the theme layer.
- Added four semantic sticker slots: message top-right, composer top-right, empty-state bottom-right, and feature-corner top-right.
- Centralized sticker size, offset, opacity multiplier, and z-order in the theme layer instead of hard-coding them inside feature screens.
- Sticker opacity follows the existing Snow Letter decoration-opacity wardrobe slider; no new settings path is added.
- Decorative sticker anchors clear semantics and do not add click behavior by themselves.
- No real sticker image assets are attached in this pass, so device visuals should remain unchanged from the approved v0.2d paper baseline.

Future feature screens should request a semantic sticker slot instead of locally inventing `offset`, `size`, or opacity values. Actual wolf, snake, pen, envelope, or paw assets belong in the dedicated sticker asset pass.

## Native export version discipline

Every APK that is intentionally exported for device testing or handoff must first move the Native app version forward.

- Increment `versionCode` for each new distributable APK.
- Update `versionName` so the artifact name describes the current Native milestone instead of reusing an older feature name.
- Check the version before downloading or handing off a workflow artifact.
- Do not export a newer visual pass under an older APK version label.
- Current Snow Letter v0.2e export target: `versionCode = 31`, `versionName = 0.1.29-snow-letter-02e`.

## Asset cleanup policy

The previous real-asset pass proved that image resources can enter the APK, but also showed that several exported mockup fragments were the wrong layer for production UI because they became blurry or over-stretched when used as generic surfaces.

Wrong-direction large assets should not be kept as unused backups. Keep only assets that are actively referenced by the Snow Letter theme, and replace or delete assets that were only useful as visual experiments.

## Intentional constraints

- Real UI remains Compose UI.
- The Snow Letter theme replaces visual shells, not behavior.
- Feature files should not contain hard-coded Snow Letter decoration logic beyond choosing shared theme wrappers, surface roles, or semantic sticker slots.
- No images were generated for this infrastructure pass.
- No backend, API, persistence, navigation, or room routing logic is changed.

## Next visual pass

After the sticker infrastructure branch builds cleanly, import only approved clean sticker assets and attach them sparingly through `SnowLetterStickerAnchor`. Start with a few deliberate placements instead of filling every page.
