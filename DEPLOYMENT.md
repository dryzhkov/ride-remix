# Deploy and validate

The initial release is deployed at https://ride-remix.fly.dev. Task 12 remains in progress for live browser/provider and mobile offline acceptance. GitHub Actions is the deployment entry point. The repository includes a Fly configuration, a volume-permission initializer, and a consistent SQLite backup tool. Deployment creates billable Fly resources.

## Current validation

- Fly CLI is installed. The current shell has no authenticated Fly account.
- Docker is unavailable locally. The GitHub release workflow builds and smoke-tests the image, but no remote workflow run has occurred.
- Automated application, API, storage, CAPTCHA, proxy-policy, and worker-cache checks run through `npm run check`.
- The SQLite recovery test restores accounts, valid sessions, and an immutable publication from committed WAL data into a separate database.
- Browser automation could not connect because its host is unavailable. Production-hostname Turnstile, real email, Fly networking, physical mobile browsers, and end-to-end airplane-mode acceptance remain pending.

## Configuration choices

`fly.toml` proposes app name `ride-remix`, region `sjc`, one shared CPU, 512 MiB RAM, and a volume named `ride_remix_data` mounted at `/app/data`. Confirm app-name availability and the preferred region before provisioning. Keep the same region for the app and volume.

Immediate deployments deliberately accept downtime on this single-Machine topology. Auto-stop is off so the persistent email queue continues processing. The HTTP service forces HTTPS, admits 30 soft/50 hard concurrent requests, and checks `/healthz`. The config alone does not enforce a one-Machine fleet. Always deploy with `--ha=false`, use `fly scale count 1`, and inspect `fly machine list` after deployment. Do not clone the Machine with an independent database.

The runtime entrypoint briefly runs as root to initialize the mounted database directory and existing database/WAL file ownership. It then execs the server as the unprivileged `node` user. This handles a fresh root-owned volume masking the directory built into the image. The image includes `gosu` from Debian's signed package repository.

## Before provisioning

1. Authenticate with `fly auth login` using your authorized Fly account.
2. Confirm or edit `app` and `primary_region` in `fly.toml`, then run `fly config validate --strict`.
3. Select the public HTTPS origin and configure its domain/certificate if using a custom domain.
4. Create a Turnstile **Non-interactive** widget for that exact hostname. Keep its public site key and server secret separate.
5. Verify a Resend sender domain and select `EMAIL_FROM`. Obtain a scoped provider API key.
6. Retain the IPv4-only application listener and Fly HTTP service. Fly runtime metadata enables the documented Fly client-IP policy. Review [security operations](./SECURITY_OPERATIONS.md) and validate spoofing resistance after deployment.

## GitHub Actions deployment

The repository includes `.github/workflows/deploy.yml`. Start releases manually using **Actions → Deploy closed beta → Run workflow** on the intended commit. The workflow runs the complete checks, builds the production image, smoke-tests a fresh Docker volume and the backup tool, then deploys through Fly. A shared concurrency group serializes releases and does not cancel a deployment in progress.

The GitHub remote is `https://github.com/dryzhkov/ride-remix.git`. Push the reviewed source and deployment workflow to the default branch before running the release workflow. Create a GitHub `production` environment and store an app-scoped Fly deploy token as its `FLY_API_TOKEN` secret. Generate a time-limited token with `fly tokens create deploy --app YOUR_APP --expiry 720h` after Fly authentication. Rotate it before expiry. Keep Resend/Turnstile keys and runtime settings in Fly secrets. GitHub only needs deployment access.

The Fly setup action is pinned to a source commit and flyctl 0.4.2, matching the locally inspected CLI. The workflow enforces `--ha=false`, scales to one Machine, and lists checks/Machines. Select the final app/region in the committed `fly.toml` before running it. Initial app/volume/domain/provider provisioning is still required below. Take and download a verified backup before subsequent releases that migrate server data.

A push-triggered main-branch deployment can be enabled after the first closed-beta rollout is verified. Manual dispatch is the initial choice to keep the first production rollout explicit.

## First deployment

Run these after the choices above are complete. Substitute your actual app and region.

```sh
fly apps create YOUR_APP
fly volumes create ride_remix_data --app YOUR_APP --region sjc --size 1
```

