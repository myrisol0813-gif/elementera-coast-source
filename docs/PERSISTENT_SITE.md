# Persistent Source site

The public Source repository can publish a **separate, long-lived** Cloudflare Pages instance. This is not the private application, and it is not the short-lived Quick Tunnel QA environment.

The deployment is prepared in `.github/workflows/source-persistent-site.yml`. It is **opt-in** and will not deploy until its GitHub variable is explicitly enabled. Never point it at an existing private Pages project or database.

## One-time Cloudflare setup

1. Create a **new Cloudflare Pages project** using Direct Upload (Wrangler), with a name ending in `-site` (example: `elementera-coast-source-site`) and production branch `main`. Do not attach the private application repository.
2. Create a **new, empty D1 database** used only by this Source site. Under the new Pages project's **Settings → Bindings**, bind it as exactly `COAST_CHAT_DB` for Production. Never reuse another site's D1 database. Set up a separate Preview binding if previews will be used.
3. Under the site's **Settings → Variables and Secrets**, configure Production secrets:
   - `COAST_PASSWORD_HASH`: SHA-256 hex of a newly chosen, long, unique site-owner password.
   - `COAST_SESSION_SECRET`: at least 32 random characters, unrelated to any other Coast installation.
   - **Do not configure** `COAST_PREVIEW_PASSWORD_HINT`; do not use demo password `123456` as the site-owner password.
   - Optional provider/API credentials remain **unset** until individually reviewed. Never put them in client assets.
4. Do not import private memories, personal archives, old chat data, production keys, API credentials, or shared production storage into this database.

Generate the secret and password hash on your own trusted computer. Example (do not commit, paste, or publish the resulting values):

```bash
openssl rand -hex 32
printf '%s' 'CHOOSE_A_NEW_LONG_UNIQUE_PASSWORD' | sha256sum | cut -d ' ' -f 1
```

## One-time GitHub setup

In the Source repository, open **Settings → Secrets and variables → Actions**.

Add **repository variables**:
- `COAST_SOURCE_SITE_ENABLED` = `true` (set this **last**, only after the Cloudflare configuration is finished).
- `COAST_SOURCE_SITE_PROJECT` = the separate Pages project name ending in `-site`.

Add **repository secrets**:
- `COAST_SOURCE_SITE_CF_ACCOUNT_ID` = Cloudflare account ID.
- `COAST_SOURCE_SITE_CF_API_TOKEN` = a dedicated Cloudflare API token with Cloudflare Pages Edit permission, scoped as narrowly as possible.

Do not reuse private-site credentials. No live key is stored in this repository.

## Publishing and future updates

Merge the persistent-site workflow into `main`. Enable the variables/secrets above, then run **Actions → Deploy persistent Source site → Run workflow** once from `main`.

The workflow verifies the public Source web tests and source-safety audit, deploys `apps/web/elementera-mcp/deploy-pages` **with** `apps/web/functions`, and checks the deployment URL. The smoke check requires:
- `GET /login` = **200** with no public preview-password hint;
- unauthenticated `GET /api/calendar/entries` = **401**;
- unauthenticated `GET /public/app.js` = **401**.

Once enabled, a successful **Source check** from a push to `main` triggers the next deployment automatically. Pull-request and failed checks do not deploy. A deployment is not proof that every D1-backed application route works; complete the authenticated acceptance steps below.

The workflow writes the exact deployment URL into the GitHub Actions job summary. Cloudflare also provides a stable `https://PROJECT.pages.dev` hostname. A custom domain can be attached later without changing the code.

## First authenticated acceptance

1. Visit the stable Pages address using a private browser session; confirm the login page shows **no password hint**.
2. Confirm a wrong password is rejected and the unique owner password admits you.
3. From the authenticated UI, open the chat, calendar, library, memory and export surfaces; confirm data is empty in this **new** installation.
4. Add a harmless test calendar item or library note; refresh and confirm it persists in the dedicated D1 database. Remove it afterward.
5. Verify that unauthenticated browser sessions cannot fetch owner data or private assets.
6. Before sharing the public URL, review **visitor mailbox registration** and add suitable anti-abuse/rate limits. An owner password does not make public mailbox endpoints private.

## Boundaries and limitations

This Source application currently has an **owner-password gate** and a separate visitor mailbox; it does **not** provide independent owner accounts or per-user D1 isolation for arbitrary public signups. Do **not** advertise it as a multi-user SaaS.

The existing session-cookie design is long-lived. Use a unique high-entropy owner password, enable appropriate Cloudflare security controls, and review session revocation and login rate limiting before broad public exposure.

Cloudflare Pages/D1 credentials and the initial project, D1 binding, and runtime secrets must be configured in the Cloudflare/GitHub dashboards by an authorized account owner. A repository workflow cannot safely invent or recover them.

A green Source check is a code/test signal; actual cloud deployment and an authenticated D1 write/read test are separate milestones.
