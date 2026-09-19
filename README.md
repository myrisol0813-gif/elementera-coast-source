# Elementera Coast Source

Elementera Coast Source is a source-available, non-commercial AI full-stack companion/chat system.

Planned monorepo structure:

- `apps/web`
- `apps/android`
- `packages/shared` or `docs/shared`
- `examples/sample-data`
- `docs`

The system includes a Web/PWA console, Cloudflare-style backend, memory/context architecture, Visitor Mailbox, Relay Room, multi-window chat structure, and a Native Android Compose client.

## Status

This repository is being populated from a clean-room migration. Production history, issues, pull requests, releases, Actions history, production secrets, production signing configuration, private data, and private copy are not imported.

## License

Licensed under the **PolyForm Noncommercial License 1.0.0**.

Permitted uses include personal learning, research, non-commercial personal use, non-commercial self-hosting, modification, and forks under the license terms.

Commercial use is not permitted, including resale, SaaS, paid deployment, paid hosting, advertising monetization, course sales, or redistribution for profit.

See `LICENSE` for the license reference.

## Production isolation

This source repository must not connect to the production Elementera Coast instance by default. Production application identifiers, update chains, release tags, signing configuration, signing secrets, private assets, private data, and production deployment settings are not part of the public source baseline.
