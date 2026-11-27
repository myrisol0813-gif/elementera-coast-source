# Rest box art pack v1

Canonical SVG art directory for the rest-box feature, shared by future Web and Android adapters. No chat, model, storage, navigation or background activity changes in this import.

- Three default room layouts: living V3.1, study V2, bedroom V2.3; original 41 furniture assets preserved. All 14 additional furniture and stationery designs are optional catalogue items, with no default placement. Gramophone uses the corrected connected horn. Original pink slippers remain the default; apricot is a palette preset.
- 16 creature bodies from wardrobe V0.5, with generic glasses and neckwear geometry and body-specific anchor configuration. Prototype executable scripts and traced third-party model badges are not included. Native pose/palette rendering and clothing occlusion parity remain to be implemented; the puppy, dog and older stoat are wardrobe-preview copies.
- Five original handheld props with anchor metadata. All SVG resources are bundled locally, not fetched from the private workshop at runtime.
- File names are relative to this pack root. The room layouts have their original viewBox units; optional extras use their own viewBoxes and still require default size / placement / interaction anchor checks. Preserve front/back layers as one furniture instance in the editor. Do not infer support for animation from a static preview.
- Native must consume the same resource source in its build, not keep a second hand-edited asset library. Browser SVG rendering and native support for filters, CSS, palettes, animation and foreground masking must be verified separately. Do not introduce a WebView as an implicit substitute for the native renderer.
- Public pack contains generic artwork only. Third-party badge artwork remains excluded pending rights review.
- Static checks: from apps/web, run `node tests/rest-box-art-assets.test.mjs`. No existing test scripts or shared build files changed yet; CI integration, real rendering and device tests are pending.
