# Ride Remix · V1 Engineering Design

Status: approved by architect. Includes invite-only email login. Product scope follows [PRD](./PRD.md).

## Architecture

- TypeScript throughout; React + Vite mobile-first PWA.
- IndexedDB holds personal decks, custom drills, sessions, and results. All practice features run locally after initial setup.
- Node HTTP service serves the built frontend and a versioned JSON API. SQLite on a persistent Fly.io volume stores accounts, invitations, authentication records, and published snapshots. Practice data stays local.
- Deploy one container, one Machine, one region. Invite-only email magic-link accounts authorize publishing. No passwords, Google sign-in, cloud history, admin portal, AI, or history-based recommendations in V1.
- Keep UI, domain logic, local repositories, and HTTP client separate. Share runtime-validated API schemas between frontend and backend; neither imports the other's persistence implementation.

## Domain model

Use client-generated UUIDs, UTC timestamps, explicit schema versions, and stable built-in drill IDs. Content revisions are immutable; editing creates a new revision under the same logical ID.

| Entity | Fields and invariants |
| --- | --- |
| DrillRevision | `id`, `revisionId`, `origin` (built-in/custom), optional `derivedFrom`, title, cue, instructions, setup details, focus tags, required equipment, suggested duration, timestamps. Published rider content excludes clinic provenance. |
| Deck | `id`, title, generation inputs, ordered entries, timestamps. Each entry references an embedded drill revision and planned duration. Each logical drill occurs at most once. Editable and reusable. |
| Session | `id`, `deckId`, immutable deck snapshot, `startedAt`, `endedAt?`, status (active/completed/ended-early), current entry. At most one active session per device. |
| DrillResult | `id`, `sessionId`, entry ID, status (done/skipped), `completedAt`, questionnaire version, answers by question ID, setup snapshot. At most one result per session entry; no individual repetition counts or notes. |
| Account | Server-generated UUID, unique normalized email, status (invited/active/revoked), timestamps. Stable identity across browsers/devices; no username or password. |
| LoginToken | Server: token hash, account ID, expiry, consumed timestamp. Random single-use secret; never store the raw token. |
| AuthSession | Server: session-secret hash, account ID, creation/expiry/revocation timestamps. Multiple browser sessions per account; distinct from practice Session. |
| SharedDeck | Server: random public ID, publisher account ID, payload version, immutable deck snapshot, creation timestamp. Public payload excludes publisher identity, rider history, ratings, and internal source metadata. |

Local repositories own reads/writes; domain code does not depend on IndexedDB. Use transactions for session advancement and result persistence. Stable entity IDs and revision IDs support future ownership/sync mapping without treating the device as a user account. Future sync needs separate authenticated APIs and conflict rules; it is not implemented implicitly through sharing.

## Invitation and authentication

- Operator provisions an invited email through a CLI over SSH; no public registration or admin portal. The CLI issues a magic-link invitation through an email delivery provider behind a server-side adapter.
- Opening the link leads to a confirmation page; an explicit Continue action consumes the token atomically, activates the invited account, and creates an authenticated browser session. GET requests never consume tokens, so email scanners cannot redeem invitations automatically.
- Returning riders enter the same email on the login page to receive another magic link. Only invited/active accounts receive links. Always return the same generic response for unknown, revoked, and eligible addresses to avoid account enumeration.
- Login tokens expire after 15 minutes and are single-use. Expired invitations can be replaced through the same email login flow. Store only token hashes; never log links or tokens. Keep link pages free of third-party assets, use a no-referrer policy, and remove the secret from the address bar after redemption.
- Use opaque server-side sessions in a `Secure`, `HttpOnly`, `SameSite=Lax`, host-only cookie with a 30-day absolute expiry. Validate account/session status on protected requests. Logout revokes the current session; operator revocation disables all account sessions and outstanding login tokens.
- Protect cookie-authenticated writes with same-origin checks and CSRF tokens. Rate-limit login requests by IP and normalized email, token redemption by IP, and publishing by account plus IP. Cap email sends and payload/storage consumption independently of authentication.
- New device/browser or cleared cookies: sign in again through email. This restores publishing permission, not local decks/history. JSON import remains the V1 recovery path for practice data; no implicit ownership or merging of local records on login/logout.
- Local practice, deck building, public previews, and saving shared copies require no login. Expired sessions never interrupt offline practice; publishing prompts login and retains the local deck.
- Email provider selection and sender-domain setup are deployment choices. Provider credentials stay server-side. Authentication requires connectivity; no email delivery dependency in offline practice.

## Deck generation

