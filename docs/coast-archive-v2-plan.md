# Coast archive: offline reader and full restore boundary

## Implemented in this change (subject to CI and real-device verification)
- Two primary export rows and one import row. Keep the V1 export/import path inside the compatibility section until the replacement can read and restore everything it exports.
- The online offline HTML ZIP reads the existing full archive API, preserves available binary originals in generated media paths, has a page per chat with all branches, separate pages for other modules, and a manifest with missing media and excluded modules. It is a read-only archive, not a restore package.
- Native local mode only reads modules actually implemented on the device; it cannot export modules or media it does not store. Current full JSON remains a backup, not a complete restore contract.
- Binary payloads read from authorized canonical storage are not passed through text clipping/redaction. Metadata remains redacted. Do not export credentials or visitor private bodies.
- The current API still materializes the JSON/Base64 response; ZIP output does not remove this bottleneck. Browser ZIP32 has a 4 GiB format bound and 65,535 entries, practical memory limits can be much lower. Native writes ZIP entries to the selected output stream but loads the existing archive JSON first.

## Next construction: one recoverable archive V2
Use a versioned manifest, paged/streamed module records, binary objects stored once by content digest and references mapped to original stable IDs. Both portable restore ZIP and offline HTML ZIP consume the same collection protocol. Preserve existing V1 reader and make V2 restore explicit. Do not claim recovery of unknown or missing originals. Include each supported owner's actual data and historical records, including memories, seeds/pockets, portraits/revisions, worldbook, soil/snapshots, chats/variants/receipts, cross-window references, calendar, daily/likes/comments, attachment/voice/media originals, library/books/annotations, model and non-secret appearance settings, tool and other supported history. Exclude auth secrets, provider credentials, and sealed visitor content. Enumerate omitted/unavailable modules and pagination limits; no silent truncation.

Cloud staging: authenticated import session, bounded chunks and individually verified binary objects, durable resume/cancel, idempotent manifest, preview conflicts and dependency closure, atomic publication of a verified generation or explicitly transactional per-module commits with a visible commit report. Never increase request body or SQL batch limits blindly; D1/R2/storage quotas, transaction constraints, device free space and safe unpacking determine actual limits. Validate paths, duplicate IDs, lengths, digests, expanded ZIP limits, compression ratios, mime and references; preserve destination data by default. Start with attachment/snapshot support, then remaining modules, then end-to-end all-module and multi-GB tests on disposable data. Do not remove compatibility export until V2 roundtrip tests pass.

## Acceptance
- Export HTML ZIP from each mode/edition, unzip as a folder, open index.html without network, browse multiple variants, display images and play voice files; compare bytes, ensure missing media appears in manifest and no script injection.
- Verify existing V1 import/export is still available and does not overwrite destination data.
- Verify stable Android signing and PWA cache version before release.
