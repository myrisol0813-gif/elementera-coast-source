# Source preview setup

This source baseline is isolated from the production Elementera Coast instance.

## Web / PWA

Use `apps/web` as the static + Pages Functions project root.

Required self-hosted bindings:

- D1 binding: `COAST_CHAT_DB`
- Secret: `COAST_SESSION_SECRET` — at least 32 characters
- Secret: `SOURCE_ACCESS_PASSWORD` — at least 8 characters

Optional model provider binding:

- Secret: `OPENROUTER_API_KEY`

Without a model provider key, the PWA shell, owner login, chat window storage, Visitor Mailbox,
human thought chain, memory views, dictionary, context preview UI, and source workbench can still
be inspected. Sending a model-generation request returns an explicit provider-not-configured error.

The source repository does not include production URLs, production database identifiers,
production secrets, production signing material, private assets, or a production update chain.

## Native source shell

Open `apps/android` as the Android project.

Source identity:

- applicationId: `com.elementeracoast.source`
- versionCode: `1`
- versionName: `0.1.0-source`

The Native project is intentionally a minimal Compose shell. It does not contain production
signing configuration, updater wiring, release configuration, or private launcher assets.