Set secrets with `fly secrets import --app YOUR_APP` from a private, mode-600 environment file or secure stdin. Do not paste secret values into shell command arguments or commit that file. Required entries are `PUBLIC_ORIGIN`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`. The configuration already sets `CLIENT_IP_MODE=fly` and the mounted `DATABASE_PATH`.

```sh
# Prefer the GitHub workflow after provisioning. Equivalent local commands are shown here.
fly deploy --app YOUR_APP --ha=false --strategy immediate
fly scale count 1 --app YOUR_APP
fly machine list --app YOUR_APP
fly volumes list --app YOUR_APP
fly checks list --app YOUR_APP
fly status --app YOUR_APP
```

Verify exactly one Machine and one attached volume in the selected region. Check that `/healthz` returns 200, HTTP redirects to HTTPS, auth responses use no-store, and `/invite`, `/auth/login`, `/deck/new`, `/history`, `/settings`, and `/s/UNKNOWN_ID` resolve correctly. The unknown shared ID must show an unavailable-deck state rather than private data.

Use Fly SSH to inspect effective identity and storage permissions. The application process should run as `node`, the database directory should be writable by node and mode 700, and the database should be mode 600. Keep the volume outside the public web root.

## Server backup

The tool uses SQLite's online backup API and verifies database integrity, foreign keys, and schema versions. It refuses an existing destination. It includes committed WAL content while the application is running. Run it as `node` so the resulting files belong to the application user.

```sh
fly ssh console --app YOUR_APP
cd /app
mkdir -p /app/data/backups
chown node:node /app/data/backups
chmod 700 /app/data/backups
su -s /bin/sh node -c 'node dist/server/backup.js backup /app/data/ride-remix.sqlite /app/data/backups/pre-release-YYYYMMDD.sqlite'
node dist/server/backup.js verify /app/data/backups/pre-release-YYYYMMDD.sqlite
```

Choose a unique filename for each backup. Take one before every migration/deployment. Download it using `fly ssh sftp get`, keep it in access-restricted encrypted storage, and verify the downloaded copy with the same tool. A copy left on the same volume does not cover volume loss. Fly volume snapshots supplement these copies. Set retention and periodic off-volume backups during deployment operations.

The database contains emails and authentication hashes. Limit access to authorized operators. Database backups cover server accounts and publications. Riders use the JSON export in Settings for personal decks and practice history.

## Restore drill and recovery

Practice this in a disposable environment before launch. Use a new candidate path so the current database and WAL files remain intact. Never copy a live SQLite main file by itself or overwrite a database that the server has open.

1. Verify the downloaded snapshot, upload it through Fly SFTP if needed, then create a verified candidate with `backup.js backup SNAPSHOT /app/data/restored-YYYYMMDD.sqlite`.
2. Plan a maintenance window. Restoring rolls server state back to the backup timestamp, including session and publication state. Freeze user traffic at the edge for the cutover and record the current `DATABASE_PATH`.
3. Stage a `DATABASE_PATH` override pointing to the candidate using `fly secrets set --stage DATABASE_PATH=/app/data/restored-YYYYMMDD.sqlite --app YOUR_APP`, then deploy with `--ha=false --strategy immediate`. Secrets override the default in `fly.toml`. The entrypoint initializes candidate ownership. Keep one Machine on the same volume.
4. Verify health, account approval state, login behavior, and a known shared snapshot. Check that the server uses the candidate path. Once traffic resumes, new writes go to the candidate database.
5. Keep the previous database for incident recovery. Switching back discards writes made to the candidate, so reconcile that explicitly before rollback. Restore operational secrets and code versions separately if the backup's schema requires an earlier release.

A backup also contains old session-validity state. If restoring across an account-revocation incident, reapply affected revocations before reopening traffic.

## Release acceptance record

Complete and record these on the deployed HTTPS origin before marking task 12 complete.

| Check | Required result | Current state |
| --- | --- | --- |
| Container | Image builds, starts on a fresh mounted volume, serves health, and runs server as node | GitHub release container and fresh-volume smoke passed |
| Networking | Trusted peers accepted, spoofed forwarding rejected, two external clients receive independent limits | Fly HTTPS and IPv4 proxy path serving requests. Multi-client/spoofing live checks pending |
| Access approval | Submit at `/invite`, verify pending denial, approve through SQL, receive and redeem email | Keys deployed. Live CAPTCHA/email approval flow pending |
| Identity recovery | New browser logs into same account. Logout and operator revocation invalidate access | Pending live browser |
| Sharing | Publish custom drill, preview publicly in another browser, save independent local copy | Automated coverage. Live pending |
| Offline | Both riders save online, reopen in airplane mode, log independently, build next deck, repeat a drill | Automated coverage. Physical mobile pending |
| Updates | Waiting update stays deferred during practice and applies between sessions without data loss | Worker simulation coverage. Live lifecycle pending |
| Rider recovery | JSON export/import retains history, reports conflicts, and preserves active session | Automated coverage. Physical mobile pending |
| Server recovery | Off-volume backup restores into a fresh candidate with accounts, sessions, and shared snapshots | Local restore drill passed. Live Fly backup creation/integrity verification passed. Restore cutover pending |
| Monitoring | Observe security events, delivery failures, quota exhaustion, health failures and disk usage | Pending live configuration |

## Sources

[Fly configuration](https://fly.io/docs/reference/configuration/), [Fly volume management](https://fly.io/docs/volumes/volume-manage/), [Fly deploy CLI](https://fly.io/docs/flyctl/deploy/), [Fly GitHub Actions guide](https://fly.io/docs/launch/continuous-deployment-with-github-actions/), and [Node SQLite backup API](https://nodejs.org/api/sqlite.html#sqlitebackupsourceDb-path-options) informed the configuration and recovery procedure.

## Provisioning progress

Fly app `ride-remix` and GitHub production environment/deploy secret are created. Seattle (`sea`) was rejected by Fly during provisioning, so the configuration uses San Jose (`sjc`). Provider secrets are deployed. GitHub release run 43168443667 succeeded for commit cc35db2. One 512 MiB Machine is healthy in sjc with the encrypted volume attached. Public HTTPS routes, HTTP redirect, auth no-store/CSP, unauthenticated 401 and missing-snapshot 404 checks passed. Live browser automation remains unavailable.
