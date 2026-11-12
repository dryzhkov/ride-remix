# Immutable snapshot sharing

Task 8 adds authenticated publishing and public read-only previews. App navigation mounts `SharedDeckScreen` at `/s/:id` and adds `ShareDeckButton` to saved decks. Authentication continues to grant publishing permission only; public previews and local saving require no account.

## Server contract and persistence

`POST /api/v1/shared-decks` requires a live account/session, the configured same-origin `Origin`, and `X-CSRF-Token`. The request is `{ requestId, payloadVersion: 1, deck }`. Strict shared runtime schemas reject history, publisher identity, internal metadata, unsupported versions, unknown fields, and malformed drill/deck data.

The service derives publisher identity from the session and saves an immutable snapshot. Public IDs contain 192 random bits. Responses contain the configured-origin URL, public ID, UTC creation timestamp, and payload version. `GET /api/v1/shared-decks/:id` returns the snapshot without account identity, request IDs, or practice history. Missing and operator-deleted snapshots return 404. All API reads/writes use no-store; installed saved copies, rather than cached API responses, are the offline source of truth.

`SharingStore` uses the existing persistent SQLite connection and an independent `sharing_migrations` ledger, currently version 1. `shared_decks` stores publisher ID, request ID, canonical SHA-256 payload hash, canonical JSON, byte count, and timestamp. A unique publisher/request constraint and immediate transaction serialize concurrent retries. Identical account/key/payload retries return the original publication; changed payload returns 409. A different account has a separate request-ID namespace. Publications have no automatic expiry, list, update, or rider delete API.

Operator deletion uses SQL over SSH:

```sql
DELETE FROM shared_decks WHERE id = 'PUBLIC_ID';
```

Deletion cannot remove recipients' downloaded copies. SQLite backup/restore must include this table and use the consistent database backup procedure established before release.

## Limits

`src/contracts/sharing.ts` defines a 128 KiB POST body limit, at most 30 entries, 200-character deck/drill titles, 500-character cues, 30 instructions of at most 4000 characters each, 20 setup details of at most 1000 characters, and 10 terrain requirements of at most 1000 characters. Durations and generation budgets must be positive whole minutes, capped at 1440. These caps apply independently, so the body limit can be reached before all individual text limits.

Defaults allow 10 publishing requests per account and 30 per IP per hour. Persistent buckets are shared with the authentication database. Requests, including retries and invalid snapshots, consume request-rate quota after authentication/CSRF checks. Storage is independently capped at 1000 publications/20 MiB per account and 10000 publications/200 MiB globally; identical retries consume no additional storage. `SharingOptions` and `defaultPublicationQuotas` define deployment/test configuration. Task 11 adds public-request admission and an explicit Fly trusted-peer client-IP policy. Configure and verify it using SECURITY_OPERATIONS.md. Arbitrary forwarded headers are ignored.

Oversized bodies return 413; invalid/unsupported content returns 422; account/IP request or storage quotas return 429; absent/expired sessions return 401 and revoked access returns 403. Publishing failure never deletes or changes the local deck. Logs record publication events without the custom payload or rider history.

## Client retries and copies

Publishing persists `{ requestId, payloadVersion, deck }` plus publisher account ID in a dedicated browser localStorage namespace before sending. It stores no cookie, CSRF token, email, or other credential. Failed/ambiguous requests reuse the exact immutable payload and ID across reloads. A freshly fetched session determines the account before each retry; account mismatch blocks replay until the rider explicitly starts a new publication. Starting a new publication or creating another link allocates a new request ID and snapshots the current local deck. Backup export excludes this localStorage namespace.

`repository.saveSharedDeck(deck, publicId)` saves an independent local deck and its embedded revisions in one IndexedDB transaction. A deterministic recipient copy UUID per public link prevents repeated saves from duplicating decks and preserves existing recipient edits. Entry IDs are new. Identical revisions deduplicate; a conflicting revision ID is remapped before insertion, so an incoming snapshot cannot overwrite existing local content. Failure rolls back the deck and all newly added revisions. No publisher identity or publication retry record enters the practice archive. A saved copy works independently of the server and remains readable after publication deletion.

Preview content renders as React text. No custom HTML is evaluated. Sharing a copy creates a new immutable publication and never changes the original link.

## Validation

Sharing HTTP/SQLite tests exercise authentication/CSRF, public retrieval/deletion, canonical retry idempotency, account isolation, strict provenance/history-field rejection, entry/text/version/body limits, request rates, storage count/byte boundaries, and database reopen preservation. Client/IndexedDB tests cover retry persistence, explicit account switching, unavailable storage, duplicate clicks, atomic rollback, revision collisions, repeat saves, and backup exclusion. Run `npm run check`; regenerate OpenAPI using `npm run contracts:generate` after contract edits.

Live authenticated browser sharing, direct-link preview/save, and airplane-mode acceptance remain integrated release checks.
