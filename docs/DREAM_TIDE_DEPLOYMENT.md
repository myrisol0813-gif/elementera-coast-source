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
Native local execution is separate from Pages; the server does not handle subscription-model autonomous execution.
No archive restore path may automatically restore execution authorization.


## Online Worker setup checklist (operator, not APK)

The following is a deployment template, not a configured production Worker.
From the Web repository root (apps/web in Tideloom), prepare a separate local Wrangler configuration
beside the Worker entrypoint. Substitute the actual Worker name and the D1
database name/ID already used by the intended Pages deployment. Do not
create an empty replacement database or commit a real credential.

```toml
name = "REPLACE_WITH_WORKER_NAME"
main = "dream-tide-worker.js"
compatibility_date = "2026-11-27"
workers_dev = false

[[d1_databases]]
binding = "COAST_CHAT_DB"
database_name = "REPLACE_WITH_EXISTING_D1_NAME"
database_id = "REPLACE_WITH_EXISTING_D1_ID"

[vars]
COAST_DREAM_TIDE_ENABLED = "false"
COAST_DREAM_TIDE_SCHEDULER = "false"
COAST_DREAM_TIDE_MAX_RUNS_PER_TICK = "1"

[triggers]
crons = []
```

Save as a local, untracked configuration under workers/. The Worker uses
its own encrypted OPENROUTER_API_KEY secret (Pages secrets are not
automatically inherited). First verify the intended D1 binding, then run
Wrangler deploy --dry-run with that explicit configuration. Register the
actual Cron cadence and change the two availability variables on both
Pages and the Worker only as a deliberate operator action after acceptance.
The proposed initial per-tick cap of 1 is an editable deployment choice,
not a restriction on a window's own model/tool settings. Re-deploy both
environments as needed; the window still requires explicit authorization.

For a no-inference shutdown, disable the Worker execution/scheduler flags
and remove its Cron trigger; disable Pages authorization availability too.
A previously armed window can resume if deployment is re-enabled, so
revoke its window authorization separately when permanent withdrawal is
wanted. Never configure a ChatGPT plan token on this Worker. The Android
local build flags have no effect on these cloud settings.

The scheduled handler uses a live clock throughout the tick, including
heartbeats and the quiet-time recheck before each later window. An initial
timestamp alone must not be propagated as a frozen execution clock.

## Android local execution — available, explicitly authorized per window

The local executor uses the existing encrypted device provider catalog. It sends
only to the exact configured local:provider/model. It does not use the cloud
transport, OAuth subscription inference, or a fallback provider. The
COAST_LOCAL_DREAM_EXECUTION_ENABLED Gradle property defaults to true for
feature availability; a diagnostic build can override it to false. No window
is armed by that property. Actual device acceptance remains required.

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
other write/media tools still require their own provenance and acceptance. No scheduled execution occurs without an explicitly armed local window.


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
reserved tool event. Execution still requires explicit per-window authorization. Both executors default to one voice attempt per activity, configurable by the owner within the general tool budget. No real speech provider is called by the fixture tests. Neither path
should promise a hard monetary cap or refund on cancellation.

## Independent image — disabled until acceptance

The image permission (execution.allowImage) is independent of voice. Web needs
the media deployment gate and configured, selected OpenRouter image model;
native needs the existing local model-write switch and configured on-device
OpenRouter image model. Both snapshot the selection, validate the catalog before
generation, reserve the activity tool, refuse saves after revocation and
default to one image attempt per activity (owner-configurable). Original bytes are in the existing
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

## Owner media budgets

Both window settings expose voiceLimit and imageLimit (integer 0–128,
default 1 for old drafts). Each is subject to its separate authorization and
the total tool budget. Zero disables the tool. The ledger counts reservations,
not just successful outputs, so failed or interrupted attempts consume their
allowance. This is not a currency cap. Normal chat media limits are unchanged.

## Pending memory proposals

The independent allowMemoryCandidate flag defaults false. Local execution
also requires the ordinary window write permission. dream_memory_candidate
accepts title (1–120), content (1–2000), destination (memory or seed).
It inserts into the existing pending pocket store with source_type=dream_tide,
real claim/step/call provenance, no synthetic turn, and a stable pocket ID.
A content fingerprint suppresses duplicates, including previously discarded
or confirmed candidates, without updating the existing record. It cannot
promote a candidate or modify formal memory; only the usual owner confirmation
flow can do that. Native and cloud fixtures use mocked inference. Portable
pocket records accept the new provenance type; full cross-workspace acceptance
remains pending.

## Subscription-route boundary

Native account inference currently uses a separate Responses transport and
its sequence token budget is explicitly soft; the API wake executor assumes
an exact selected provider and a caller-set output cap. Do not silently send
subscription model IDs to an API provider, reuse a chat turn as a wake, or
convert an API wake authorization into subscription background permission.
Native subscription wake has a separate local transport and grant. Actual-account
and background behavior remain subject to provider eligibility and device acceptance. No account token is copied into cloud
settings or archives.

