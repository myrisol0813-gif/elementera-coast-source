# Direct dev-hands architecture

## Runtime contract

Elementera Coast no longer has a separate construction mode. Ordinary owner chat receives GitHub, Notion, CI, APK, and 屋主设置 developer tools through the same model tool registry used by the rest of the Coast.

The model decides whether and when to use those tools. Coast does not require a construction-mode toggle, tool-pack switches, pending confirmation cards, or a separate construction chat transport before exposing them.

Visitor and mailbox surfaces do not receive owner developer tools.

## Boundaries that remain

The remaining boundaries describe real resource ownership rather than a product-level enable gate:

- GitHub access stays inside `COAST_GITHUB_ALLOWED_REPOS`.
- Notion access stays inside the configured Elementera Coast root.
- tokens, cookies, authorization headers, keystores, and server secrets remain server-side and are redacted from logs and model-visible summaries.
- provider, GitHub, Notion, Cloudflare, and model limits are surfaced as real errors rather than hidden trimming or compatibility fallbacks.

## Observation surfaces

The PWA and Native developer-hands pages are observation surfaces only. They show connection self-checks, model-visible tool inventory, real tool-run footprints, release metadata, and Native/APK information. They do not control whether the owner model has developer tools.

## Version

This source edition uses PWA cache `coast-source-app-01`, backend release `COAST-SOURCE-DEV-HANDS-01`, and the source Native identity documented in the repository README.
