# Elementera Coast Source

Elementera Coast Source is a **source-available, non-commercial, self-hosted long-term AI conversation workspace**. It is not an official hosted service, and it does not include the private deployment the architecture was derived from.

This repository contains the architecture of a house, not the private life once lived inside it.

这个仓库公开的是造房子的结构，不是屋里生活过的私人日记。

## Included in this source baseline

- Web/PWA shell and owner login
- long-term conversation windows
- source-safe OpenRouter chat core
- formal source context assembler
- model-decided provider-backed web search when supported
- image/file attachments for model input
- Visitor Mailbox
- Human Thought Chain / 人类思考链
- Turn Context Preview / 本轮上下文预览
- Conversation Note / 整理当前对话的纸条
- Active Thread / 当前活跃线索
- Memory Library / 记忆库
- Review Queue / 待确认区
- Worldbook / 世界书
- Dictionary / 词典
- Widgets / 小组件
- owner settings, themes and run settings
- Model Desk / 模型工作台
- Tool Call Log / 工具调用记录
- Dev Hands / 开发手 skeleton
- generic GitHub / Notion adapter contracts
- External Entry Messages / Common Room / MCP Room contracts
- source-only snapshot export
- Native Android Compose source skeleton

The public source does **not** include private data, a production deployment, private credentials, old production migrations, private visual assets, production OAuth, a formal APK updater, release signing, or private remote-execution wiring.

## License

Licensed under the **PolyForm Noncommercial License 1.0.0**. See `LICENSE`.

Permitted under the license terms include personal learning, research, non-commercial personal use, non-commercial self-hosting, modification, and forks.

Commercial use is not permitted, including resale, paid deployment, paid hosting, SaaS, commercial product integration, paid customization, advertising monetization, paid courses, or redistribution for revenue.

## Repository layout

- `apps/web` — static PWA + Cloudflare Pages Functions
- `apps/android` — Native Android Compose source skeleton
- `docs` — architecture, privacy, self-hosting, environment and limitations

There is currently no root `package.json` and no JavaScript build step. The Web source is served directly as a Cloudflare Pages static + Functions project.

## Local Web / PWA preview

Requirements:

- Node.js with `npx`
- a current Wrangler CLI
- a self-hosted Cloudflare D1 database binding named `COAST_CHAT_DB`

From the repository root:

```bash
cp .env.example .dev.vars

npx wrangler pages dev apps/web \
  --env-file .dev.vars \
  --d1 COAST_CHAT_DB=<YOUR_D1_DATABASE_ID>
```

Use your own D1 database. Do not point the source project at private or production resources.

The source stores create their own tables lazily with `CREATE TABLE IF NOT EXISTS`; no old production migration is required.

See `docs/SELF_HOSTING.md` and `docs/ENVIRONMENT.md`.

## Environment

Required:

- `SOURCE_ACCESS_PASSWORD` — source deployment access password; minimum 8 characters
- `COAST_SESSION_SECRET` — session HMAC secret; minimum 32 characters
- `COAST_CHAT_DB` — D1 binding name used by the application; configure as a D1 binding, not a secret string

Optional:

- `OPENROUTER_API_KEY` — OpenRouter provider key
- `OPENROUTER_MODEL` — optional default model id

Without `OPENROUTER_API_KEY`, the shell and source-backed UI/storage surfaces can still be inspected, while model generation returns the explicit error `OpenRouter key 未配置。`.

## OpenRouter

No provider key is included in this repository. Configure your own key.

`OPENROUTER_MODEL` may be set to a model id accepted by the source catalog. A model selected explicitly in the UI takes precedence over the environment default.

Provider-backed web search depends on the selected model/provider supporting the exposed tool.

## PWA deployment

Use `apps/web` as the Cloudflare Pages static asset + Functions root. Configure a new self-hosted Pages project, a new D1 binding named `COAST_CHAT_DB`, and your own secrets/variables.

No public preview URL or production domain is committed to this repository.

## Native Android status

Open `apps/android` as the Android project.

Source identity is fixed to:

```text
applicationId = com.elementeracoast.source
versionCode = 1
versionName = 0.1.0-source
```

Native is currently a **source skeleton**. It does not include release signing, a production updater, private launcher assets, or a production URL.

The repository currently does not ship a Gradle Wrapper, so a clean-checkout debug APK build has not yet been reproducibly verified.

## Generic integration contracts

GitHub and Notion surfaces are generic adapter contracts / source UI skeletons. They contain no private production credentials and do not recreate the private deployment's remote-write chain.

## Documentation

- `docs/ARCHITECTURE.md`
- `docs/PRIVACY_MODEL.md`
- `docs/GLOSSARY.md`
- `docs/SELF_HOSTING.md`
- `docs/ENVIRONMENT.md`
- `docs/ROADMAP.md`
- `docs/KNOWN_LIMITATIONS.md`
- `docs/SOURCE_PREVIEW.md`
