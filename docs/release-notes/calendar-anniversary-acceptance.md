# Calendar anniversary acceptance

Release candidate: Source 0.2.30 (code 32). This is an acceptance plan, not a record of completed phone tests.

1. Cover-install via the existing signed updater; confirm chats, account authorization, and provider settings are preserved.
2. Open the sidebar. The former sample counters are gone. Add your own record; no personal private defaults are preloaded.
3. Add elapsed, day-N and yearly records. Verify start date is day 1, day 100 from 2026-11-24 is 2027-03-03, and Feb 29 only recurs in leap years.
4. Edit from both entrances; verify the same record, including title and date, changes. Unpin retains the calendar record, delete removes it.
5. In local mode, reopen the app without network, verify records and sidebar remain. Switch to connected mode; no automatic cross-workspace copy. Test local snapshot contains calendar but excludes credentials.
6. Connected mode: Android and PWA show the same entries after refresh. Check old notes, normal events, and existing repeat rules remain.
7. Open the in-page question mark from chat, memory, model box, calendar, file library and settings. Read the README-linked guide and verify help closes without leaving the page.
8. Check app signing and SHA-256, and preserve previous stable releases. Do not publish until CI passes; verify backend deployment before connected Native acceptance.
