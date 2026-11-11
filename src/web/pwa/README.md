# Offline installation and updates

The production Vite plugin emits `sw.js` plus a versioned JSON library asset. Its cache version hashes emitted content and worker behavior, producing the same worker from the same build. The precache contains only the built public shell, bundled local drill guides, manifest, icons, and library. API/auth/health requests bypass the worker. Public snapshot data is never cached; `/s/:id` gets a local shell and its API request requires connectivity until saved locally.

`PwaStatus` registers only in production and verifies every asset before announcing offline readiness. Installation fails if required assets fail or active practice is detected. Waiting updates require an explicit action; both UI and worker check persisted practice state. If a browser automatically activates a waiting worker after all tabs close while practice is active, it keeps serving the preceding cache for that session, including the preceding hashed assets. Cache selection is recomputed from IndexedDB after worker restarts. Once the session ends, new navigation can load the new shell. An unreadable database keeps the old cache where available.

Worker activation never deletes local IndexedDB data. Schema migration/write errors continue to reject repository operations and are displayed by application screens. Failed readiness checks do not claim offline support. Applying a waiting update reloads the app only after activation; the initial installation does not force a reload.

`RecoveryScreen` exposes versioned JSON backup/merge, conflict details, and an explicit browser-persistence request. Local records do not sync with login; backups contain practice data only. Keep backups even when persistence is granted.

Tests simulate worker lifecycle/cache routing and use real repository operations over fake IndexedDB for recovery validation. Release still requires actual installation, airplane-mode, update, and storage-eviction checks on Safari and Chrome devices.
