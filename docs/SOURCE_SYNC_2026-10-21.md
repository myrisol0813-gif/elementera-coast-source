# Public source sync · 2026-10-21

This selective reference update is not a copy of the private application tree.

## Included
- Generic owner-only Gregorian calendar: list/create/edit/delete events and notes; annual recurrence; isolated D1 records.
- Compact calendar view in the public-source PWA sidebar.
- Compact chat typography: 16px body, 1.58 line-height, 48px top bar, 56px composer.
- API tests for owner authorization, date validation, recurrence, editing and deletion.
- Source-specific cache version `coast-source-app-02`.

## Explicitly excluded
- Private prompts, personal memory, chat data, calendar events, worldbook, books, audio and media.
- Production site origins, signing and updater configuration, API tokens and secrets.
- The private book library, voice generation and MCP additions pending separate review.

## Validation notes
- Calendar author labels use generic `owner` / `assistant`, not private profiles.
- Writes retain the common same-origin check; all calendar endpoints require the owner session.
- The old, retired `/api/calendar/events` route remains retired.
- No private-history Git merge, production resources or personal data were used.

## Acceptance
Run `npm test` in `apps/web`, verify the source CI, and manually test the sidebar calendar (create, edit, repeat, delete), chat layout and keyboard before merging.