- Inputs: time budget (default **20 minutes**), focus (default **All skills**, or multiple selected focuses), and cones/obstacle/incline, each **available / unavailable / unspecified**.
- Focus labels are Balance, Clutch / Throttle control, Body positioning, and Obstacle Crossing. Obstacle covers any usable obstacle, including rocks and logs. Isolated drills default to 10-minute practice blocks and combined drills to 15 minutes.
- Exclude drills requiring explicitly unavailable equipment. Unspecified equipment does not exclude drills; show their requirements before practice.
- Match any selected focus; All skills removes the focus filter. Select distinct eligible drills with randomized variety within the budget, using suggested durations. No history input.
- If no drill fits, show the constraint causing the empty result and let the rider adjust it; do not silently violate it. Unused budget is acceptable.
- Riders can swap, remove, reorder, and manually select drills to repeat from history. Swaps obey current filters; show updated planned time when manually editing.
- Rut and sidehill drills are manually selectable with terrain requirements displayed and excluded from automatic generation in V1.
- Persist generated entries immediately. Offline generation uses the installed library and local custom drills.

## Practice and history

Starting a deck creates a session snapshot; subsequent deck or library edits cannot rewrite it. Resume the existing active session, or end it before starting another.

Practice one drill freely, then select Done. Show one optional question: **How did it feel?**

| Stored answer | Label |
| --- | --- |
| `finding` | Still finding it |
| `consistent` | Getting consistent |
| `repeatable` | Repeatable today |

One tap records the answer and advances. Skip rating records completion without answers. Skipping the drill records a skipped result. Repetitions are not logged separately. Persist the current position and completion transactionally; duplicate taps must not create extra results. Ending early preserves completed results and leaves remaining entries unattempted.

Use questionnaire `v1`, question ID `feel`, and stable answer codes. Future questions receive stable IDs and explicit questionnaire versions; history renders answers using the recorded version rather than reinterpreting them.

History shows recent sessions, completed practice counts per logical drill, ratings over time, and recorded setup. Counts include done results, not skips. Repeat practice creates a new session. Existing snapshots remain readable if a drill is edited or deleted.

## FE/BE contract

JSON over HTTPS, prefix `/api/v1`. Maintain shared request/response schemas, fixtures, and an OpenAPI contract in the repository. Reject unsupported payload versions and invalid content with structured errors: `{ error: { code, message, fieldErrors? } }`.

| Endpoint | Contract |
| --- | --- |
| `POST /api/v1/auth/login-links` | `{ email }`; generic `202` response, conditionally sends a login link to an eligible account. Rate-limited; no public registration. |
| `POST /api/v1/auth/redeem` | `{ token }`; atomically consumes a valid token, sets session cookie, returns `{ account: { id, email }, csrfToken }`. Invalid/expired/used tokens return a generic `400`. |
| `GET /api/v1/auth/session` | Authenticated: `{ account: { id, email }, expiresAt, csrfToken }`; otherwise `401`. Private, never cached. |
| `POST /api/v1/auth/logout` | Authenticated + CSRF protected; revokes session, clears cookie, returns `204`. |
| `POST /api/v1/shared-decks` | Authenticated + CSRF protected. Request: `{ requestId, payloadVersion: 1, deck }`. Response `201`: `{ id, url, createdAt, payloadVersion: 1 }`. `deck` contains all drill content needed by the recipient. No local history or results accepted. Server derives publisher identity from the session. |
| `GET /api/v1/shared-decks/:id` | `200`: `{ id, createdAt, payloadVersion: 1, deck }`; missing or operator-deleted snapshots return `404`. |
| `GET /healthz` | Process health; no application data. |

Server generates cryptographically random, unguessable link IDs; possession grants public read access. No publication list, update, or public delete endpoint. Same account + `requestId` + payload returns the original publication; different payload under that account/key returns `409`. Store a canonical payload hash to enforce this. Client retains the request ID across retries. Missing/expired authentication returns `401`; revoked access returns `403`. Do not replay a pending publication under a different account without explicit rider action.

Limit POST body size, entry count, text lengths, and publishing request rate; return `413`, `422`, or `429` as appropriate. Final numeric limits are implementation configuration, covered by boundary tests. Render custom content as text, never arbitrary HTML. Snapshots persist indefinitely unless an operator deletes them directly in SQLite over SSH. No automatic expiration. Deleting a publication cannot remove downloaded copies.

Publishing and opening an unsaved link require connectivity. `/s/:id` previews the snapshot and offers Save a copy. Saving atomically imports a new local deck and its embedded drill revisions; recipient edits affect only that copy. Re-sharing creates a new snapshot/link. A saved copy works offline independently of server availability. Repeated saves must not duplicate drill revisions or overwrite existing local content.

## Offline, updates, and recovery

- Service worker precaches the application shell and versioned general drill library. SPA navigation fallback supports direct shared links. All API/auth requests are network-only; auth responses use `Cache-Control: no-store`. Local saved copies are the offline source of truth.
- Show offline readiness only after required assets and library are installed. All drill guides needed for practice are text/local assets; no offline video.
- Apply app/library updates between sessions. Migrate IndexedDB explicitly; preserve embedded revisions and session snapshots. Surface failed writes instead of displaying false success.
- Request persistent browser storage where supported. Browser clearing/eviction can still lose local data; provide JSON backup/restore and explain that local data does not sync.
- Export a versioned JSON archive of local decks, custom content, sessions, results, and referenced revisions. Exclude authentication credentials, account email, and publication retry secrets/internal state.
- Validate the full archive before import. Merge by stable ID in a transaction; identical records deduplicate, existing records win conflicts, and the import report lists imported/skipped/conflicting records. Preserve the current active session and report any imported active-session conflict rather than creating a second active session.

