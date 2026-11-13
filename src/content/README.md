# Built-in drill library

`starter-library.v1.json` uses schema version 1 and library version 2. Import `getStarterLibrary()` from `starter-library.ts` for a runtime-validated, independent copy. It contains all 24 cards approved in the content review, with 10-minute isolated skills and 15-minute combined techniques. The two double-blip cards remain deferred.

22 cards support automatic generation. Rut Control and Sidehill Control are manually selectable with explicit terrain requirements. Optional inclines do not count as required equipment. Obstacle Crossing is now covered by the library.

Logical drill UUIDs remain stable for the lifetime of each card. Treat published revision content as immutable: when changing a card, assign a new revision UUID and creation timestamp, retain its logical drill UUID, and increment `libraryVersion`. Update identity expectations in tests deliberately. Old deck/session snapshots keep their embedded revisions.

Keep review notes and original reference documents outside runtime assets. The approved cards retain concise technique summaries rather than inventing missing input sequences. Sidehill Control uses the source's connection to rut balance and traction cues. The On / Off / Out / In Drill retains the confirmed base sequence without the suspension/lift progression.

The renamed drill keeps Collection's logical ID, with a new revision ID and timestamp. Other existing revisions are unchanged. New built-in cards receive permanent logical and revision UUIDs.

Task 4 consumes this module for deck generation; task 9 precaches the versioned library and controls when updates apply between sessions. This module does not install revisions into local storage or replace saved snapshots.
