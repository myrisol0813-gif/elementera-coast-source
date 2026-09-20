# Roadmap

The source baseline is intentionally conservative. The goal is to keep a self-hostable architecture understandable and private-data-free rather than reproduce every private deployment capability.

## v0.1-source readiness work

- local/static PWA smoke checks
- self-hosting documentation
- environment/binding documentation
- repository hygiene scan
- source-only snapshot review
- Native identity isolation and skeleton review

## Possible work after v0.1-source

- reproducible automated Web smoke tests
- a source-safe database test fixture with synthetic data
- a committed Android Gradle Wrapper and reproducible debug build workflow
- stronger schema-level tests for snapshot/export invariants
- optional generic integration examples using user-supplied credentials

These are possibilities, not promises, and should not pull private production infrastructure into the source repository.

## Explicitly outside the current source baseline

- private production OAuth/router infrastructure
- private Dev Hands remote-execution chain
- private GitHub / Notion credentials
- production updater/signing/release distribution
- old private migrations/data
- private visual assets
- RikkaHub import
- voice or realtime call surfaces
