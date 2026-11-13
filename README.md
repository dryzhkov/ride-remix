# Ride Remix

A mobile-first motorcycle practice PWA. React and IndexedDB power local practice, with a Node/SQLite service for invite-only login and shared snapshots.

## Development

Use Node 24 or newer and npm. Run `npm ci`, then `npm run dev`. Vite prints the frontend URL and proxies `/api` and `/healthz` to the local Node service on port 3000.

Run `npm run check` for lint, local storage tests, strict TypeScript checks, and production builds. Run `npm test` for the storage tests alone. Run `npm start` after building to serve both the application and HTTP API at `http://localhost:3000`. `PORT` overrides the server port. The development proxy targets port 3000.

## Layout

- `src/web` contains the React UI and browser HTTP client.
- `src/domain` contains validated practice entities, archive schemas, and the repository interface.
- `src/repositories` contains the IndexedDB adapter and storage integration tests.
- `src/contracts` contains runtime schemas and inferred API types.
- `src/server` contains HTTP routes and will hold server persistence adapters.
- `openapi.json` describes implemented HTTP contracts and marks the V1 routes reserved for subsequent tasks.

ESLint enforces dependency boundaries between the browser, server, domain, and contracts. The app includes local practice/history, invite-only authentication, snapshot sharing, offline readiness, and backup/recovery.

## Container

Run `docker build -t ride-remix .` and `docker run --rm -p 3000:3000 --env-file .env.production -v ride-remix-data:/app/data ride-remix`. The multi-stage image uses Node 24. Its entrypoint initializes mounted storage permissions and then runs the server as the unprivileged node user. `/healthz` reports process health. Unknown API routes return structured JSON errors. Browser navigation routes receive the application shell.

Fly configuration and the release/backup runbook are in [DEPLOYMENT.md](./DEPLOYMENT.md). Task 12 remains in progress until live deployment acceptance is recorded.

## App routes and mobile layout

- `/deck` lists saved decks; the **+ New deck** action opens `/deck/new`.
- `/deck/:deckId` opens the saved deck for remixing, sharing, or starting practice.
- `/practice` resumes the active session; `/practice/:sessionId` opens that exact snapshot, including completed sessions. Missing IDs show an error rather than another session.
- `/history` shows session summaries and drill progression; `/settings` contains JSON backup/restore, storage protection, and offline update controls.
- `/s/:id` and `/auth/*` retain their public-preview and sign-in behavior.

Main navigation stays fixed with icon labels and safe-area spacing. Generation, library details, setup, and sharing use progressive disclosure to keep daily practice compact. Browser refresh/back/forward and saved data are covered by the app integration test.

Task 10 validation also exercised headless Chrome at 320, 390, 820, and 1280px widths (no horizontal overflow; fixed navigation), plus production offline reloads of saved-deck, session, history, and settings routes. Physical iOS/Android acceptance remains part of release validation.

## Closed-beta access and security

Task 11 adds email access requests requiring manual approval, simple Turnstile verification on access/login requests, proxy-aware throttling and public-read limits, and application-wide security headers. Configure production Turnstile keys and the verified Fly proxy trust policy before starting the production image. Follow [SECURITY_OPERATIONS.md](./SECURITY_OPERATIONS.md) for setup, rate limits, SQL approval over Fly SSH, monitoring, and remaining release checks. The image ships `dist/server/auth/sql.js` for operator SQL access.

Request beta access at `/invite`. Approved riders sign in at `/auth/login`.

Releases use the manual GitHub **Deploy closed beta** workflow after Fly bootstrap. Checks and a fresh-volume container smoke run before deployment. Configure the production environment's app-scoped `FLY_API_TOKEN` and follow [DEPLOYMENT.md](./DEPLOYMENT.md).

The Account link opens `/account`. Signed-out riders choose Request beta access or Sign in before seeing the matching form and CAPTCHA. Signed-in riders see their account and Sign out. Direct `/invite` and `/auth/login` links open their respective forms.
