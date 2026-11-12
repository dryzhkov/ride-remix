# Closed-beta security operations

Task 11 implements the controls below. Task 12 verifies live provider, browser, Fly networking, and backup behavior before launch.

## Turnstile setup

Create a Cloudflare Turnstile widget for the exact production hostname. Select **Non-interactive** mode for automatic verification. Managed mode can show a simple checkbox. Turnstile uses no image-selection puzzles.

Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` through Fly secrets, along with `PUBLIC_ORIGIN`, `RESEND_API_KEY`, and `EMAIL_FROM`. The public site key is served at `/api/v1/auth/challenge-config`. The secret remains server-side. Production startup requires both keys. Local practice works without CAPTCHA configuration in development, while online access requests and login-link requests fail closed. Use a separate development widget when exercising this flow locally.

The server verifies Siteverify success, exact hostname, expected `login` or `access_request` action, and token age of at most five minutes with 30 seconds of clock skew tolerance. Atomic SHA-256 token-use records reject replay across endpoints, including concurrent submissions. At most 10000 unexpired replay records are retained. Provider errors/timeouts deny the request and require a fresh challenge. No provider response, token, or secret enters logs.

Sources used for implementation are [Cloudflare validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) and [widget configuration](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/).

## Request and approve access

Visitors select Request beta access on the login page and submit an email after verification. Requests receive a generic receipt. Normalized addresses deduplicate. Repeated submissions preserve invited, active, and revoked states. A request creates a pending account and sends no email. Pending accounts cannot receive links, redeem existing tokens, or use existing sessions.

Pending records are capped at 1000. Records older than 30 days are removed when handling new access requests. Submission limits are 10 per IP and 3 per email per 15 minutes, plus 500 globally per hour. These limits apply before contacting Turnstile. Existing login quotas remain independent.

After deployment, connect to the running Machine with your authorized Fly account.

```sh
fly ssh console -a YOUR_APP
cd /app
```

`DATABASE_PATH` must identify the database on the mounted volume. The image ships a Node SQLite helper, so installing a separate sqlite shell is unnecessary. It refuses to create a missing database. Each invocation accepts one SQL statement on stdin. First list pending requests.

```sh
node dist/server/auth/sql.js <<'SQL'
SELECT email, datetime(created_at / 1000, 'unixepoch') AS requested_at
FROM accounts WHERE status='pending' ORDER BY created_at;
SQL
```

Approve the exact normalized email and verify `changes: 1`.

```sh
node dist/server/auth/sql.js <<'SQL'
UPDATE accounts SET status='invited', updated_at=unixepoch()*1000
WHERE email='rider@example.com' AND status='pending';
SQL
```

Verify the result.

```sh
node dist/server/auth/sql.js <<'SQL'
SELECT email,status FROM accounts WHERE email='rider@example.com';
SQL
```

Tell the rider to request a sign-in link afterward. SQL approval sends no notification. A zero-row update means the record was absent or already changed. Review the row before taking another action. Use the existing operator `auth/cli.js revoke` command for revocation so tokens and sessions are invalidated together. Revoked emails cannot regain access by resubmitting a request.

Approval data uses schema version 3. Startup migrates the account status CHECK constraint while preserving IDs and dependent tokens, sessions, and publications, then verifies foreign keys. Take a consistent database backup before deploying migrations as part of task 12.

## Fly client IP and traffic admission

Use `CLIENT_IP_MODE=fly` and set `TRUSTED_PROXY_CIDRS` to the verified immediate Fly Proxy socket peer CIDRs for this app. Fly Machines default to fly mode when `FLY_APP_NAME` is set. Missing trusted CIDRs prevent startup. Values are comma-separated IPv4/IPv6 CIDRs. Confirm peers in a controlled deployment before setting narrow ranges. Do not use `0.0.0.0/0` or `::/0`.

Fly mode accepts `Fly-Client-IP` only from those peers, requires one valid IP, and ignores `X-Forwarded-For` and `CF-Connecting-IP`. Other peers are rejected. Keep direct public container access disabled and isolate the app from untrusted org/private-network workloads that could impersonate a trusted proxy. The process health endpoint works locally without proxy headers. Development and deployments without a proxy use `CLIENT_IP_MODE=direct`, which ignores every forwarding header.

This policy assumes Fly Proxy is the public edge. Adding Cloudflare or another proxy in front requires a reviewed trust policy rather than blindly trusting its headers. Verify different external clients receive independent limits and that spoofed forwarded headers cannot bypass them. Fly documents the header contract and forwarding cautions here. [Fly request headers](https://fly.io/docs/networking/request-headers/)

All public paths except health are limited to 300 requests/IP/minute and 3000 requests/process/minute. Buckets are bounded to 10000 clients. At most 100 requests are admitted concurrently. Timeouts are 15 seconds for receiving requests, 10 seconds socket inactivity, and 5 seconds keep-alive, with at most 100 requests/socket. Rate-limit responses include Retry-After. These controls include public snapshot reads and static assets. Process limits reset on restart, while auth and publishing quotas persist in SQLite.

In task 12, configure Fly's HTTP service with forced HTTPS and request concurrency limits. A starting configuration is shown below, to integrate into the actual app configuration rather than deploy on its own.

```toml
[http_service]
  internal_port = 3000
  force_https = true

[http_service.concurrency]
  type = "requests"
  soft_limit = 30
  hard_limit = 50
```

App admission limits protect the single Machine. Large network floods still require provider/edge controls. Review limits against real beta usage and monitor 429/503 rates before changing them.

## Headers and monitoring

Every application route receives CSP, frame denial, nosniff, and a no-referrer policy. CSP permits the Cloudflare challenge script/frame/connect origins and local assets. Inline styles support existing React layout, while arbitrary inline scripts remain blocked. API and auth responses use no-store. Login confirmation renders no Turnstile widget until the normal login form is used.

Security logs report event types and aggregated counts, at most once per event/minute, for request throttling, untrusted proxy routes, concurrency rejection, delivery queue saturation, email quota exhaustion, provider failures, and pending-access capacity. They exclude emails, client IPs, tokens, and custom deck content. Observe Fly logs and configure alerting for sustained events during deployment. Operator listing/approval output intentionally contains requested emails and should remain in the authorized SSH session.

## Remaining release verification

- Real production-hostname Turnstile completion and retry after expiration, including mobile Safari and Android Chrome.
- Live email delivery, manual SQL approval, new-browser re-login, logout, and revocation.
- Actual Fly socket peer trust, spoofed forwarding headers, independent external client limits, forced HTTPS, and volume permissions.
- Production browser CSP, static assets, direct shared links, offline readiness, practice, worker updates, backup/import, and database restore.
- Configure provider-level traffic protections/alerts and verify quotas against expected beta usage.

Dependency audit and automated checks are recorded in the implementation handoff. Full card review remains task 13.
