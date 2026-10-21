# Original library UI and exports · source sync · 2026-10-21

## Included
- Full original Tidal Library reader, shelf, cover picker, highlight/annotation/reflection screens and TXT/text-only EPUB importer.
- Original `library.css` copied without any CSS rewriting.
- Same owner-only backend with non-destructive source-instance library tables and no seeded books, chapters, notes, covers or reading history.
- Public-source actor label changes only: `owner` and `assistant`, instead of private personal identities.
- Calendar + library included in V1 JSON snapshot, full JSON archive, and HTML export. Exported archive contents must be protected by the owner.
- Frontend explicitly displays library limits; backend still provides `LIBRARY_LIMITS` to clients.

## Boundaries and deliberate exclusions
- Do not publish any actual private books, imported documents, illustrations, recorded voice or user-created annotations.
- No production origins, private app credentials, signing keys, deployment chain, personal ElevenLabs voice ID, or private MCP tool registration.
- The Android source and native APK are unchanged; no APK or release update is made in this batch.
- Old calendar legacy APIs remain retired.
- Source PWA cache: `coast-source-app-02` → `coast-source-app-03`.

## Data behavior
- New source installations initialize their own library tables on first use. Existing source data is not wiped.
- Source storage extends its own database using `CREATE TABLE IF NOT EXISTS` and targeted additive columns only; no destructive schema migration is run.
- Export now includes book contents, covers and notes **in the user's downloaded archive**, not in the git repository.
- Supported text-only EPUB is not a full EPUB rendering engine; DRM, complex layout and embedded images are unsupported.

## Acceptance
1. Open source-edition PWA and look for "潮中书房" in sidebar. Visually compare its shelves/reader to the original; no replacement component should appear.
2. Create a small synthetic TXT or text-only EPUB and import it. Open chapters, swipe pages and change theme / font size.
3. Highlight a sentence; add, edit, delete notes and reflections; upload a sample cover.
4. Verify reading position after closing and reopening a book.
5. Export V1 snapshot, full archive and global HTML. Check that the synthetic calendar entry, book text and notes appear. Do not publicly share personal exports.
6. Delete the sample book and verify the shelf updates.
7. Run the source CI tests: web tests and Android regression build; inspect privacy delta before merge.