## Activity and original navigation

The owner activity list accepts a media_id filter. It matches the actual
historical tool name, claim, step and call index within the owning window,
not a guessed chat turn or a user-supplied activity ID. Both basic media and
favorites can open the matching activity. Web uses the scoped activity page;
Native uses a read-only activity detail dialog. Activity receipts with the
exact stable media ID link back to the original; Native reuses the existing
audio player and a bounded sampled image preview on the same workspace
transport. Missing originals are not regenerated. This is owner-facing
navigation, not automatic model vision readback. Interrupted saves without a
settled receipt can still be traced from the original to its activity.

## Optional autonomous image readback

The independent allowImageReadback flag defaults false. A successful image
save is not delivery. Only the current activity's newly saved original may
be read back, only into the same exact chat route, when the provider catalog
explicitly reports image input support. Native also checks current window
write permission before continuation. The next request receives a labelled
system-transferred image envelope (wire user role, never stored as a human
message). At most 8 MiB total original bytes per continuation, estimated
2048 tokens per image, cumulative token and reported context budget checked;
no repeated pixel injection in later requests. Durable step receipts include
only original IDs and accepted/unconfirmed response status, not base64,
prompt, or claims of visual comprehension. Insufficient budget stops the
continuation without regenerating or removing saved originals. Old drafts
default off; archive import still disables wake. Offline fixtures cover
explicit opt-in, known/unknown vision, budget, exact original pixels, and
one-shot transport. Real provider compatibility requires later acceptance.

## Cross-workspace migration acceptance

The source archive preserves the historical claim, steps, tool receipts,
notes, replies, independent media originals and pending memory candidates.
Cloud export rejects independent originals while the activity is running
and verifies media ownership against the terminal activity. Cloud and Native
candidate export/import verify the candidate ID, destination, window, model,
claim and tool indices against its recorded activity. A candidate with a
missing or mismatched activity cannot be silently restored as a genuine
proposal. Native restores the chat and selected modules in its existing
atomic transaction; cloud restores chat/media as a group, then memory and
favorites through their existing dependency-aware record restore. No import
arms the schedule or replays providers. The combined fixtures exercise both
workspace wire shapes and byte preservation; they are not a live network or
device round-trip test. Retain same-edition constraints and conflict refusal.

## Native ChatGPT plan transport — local, independently authorized

Official SIWC preview permits eligible Responses requests using an explicitly
consented account's plan allowance. See https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations and https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery .
The native plan model route is chatgpt-plan:<catalog slug>, separate from
local API-key providers. The new protocol and single-shot SSE transport
require current account/client registration, the exact window and grant
revision, both direct-use scopes, a matching account model catalog, an
explicit soft-budget acceptance and a bounded request count. It uses the
public HTTPS Responses endpoint, store:false and stream:true, namespaced
Coast function definitions, explicit developer invitation and stateless
continuation with exact call IDs. Unsupported background, max_output_tokens,
max_tool_calls and previous_response_id fields are absent. The in-memory
session checks estimated input, remaining reported usage and durable
reservation callback before transmission. Unknown usage or failed request
stops the session; no automatic billing-route fallback, retry or claim of
USD cost. Pixels are transient and reasoning items never enter the archive.
Shared in-process credential mutex serializes refresh across repositories.

The Native scheduler and common activity executor are now wired behind a
separate, default-true COAST_LOCAL_DREAM_PLAN_EXECUTION_ENABLED build
property, in addition to the ordinary local execution gate. Availability does
not arm a window or confer a grant; both properties can be overridden for
restricted or diagnostic builds. A local nonportable grant is bound to the window revision,
exact model slug, account/client/host and connection epoch (hashed identity),
with an explicitly accepted soft budget and independently chosen 1–129
request cap. The last permitted request has no tools. Each request and tool
uses the existing durable claim and reservation, no alternate API billing
route. Fresh sign-in and disconnection invalidate the connection epoch;
revoking or editing the window invalidates its grant. A quota error,
unavailable usage or terminal authorization restriction pauses old grants
for that connection, including other windows; explicit reauthorization of
one window does not restore the others. Status and usage link
https://chatgpt.com/settings/usage are shown in the Native settings sheet.
The catalog is refreshed before each autonomous activity. Unknown plan
vision metadata means the saved image remains in the library, without pixel
readback on this route. No OAuth token, grant, opaque reasoning or raw
request is included in portable archives. Grant restoration is prohibited.

The official docs support eligible Responses calls for open-source and
locally hosted apps, including user-consented plan use and offline token
refresh. They do not explicitly certify this app's unattended scheduling
or remotely hosted edition. Treat unattended use as experimental; provider eligibility and applicable
terms still govern each request. An actual-account test is pending. No live provider calls
were made by development fixtures. The cloud route still rejects plan
models; a native online-workspace foreground plan login is not a server
background authorization. API-key wake remains separate.
