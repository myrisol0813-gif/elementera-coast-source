# 梦醒潮 / Dream tide — deployment boundary

Current scope: Web/D1 internal executor, owner settings and notes/activity APIs,
PWA views, independent scheduled Worker entrypoint. This is not an enabled
production feature. Do not enable before full acceptance including native,
archive/restore, provider capability, and every relevant generation path.

## Explicit deployment

- Pages and the scheduled Worker must use the same **intended** COAST_CHAT_DB
  binding. Keep the existing owner session protection on Pages.
- Worker entrypoint: apps/web/workers/dream-tide-worker.js. A separate Worker
  deployment is required; Pages does not run this scheduled handler. The
  Worker HTTP handler always returns 404. No request-driven wake endpoint.
- Configure the existing server-side OpenRouter credential as a secret on the
  Worker (never in source, archive, browser or logs). The bound model must
  be supported by the actual provider and its allowed catalog.
- Both COAST_DREAM_TIDE_ENABLED and COAST_DREAM_TIDE_SCHEDULER must equal
  "true" on the intended deployments only after acceptance. Unset/false
  leaves execution disabled. Worker also requires explicit integer
  COAST_DREAM_TIDE_MAX_RUNS_PER_TICK (1–100).
- Select the Cron Trigger cadence deliberately on the separate Worker.
  Fixed local time means the first eligible tick at/after the chosen time,
  not guaranteed execution at the exact minute. Quiet time, active chat,
  provider limits and worker runtime quotas may defer or interrupt it.
- Owner must configure the window and explicitly authorize execution in the
  UI; saving settings alone creates a disabled draft. Revoking rotates the
  revision, stops future claims and signals an in-flight run to cancel.
- Do not automatically retry an interrupted provider request. Token input is
  estimated; only returned actual usage/cost is reported as such. This is
  not a hard monetary spending guarantee.

Do not activate or register Cron from the current Pages CI. No production
binding ID, credential, deployment name or trigger has been added here.
Native local and subscription-model autonomous execution are not implemented.
No archive restore path may automatically restore execution authorization.
