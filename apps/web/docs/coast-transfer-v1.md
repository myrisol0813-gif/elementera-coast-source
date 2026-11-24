# Unified Coast transfer v1

One portable envelope for local and cloud workspaces: elementera-coast-transfer v1, SHA-256 of the exact UTF-8 payload_json bytes. Origin edition and workspace describe provenance; the selected destination determines where records are saved. Daily identity fields on the wire are neutral (owner / model_partner); edition-specific conversion happens at the private boundary.

Supported modules: chat histories and variants, calendar and anniversaries, daily profile/moments/comments/diaries/individual likes, model profile. Preview is read-only; import preserves existing records and reports duplicate IDs and conflicting contents. Local import uses staged atomic generation switching and cloud import uses a single D1 batch. No implicit replacement or partial write. Select modules before import.

Limits: 64 MiB archive, 8 MiB cloud import request, 90 SQL statements per atomic cloud import. Larger requests are rejected; record-level splitting is not implemented. Chats containing attachments or cross-window snapshots are blocked; historical aggregate likes without actor/timestamp details cannot be reconstructed on cloud import. Unsupported or non-preservable fields are rejected rather than silently discarded. Earlier readable backups are not this restore format.

Excluded: original media/attachments, credentials, provider configuration, device appearance/settings, memory/worldbook, library, tool logs and other unsupported modules. The checksum detects corruption, not authenticity, and the archive is not encrypted. Keep it private.

Acceptance: use disposable chat/calendar/daily/profile records, export from local or cloud, preview into the other workspace, verify selected modules and destination, import, reimport for duplicate handling, confirm a same-ID conflict leaves destination untouched, and corrupt a copy to verify rejection. Do not test on irreplaceable production records. APK updates must retain the installed signing identity; do not uninstall an app with unexported local data.
