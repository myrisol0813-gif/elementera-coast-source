# Known limitations

This source baseline is deliberately not a production replica.

- It does not include production OAuth.
- GitHub / Notion are generic adapter contracts; no production write credentials are bundled.
- Dev Hands does not include the private deployment's formal remote execution capability.
- There is no production APK updater.
- There is no release signing configuration or signing material.
- Old production data migrations are not included.
- Private visual assets are not included.
- RikkaHub import is not included.
- Voice and realtime call entry points are not included.
- Native is a source skeleton.
- The repository currently does not include a Gradle Wrapper, so a clean-checkout debug APK build is not yet reproducibly verified.
- Model chat requires a self-configured OpenRouter key.
- Provider-backed web search depends on the selected model/provider supporting the exposed tool.
- There is no committed public Cloudflare preview URL.
- Web/PWA runtime smoke testing requires a self-hosted D1 binding and local/preview environment.
- GitHub / Notion source surfaces do not recreate private production remote-write behavior.
- Model-autonomous cross-window tooling is not included; the source keeps cross-window access owner-driven/manual.
- Attachment export contains metadata rather than embedded attachment bytes.

These limitations are part of the source boundary, not an invitation to reconnect private production infrastructure.
