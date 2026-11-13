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

## Quick testing

There are two different ways to try this repository. They are intentionally not the same.

### 1. Inspect the current public Android build

Download the current **Source Native Visitor QA** APK and its SHA-256 from **[Latest APK release](../../releases/latest)**, then enter:

```text
123456
```

This opens the real Native page structure and local appearance for inspection. Visitor mode is deliberately **offline-only**: account login, ChatGPT authorization, model calls, and other cloud actions are blocked before network transmission.

**Only use Latest for a new install.** Old QA APKs mentioned in release notes are historical builds and may have expired backends or missing fixes.

If your phone says **“no signature file”** or **“cannot verify signature”**, do not rename or unpack the APK and do not install it from a ZIP preview. Download the actual `.apk` file using the system browser and compare its SHA-256 with the `SHA256SUMS.txt` linked in the release. A mismatching digest means the download is damaged; a matching digest with an installer error needs device-specific debugging. A disposable QA signature is not an additional file to install.

The published visitor APK is compiled with the non-routable backend placeholder:

```text
https://elementera-coast-source.invalid
```

That backend URL is part of the APK build configuration. **The published visitor APK cannot be repointed to a Cloudflare Tunnel after installation.**

### 2. Run a live source test with your own ChatGPT account

The fastest path does **not** require a Cloudflare account.

In your own copy of the repository, open **Actions → Live ChatGPT Test → Run workflow**. The workflow automatically:

```text
fresh empty Coast backend
        ↓
Cloudflare Quick Tunnel
        ↓
fresh Native APK with visitor mode OFF
        ↓
private Draft Release with APK + temporary login details
```

Open the Draft Release as soon as the workflow says the package is ready. Install the APK, use the random Coast password shown in the Draft Release, then:

1. open the model box;
2. choose the **ChatGPT plan** section;
3. select **Continue with ChatGPT** and complete browser authorization;
4. return to the app, refresh the account model list, choose a model, and send a test reply.

The temporary backend and Quick Tunnel stay alive only for the workflow's test window. The APK uses a disposable QA signing certificate and is meant for testing, not permanent installation.

If you are testing from a **new GitHub account**, fork this repository first. GitHub may ask you to enable Actions on the fork. Once enabled, run **Live ChatGPT Test** from the fork's **Actions** tab. Running workflows in the original repository requires write access to that repository.

The ChatGPT OAuth credentials are stored on the Android device with Android Keystore and are not sent to the Coast backend. The device calls the OpenAI Responses API directly; the Coast backend is used for workspace context, history, authorized tool operations, and sanitized receipts.

#### Manual equivalent

You can also run your own source backend, expose it with a temporary or permanent HTTPS URL, and build a fresh APK against it. A local Debug build is still useful for development:

```bash
cd apps/android
gradle :app:testDebugUnitTest :app:assembleDebug --no-daemon --stacktrace \
  -PCOAST_API_BASE_URL="https://YOUR-TUNNEL.trycloudflare.com" \
  -PSOURCE_TOUR_ENABLED=false
```

The repository's disposable QA workflows intentionally use the stricter release path instead:

```text
assembleRelease
  → app-release-unsigned.apk
  → scripts/sign-disposable-qa.sh <unsigned> <signed>
  → apksigner verification
```

`Source check` now exercises that signing path on every relevant change, so a future signer-interface mismatch fails in CI instead of surfacing only during a manual Live ChatGPT run.

