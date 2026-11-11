# Ride Remix

A mobile-first motorcycle practice PWA. The scaffold provides the React application shell, Node server, runtime-validated shared HTTP contracts, and build/CI configuration.

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

ESLint enforces dependency boundaries between the browser, server, domain, and contracts. Domain/storage schemas and local persistence are implemented. Later tasks add authentication, sharing, offline caching, install icons, and feature screens. The web manifest establishes the PWA entry point. Offline readiness is delivered in task 9.

## Container

Run `docker build -t ride-remix .` and `docker run --rm -p 3000:3000 ride-remix`. The multi-stage image uses Node 24 and runs as an unprivileged user. `/healthz` reports process health. Unknown API routes return structured JSON errors. Browser navigation routes receive the application shell.

Fly configuration, persistent SQLite storage, and email delivery configuration are delivered with the corresponding implementation tasks.

## App routes and mobile layout

- `/deck` lists saved decks; the **+ New deck** action opens `/deck/new`.
- `/deck/:deckId` opens the saved deck for remixing, sharing, or starting practice.
- `/practice` resumes the active session; `/practice/:sessionId` opens that exact snapshot, including completed sessions. Missing IDs show an error rather than another session.
- `/history` shows session summaries and drill progression; `/settings` contains JSON backup/restore, storage protection, and offline update controls.
- `/s/:id` and `/auth/*` retain their public-preview and sign-in behavior.

Main navigation stays fixed with icon labels and safe-area spacing. Generation, library details, setup, and sharing use progressive disclosure to keep daily practice compact. Browser refresh/back/forward and saved data are covered by the app integration test.

Task 10 validation also exercised headless Chrome at 320, 390, 820, and 1280px widths (no horizontal overflow; fixed navigation), plus production offline reloads of saved-deck, session, history, and settings routes. Physical iOS/Android acceptance remains part of release validation.
