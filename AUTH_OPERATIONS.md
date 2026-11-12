# Invite-only authentication

Task 7 implements email sign-in for publishing permission. Local practice is independent of accounts; signing in or out never changes IndexedDB data. Task 11 adds manually approved email access requests and Turnstile. See [closed-beta security operations](./SECURITY_OPERATIONS.md) for configuration and the Fly SSH SQL approval runbook.

## Configuration

Copy `.env.example` values into your environment using your deployment or shell tooling. The service does not automatically load `.env` files. Set `PUBLIC_ORIGIN` to the precise frontend origin without a trailing slash. Production requires HTTPS. Local development defaults to `http://localhost:5173`; launch the Vite app there. Secure, host-only cookies remain enabled in development; current browsers permit secure cookies on localhost. Do not use a plain-HTTP LAN hostname for authentication.

`DATABASE_PATH` defaults to `data/ride-remix.sqlite`. Mount its parent directory on a persistent volume. Use one Machine. The initial migration creates accounts, login tokens, auth sessions, and rate-limit buckets. Version 2 adds the persistent login-delivery queue. Version 3 adds pending account status and CAPTCHA replay records while preserving existing identities, sessions, and shared snapshots. File-backed databases use WAL, foreign keys, a busy timeout, and mode 0600. Keep the parent directory and any SQLite backup/WAL files access-restricted. The container creates a writable `/app/data` directory, but deployment still needs the volume configuration in task 12.

Set `RESEND_API_KEY` and `EMAIL_FROM` together to enable the server-side Resend adapter; configure a verified sender/domain with the provider before deployment. Credentials never reach the frontend. Without both variables, the service remains usable for local practice, but email delivery is disabled. No console-link fallback logs secrets. Tests inject an in-memory inbox and never contact Resend.

## Operator commands

Development:

```sh
npm run auth -- invite rider@example.com
npm run auth -- reinvite rider@example.com
npm run auth -- revoke rider@example.com
```

Built container over SSH, with the same environment/database as the service:

```sh
node dist/server/auth/cli.js invite rider@example.com
node dist/server/auth/cli.js reinvite rider@example.com
node dist/server/auth/cli.js revoke rider@example.com
```

Invite/reinvite normalize the email and preserve identity. Reinviting a revoked account explicitly restores invited status; previously revoked sessions stay revoked. Issuing a replacement link invalidates earlier pending links. Delivery failure discards the new token and exits unsuccessfully; the invited account remains available for a later retry. Revoke disables all existing sessions and outstanding tokens. Commands never print email addresses or links, though operators should account for emails appearing in their shell history/process arguments.

## Protocol and limits

The auth operations are documented in `openapi.json`; runtime schemas and example fixtures live in `src/contracts/auth.ts`. Run `npm run contracts:generate` after changing schemas or HTTP contract definitions.

Opening `/auth/confirm#token=…` never consumes a link. The frontend moves the fragment secret into memory and removes it from the address bar. Only Continue sends a redemption POST. Refreshing that confirmation page requires reopening the email link. Login tokens expire after 15 minutes; redemption consumes the token, activates the account, and creates a distinct 30-day absolute-expiry browser session in one SQLite transaction. Only hashes are stored. CSRF tokens are derived from the session secret and remain in frontend memory.

Auth responses and confirmation pages use no-store and no-referrer headers. Login and access-request forms load the Cloudflare Turnstile widget. The confirmation screen uses local assets. Request URL/body/header logging is disabled; application failure messages omit raw exception/provider details. Unknown, pending, revoked, eligible, provider-failed, and delivery-quota-limited login requests receive the same generic 202 body. Invalid email syntax returns 422. Expired/used/invalid redemption tokens share one 400 response. Session absence/expiry returns 401; revoked access returns 403.

Defaults are 20 login requests per IP and 3 per normalized email per 15 minutes; 30 redemption attempts per IP per 15 minutes; and 100 delivery-quota attempts globally per 24 hours. Delivery quota is consumed only for eligible send attempts. Public requests enqueue normalized emails without looking up eligibility or waiting for the provider, then return the generic response. A single background worker handles eligibility, quota, token issuance, and delivery. The SQLite queue is capped at 1,000 jobs and expires requests after 15 minutes. A full queue still returns the generic response and requires the rider to request a link later. HTTP and CLI request throttles remain separate from delivery quota. HTTP and CLI share persistent buckets. Limit definitions are injectable through `AuthService` for tests and can be changed centrally in `defaultAuthLimits` for deployment. Rate-limit keys hash IP/email labels. Replacing links bounds outstanding tokens to one per account; expired records are cleaned during issuance/redemption. Access-request and login-link JSON bodies are capped at 4096 bytes to accommodate challenge tokens. Redemption/logout bodies are capped at 2048 bytes.

Origin checks require the configured frontend Origin on all public auth POSTs. Logout additionally requires the session's `X-CSRF-Token`; future protected publishing writes must use the exported same-origin/session/CSRF helpers. The direct-mode server ignores forwarded IP headers. Fly mode requires explicit trusted socket-peer CIDRs and validates Fly-Client-IP. Public-read admission, proxy configuration, and CAPTCHA/pending-account limits are documented in SECURITY_OPERATIONS.md. Publishing quotas are documented in SHARING_OPERATIONS.md.

The worker resumes pending jobs at startup. Graceful shutdown waits for the in-flight delivery (the provider adapter has a 10-second timeout) and leaves other jobs for restart. Failed delivery discards its token, logs a generic failure, and removes the job so the rider can retry. An abrupt crash can cause an in-flight delivery to be attempted again, spending another quota attempt and replacing its earlier link. Queue records contain normalized addresses and receive the same database access restrictions as accounts.

## Verification

`npm run check` includes auth HTTP/SQLite integration tests for invite eligibility, normalization, generic responses, scanner-safe GET, concurrent replay, expiry, superseded links, cookie properties, session status, CSRF/origin rejection, logout, account revocation, provider failure, payload limits, rate boundaries, schema fixtures, and database reopen preservation. Live email delivery, sender-domain configuration, real-browser mobile acceptance, persistent deployment, and backup/restore verification remain task 12 release checks.