## Content pipeline

Convert [clinic reference](./olympia-clinic-drills.md) into a schema-validated, version-controlled general library. Deduplicate the repeated `collection` entry. Source contains 26 unique drill IDs, including unresolved material; do not infer missing techniques or publish unresolved cards.

Full card review is deferred by the architect. Implement with the provisional starter library in `DRILL_CARD_DRAFTS.md`: Cone Weave, Moving Outside-Peg Weight, and Collection. These support the core flow while content is polished later. Omit Collection's suspension/lift progression from the starter card. Other drafts can be added incrementally. Original schedule times and class durations are not practice-duration defaults. Clinic name, day labels, and source notes stay out of generated assets, screens, and shared payloads. Built-in library administration remains a repository change.

## Deployment and operations

Build a reproducible container and Fly configuration; mount SQLite outside the image. Explicitly configure one Machine to avoid independent databases on multiple volumes. Use migrations and SQLite transactions; verify a consistent backup and restore procedure before release. Fly volume snapshots supplement database backups. Operator deletion uses SQL, with no rider/admin UI.

Provide operator CLI commands to invite/reinvite an email and revoke an account, using the same validation and token generation as the service. Configure the email sender, public application origin, and provider secrets through deployment configuration. Never derive login-link origins from an untrusted request Host header. Database backups now contain email addresses and authentication hashes and must be access-restricted.

Log API failures and publication counts without full custom payloads or local practice data. A server outage blocks publishing and uncached link retrieval; installed local practice continues. This topology accepts temporary sharing downtime; multi-Machine availability requires a later storage design.

## Implementation tasks

| Order | Task | Completion criteria |
| --- | --- | --- |
| 1 | Scaffold app, server, shared contracts, CI | TypeScript build, lint/type checks, separate domain/repository boundaries, OpenAPI skeleton, production container. |
| 2 | Define schemas and local storage | Entity/revision schemas, IndexedDB migrations and repositories; atomic result/session updates; versioned backup merge with conflict report. |
| 3 | Prepare provisional starter content | Structure the three designated starter cards with durations/tags/instructions. Validate schemas and absence of internal provenance. Full card review and content expansion follow implementation. |
| 4 | Build Deck screen and generation | Optional inputs/defaults, three-state equipment, multi-focus filtering, budget selection, manual selection/swap/reorder, custom drill creation/copy/edit. |
| 5 | Build Practice screen | Session snapshot, single active session, resume, skip/end early, one-question optional rating, duplicate-write protection. |
| 6 | Build History screen | Sessions, counts, version-aware ratings and setup; create next deck and explicitly repeat drills. |
| 7 | Implement invite-only authentication | Account/token/session migrations, email adapter and operator CLI, invitation/login/confirmation UI, single-use redemption, session/logout/CSRF contracts, throttling and revocation. |
| 8 | Implement snapshot sharing | Authenticated publishing, public GET contract, account-scoped retry idempotency, validation/quotas, link preview and atomic local save. |
| 9 | Complete PWA and recovery | Installable manifest, shell/library caching, readiness/update states, offline flows, backup/restore UI; no auth caching or credentials in exports. |
| 10 | Deploy and validate | Fly volume/single-Machine configuration, email sender/provider setup, backup/restore check, focused integration and device acceptance tests. |
| 11 | Full card review and polish | After V1 implementation, review all 24 drafted cards with the architect in batches. Polish starter cards, resolve setup/technique gaps, confirm labels and durations, and expand the library. Revisit both deferred double-blip cards using the saved video reference. Track approval per card before adding reviewed content. |

Tasks 4–6 depend on 2 and provisional starter content from 3. Full card review does not block implementation. Task 7 depends on shared schemas and server storage; task 8 depends on 7; task 9 integrates the local flows; task 10 gates release.

## Release verification

- Unit checks: generation constraints, revision preservation, questionnaire versions, import conflicts, session state transitions.
- Integration checks: API schema compatibility, publication retry behavior, malformed/oversized payloads, rate limits, local transaction failures and schema migration preservation.
- Auth checks: invited-only issuance, generic login responses, token expiry/replay/concurrent redemption, scanner-safe GET, CSRF rejection, logout/expiry/revocation, email failure, and publishing quotas. Verify neither tokens nor email addresses leak into public snapshots, logs, caches, or exports.
- Browser acceptance: invited rider signs in and shares a deck containing a custom drill; friend previews and saves online without login; both reopen in airplane mode, practice, rate, and view independent histories; next ride repeats a drill in a new session.
- Recovery acceptance: sign in as the same account in a new browser and after clearing cookies; publishing access returns, local history does not. Restore history via JSON import. Verify session expiry does not block local practice.
- Verify refresh/resume mid-session, early finish/skips, unavailable equipment, offline fresh generation, backup/restore, direct link navigation, operator-deleted links, and app update between sessions. Exercise mobile Safari and Android Chrome on real devices before release.