For a longer-lived setup, replace the Quick Tunnel with your own hosted source backend and your own stable signing setup. See [Running and testing](#running-and-testing), [Configuration](#configuration), and `apps/android/README.md`.

## Table of contents

- [Quick testing](#quick-testing)
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
- [Current feature status (0.2.15-source)](#current-feature-status-0215-source)
- [Android APK downloads and history](#android-apk-downloads-and-history)
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

### Current-window context and response mode

Each conversation can keep its own `context_settings`. The current source supports:

- opt-in **Reality Context** per conversation;
- independently toggleable **short reply mode**;
- a current-window settings surface on both Native and PWA;
- explicit current-turn receipts showing what reality/response-mode context actually reached the model;
- message timestamps and cross-day markers without implying that display time was injected into the model.

The PWA intentionally keeps Reality Context lightweight: it can deliver date, local time, and the next seven days of Coast calendar entries without waiting on external weather or device services. Android Native keeps the fuller Reality set, including the manually configured weather city plus selected device-local fields such as battery, coarse location, most-recent non-Coast app, today's Top 5 app-usage durations, and a lightweight step-counter value.

The backend re-reads the canonical conversation settings before assembly and intersects them with the supplied snapshot, so a client cannot inject a Reality field that the current window did not allow. Short reply mode remains independent: Reality can be fully disabled while short reply mode stays on.

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

### Local ChatGPT plan connection

The Android source can optionally connect a user's ChatGPT account directly on the device. OAuth credentials are encrypted with Android Keystore and are not uploaded to the Coast backend. The backend remains responsible for authenticated context assembly, owner-tool execution and sanitized model receipts; the ChatGPT response itself is requested with the device-held account authorization.

This path reuses the same conversation, attachment, tool and context contracts instead of creating a second chat system. Provider reasoning options are only shown when the returned model catalog explicitly advertises them. The public visitor code remains offline-only and cannot use account-backed cloud operations.

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

### 10. Tidal Library / reading room

The source edition includes the original Tidal Library interface and layout: TXT/EPUB text import, cover handling, chapter and page navigation, highlights, annotations, reflections and reading progress. The original reader stylesheet is retained unchanged. User names and actor keys are neutralized, and no private books or annotations are included.

The source PWA exposes the same owner-only storage API and exports its own calendar and library records through JSON and HTML. Export files contain the reader's books and notes: handle downloads as personal data.

### 11. Snapshot / export direction

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

### Voice clips and MCP tool parity

The source edition preserves the original message-anchored voice clip player and text-selection dialogue. Each self-hosting owner may configure `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` **in the server environment**, not in source code. No private or sample production voice ID is bundled. When unconfigured, voice creation fails explicitly; provider usage incurs external costs.

The unified tool registry now exposes owner-authorized calendar, reading-room and voice tools to the model and MCP surfaces. Guest mailboxes cannot access these tools. Voice clips and their audio bytes are included in the authenticated full JSON archive; the lightweight snapshot/HTML view includes metadata only.

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
- per-window Reality / short-reply / thought-soil settings;
- compact mobile reading typography and an internally scrolling conversation drawer;
- current-turn context receipts showing delivered and missing context;
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
versionCode = 17
versionName = 0.2.15-source
```

The Android client keeps the copied native application structure, including areas such as:

- page navigation;
- themes;
- repositories;
- HTTP / SSE transport;
- conversation flow;
- per-window Reality Context and short reply mode;
- device-local Reality collection with permission-aware fallbacks;
- Daily surfaces;
- memory surfaces;
- visitor mailbox;
- model workspace;
- owner settings;
- theme wardrobe including the optional Cream Paper preset;
- diagnostic UI.

The Android client does not embed a WebView, React Native app, TypeScript app, or the PWA source. It is a native client that talks to backend contracts.

The production signing chain, production updater, production API origin, and production release machinery are intentionally not included.

## Memory and context model

Elementera Coast treats memory as something that should be organized, inspected, and confirmed, rather than silently mixed into every prompt.

The source release includes structures around:

- memory records;
- memory candidates and seed candidates;
- per-conversation Thought Soil / current-conversation notes;
- source references;
- world-book style entries;
- recall-oriented organization;
- current-turn context preview.

Thought Soil v2 uses four explicit fields: `current_text`, `afterthoughts`, `memory_candidates`, and `seed_candidates`. Only the current note and optional afterthoughts are carried into the next model turn. Memory and seed candidates are routed to the visible pending-confirmation flow and are never injected into the chat body merely because the organizer suggested them. A successful organization replaces the temporary soil snapshot; an invalid, truncated, or unavailable organizer response preserves the last successful soil and its cursor instead of writing a synthetic fallback.

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

The source Native client now includes the original owner calendar, Tidal Library shelf and reader, EPUB/TXT import and audio-clip actions, using the same source backend contracts as the PWA. Only the interface and generic implementation are mirrored; private data, accounts, identities and signing are excluded. See [Native parity acceptance](docs/SOURCE_NATIVE_PARITY_2026-10-21.md).

## Current feature status (0.2.15-source)

The source tree currently identifies the Android app as `0.2.15-source` (`versionCode=17`). The PWA cache is currently `coast-source-app-15`.

### Thought Soil v2

The current Source build exposes the per-conversation work note as **Current / Afterthoughts / Destinations**. Native ChatGPT-plan Thought Soil organization also prefers the lightest reasoning effort explicitly advertised by the selected model (`none`, then `minimal`, then `low`) and applies the organizer output cap only when that light reasoning mode is known to be supported; ordinary chat reasoning remains unchanged. The PWA and Native client share the same v2 contract, while the public UI keeps the more generic “current conversation note” wording. Suggested memory and seed destinations remain reviewable: they can be confirmed, redirected, or discarded before becoming long-term state. Legacy D1 columns are retained only for historical schema compatibility; the v2 runtime no longer reads or writes the old hand-seed / do-not-repeat / pocket-candidate soil fields.

### Conversation Reality Context and response mode

Reality Context is stored per conversation and is opt-in. The PWA path is deliberately lightweight and only delivers date, local time, and the next seven days of Coast calendar entries. Native retains weather plus battery, optional coarse location, the most recent non-Coast foreground app, today's Top 5 app-usage durations, and lightweight step-counter data when selected and available.

The backend rechecks the canonical conversation settings before model assembly. Selected-but-unavailable fields remain visibly missing rather than being invented. Short reply mode is independent of the Reality master switch. Both clients expose current-turn receipts, chat timestamps/cross-day markers, and the existing thought-soil entry.

### PWA mobile parity

The current PWA has a **「这个窗口」** settings sheet for Reality, short reply mode, thought soil and the landing letter. Its Reality controls are limited to date, local time, and the next seven days of calendar entries; weather and Native-only device fields are intentionally absent so they cannot delay a browser chat turn. The mobile reading surface uses a compact 14px reading size, the main top-bar title is 16px, and the conversation drawer is pinned to the app viewport with its content as the dedicated vertical scroll area.

The current Source PWA cache is `coast-source-app-15`.

### Native appearance

`0.2.14-source` restored the optional **奶油纸牌 / Cream Paper** Native theme on top of the Reality Context work. `0.2.15-source` keeps that appearance work and adds the lightweight ChatGPT-plan Thought Soil organizer policy described above. The theme wardrobe and appearance screen expose cream/blush cards, cocoa outlines and hard offset shadows across chat chrome and common settings surfaces. This is Native-only visual styling; it does not replace the PWA's separate web theme system.

### Local ChatGPT plan connection

The Native source can connect a user's ChatGPT account on-device. OAuth credentials are protected with Android Keystore and are not uploaded to the Coast backend. The backend still assembles authenticated workspace context, validates owner-authorized tools and stores sanitized receipts; the account-backed model request is made from the device.

### Source QA and APK signing

The public visitor publisher and temporary Live ChatGPT QA path build an **unsigned Release APK**, then call `scripts/sign-disposable-qa.sh <unsigned-apk> <signed-apk>`. The signer ZIP-aligns the original unsigned release, signs it once with disposable Source-only V1/V2/V3 signing material, and verifies the final distributable APK.

`Source check` now exercises this disposable Release signing path in CI. The Live ChatGPT and V1/V2 diagnostic scripts no longer re-sign `app-debug.apk`, and their version checks are read from the current Gradle identity instead of historical hard-coded values.

| Surface | Available in the current open-source implementation | Configuration / limits |
| --- | --- | --- |
| Web / PWA | Conversation UI, streaming/SSE paths, per-window context settings, visible context/tool records, owner/visitor separation, memory/world-book workspaces, attachments | Reality is intentionally limited to date, local time, and next-seven-days calendar context; weather/device reads are not part of the PWA send path |
| Android Native | Jetpack Compose chat/Daily/calendar/library/memory surfaces, local ChatGPT connection, Reality device fields, themes including Cream Paper | `0.2.15-source`, `versionCode=17`; visitor builds are Source-only and disposable-signed |
| Owner calendar | Entries, notes, edits/deletion and recurrence | Requires self-hosted backend/storage; calendar can feed the next seven days into Reality Context when selected |
| Tidal Library | TXT/EPUB imports, shelf/cover, chapter/page navigation, progress, highlights, annotations, reader options | PWA and Native use the same backend contracts when pointed at the same host |
| Voice clips | Message-linked speech clip controls, playback and authorized generation endpoints | Actual generation needs self-hosted `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` |
| Exports / tools | Source JSON/HTML snapshot and authorized calendar/reading/voice/tool routes | Unconfigured integrations remain visibly unavailable; private production credentials are not distributed |

Historical implementation milestones belong in [source release history](docs/SOURCE_RELEASE_HISTORY.md), not in the current-status section.

## Android APK downloads and history

**Download the current public APK:** [Latest Source Native Visitor QA release](../../releases/latest) — the release page contains the current APK and a `SHA256SUMS.txt` checksum file. This link automatically follows new public visitor releases; do **not** use an APK from an old walkthrough.

- **Visitor APK:** enter `123456` to inspect the Native interface offline. This published package has an intentionally non-routable backend and cannot connect to your ChatGPT account.
- **Live ChatGPT test:** fork the repository, enable Actions and run [Live ChatGPT Test](.github/workflows/source-live-chatgpt-test.yml). It builds a fresh temporary APK and backend; fetch the package and random login password from that run's Draft Release during its test window.
- **Persistent self-hosting:** configure your own Pages/D1 backend, Android API URL and signing setup. See [deployment instructions](docs/SOURCE_DEMO_PWA_APK.md) and [configuration](#configuration). Neither private production credentials nor signing keys are shipped.

**Version clarity:** the source tree is currently `0.2.15-source` (`versionCode=17`), whereas [Latest Releases](../../releases/latest) is the authoritative download target as newer builds are published. Each visitor QA build uses disposable signing material and normally cannot be installed as an in-place update over a separately signed QA APK. Uninstall only `com.elementeracoast.source` if Android reports a signing conflict; this does not affect any separately packaged private installation.

**Older builds are not recommended downloads.** The `0.2.6` through `0.2.9` visitor packages are superseded; `0.2.9` was reported rejected by a phone installer and withdrawn. Earlier `0.2.2` Quick Tunnel demos and the original `v0.1-source` preview are historical milestones, not current installation instructions; the `v0.1-source` release is no longer available on the Releases page. Keep their implementation notes in [source release history](docs/SOURCE_RELEASE_HISTORY.md), not in the current APK download instructions.

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
- published Android assets include historical and temporary signed QA builds, not a permanent production service; their embedded test backends expire;
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

The repository began with `v0.1-source`; the current Android source identity is `0.2.15-source` (`versionCode=17`), with the PWA and backend continuing to evolve independently under the same source tree.

It remains a reference implementation rather than a mature framework or hosted product. Current feature status is documented above; older milestones and superseded QA flows are kept in [docs/SOURCE_RELEASE_HISTORY.md](docs/SOURCE_RELEASE_HISTORY.md).

## License

MIT License.

See `LICENSE`.
