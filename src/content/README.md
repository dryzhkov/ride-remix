# Built-in drill library

`starter-library.v1.json` is the provisional version-1 runtime asset. Import `getStarterLibrary()` from `starter-library.ts` for a runtime-validated, independent copy. It contains the three designated starter cards; all use 10-minute practice blocks. Collection's incline is optional and is therefore not required equipment.

Logical drill UUIDs remain stable for the lifetime of each card. Treat published revision content as immutable: when changing a card, assign a new revision UUID and creation timestamp, retain its logical drill UUID, and increment `libraryVersion`. Update identity expectations in tests deliberately. Old deck/session snapshots keep their embedded revisions.

Keep review notes and original reference documents outside runtime assets. This library intentionally omits unresolved cards and Collection's suspension/lift progression. Content expansion and full review remain task 11. The starter library has no Obstacle Crossing card; generation must handle empty results for unsupported focus filters.

Task 4 consumes this module for deck generation; task 9 precaches the versioned library and controls when updates apply between sessions. This module does not install revisions into local storage or replace saved snapshots.
