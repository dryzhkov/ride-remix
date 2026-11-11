# Local repositories

`openPracticeRepository()` opens `ride-remix` IndexedDB version 1. The initial migration creates revisions, decks, sessions, and results stores. Future schema changes must increment the database version and migrate within `upgrade`; never clear existing stores to apply updates. A connection closes when another tab requests an upgrade.

The adapter validates reads and writes. Revisions are append-only; saving a changed revision under an existing revision ID fails. Save a new revision ID under the same logical drill ID to edit content. Saving a deck also persists all embedded revisions. Starting practice snapshots the saved deck and rejects a second active session.

All mutations use a single read/write transaction over the four stores, which serializes cross-tab writers. Result persistence and session advancement commit together. The first result for a session entry wins; repeated completion requests do not advance again. Ending early leaves remaining entries unattempted. Storage and validation errors reject promises so callers must display failure, not success.

`exportArchive()` returns a strict versioned JSON-compatible archive containing only practice data. Serialize it with `JSON.stringify`. It contains no credentials, email, publishing retries, or server state. `importArchive()` accepts parsed JSON, validates the entire archive before writing, and merges atomically by stable IDs. Its report lists `kind:id` strings in imported, skipped (identical), and conflicting (existing wins) arrays. Embedded revisions are collected automatically. An internally inconsistent archive is rejected.

Sessions and their results merge as a unit: if an existing snapshot/position/result differs, that session's incoming results are also rejected. An imported active session conflicts when a local active session exists. Conflicting revisions prevent dependent decks/sessions from being imported. Local data is never overwritten by recovery.

The V1 adapter reads all local records for validation during mutations. This favors correctness for the small local practice dataset; add indexed reads and incremental invariant checks if history size warrants it. `close()` releases the connection. Backup UI, storage-persistence prompts, and browser/device acceptance checks belong to task 9 and release verification.

`npm test` runs meaningful IndexedDB integration tests using fake-indexeddb, including concurrent writes, rollback, immutable snapshots, backup conflicts, and reopen preservation. These do not replace real Safari/Chrome release checks.
