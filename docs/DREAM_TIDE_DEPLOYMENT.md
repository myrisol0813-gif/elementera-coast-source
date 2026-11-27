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
Leave the deployment gate unset until acceptance: the per-window permission
switch and native voice execution are now wired, but native CI, actual-device
behavior and full archive/restore acceptance are not confirmed. This code
does not enable a deployment or perform a provider call in CI. The existing
voice store holds the real bytes with source=dream_tide, stable activity-derived
clip ID and null chat turn/message IDs. A single D1 batch fences metadata
and chunks against the still-authorized tool claim. A saved claim is not
generated again. Revocation during a provider call can still incur provider
charges even when saving is refused; do not automatically retry. Separate
voice/media costs are not included in reported chat-provider token costs.

Android uses the separately configured on-device ElevenLabs credential and
existing original-byte store. It requires both the ordinary local model-write
permission and the window's autonomous voice permission, an active claim and
reserved tool event. Normal build execution remains disabled. Both the native and online executors permit one voice attempt per activity,
within the general tool budget. No real speech provider is called by the fixture tests. Neither path
should promise a hard monetary cap or refund on cancellation.

## Independent image — disabled until acceptance

The image permission (execution.allowImage) is independent of voice. Web needs
the media deployment gate and configured, selected OpenRouter image model;
native needs the existing local model-write switch and configured on-device
OpenRouter image model. Both snapshot the selection, validate the catalog before
generation, reserve the activity tool, refuse saves after revocation and
attempt at most one image per activity. Original bytes are in the existing
attachment store, with att_dream_<claim>_<step>_<index> IDs, null turn_id,
activity tool receipt and no artificial human/assistant turn. Readback checks
original bytes but does not send image pixels to the autonomous chat model.
The model must not claim to have seen them. Archive attachment validation rejects
binding these IDs to chat history. Full cross-end archive roundtrip including
activity receipts and voice/image originals is still an acceptance item; the
image provider/model/cost metadata in the transient result is not a durable
separate billing record. No actual provider request or scheduler activation
is part of the fixture tests or this draft.

## Independent media archive ownership

Present autonomous voice/image originals now require a matching historical
activity and tool reservation during cloud restore and native export/restore.
A missing original is not itself an invalid historical receipt: selective
exports and deliberate deletion can preserve history without a binary. An
interrupted operation may have committed its original before settling its
receipt. Favorites of independent images keep assistant authorship and no
message ID. New fixture tests cover native ZIP restore and cloud staged
restore of images, audio and activity history, with the restored arm disabled.
Cross-workspace end-to-end fixture and actual-device acceptance remain separate.
