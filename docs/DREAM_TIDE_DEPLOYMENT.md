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


## Android local execution — experimental, disabled in normal builds

The local executor uses the existing encrypted device provider catalog. It sends
only to the exact configured local:provider/model. It does not use the cloud
transport, OAuth subscription inference, or a fallback provider. The
COAST_LOCAL_DREAM_EXECUTION_ENABLED Gradle property defaults to false; do not
set it true for a public or private release before device acceptance.

The separate unique WorkManager periodic job is network-constrained (15-minute
minimum interval). Android may delay or interrupt execution. Power-off, force
stop, network loss, background restrictions, and a switch away from the local
workspace can prevent a wake. It never promises exact-time delivery. At most one
eligible local window is dispatched in a tick; consumed slots are not replayed.
The first implementation conservatively shares one process-wide generation
lease with ordinary chat, regenerate, retry, edited-message generation, and
manual image generation. The window-specific permission, schedule, draft,
history and receipts stay separate. Before opening the gate, review the UX of
this lease and other independent model-generation surfaces.

Every provider call and tool call has a persisted claim before execution;
process recovery marks interrupted claims, and never automatically retries
them. Explicit revocation invalidates the revision and cancels live work.
Unknown usage prevents additional model requests; a remaining claimed step
means billing is unconfirmed. The local input estimate is not a hard provider
cost limit. Window history, optional autonomous note and extra appointment are implemented.
Explicit opt-in groups also reuse ordinary registered web, library, confirmed
memory search, calendar and collection tools. Library creation is fenced at the
actual write; no edit/delete or fake turn. Core custom instructions, portraits,
window message count and separately authorized reality fields can be injected;
server wakes do not claim device step or usage data. Subscription models and
other write/media tools still require their own provenance and acceptance. No scheduled execution occurs in the normal build.


## Independent online voice — additional disabled gate

The online voice path additionally requires COAST_DREAM_MEDIA_ENABLED=true,
a configured ElevenLabs provider, and per-window execution.allowVoice=true.
Leave the deployment gate unset: the user-facing permission switch, native
local parity and full archive/restore acceptance are not finished. This code
does not enable a deployment or perform a provider call in CI. The existing
voice store holds the real bytes with source=dream_tide, stable activity-derived
clip ID and null chat turn/message IDs. A single D1 batch fences metadata
and chunks against the still-authorized tool claim. A saved claim is not
generated again. Revocation during a provider call can still incur provider
charges even when saving is refused; do not automatically retry. Separate
voice/media costs are not included in reported chat-provider token costs.
