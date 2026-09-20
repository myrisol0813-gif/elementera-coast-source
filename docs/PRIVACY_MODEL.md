# Privacy model

The public source repository is designed around **structural disclosure without private-life disclosure**.

This repository contains the architecture of a house, not the private life once lived inside it.

这个仓库公开的是造房子的结构，不是屋里生活过的私人日记。

## Repository boundary

The repository may contain:

- source code and generic fixed UI copy
- empty/source-safe schemas
- source-only configuration templates
- generic integration contracts
- self-hosting documentation

It should not contain:

- real private chat history
- real Visitor Mailbox messages
- real memories or Human Thought Chain content
- private visual assets
- provider keys, access tokens, session secrets or signing material
- private database identifiers
- production URLs or updater/release wiring
- historical private migrations or seeded private rows

## Deployment boundary

A self-hosted deployment creates its own owner password, session secret, provider credentials and D1 database.

`COAST_CHAT_DB` is the source deployment's D1 binding. A user should bind a database they control.

## Authentication boundary

Owner surfaces require an owner session created from `SOURCE_ACCESS_PASSWORD` and `COAST_SESSION_SECRET`.

Visitor Mailbox access has its own visitor-oriented boundary and source-safe storage model.

## Export boundary

Source snapshot export describes data stored by the **current source deployment**. It must not inject private production data or credentials.

The export can include source-deployment conversations, Human Thought Chain, Conversation Note, Review Queue, memory, Worldbook, widgets, external-entry messages, attachment metadata and redacted Tool Call Log summaries.

Attachment bytes and deployment secrets are not intentionally embedded by the snapshot endpoint.

## Logging and tools

Tool Call Log records are designed as redacted summaries. Public integration surfaces are contracts rather than bundled private credentials.

## Security defects

Treat any accidental private text, credential, production endpoint, signing artifact or private visual asset found in the repository as a privacy/security defect and remove it before tagging a source release.
