# Repository engineering requirements

These requirements apply to changes in this repository and their corresponding Native, PWA, local and online implementations where applicable.

## Persistence and portability

- When a feature creates durable data, settings, records, relationships or media, include its export and restore path in the same batch. Reuse the existing ZIP V2 recoverable archive and HTML reading export; do not add redundant export entrances.
- Preserve stable identifiers, provenance, dependencies, original media, revisions and conversation branches. Test export, isolated restore, read-back, duplicate/conflict handling and older archive compatibility.
- Do not replay transient execution tasks on restore. Unsent composer text remains device-local unless migration is separately specified. Never export secrets, authentication tokens or private connection credentials in ordinary archives.
- State explicit exclusions and limitations. Derived indexes may be rebuilt rather than archived.

## Actual model context and per-turn receipts

- Any new input source or tool result that actually reaches the model must be represented in the corresponding turn's existing context receipt (本轮桌面), including provenance, authorization, delivered content or an explicitly labeled safe preview, relevant limits, estimates and trimming.
- Distinguish available tools from actual calls, success from failure, candidates from confirmed documents, and material not delivered from delivered material. Never present a synthetic or omitted input as delivered.
- Bind asynchronous writes, tool receipts, reply variants and post-reply organization to their source conversation and turn, not the currently visible page. Preserve historical receipts through navigation, archive and restore.
- Do not inject ordinary UI state or unsent drafts into the model. Avoid unnecessary duplicate context, private data exposure and secret-bearing logs.
- Keep limits and settings consistent across surfaces, use existing authoritative contracts, and make real platform differences visible.

## Definition of done

For every applicable feature, verify the runtime path, persistence, ZIP/HTML export, isolated restoration, per-turn receipt, historical receipt and permission boundaries. Record automated checks and real-device/provider checks separately. If a requirement is not applicable or has not been verified, say so explicitly. Do not claim a successful CI run proves deployment or real-device behavior. Keep changes scoped; preserve existing application identities, signing and stored user data.
