# Coast Vault / 拾潮 — draft contract

This describes feature-branch code, **not** a deployed service.

## Concepts

The basic library is a read-only index of media already stored on the host's chat backend. It currently reads `chat_attachments` and `coast_voice_clips` using the authenticated owner session. Images, generated audio and file attachments are visible without needing to click Favorite. Text and conversation snapshots are not copied into this basic media index.

Treasures / 拾潮 is a distinct, user-selected collection of text excerpts and media references. Each entry stores a stable source identifier, optional paragraph selections, a user note, and creation/update time. Cancelling a treasure does not delete the original media. Existing assistant favorite flags can be scanned first, then migrated only after an explicit confirmation using a bounded, repeatable routine.

## HTTP contract (all routes authenticated and owner-scoped)

- `GET /api/coast-vault/media?kind=all|image|audio|file&q=...&cursor=...`: returns a page of persisted media, provenance and bookmark state. This is not an arbitrary database file browser.
- `GET /api/coast-vault/treasures?kind=all|text|image|audio|file&q=...&cursor=...`: search saved text and notes.
- `POST /api/coast-vault/treasures`: store a known conversation media ID, or a verified chat message ID with optional paragraph indices and note. Reject missing originals; do not fabricate content.
- `PATCH /api/coast-vault/treasures/:id`: update the note.
- `DELETE /api/coast-vault/treasures/:id`: remove one favorite link only, leaving original chat/attachment untouched.
- `GET /api/coast-vault/legacy-hearts`: read-only counts for one bounded batch of old heart flags; follow `next_cursor`.
- `POST /api/coast-vault/legacy-hearts`: requires `confirm: true` and processes one idempotent batch. It does not clear existing chat flags.
- `GET /api/chat/search?q=...&cursor=...`: bounded search of title and user/assistant message text, including message-variant IDs. Search is server-side and must never automatically enter model context.

The additive `coast_vault_treasures` table is created only in a host that has configured an authorized D1 binding. The exact migration must be approved and backed up before publishing against real data. Rolling back code does **not** revert D1 data.

## Known gaps in draft branch

The existing message-row heart UI is not yet connected to the new multi-item selection sheet; the Native sidebar has not yet adopted exact-message full-text navigation. Favorites of historical thought-soil snapshots, comprehensive JSON+HTML exports, deleted-original media retention, and any media held only by non-chat modules remain out of scope for the first PR iteration. The basic library only indexes media that actually exists in the host's canonical tables.

The server contains no new automatic memory/context injection for this collection. Users can search it, but the model has no general background right to read it; a separate permissioned two-step tool contract must be added before claiming model recall support.

## Safety and acceptance

Never commit real credentials, production origins, private message data, signed application identity or personal avatar/media bytes to a public repository. Verify current live database state separately. Before release, run the Web test suite and the Android unit/build checks; open Basic Media and Treasures in PWA and Native, test search/notes/favorite cancellation/re-favoriting, and check both the presence of old records and correctness of precise source references. CI-green alone is not end-user acceptance.
