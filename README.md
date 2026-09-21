# Elementera Coast Source

Elementera Coast Source is an open-source reference version of a personal long-term conversation workspace.

It grew out of a private project built around one idea:

> Keep the visible chat window light, and move long-term context, memory, tools, visitors, files, and cross-window state into a separate shore.

This repository is not a ChatGPT replacement, a polished SaaS product, or a ready-to-deploy framework. It is a source release of a real personal system, cleaned and generalized for public reference.

It may be useful if you are exploring:

- personal AI frontends;
- long-term conversation memory;
- PWA + backend + Android app structure;
- context assembly across multiple windows;
- visitor mailboxes and controlled external input;
- model workspaces and tool-call records;
- early MCP / OpenAI-compatible interface experiments;
- the process of turning a private long-term conversation workspace into a public source release.

## Table of contents

- [What is Elementera Coast?](#what-is-elementera-coast)
- [High-level architecture](#high-level-architecture)
- [Main features](#main-features)
- [Repository layout](#repository-layout)
- [PWA / Web app](#pwa--web-app)
- [Backend / API source](#backend--api-source)
- [Android native app](#android-native-app)
- [Memory and context model](#memory-and-context-model)
- [Visitor mailbox](#visitor-mailbox)
- [Model workspace and tool records](#model-workspace-and-tool-records)
- [Attachments, files, and search surfaces](#attachments-files-and-search-surfaces)
- [MCP and external-interface experiments](#mcp-and-external-interface-experiments)
- [Preview APK](#preview-apk)
- [Running and testing](#running-and-testing)
- [Configuration](#configuration)
- [Privacy and sanitization](#privacy-and-sanitization)
- [Known limitations](#known-limitations)
- [License](#license)

## What is Elementera Coast?

Elementera Coast is a personal AI workspace built around a “many windows, one brain” structure.

Different frontends can exist as different windows:

- a PWA / web workspace;
- an Android native app;
- visitor-facing mailbox surfaces;
- model or tool workspaces;
- future external clients or gateways.

Those windows do not need to share the same visible chat history. Instead, they can share a deeper source of truth: memory, world-book entries, context notes, tool records, visitor metadata, and other long-term state.

In simpler words:

- the chat window is where people talk;
- the gateway decides what context should be brought into the conversation;
- the memory system keeps long-term material organized;
- the app surfaces make that system visible and usable.

Elementera Coast was originally built as a private shore beside the main conversation space: a place to store memory, inspect model work, preserve context, handle visitors, and experiment with multi-window AI interfaces.

The source edition keeps the real application shape where possible, while removing private data, production credentials, private visual identity, and production release machinery.

## High-level architecture

Elementera Coast can be understood as five layers:

```text
Frontend windows
  ↓
Gateway / backend functions
  ↓
Service and feature logic
  ↓
Storage / long-term state
  ↓
Model and tool providers
```

A more detailed view:

```text
PWA / Web app
Android native app
Visitor mailbox
Model workspace
Future external clients
        ↓
Backend / API layer
        ↓
Context assembly
Memory and world-book lookup
Mailbox boundaries
Tool-call records
Attachment/file handling
MCP and mock-interface routes
        ↓
Model providers / tools / storage
```

The important design choice is that the frontend is not treated as the whole brain.

The frontend is a window. The long-term state lives behind it.

## Main features

This source release includes early or source-level implementations for the following areas.

### 1. Chat and conversation surfaces

The project includes conversation UI and backend routes for personal AI chat workflows.

Relevant ideas include:

- visible chat messages;
- streaming / SSE-style model response flow;
- model metadata display;
- backend response inspection;
- current-turn context preview;
- owner / model / visitor role boundaries;
- attachment-aware messages;
- source and tool records attached to a turn.

The goal is not only to send a message and receive a reply. The goal is also to show what context, tools, files, and backend results were involved in that turn.

### 2. Long-term context and memory surfaces

Elementera Coast contains early structures for keeping long-term material outside the immediate chat window.

The source includes surfaces and logic related to:

- context assembly;
- memory records;
- current conversation notes;
- active leads or currently held context;
- pending memory candidates;
- source and update metadata;
- world-book style organization;
- cross-window reading experiments.

The memory system is intentionally not presented as a finished autonomous brain. It is closer to a set of usable shelves: store things, label them, inspect them, and decide what should be carried into future conversations.

### 3. Visitor mailbox

The project includes a visitor-facing mailbox concept.

The mailbox is designed around separation:

- visitors can send controlled external messages;
- visitor material is not treated as ordinary private memory by default;
- mailbox metadata and mailbox UI are separate from private owner chat;
- source and privacy boundaries remain visible.

This is useful for experiments where an AI workspace needs an external input surface without letting external messages directly pollute private memory or core state.

### 4. Model workspace

The source includes a model workspace / workbench concept.

This area is used to inspect and manage model-side activity, such as:

- backend raw response text;
- model output metadata;
- model/tool execution surfaces;
- failure reasons;
- returned artifacts or external results;
- tool-call logs and redacted summaries.

The goal is to make model activity visible enough that the owner can debug what happened, instead of treating the model reply as an opaque black box.

### 5. Tool-call records

The project contains source structures for recording tool-related activity.

These records can include ideas such as:

- which tool or tool category was used;
- what target it acted on;
- whether the call succeeded or failed;
- a readable failure reason;
- whether the result was passed back to the model;
- whether it entered the current-turn context surface;
- redaction of sensitive details.

This is especially useful for personal AI workspaces where tools may touch files, repositories, notes, search, or other external systems.

### 6. Attachments and file input

The V1 project line includes unified attachment handling for images and files.

The source release includes related structures for:

- image/file attachment entry points;
- attachment-only messages;
- file metadata;
- text-file reading paths;
- image-aware or file-aware conversation flow;
- attachment records in the current turn.

The public source release does not include private uploaded files or private attachment data.

### 7. Search and source surfaces

The project has experimental surfaces for showing whether search or external sources were involved in a response.

The goal is not to fake provider-internal search behavior. Instead, the UI can record source-side facts that are actually available to the application, such as:

- whether a search-like tool was used;
- how many source records were returned;
- which source summaries entered the current turn;
- what visible source metadata the user can inspect.

### 8. Cross-window state

Elementera Coast is designed around the idea that multiple windows may exist at the same time.

For example:

- the Android app may be the high-frequency chat window;
- the PWA may be better for memory and workspace inspection;
- a mailbox may receive visitor input;
- future clients may speak to the same backend through compatible routes.

Each window can have its own local conversation context, while long-term material remains organized behind the scenes.

### 9. Daily / status / small surfaces

The source tree includes Daily-related and status-related surfaces from the original application structure.

These are part of the broader idea that a personal AI workspace is not only a chat box. It may also contain:

- daily notes;
- small status summaries;
- dashboard-style cards;
- owner-facing state displays;
- diagnostic surfaces.

These surfaces should be treated as project-specific early structures, not as a polished generic dashboard framework.

### 10. Snapshot / export direction

The private V1 project line included anti-loss snapshot work.

The source release keeps related structural ideas, such as preserving or exporting metadata around:

- core chat;
- memory;
- context notes;
- world-book style entries;
- tool summaries;
- attachment indexes;
- search summaries.

The public source release does not include private snapshot data.

## Repository layout

```text
.
├── apps
│   ├── web        # PWA / Cloudflare Pages-style app and backend functions
│   └── android    # Android native app source
├── docs           # environment, limitations, sanitization and verification notes
├── LICENSE
└── README.md
```

## PWA / Web app

The web source lives in:

```text
apps/web
```

It is a copied PWA / Cloudflare Pages-style application tree.

The web side includes application and backend source related to:

- chat flow;
- streaming response handling;
- attachments;
- model metadata;
- memory and context surfaces;
- world-book structures;
- visitor mailbox;
- owner settings;
- model workspace;
- tool records;
- MCP-related routes;
- cross-window experiments;
- UI and DOM tests.

The web app is not distributed here as a generic Vite / React template. It is a source snapshot of a real project tree, with private material removed.

### Web tests

The web package contains grouped test scripts, including areas such as:

- core conversation behavior;
- attachments;
- streaming format;
- model metadata;
- cross-window behavior;
- backend contracts;
- context contracts;
- world-book logic;
- tool summaries;
- memory routing and memory UI;
- mailbox behavior;
- MCP room behavior;
- Daily surfaces;
- DOM / UI behavior.

The test suite is useful for understanding the project’s feature boundaries even before deploying it.

## Backend / API source

The backend source is kept inside the web application tree.

The public source release includes routes and functions related to the project’s core flows, but does not include production platform state or real credentials.

The backend layer is responsible for work such as:

- receiving chat requests;
- preserving conversation contracts;
- assembling context;
- working with memory and world-book records;
- handling mailbox boundaries;
- recording tool and model activity;
- supporting attachment/file paths;
- exposing experimental MCP or external-interface routes;
- keeping sensitive production configuration out of the source tree.

This source release expects self-hosters to provide their own backend environment and storage configuration.

## Android native app

The Android source lives in:

```text
apps/android
```

It is a Kotlin + Jetpack Compose application.

Source identity:

```text
App: Elementera Coast Source
applicationId = com.elementeracoast.source
versionCode = 1
versionName = 0.1.0-source
```

The Android client keeps the copied native application structure, including areas such as:

- page navigation;
- themes;
- repositories;
- HTTP / SSE transport;
- conversation flow;
- Daily surfaces;
- memory surfaces;
- visitor mailbox;
- model workspace;
- owner settings;
- diagnostic UI.

The Android client does not embed a WebView, React Native app, TypeScript app, or the PWA source. It is a native client that talks to backend contracts.

The production signing chain, production updater, production API origin, and production release machinery are intentionally not included.

## Memory and context model

Elementera Coast treats memory as something that should be organized, inspected, and confirmed, rather than silently mixed into every prompt.

The source release includes early structures around:

- memory records;
- memory candidates;
- context notes;
- active or current leads;
- source references;
- world-book style entries;
- recall-oriented organization;
- current-turn context preview.

A typical intended flow is:

```text
Conversation or external input
  ↓
Candidate context / candidate memory
  ↓
Owner-visible review surface
  ↓
Accepted, edited, rejected, archived, or kept pending
  ↓
Long-term memory / world-book / context surface
  ↓
Selective recall into later model turns
```

The important boundary is that not every message should immediately become core memory.

Some material is temporary. Some material is private. Some material comes from visitors. Some material is only useful for one turn. The UI and backend structures are designed to make those distinctions visible.

## Visitor mailbox

The visitor mailbox is an external input surface.

It is meant for controlled incoming messages, not for unrestricted access to the owner’s private workspace.

The mailbox concept includes:

- visitor-facing message entry;
- mailbox records;
- visitor metadata;
- controlled display inside the owner workspace;
- privacy and source boundaries;
- separation from core private memory.

In a personal AI workspace, this matters because not all incoming text should be treated equally.

A private chat message, a model note, a visitor letter, and a memory candidate may all be text, but they should not have the same permissions or the same path into long-term memory.

## Model workspace and tool records

The model workspace exists to make model-side activity easier to inspect.

Instead of only showing the final reply, the application can expose related information such as:

- backend raw response text;
- model metadata;
- tool-call summaries;
- tool failures;
- returned source records;
- current-turn context;
- whether a tool result was passed to the model;
- whether data was redacted before display.

This is useful while developing a personal AI system because many errors are not ordinary UI errors. They may be context errors, provider errors, tool permission errors, missing-token errors, unsupported-feature errors, or source-handling errors.

The project includes early structures for making those failure modes visible to the owner.

## Attachments, files, and search surfaces

Elementera Coast includes source paths related to attachments and file-aware conversation.

The project line includes support for:

- a unified attachment entry point;
- images;
- files;
- attachment-only messages;
- text-file reading;
- attachment metadata;
- model-visible attachment records;
- search/source records in the current turn.

This source release does not include private uploaded files or private attachment content.

Search-like behavior and file-reading behavior should be understood as application-level surfaces that depend on the configured backend and tools. Provider-internal search behavior is not faked.

## MCP and external-interface experiments

This repository contains experimental MCP-related and API-side interface structures.

These are included as source reference material, not as a finished universal MCP framework.

The experimental direction includes:

- MCP-style room or porch surfaces;
- tool registry and tool-call records;
- model workbench integration;
- external gateway ideas;
- OpenAI-compatible route experiments;
- future multi-window client possibilities.

These parts are useful to read if you are exploring how a personal AI workspace might connect to external tools or alternate clients.

They should be treated as experimental.

## Preview APK

A debug preview APK is available from the `v0.1-source` GitHub Release.

APK details:

```text
file: elementera-coast-source-v0.1-debug.apk
applicationId: com.elementeracoast.source
versionCode: 1
versionName: 0.1.0-source
build type: debug
official_production_apk: false
preview password: 123456
SHA-256: 989a8f7f159f251d2f2b0bcc57e915da3724268fa901c2ae182d30c524859beb
```

This APK is only a source preview build. It is not an official production APK.

## Running and testing

### Web

The web source is distributed as a copied Cloudflare Pages / static application tree.

From the web app directory:

```bash
cd apps/web
npm install
npm test
```

Some DOM-related tests require the declared test dependencies to be installed.

The source release does not include production platform state, production secrets, or a complete hosted deployment setup.

See:

```text
docs/ENVIRONMENT.md
docs/KNOWN_LIMITATIONS.md
```

### Android

The Android source can be opened from:

```text
apps/android
```

With JDK 17, Android SDK 34, and Gradle 8.9 available, the Android README documents:

```bash
gradle :app:testDebugUnitTest --no-daemon --stacktrace
gradle :app:assembleDebug --no-daemon --stacktrace
```

A locally built debug APK is for inspection and testing only.

## Configuration

No credentials, tokens, production database IDs, production project IDs, production signing material, or private data are included.

The PWA expects Cloudflare Pages / Workers-style bindings for real deployment.

Important configuration is documented in:

```text
docs/ENVIRONMENT.md
```

Examples of expected configuration include:

- owner password hash;
- session secret;
- D1-compatible database binding;
- optional provider keys;
- optional GitHub / Notion / MCP-related variables, depending on which features are used.

The Android source uses a non-routable placeholder backend by default:

```text
https://elementera-coast-source.invalid
```

Self-hosters should point their own build at their own backend.

## Privacy and sanitization

This repository was derived from a private personal project and sanitized before publication.

The source release removes or replaces:

- private conversations;
- visitor letter bodies;
- memory bodies;
- private onboarding prose;
- private seed data;
- production credentials;
- production signing configuration;
- production updater and release machinery;
- private visual identity assets.

Some fixed UI copy and internal names were generalized for public distribution.

The goal of this source release is to preserve the real application structure while removing private data and production-only machinery.

## Known limitations

This repository is a source release, not a production service.

Important limitations:

- production signing material is not included;
- production updater and production release publishing are not included;
- production API origin is not included;
- real credentials and private data are not included;
- the published APK is a debug preview build, not a production APK;
- self-hosters must provide their own backend, secrets, storage, and deployment configuration;
- some legacy wire/database values may remain where changing them would break compatibility with copied source contracts;
- experimental MCP / gateway / memory structures should not be treated as stable public APIs.

See:

```text
docs/KNOWN_LIMITATIONS.md
```

## Who should read this repository?

This repository is most useful for people who want to study or adapt ideas from a real personal AI workspace.

It may help you think about:

- how to separate chat UI from long-term memory;
- how to make model/tool activity inspectable;
- how to handle visitors without merging them into private memory;
- how to keep PWA and Android clients aligned around related backend contracts;
- how to structure early memory, context, and world-book systems;
- how to sanitize a private AI project before public release.

## Who should not use it directly?

This repository is probably not what you want if you need:

- a finished product;
- a production-ready hosted backend;
- a generic ChatGPT clone;
- a polished UI template;
- a plug-and-play memory framework;
- a stable public API contract;
- community support around a mature framework.

You should expect to fork, rename, configure, simplify, and replace parts of it for your own use.

## Project status

`v0.1-source` is the first MIT source release.

It is an early reference release. The codebase is broad enough to study, but it should not be treated as a mature framework or stable public product.

## License

MIT License.

See `LICENSE`.
