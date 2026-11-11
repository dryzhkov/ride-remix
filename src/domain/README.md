# Domain

`schemas.ts` defines strict version-1 drill revisions, decks, sessions, results, and recovery archives with Zod. Focus and equipment use stable codes; questionnaire `v1` stores the optional `feel` answer. Unknown versions and fields are rejected rather than silently discarded. Built-in drill IDs must be stable UUIDs assigned by the content pipeline.

`repository.ts` defines the practice persistence interface. UI/application flows depend on this interface, not IndexedDB. Server account, login-token, and authentication-session persistence belongs to task 7.

Decks embed complete revisions. Sessions embed an immutable deck snapshot. Archives check result references, setup snapshots, entry uniqueness, one active session, and agreement between saved results and session position. No history logic depends on mutable library content.
